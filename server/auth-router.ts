import { Router } from "express"
import { getClerkUserProfile, HttpError } from "./auth.ts"
import { getPool } from "./db.ts"
import { syncCurrentTenant, upsertGlobalClerkUser } from "./tenant.ts"

export function createAuthRouter() {
  const router = Router()

  router.post("/sync", async (req, res) => {
    const principal = req.auth
    if (!principal) throw new HttpError(401, "unauthenticated", "Authentification requise.")

    const profile = await getClerkUserProfile(principal.clerkUserId)
    await upsertGlobalClerkUser(profile)

    if (!principal.clerkOrgId) {
      res.status(200).json({
        synced: true,
        requires_organization: true,
        message: "Le compte Clerk est synchronisé. Créez ou rejoignez une organisation pour accéder à l'espace de travail.",
      })
      return
    }

    const tenant = await syncCurrentTenant(req)
    res.status(200).json({
      synced: true,
      requires_organization: false,
      user: { id: tenant.userId, clerk_user_id: tenant.clerkUserId, email: profile.email },
      organization: {
        id: tenant.organizationId,
        clerk_org_id: tenant.clerkOrgId,
        name: tenant.organizationName,
        onboarding_completed: tenant.onboardingCompleted,
      },
    })
  })

  router.get("/me", async (req, res) => {
    const principal = req.auth
    if (!principal) throw new HttpError(401, "unauthenticated", "Authentification requise.")
    const pool = getPool()
    if (!pool) throw new HttpError(503, "database_not_configured", "La base de données Neon n'est pas configurée.")

    if (!principal.clerkOrgId) {
      const profile = await getClerkUserProfile(principal.clerkUserId)
      res.json({
        id: null,
        clerk_user_id: principal.clerkUserId,
        email: profile.email,
        first_name: profile.firstName,
        last_name: profile.lastName,
        organization: null,
      })
      return
    }

    const tenant = await syncCurrentTenant(req)
    const { rows } = await pool.query(
      `SELECT u.id, u.clerk_user_id, u.first_name, u.last_name, u.email,
              u.phone, u.avatar_url, u.status, m.role, o.id AS organization_id,
              o.name AS organization_name
       FROM users u
       JOIN organization_members m ON m.user_id = u.id
       JOIN organizations o ON o.id = m.organization_id
       WHERE u.id = $1 AND o.id = $2`,
      [tenant.userId, tenant.organizationId]
    )
    if (!rows[0]) throw new HttpError(404, "user_not_found", "Utilisateur introuvable.")
    res.json(rows[0])
  })

  return router
}
