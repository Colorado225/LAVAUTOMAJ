import type { NextFunction, Request, Response } from "express"
import type { PoolClient } from "pg"
import { getPool } from "./db.ts"
import {
  HttpError,
  getClerkOrganizationMembershipRole,
  getClerkOrganizationProfile,
  getClerkUserProfile,
  type AuthContext,
} from "./auth.ts"
import { env } from "./env.ts"

/** Map Clerk organization roles onto the application roles. */
export function roleFromClerkRole(role: string | null | undefined): string {
  if (role === "org:admin" || role === "admin") return "owner"
  if (role === "org:manager" || role === "manager") return "manager"
  if (role === "org:member" || role === "member") return "cashier"
  return "cashier"
}

interface TenantRow {
  organization_id: string
  user_id: string
  status: string
  role: string
}

async function findTenantRow(clerkOrgId: string, clerkUserId: string): Promise<TenantRow | null> {
  const pool = getPool()
  if (!pool) return null
  const q = await pool.query(
    `SELECT o.id AS organization_id, u.id AS user_id, u.status, m.role
     FROM organizations o
     JOIN organization_members m ON m.organization_id = o.id
     JOIN users u ON u.id = m.user_id
     WHERE o.clerk_org_id = $1 AND u.clerk_user_id = $2 LIMIT 1`,
    [clerkOrgId, clerkUserId],
  )
  return (q.rows[0] as TenantRow | undefined) ?? null
}

/**
 * Provision the organization + membership from the Clerk API when the webhook
 * has not synced them yet (first request after sign-up, dev without webhooks).
 */
async function provisionTenantFromClerk(clerkOrgId: string, clerkUserId: string): Promise<TenantRow | null> {
  const pool = getPool()
  if (!pool || !env.CLERK_SECRET_KEY) return null
  try {
    const [user, organization, clerkRole] = await Promise.all([
      getClerkUserProfile(clerkUserId),
      getClerkOrganizationProfile(clerkOrgId),
      getClerkOrganizationMembershipRole(clerkOrgId, clerkUserId),
    ])
    if (!clerkRole) return null
    const role = roleFromClerkRole(clerkRole)

    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const orgQ = await client.query(
        `INSERT INTO organizations (clerk_org_id, name, slug) VALUES ($1, $2, $3)
         ON CONFLICT (clerk_org_id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, updated_at = NOW()
         RETURNING id`,
        [clerkOrgId, organization.name, organization.slug],
      )
      const organizationId = orgQ.rows[0].id as string
      const userQ = await client.query(
        `INSERT INTO users (clerk_user_id, organization_id, email, first_name, last_name, avatar_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')
         ON CONFLICT (clerk_user_id) DO UPDATE SET
           email = EXCLUDED.email, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
           avatar_url = EXCLUDED.avatar_url, updated_at = NOW()
         RETURNING id, status`,
        [clerkUserId, organizationId, user.email, user.firstName, user.lastName, user.avatarUrl],
      )
      const userId = userQ.rows[0].id as string
      await client.query(
        `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
        [organizationId, userId, role],
      )
      await client.query(
        `INSERT INTO onboarding_progress (organization_id, current_stage) VALUES ($1, 'station')
         ON CONFLICT (organization_id) DO NOTHING`,
        [organizationId],
      )
      await client.query("COMMIT")
      return { organization_id: organizationId, user_id: userId, status: userQ.rows[0].status as string, role }
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    console.warn("[tenant] Auto-provisioning from Clerk failed:", error instanceof Error ? error.message : "unknown")
    return null
  }
}

/**
 * Last-resort provisioning from the *verified* token claims (org_id, org_slug,
 * org_role are signed by Clerk). Used when the Clerk REST API is unreachable
 * (e.g. restricted network): names/emails are placeholders until the webhook
 * or a reachable API call enriches them.
 */
async function provisionTenantFromClaims(auth: AuthContext): Promise<TenantRow | null> {
  const pool = getPool()
  if (!pool || !auth.clerkOrgId || !auth.clerkRole) return null
  const role = roleFromClerkRole(auth.clerkRole)
  const orgName = auth.clerkOrgSlug ? auth.clerkOrgSlug.replace(/-/g, " ") : "Mon organisation"
  const placeholderEmail = `${auth.clerkUserId}@clerk.local`

  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const orgQ = await client.query(
      `INSERT INTO organizations (clerk_org_id, name, slug) VALUES ($1, $2, $3)
       ON CONFLICT (clerk_org_id) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [auth.clerkOrgId, orgName, auth.clerkOrgSlug],
    )
    const organizationId = orgQ.rows[0].id as string
    const userQ = await client.query(
      `INSERT INTO users (clerk_user_id, organization_id, email, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (clerk_user_id) DO UPDATE SET updated_at = NOW()
       RETURNING id, status`,
      [auth.clerkUserId, organizationId, placeholderEmail],
    )
    const userId = userQ.rows[0].id as string
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
      [organizationId, userId, role],
    )
    await client.query(
      `INSERT INTO onboarding_progress (organization_id, current_stage) VALUES ($1, 'station')
       ON CONFLICT (organization_id) DO NOTHING`,
      [organizationId],
    )
    await client.query("COMMIT")
    console.info("[tenant] Provisioned organization from verified token claims (Clerk API unreachable).")
    return { organization_id: organizationId, user_id: userId, status: userQ.rows[0].status as string, role }
  } catch (error) {
    await client.query("ROLLBACK")
    console.warn("[tenant] Claims-based provisioning failed:", error instanceof Error ? error.message : "unknown")
    return null
  } finally {
    client.release()
  }
}

