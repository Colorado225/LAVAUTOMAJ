import type { NextFunction, Request, Response } from "express"
import { getPool } from "./db.ts"
import {
  getClerkOrganizationMembershipRole,
  getClerkOrganizationProfile,
  getClerkUserProfile,
  HttpError,
} from "./auth.ts"
import type { PoolClient } from "pg"
import type { TenantContext } from "./types.ts"

export function roleFromClerkRole(role: string | null): string {
  if (role === "org:admin" || role === "org:owner") return "owner"
  if (role === "org:manager") return "manager"
  return "cashier"
}

/** Serialize member creation within a tenant so plan limits cannot be raced. */
export async function assertOrganizationUserCapacity(client: PoolClient, organizationId: string, userId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`membership-limit:${organizationId}`])
  const existing = await client.query(
    `SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
    [organizationId, userId]
  )
  if (existing.rowCount) return

  const capacity = await client.query<{ max_users: number | null; active_count: string }>(
    `SELECT p.max_users, COUNT(u.id)::text AS active_count
     FROM organizations o
     JOIN plans p ON p.code = o.plan
     LEFT JOIN organization_members m ON m.organization_id = o.id
     LEFT JOIN users u ON u.id = m.user_id AND u.status = 'active'
     WHERE o.id = $1
     GROUP BY p.max_users`,
    [organizationId]
  )
  const limit = capacity.rows[0]
  if (!limit) throw new HttpError(409, "subscription_required", "Aucun forfait actif n'est associé à cette organisation.")
  if (limit.max_users !== null && Number(limit.active_count) >= limit.max_users) {
    throw new HttpError(403, "plan_user_limit", `Votre forfait autorise au maximum ${limit.max_users} comptes utilisateurs.`)
  }
}

/**
 * Resolves the active Clerk organization to a local tenant and makes sure the
 * Clerk user/membership are mirrored in Neon. Organization IDs always come
 * from a cryptographically verified Clerk token, never from request data.
 */
export async function syncCurrentTenant(req: Request): Promise<TenantContext> {
  const principal = req.auth
  if (!principal) throw new HttpError(401, "unauthenticated", "Authentification requise.")
  if (!principal.clerkOrgId) {
    throw new HttpError(409, "organization_required", "Créez ou sélectionnez une organisation Clerk pour continuer.")
  }

  const pool = getPool()
  if (!pool) throw new HttpError(503, "database_not_configured", "La base de données Neon n'est pas configurée.")

  const [userProfile, orgProfile, clerkRole] = await Promise.all([
    getClerkUserProfile(principal.clerkUserId),
    getClerkOrganizationProfile(principal.clerkOrgId),
    getClerkOrganizationMembershipRole(principal.clerkOrgId, principal.clerkUserId),
  ])
  if (!clerkRole) {
    throw new HttpError(403, "organization_membership_required", "Vous n'appartenez plus à cette organisation Clerk.")
  }
  const activeRole = roleFromClerkRole(clerkRole)

  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const orgResult = await client.query<{
      id: string
      name: string
      onboarding_completed: boolean
    }>(
      `INSERT INTO organizations (clerk_org_id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (clerk_org_id) DO UPDATE SET
         name = CASE WHEN organizations.onboarding_completed THEN organizations.name ELSE EXCLUDED.name END,
         slug = COALESCE(organizations.slug, EXCLUDED.slug),
         updated_at = NOW()
       RETURNING id, name, onboarding_completed`,
      [orgProfile.id, orgProfile.name, orgProfile.slug]
    )
    const organization = orgResult.rows[0]
    if (!organization) throw new Error("Organization upsert returned no row")

    const userResult = await client.query<{ id: string; status: string }>(
      `INSERT INTO users (
         clerk_user_id, organization_id, first_name, last_name, email,
         phone, avatar_url, status, last_sign_in_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW())
       ON CONFLICT (clerk_user_id) DO UPDATE SET
         organization_id = COALESCE(users.organization_id, EXCLUDED.organization_id),
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         email = EXCLUDED.email,
         phone = EXCLUDED.phone,
         avatar_url = EXCLUDED.avatar_url,
         last_sign_in_at = CASE
           WHEN users.last_sign_in_at IS NULL OR users.last_sign_in_at < NOW() - INTERVAL '5 minutes' THEN NOW()
           ELSE users.last_sign_in_at
         END,
         updated_at = NOW()
         RETURNING id, status`,
      [
        userProfile.id,
        organization.id,
        userProfile.firstName,
        userProfile.lastName,
        userProfile.email,
        userProfile.phone,
        userProfile.avatarUrl,
      ]
    )
    const user = userResult.rows[0]
    if (!user) throw new Error("User upsert returned no row")
    if (user.status !== "active") {
      throw new HttpError(403, "user_inactive", "Ce compte a été désactivé. Contactez le propriétaire de l'organisation.")
    }

    await assertOrganizationUserCapacity(client, organization.id, user.id)
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, organization_id) DO UPDATE SET
         role = EXCLUDED.role,
         updated_at = NOW()`,
      [organization.id, user.id, activeRole]
    )

    await client.query(
      `INSERT INTO onboarding_progress (organization_id, current_stage)
       VALUES ($1, 'station')
       ON CONFLICT (organization_id) DO NOTHING`,
      [organization.id]
    )

    const progressResult = await client.query<{ current_stage: string | null }>(
      `SELECT current_stage FROM onboarding_progress WHERE organization_id = $1`,
      [organization.id]
    )

    await client.query("COMMIT")
    return {
      organizationId: organization.id,
      clerkOrgId: orgProfile.id,
      clerkUserId: userProfile.id,
      userId: user.id,
      role: activeRole,
      organizationName: organization.name,
      onboardingCompleted: organization.onboarding_completed,
      currentStage: progressResult.rows[0]?.current_stage ?? "station",
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    if (typeof error === "object" && error !== null && "code" in error) {
      const pgError = error as { code?: string; constraint?: string }
      if (pgError.code === "23505") {
        if (pgError.constraint?.includes("email")) {
          throw new HttpError(409, "user_email_conflict", "Cette adresse e-mail est déjà associée à un autre compte.")
        }
        if (pgError.constraint?.includes("slug")) {
          throw new HttpError(409, "organization_slug_conflict", "Le slug Clerk de cette organisation est déjà utilisé.")
        }
      }
    }
    throw error
  } finally {
    client.release()
  }
}

