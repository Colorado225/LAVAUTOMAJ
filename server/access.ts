import { Router } from "express"
import { z } from "zod"
import type { Pool, PoolClient } from "pg"
import { getPool } from "./db.ts"
import { asyncRoute, body, tenant, parseId, requirePermission, HttpError } from "./http.ts"
import {
  PERMISSIONS,
  PERMISSION_LABELS,
  ROLES,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_PERMISSIONS,
  OWNER_ONLY_PERMISSIONS,
  GRANTABLE_PERMISSIONS,
  effectivePermissions,
  isPermission,
  isRole,
  type Permission,
  type Role,
} from "./permissions.ts"

// ---------------------------------------------------------------------------
// Gestion des accès
//
// Le propriétaire attribue les rôles, accorde des exceptions et désactive les
// accès. Les garde-fous sont posés ici parce qu'ils relèvent du métier, pas de
// la simple vérification d'un droit :
//   • personne ne modifie son propre rôle ni ses propres droits ;
//   • une station conserve toujours au moins un propriétaire actif ;
//   • les permissions réservées au propriétaire ne sont jamais déléguées ;
//   • toute tentative refusée et toute modification acceptée sont journalisées.
// ---------------------------------------------------------------------------

function db(): Pool {
  const pool = getPool()
  if (!pool) throw new HttpError(503, "database_not_configured", "Base de données indisponible.")
  return pool
}

/** Journalise une action sensible (acceptée ou refusée). */
async function audit(
  client: Pool | PoolClient,
  organizationId: string,
  actorUserId: string,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
     VALUES($1::uuid,$2::uuid,$3,'member',$4::text,$5::jsonb)`,
    [organizationId, actorUserId, action, entityId, JSON.stringify(metadata)],
  )
}

const MEMBER_SELECT = `m.user_id, m.role, m.status, m.created_at, m.disabled_at,
  u.email, u.first_name, u.last_name, u.phone`

interface MemberRow {
  user_id: string
  role: string
  status: string
  created_at: string
  disabled_at: string | null
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
}

/** Nombre de propriétaires actifs restants, hors membre visé. */
async function activeOwnerCount(client: Pool | PoolClient, organizationId: string, excludeUserId?: string) {
  const q = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM organization_members
     WHERE organization_id=$1::uuid AND role='owner' AND status='active'
       AND ($2::uuid IS NULL OR user_id <> $2::uuid)`,
    [organizationId, excludeUserId ?? null],
  )
  return Number(q.rows[0].count)
}

