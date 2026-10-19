import { Router } from "express"
import { getPool } from "./db.ts"
import { asyncRoute } from "./http.ts"
import { HttpError, getClerkUserProfile } from "./auth.ts"

export function createAuthRouter() {
  const r = Router()

  // POST /api/v1/auth/sync — called after Clerk sign-in/sign-up to ensure
  // the user exists in Neon. Idempotent; safe to retry.
  r.post(
    "/sync",
    asyncRoute(async (req, res) => {
      const a = req.auth
      if (!a) throw new HttpError(401, "authentication_required", "Connectez-vous.")
      const p = getPool()
      if (!p) throw new HttpError(503, "database_not_configured", "Base de données indisponible.")

      // Fetch the verified profile from Clerk (server-side, never trust browser).
      try {
        const profile = await getClerkUserProfile(a.clerkUserId)
        await p.query(
          `INSERT INTO users (clerk_user_id, email, first_name, last_name, avatar_url, status)
           VALUES ($1, $2, $3, $4, $5, 'active')
           ON CONFLICT (clerk_user_id) DO UPDATE SET
             email = EXCLUDED.email,
             first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name,
             avatar_url = EXCLUDED.avatar_url,
             status = CASE WHEN users.status = 'inactive' THEN users.status ELSE 'active' END,
             updated_at = NOW()`,
          [a.clerkUserId, profile.email, profile.firstName, profile.lastName, profile.avatarUrl],
        )
        res.json({ ok: true, user_id: a.clerkUserId })
      } catch (error) {
        // Clerk REST API unreachable (restricted network): record a minimal,
        // token-verified identity. The webhook or a later sync enriches it.
        if (error instanceof HttpError && (error.status === 502 || error.status === 503)) {
          await p.query(
            `INSERT INTO users (clerk_user_id, email, status) VALUES ($1, $2, 'active')
             ON CONFLICT (clerk_user_id) DO NOTHING`,
            [a.clerkUserId, `${a.clerkUserId}@clerk.local`],
          )
          res.json({ ok: true, user_id: a.clerkUserId, degraded: true })
          return
        }
        throw error
      }
    }),
  )

  // GET /api/v1/auth/me — current authenticated user, their organization role
  // (`role` at the top level is what the pages consume) and the Clerk context.
  r.get(
    "/me",
    asyncRoute(async (req, res) => {
      const a = req.auth
      if (!a) throw new HttpError(401, "authentication_required", "Connectez-vous.")
      const p = getPool()
      if (!p) throw new HttpError(503, "database_not_configured", "Base de données indisponible.")

      const userQ = await p.query(
        "SELECT id, email, first_name, last_name, avatar_url, status FROM users WHERE clerk_user_id = $1",
        [a.clerkUserId],
      )

      let role: string | null = null
      if (a.clerkOrgId) {
        const roleQ = await p.query(
          `SELECT m.role FROM organizations o
           JOIN organization_members m ON m.organization_id = o.id
           JOIN users u ON u.id = m.user_id
           WHERE o.clerk_org_id = $1 AND u.clerk_user_id = $2 LIMIT 1`,
          [a.clerkOrgId, a.clerkUserId],
        )
        role = (roleQ.rows[0]?.role as string | undefined) ?? null
      }

      res.json({
        role,
        user: userQ.rows[0] || { clerk_user_id: a.clerkUserId },
        clerk: { organization_id: a.clerkOrgId, role: a.clerkRole },
      })
    }),
  )

  return r
}