/** Resolve the Neon tenant for the verified Clerk session and attach it to the request. */
export async function requireTenantContext(req: Request, _res: Response, next: NextFunction) {
  try {
    const auth = req.auth
    if (!auth) throw new HttpError(401, "authentication_required", "Connectez-vous pour continuer.")
    const pool = getPool()
    if (!pool) throw new HttpError(503, "database_not_configured", "La base de données n'est pas configurée.")
    if (!auth.clerkOrgId) {
      throw new HttpError(403, "organization_required", "Sélectionnez ou créez une organisation pour continuer.")
    }

    let row = await findTenantRow(auth.clerkOrgId, auth.clerkUserId)
    if (!row) {
      // Webhook sync may lag behind the first authenticated request.
      row = await provisionTenantFromClerk(auth.clerkOrgId, auth.clerkUserId)
    }
    if (!row) {
      // Clerk REST API unreachable: fall back to the signed token claims.
      row = await provisionTenantFromClaims(auth)
    }
    if (!row || row.status !== "active") {
      throw new HttpError(403, "organization_membership_required", "Votre compte n'est pas membre de cette organisation.")
    }
    req.tenant = { organizationId: row.organization_id, userId: row.user_id, role: row.role }
    next()
  } catch (error) {
    next(error)
  }
}

/** Enforce the plan's max_users before adding a new member (advisory-locked per org). */
export async function assertOrganizationUserCapacity(client: PoolClient, organizationId: string, userId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [organizationId])
  const exists = await client.query(
    "SELECT 1 FROM organization_members WHERE organization_id=$1 AND user_id=$2",
    [organizationId, userId],
  )
  if (exists.rowCount) return
  const q = await client.query(
    `SELECT p.max_users, COUNT(m.id)::int AS active_count FROM organizations o
     LEFT JOIN subscriptions s ON s.organization_id = o.id
     LEFT JOIN plans p ON p.id = s.plan_id
     LEFT JOIN organization_members m ON m.organization_id = o.id
     WHERE o.id = $1 GROUP BY p.max_users`,
    [organizationId],
  )
  const row = q.rows[0]
  if (row?.max_users != null && Number(row.active_count) >= Number(row.max_users)) {
    throw new HttpError(409, "plan_user_limit", "Le nombre maximal d'utilisateurs de votre forfait est atteint.")
  }
}