async function resolveTenantContext(req: Request): Promise<TenantContext> {
  const principal = req.auth
  if (!principal) throw new HttpError(401, "unauthenticated", "Authentification requise.")
  if (!principal.clerkOrgId) {
    throw new HttpError(409, "organization_required", "Créez ou sélectionnez une organisation Clerk pour continuer.")
  }

  const pool = getPool()
  if (!pool) throw new HttpError(503, "database_not_configured", "La base de données Neon n'est pas configurée.")
  const existing = await pool.query<{
    organization_id: string
    clerk_org_id: string
    clerk_user_id: string
    user_id: string
    role: string
    organization_name: string
    onboarding_completed: boolean
    current_stage: string | null
  }>(
    `SELECT o.id AS organization_id, o.clerk_org_id, u.clerk_user_id,
            u.id AS user_id, m.role, o.name AS organization_name,
            o.onboarding_completed, p.current_stage
     FROM organizations o
     JOIN organization_members m ON m.organization_id = o.id
     JOIN users u ON u.id = m.user_id AND u.status = 'active'
     LEFT JOIN onboarding_progress p ON p.organization_id = o.id
     WHERE o.clerk_org_id = $1 AND u.clerk_user_id = $2
     LIMIT 1`,
    [principal.clerkOrgId, principal.clerkUserId]
  )

  const row = existing.rows[0]
  if (row) {
    let activeRole = row.role
    if (principal.clerkOrgRole) {
      const tokenRole = roleFromClerkRole(principal.clerkOrgRole)
      if (tokenRole !== row.role) {
        const verifiedRole = await getClerkOrganizationMembershipRole(principal.clerkOrgId, principal.clerkUserId)
        if (!verifiedRole) {
          throw new HttpError(403, "organization_membership_required", "Vous n'appartenez plus à cette organisation Clerk.")
        }
        activeRole = roleFromClerkRole(verifiedRole)
        if (activeRole !== row.role) {
          await pool.query(
            `UPDATE organization_members SET role = $3, updated_at = NOW()
             WHERE organization_id = $1 AND user_id = $2`,
            [row.organization_id, row.user_id, activeRole]
          )
        }
      }
    }
    if (!row.current_stage) {
      const stage = row.onboarding_completed ? "review" : "station"
      await pool.query(
        `INSERT INTO onboarding_progress (organization_id, current_stage, completed_at)
         VALUES ($1, $2, CASE WHEN $3 THEN NOW() ELSE NULL END)
         ON CONFLICT (organization_id) DO NOTHING`,
        [row.organization_id, stage, row.onboarding_completed]
      )
    }
    return {
      organizationId: row.organization_id,
      clerkOrgId: row.clerk_org_id,
      clerkUserId: row.clerk_user_id,
      userId: row.user_id,
      role: activeRole,
      organizationName: row.organization_name,
      onboardingCompleted: row.onboarding_completed,
      currentStage: row.current_stage ?? (row.onboarding_completed ? "review" : "station"),
    }
  }

  // A newly created Clerk org or a newly joined member is mirrored on first use.
  return syncCurrentTenant(req)
}

export function requireTenantContext(req: Request, _res: Response, next: NextFunction) {
  void resolveTenantContext(req)
    .then((currentTenant) => {
      req.tenant = currentTenant
      next()
    })
    .catch(next)
}

export async function upsertGlobalClerkUser(profile: {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  phone?: string | null
  avatarUrl?: string | null
}): Promise<void> {
  const pool = getPool()
  if (!pool) throw new HttpError(503, "database_not_configured", "La base de données Neon n'est pas configurée.")

  try {
    await pool.query(
      `INSERT INTO users (clerk_user_id, email, first_name, last_name, phone, avatar_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       ON CONFLICT (clerk_user_id) DO UPDATE SET
         email = EXCLUDED.email,
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         phone = EXCLUDED.phone,
         avatar_url = EXCLUDED.avatar_url,
         updated_at = NOW()`, 
      [
        profile.id,
        profile.email.trim().toLowerCase(),
        profile.firstName?.trim() || null,
        profile.lastName?.trim() || null,
        profile.phone || null,
        profile.avatarUrl || null,
      ]
    )
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) {
      const pgError = error as { code?: string; constraint?: string }
      if (pgError.code === "23505") {
        throw new HttpError(409, "user_email_conflict", "Cette adresse e-mail est déjà associée à un autre compte.")
      }
    }
    throw error
  }
}
