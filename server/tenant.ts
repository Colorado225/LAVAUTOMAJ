import type { NextFunction, Request, Response } from "express"
import type { PoolClient } from "pg"
import { getPool } from "./db.ts"
import { HttpError } from "./auth.ts"
import { effectivePermissions, type Permission, type PermissionOverride } from "./permissions.ts"

interface TenantRow {
  organization_id: string
  role: string
  status: string
}

/**
 * Résout l'appartenance de l'utilisateur à une station, puis attache au
 * contexte de la requête l'organisation, le rôle **et les permissions
 * effectives**.
 *
 * Deux règles de sécurité structurelles :
 *   • l'organisation vient toujours de l'appartenance en base, jamais d'un
 *     identifiant fourni par le navigateur ;
 *   • un membre désactivé est refusé ici, avant d'atteindre la moindre route.
 */
export async function requireTenantContext(req: Request, _res: Response, next: NextFunction) {
  try {
    const auth = req.auth
    if (!auth) throw new HttpError(401, "authentication_required", "Connectez-vous pour continuer.")
    const pool = getPool()
    if (!pool) throw new HttpError(503, "database_not_configured", "La base de données n'est pas configurée.")

    const q = await pool.query(
      `SELECT m.organization_id, m.role, m.status
       FROM organization_members m
       WHERE m.user_id = $1::uuid
       ORDER BY (m.status = 'active') DESC, m.created_at ASC
       LIMIT 1`,
      [auth.userId],
    )
    const row = q.rows[0] as TenantRow | undefined
    if (!row) {
      throw new HttpError(403, "organization_required", "Votre compte n'est rattaché à aucune organisation. Contactez votre administrateur.")
    }
    if (row.status !== "active") {
      throw new HttpError(
        403,
        "membership_disabled",
        "Votre accès à cette station a été désactivé. Contactez le propriétaire.",
      )
    }

    // Exceptions posées par le propriétaire sur ce membre précis.
    const overridesQ = await pool.query<PermissionOverride>(
      "SELECT permission, granted FROM member_permissions WHERE organization_id=$1::uuid AND user_id=$2::uuid",
      [row.organization_id, auth.userId],
    )
    const permissions = effectivePermissions(row.role, overridesQ.rows)

    req.tenant = {
      organizationId: row.organization_id,
      userId: auth.userId,
      role: row.role,
      permissions,
      can: (permission: Permission) => permissions.has(permission),
    }
    next()
  } catch (error) {
    next(error)
  }
}

/** Enforce the plan's max_users before adding a new member (advisory-locked per org). */
export async function assertOrganizationUserCapacity(client: PoolClient, organizationId: string, userId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [organizationId])
  const exists = await client.query(
    "SELECT 1 FROM organization_members WHERE organization_id=$1::uuid AND user_id=$2::uuid",
    [organizationId, userId],
  )
  if (exists.rowCount) return
  const q = await client.query(
    `SELECT p.max_users, COUNT(m.id)::int AS active_count FROM organizations o
     LEFT JOIN subscriptions s ON s.organization_id = o.id
     LEFT JOIN plans p ON p.id = s.plan_id
     LEFT JOIN organization_members m ON m.organization_id = o.id AND m.status = 'active'
     WHERE o.id = $1 GROUP BY p.max_users`,
    [organizationId],
  )
  const row = q.rows[0]
  if (row?.max_users != null && Number(row.active_count) >= Number(row.max_users)) {
    throw new HttpError(409, "plan_user_limit", "Le nombre maximal d'utilisateurs de votre forfait est atteint.")
  }
}
