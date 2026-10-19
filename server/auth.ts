import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto"
import { promisify } from "node:util"
import type { NextFunction, Request, Response } from "express"
import type pg from "pg"
import { getPool } from "./db.ts"
import { env } from "./env.ts"

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>

export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "HttpError"
    this.status = status
    this.code = code
  }
}

export interface AuthContext {
  userId: string
  email: string
  sessionId: string
}

// Express request augmentation requires a namespace declaration by design.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare global { namespace Express { interface Request { auth?: AuthContext; tenant?: { organizationId: string; userId: string; role: string; siteId?: string } } } }

// ---------------------------------------------------------------------------
// Password hashing (scrypt, Node built-in — no external dependency)
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN)
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false
  const [scheme, saltHex, hashHex] = stored.split(":")
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, "hex")
  const expected = Buffer.from(hashHex, "hex")
  const derived = await scrypt(password, salt, expected.length)
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

// ---------------------------------------------------------------------------
// Sessions (opaque token in an httpOnly cookie; only its SHA-256 is stored)
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "washpilot_session"
export const SESSION_TTL_DAYS = 30

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export async function createSession(pool: pg.Pool, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url")
  await pool.query(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + make_interval(days => $3))`,
    [userId, hashSessionToken(token), SESSION_TTL_DAYS],
  )
  return token
}

export async function destroySession(pool: pg.Pool, token: string): Promise<void> {
  await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [hashSessionToken(token)])
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: env.NODE_ENV === "production", path: "/" })
}

/** Read the raw session token from the request cookies (no cookie-parser needed). */
export function readSessionToken(req: Request): string | null {
  const header = req.get("cookie")
  if (!header) return null
  for (const part of header.split(";")) {
    const separator = part.indexOf("=")
    if (separator === -1) continue
    const name = part.slice(0, separator).trim()
    if (name !== SESSION_COOKIE) continue
    const value = part.slice(separator + 1).trim()
    return value ? decodeURIComponent(value) : null
  }
  return null
}

export interface SessionUser {
  sessionId: string
  userId: string
  email: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  avatarUrl: string | null
  status: string
}

/** Resolve the active user for the request's session cookie, or null. */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const token = readSessionToken(req)
  if (!token) return null
  const pool = getPool()
  if (!pool) return null
  const q = await pool.query(
    `SELECT s.id AS session_id, u.id AS user_id, u.email, u.first_name, u.last_name, u.phone, u.avatar_url, u.status
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()
     LIMIT 1`,
    [hashSessionToken(token)],
  )
  const row = q.rows[0] as {
    session_id: string; user_id: string; email: string; first_name: string | null
    last_name: string | null; phone: string | null; avatar_url: string | null; status: string
  } | undefined
  if (!row || row.status !== "active") return null
  // Sliding expiration: refresh the window on activity (best effort).
  void pool.query(
    `UPDATE auth_sessions SET last_used_at = NOW(), expires_at = NOW() + make_interval(days => $2) WHERE id = $1`,
    [row.session_id, SESSION_TTL_DAYS],
  ).catch(() => {})
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    status: row.status,
  }
}

/** Require a valid session cookie; attach the authenticated user to the request. */
export async function requireSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const pool = getPool()
    if (!pool) throw new HttpError(503, "database_not_configured", "La base de données n'est pas configurée.")
    const user = await getSessionUser(req)
    if (!user) throw new HttpError(401, "authentication_required", "Connectez-vous pour continuer.")
    req.auth = { userId: user.userId, email: user.email, sessionId: user.sessionId }
    next()
  } catch (error) {
    if (error instanceof HttpError) return next(error)
    next(new HttpError(401, "invalid_session", "Votre session a expiré ou n'est pas valide. Reconnectez-vous."))
  }
}