export function createAccessRouter() {
  const r = Router()

  // GET /api/v1/me/permissions — ce que l'utilisateur connecté a le droit de faire.
  // Accessible à tous les membres : c'est la source unique utilisée par
  // l'interface pour afficher ou masquer les actions.
  r.get(
    "/me/permissions",
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      res.json({
        user_id: t.userId,
        organization_id: t.organizationId,
        role: t.role,
        role_label: isRole(t.role) ? ROLE_LABELS[t.role] : t.role,
        permissions: [...t.permissions].sort(),
        permission_labels: PERMISSION_LABELS,
      })
    }),
  )

  // GET /api/v1/access/roles — référentiel, pour l'écran de gestion des accès.
  r.get(
    "/access/roles",
    requirePermission("user:manage"),
    asyncRoute(async (req, res) => {
      tenant(req)
      res.json({
        roles: ROLES.map((role) => ({
          code: role,
          label: ROLE_LABELS[role],
          description: ROLE_DESCRIPTIONS[role],
          permissions: [...ROLE_PERMISSIONS[role]],
        })),
        permissions: PERMISSIONS.map((permission) => ({
          code: permission,
          label: PERMISSION_LABELS[permission],
          grantable: (GRANTABLE_PERMISSIONS as readonly string[]).includes(permission),
        })),
        owner_only: [...OWNER_ONLY_PERMISSIONS],
      })
    }),
  )

  // GET /api/v1/access/members — membres de la station et droits effectifs.
  r.get(
    "/access/members",
    requirePermission("user:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const pool = db()
      const [membersQ, overridesQ] = await Promise.all([
        pool.query<MemberRow>(
          `SELECT ${MEMBER_SELECT} FROM organization_members m
           JOIN users u ON u.id = m.user_id
           WHERE m.organization_id=$1::uuid
           ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'cashier' THEN 2 ELSE 3 END,
                    m.created_at`,
          [t.organizationId],
        ),
        pool.query<{ user_id: string; permission: string; granted: boolean }>(
          "SELECT user_id, permission, granted FROM member_permissions WHERE organization_id=$1::uuid",
          [t.organizationId],
        ),
      ])

      const members = membersQ.rows.map((member) => {
        const overrides = overridesQ.rows.filter((o) => o.user_id === member.user_id)
        return {
          ...member,
          is_self: member.user_id === t.userId,
          overrides: overrides.map(({ permission, granted }) => ({ permission, granted })),
          permissions: [...effectivePermissions(member.role, overrides)].sort(),
        }
      })

      res.json({ members })
    }),
  )

  // PATCH /api/v1/access/members/:userId — changer le rôle ou l'état d'un membre.
  r.patch(
    "/access/members/:userId",
    requirePermission("user:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const targetUserId = parseId(req.params.userId)
      const input = body(
        z
          .object({
            role: z.enum(ROLES).optional(),
            status: z.enum(["active", "disabled"]).optional(),
          })
          .strip()
          .refine((value) => value.role !== undefined || value.status !== undefined, {
            message: "Indiquez un rôle ou un statut.",
          }),
        req.body,
      )
      const pool = db()

      // Garde-fou : personne ne modifie son propre rôle ni son propre accès.
      // C'est la tentative d'escalade de privilèges la plus simple.
      if (targetUserId === t.userId) {
        await audit(pool, t.organizationId, t.userId, "access.denied", targetUserId, {
          attempted: input,
          reason: "self_modification",
        })
        throw new HttpError(
          403,
          "self_modification_forbidden",
          "Vous ne pouvez pas modifier votre propre rôle ni votre propre accès.",
        )
      }

      const client = await pool.connect()
      try {
        await client.query("BEGIN")

        const currentQ = await client.query<MemberRow>(
          `SELECT ${MEMBER_SELECT} FROM organization_members m
           JOIN users u ON u.id = m.user_id
           WHERE m.organization_id=$1::uuid AND m.user_id=$2::uuid FOR UPDATE OF m`,
          [t.organizationId, targetUserId],
        )
        const current = currentQ.rows[0]
        if (!current) throw new HttpError(404, "member_not_found", "Ce membre n’appartient pas à votre station.")

        const nextRole = (input.role ?? current.role) as Role
        const nextStatus = input.status ?? current.status

        // Garde-fou : une station garde toujours un propriétaire actif.
        const losesOwner =
          current.role === "owner" && (nextRole !== "owner" || nextStatus !== "active")
        if (losesOwner && (await activeOwnerCount(client, t.organizationId, targetUserId)) === 0) {
          throw new HttpError(
            409,
            "last_owner",
            "Cette station doit conserver au moins un propriétaire actif.",
          )
        }

        await client.query(
          `UPDATE organization_members
           SET role=$3, status=$4, disabled_at = CASE WHEN $4 = 'disabled' THEN now() ELSE NULL END,
               updated_by=$5::uuid, updated_at=now()
           WHERE organization_id=$1::uuid AND user_id=$2::uuid`,
          [t.organizationId, targetUserId, nextRole, nextStatus, t.userId],
        )

        // Un changement de rôle rend les exceptions précédentes caduques :
        // elles avaient été accordées pour un autre périmètre.
        if (input.role && input.role !== current.role) {
          await client.query(
            "DELETE FROM member_permissions WHERE organization_id=$1::uuid AND user_id=$2::uuid",
            [t.organizationId, targetUserId],
          )
        }

        await audit(client, t.organizationId, t.userId, "member.access_updated", targetUserId, {
          before: { role: current.role, status: current.status },
          after: { role: nextRole, status: nextStatus },
        })

        await client.query("COMMIT")
        res.json({
          user_id: targetUserId,
          role: nextRole,
          status: nextStatus,
          permissions: [...effectivePermissions(nextRole)].sort(),
        })
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {})
        throw error
      } finally {
        client.release()
      }
    }),
  )

  // PUT /api/v1/access/members/:userId/permissions/:permission — exception.
  r.put(
    "/access/members/:userId/permissions/:permission",
    requirePermission("user:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const targetUserId = parseId(req.params.userId)
      const permission = req.params.permission
      const input = body(
        z.object({ granted: z.boolean().nullable() }).strip(),
        req.body,
      )
      const pool = db()

      if (!isPermission(permission)) {
        throw new HttpError(400, "unknown_permission", "Permission inconnue.")
      }
      if (targetUserId === t.userId) {
        await audit(pool, t.organizationId, t.userId, "access.denied", targetUserId, {
          attempted: { permission, granted: input.granted },
          reason: "self_modification",
        })
        throw new HttpError(
          403,
          "self_modification_forbidden",
          "Vous ne pouvez pas modifier vos propres droits.",
        )
      }
      // Garde-fou structurel : certaines permissions ne se délèguent jamais,
      // même par le propriétaire. Sinon le système de rôles se contourne.
      if (input.granted === true && OWNER_ONLY_PERMISSIONS.includes(permission as Permission)) {
        await audit(pool, t.organizationId, t.userId, "access.denied", targetUserId, {
          attempted: { permission },
          reason: "owner_only_permission",
        })
        throw new HttpError(
          403,
          "permission_not_grantable",
          `La permission « ${PERMISSION_LABELS[permission as Permission]} » est réservée au propriétaire.`,
        )
      }

      const memberQ = await pool.query<{ role: string }>(
        "SELECT role FROM organization_members WHERE organization_id=$1::uuid AND user_id=$2::uuid",
        [t.organizationId, targetUserId],
      )
      if (!memberQ.rowCount) {
        throw new HttpError(404, "member_not_found", "Ce membre n’appartient pas à votre station.")
      }

      if (input.granted === null) {
        // Retour au comportement par défaut du rôle.
        await pool.query(
          "DELETE FROM member_permissions WHERE organization_id=$1::uuid AND user_id=$2::uuid AND permission=$3",
          [t.organizationId, targetUserId, permission],
        )
      } else {
        await pool.query(
          `INSERT INTO member_permissions(organization_id, user_id, permission, granted, granted_by)
           VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid)
           ON CONFLICT (organization_id, user_id, permission)
           DO UPDATE SET granted = EXCLUDED.granted, granted_by = EXCLUDED.granted_by, created_at = now()`,
          [t.organizationId, targetUserId, permission, input.granted, t.userId],
        )
      }

      await audit(
        pool,
        t.organizationId,
        t.userId,
        input.granted === null
          ? "member.permission_reset"
          : input.granted
            ? "member.permission_granted"
            : "member.permission_revoked",
        targetUserId,
        { permission },
      )

      const overridesQ = await pool.query<{ permission: string; granted: boolean }>(
        "SELECT permission, granted FROM member_permissions WHERE organization_id=$1::uuid AND user_id=$2::uuid",
        [t.organizationId, targetUserId],
      )
      res.json({
        user_id: targetUserId,
        overrides: overridesQ.rows,
        permissions: [...effectivePermissions(memberQ.rows[0].role, overridesQ.rows)].sort(),
      })
    }),
  )

  return r
}
