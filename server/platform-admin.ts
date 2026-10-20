import type { NextFunction, Request, Response } from "express"
import type { Pool } from "pg"
import { getPool } from "./db.ts"
import { HttpError } from "./auth.ts"

// ---------------------------------------------------------------------------
// Administration de plateforme
//
// Surface réservée à l'éditeur, distincte de tout ce que fait un client.
//
// Le reste de l'API repose sur `requireTenantContext` : l'organisation vient
// de l'appartenance en base et jamais du navigateur, ce qui rend structurelle
// l'isolation entre stations. L'administration doit précisément traverser
// cette frontière — pour activer le forfait d'un client, il faut écrire chez
// lui. Elle est donc isolée dans son propre module et montée **avant**
// `requireTenantContext` (voir `server/app.ts`), pour deux raisons :
//
//   • l'éditeur n'appartient à aucune station : passer par le contexte de
//     locataire le rejetterait avec `organization_required` ;
//   • surtout, le franchissement de la frontière reste visible à la lecture
//     du montage, au lieu d'être une exception cachée dans une route.
//
// Le droit lui-même n'est accordé par aucune route. Il se lit dans
// `users.platform_admin`, aligné au démarrage sur `PLATFORM_ADMIN_EMAILS`
// (`server/db.ts`). Un droit qui ouvre toutes les stations ne doit pas pouvoir
// s'obtenir depuis l'application.
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      platformAdmin?: { userId: string; email: string }
    }
  }
}

export function adminDb(): Pool {
  const pool = getPool()
  if (!pool) throw new HttpError(503, "database_not_configured", "Base de données indisponible.")
  return pool
}

/**
 * Exige un administrateur de plateforme actif.
 *
 * Renvoie `404 not_found` et non `403 forbidden` lorsque le compte n'a pas le
 * drapeau : pour un utilisateur ordinaire, l'existence même du back-office ne
 * se devine pas. Un 403 confirmerait qu'il y a quelque chose à cette adresse.
 */
export async function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const auth = req.auth
    if (!auth) throw new HttpError(401, "authentication_required", "Connectez-vous pour continuer.")

    const q = await adminDb().query(
      "SELECT id, email, status, platform_admin FROM users WHERE id = $1::uuid",
      [auth.userId],
    )
    const user = q.rows[0] as
      | { id: string; email: string; status: string; platform_admin: boolean }
      | undefined

    if (!user || !user.platform_admin || user.status !== "active") {
      throw new HttpError(404, "not_found", "Cette route API n'existe pas.")
    }

    req.platformAdmin = { userId: user.id, email: user.email }
    next()
  } catch (error) {
    next(error)
  }
}

/** Le compte est-il administrateur de plateforme ? (lecture seule, sans erreur) */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const pool = getPool()
  if (!pool) return false
  const q = await pool.query(
    "SELECT 1 FROM users WHERE id = $1::uuid AND platform_admin AND status = 'active'",
    [userId],
  )
  return q.rowCount === 1
}

/**
 * Journalise une action d'administration **dans le journal de la station
 * concernée**, et non dans un registre séparé.
 *
 * C'est délibéré : le propriétaire doit voir dans son propre historique que
 * son forfait a été activé, par qui et quand. Une intervention de l'éditeur
 * invisible du client serait une porte dérobée.
 */
export async function auditPlatformAction(
  client: Pool,
  organizationId: string,
  actorUserId: string,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
     VALUES($1::uuid,$2::uuid,$3,'subscription',$4::text,$5::jsonb)`,
    [organizationId, actorUserId, action, entityId, JSON.stringify({ ...metadata, by: "platform_admin" })],
  )
}
