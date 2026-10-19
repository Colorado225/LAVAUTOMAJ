import type { NextFunction, Request, Response } from "express"
import { verifyToken } from "@clerk/backend"
import { env } from "./env.ts"

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
export interface AuthContext { clerkUserId: string; clerkOrgId: string | null; clerkRole: string | null; sessionId: string | null }
// Express request augmentation requires a namespace declaration by design.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare global { namespace Express { interface Request { auth?: AuthContext; tenant?: { organizationId: string; userId: string; role: string; siteId?: string } } } }

export async function requireClerkSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.get("authorization") || ""
    const match = /^Bearer\s+(.+)$/i.exec(header)
    if (!match) throw new HttpError(401, "authentication_required", "Connectez-vous pour continuer.")
    if (!env.CLERK_SECRET_KEY && !env.CLERK_JWT_KEY) throw new HttpError(503, "auth_not_configured", "Le service d'authentification n'est pas configuré.")
    const claims = await verifyToken(match[1], {
      secretKey: env.CLERK_SECRET_KEY || undefined,
      jwtKey: env.CLERK_JWT_KEY || undefined,
      authorizedParties: env.CLERK_AUTHORIZED_PARTIES.length ? env.CLERK_AUTHORIZED_PARTIES : undefined,
    })
    const sub = typeof claims.sub === "string" ? claims.sub : ""
    if (!sub.startsWith("user_")) throw new HttpError(401, "invalid_session", "Session invalide. Reconnectez-vous.")
    req.auth = {
      clerkUserId: sub,
      clerkOrgId: typeof claims.org_id === "string" ? claims.org_id : null,
      clerkRole: typeof claims.org_role === "string" ? claims.org_role : null,
      sessionId: typeof claims.sid === "string" ? claims.sid : null,
    }
    next()
  } catch (error) {
    if (error instanceof HttpError) return next(error)
    next(new HttpError(401, "invalid_session", "Votre session a expiré ou n'est pas valide. Reconnectez-vous."))
  }
}
export async function getClerkUserProfile(userId: string) {
  if (!env.CLERK_SECRET_KEY) throw new HttpError(503,"clerk_not_configured","Clerk n'est pas configuré.")
  const r = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {headers:{Authorization:`Bearer ${env.CLERK_SECRET_KEY}`}})
  if (!r.ok) throw new HttpError(502,"clerk_profile_unavailable","Impossible de récupérer le profil Clerk.")
  const d = await r.json() as Record<string, unknown>
  const emails = Array.isArray(d.email_addresses) ? d.email_addresses as Array<Record<string,unknown>> : []
  const primary = emails.find(e=>e.id===d.primary_email_address_id) || emails[0] || {}
  return { id:userId, email:String(primary.email_address||""), firstName:typeof d.first_name==="string"?d.first_name:null, lastName:typeof d.last_name==="string"?d.last_name:null, phone:null as string|null, avatarUrl:typeof d.image_url==="string"?d.image_url:null }
}
export async function getClerkOrganizationProfile(orgId: string) {
  if (!env.CLERK_SECRET_KEY) throw new HttpError(503,"clerk_not_configured","Clerk n'est pas configuré.")
  const r=await fetch(`https://api.clerk.com/v1/organizations/${encodeURIComponent(orgId)}`,{headers:{Authorization:`Bearer ${env.CLERK_SECRET_KEY}`}})
  if(!r.ok) throw new HttpError(502,"clerk_organization_unavailable","Impossible de récupérer l'organisation Clerk.")
  const d=await r.json() as Record<string,unknown>
  return {id:orgId,name:String(d.name||"Mon organisation"),slug:typeof d.slug==="string"?d.slug:null}
}
export async function getClerkOrganizationMembershipRole(orgId:string,userId:string):Promise<string|null>{
 if(!env.CLERK_SECRET_KEY)return null
 const r=await fetch(`https://api.clerk.com/v1/organizations/${encodeURIComponent(orgId)}/memberships?user_id=${encodeURIComponent(userId)}&limit=1`,{headers:{Authorization:`Bearer ${env.CLERK_SECRET_KEY}`}})
 if(!r.ok)return null
 const d=await r.json() as {data?:Array<Record<string,unknown>>}
 const row=d.data?.[0]; const role=row&&typeof row.role==="string"?row.role:null
 return role
}
export function invalidateClerkProfileCache(_id:string) {}
export function invalidateClerkOrganizationCache(_id:string) {}
export function invalidateClerkOrganizationMembershipCache(_org:string,_user:string) {}
