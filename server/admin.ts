import { Router } from "express"
import { z } from "zod"
import { asyncRoute, body, parseId } from "./http.ts"
import { HttpError } from "./auth.ts"
import { adminDb, auditPlatformAction } from "./platform-admin.ts"
import { computeSubscriptionState, invalidateSubscriptionCache } from "./entitlements.ts"
import { activateSubscription } from "./subscription-service.ts"
import { logConsoleAction } from "./console-auth.ts"
import {
  DEFAULT_GRACE_DAYS,
  cancelDeletion,
  purgeOrganization,
  scheduleDeletion,
} from "./organization-deletion.ts"
import { createPasswordResetToken } from "./auth.ts"

// ---------------------------------------------------------------------------
// Back-office de l'éditeur
//
// Raison d'être : jusqu'ici, aucune route ne pouvait activer un forfait payant
// en production. `POST /subscription/simulate` est bridée hors production, et
// les seules autres écritures sur `subscriptions` créent l'essai ou l'expirent.
// Un client qui voulait payer ne le pouvait pas sans SQL écrit à la main.
//
// Le paiement reste encaissé hors application (mobile money, virement), comme
// cela se pratique. Ce module fournit la marche qui manquait : constater la
// demande, puis activer.
//
// Deux partis pris explicites :
//
//   1. **Aucune coupure automatique.** Un abonnement `active` reste actif même
//      après `current_period_end` (voir `computeSubscriptionState` : seul
//      `trialing` regarde l'échéance). Couper automatiquement un client dont
//      le virement n'a pas encore été saisi serait plus grave que de laisser
//      courir quelques jours. En contrepartie, `GET /admin/metrics` et le
//      filtre `past_due` rendent les échéances dépassées impossibles à
//      manquer : la décision revient à un humain, mais elle lui est présentée.
//
//   2. **Toute action est journalisée chez le client**, pas dans un registre
//      séparé (voir `auditPlatformAction`). Le propriétaire voit dans son
//      propre historique que son forfait a été activé, par qui et quand.
// ---------------------------------------------------------------------------

/** Durées d'activation proposées, en mois. Bornées pour éviter la faute de frappe. */
/**
 * Une demande d'activation cesse d'être « en attente » dès qu'elle a reçu une
 * réponse — un oui (activation) comme un non (refus). Sans la seconde branche,
 * une demande qu'on choisit de ne pas honorer resterait affichée pour
 * toujours, et le compteur du tableau de bord ne retomberait jamais à zéro.
 *
 * La règle est écrite une seule fois : le compteur des indicateurs et la liste
 * des demandes doivent compter la même chose, sinon le bandeau annonce trois
 * demandes là où la liste n'en montre qu'une.
 */
const PENDING_CLAUSE = `NOT EXISTS (
  SELECT 1 FROM audit_logs b
  WHERE b.organization_id = a.organization_id
    AND b.action IN ('subscription.activated', 'subscription.request_declined')
    AND b.created_at > a.created_at
)`

const MAX_MONTHS = 36

const ORGANIZATION_SELECT = `
  o.id,
  o.name,
  o.created_at,
  s.status        AS stored_status,
  s.current_period_end,
  s.plan_changed_at,
  p.code          AS plan_code,
  p.name          AS plan_name,
  p.price_cents   AS plan_price_cents,
  (SELECT count(*)::int FROM organization_members m
     WHERE m.organization_id = o.id AND m.status = 'active')        AS member_count,
  (SELECT count(*)::int FROM sites si
     WHERE si.organization_id = o.id AND si.is_active)              AS site_count,
  (SELECT u.email FROM organization_members m2
     JOIN users u ON u.id = m2.user_id
    WHERE m2.organization_id = o.id AND m2.role = 'owner' AND m2.status = 'active'
    ORDER BY m2.created_at ASC LIMIT 1)                             AS owner_email,
  (SELECT u.phone FROM organization_members m3
     JOIN users u ON u.id = m3.user_id
    WHERE m3.organization_id = o.id AND m3.role = 'owner' AND m3.status = 'active'
    ORDER BY m3.created_at ASC LIMIT 1)                             AS owner_phone,
  o.deletion_requested_at,
  o.deletion_scheduled_for,
  o.deletion_reason,
  (SELECT max(w.created_at) FROM washes w
     WHERE w.organization_id = o.id)                                AS last_wash_at`

interface OrganizationRow {
  id: string
  name: string
  created_at: string
  stored_status: string | null
  current_period_end: string | null
  plan_changed_at: string | null
  plan_code: string | null
  plan_name: string | null
  plan_price_cents: number | null
  member_count: number
  site_count: number
  owner_email: string | null
  owner_phone: string | null
  deletion_requested_at: string | null
  deletion_scheduled_for: string | null
  deletion_reason: string | null
  last_wash_at: string | null
}

/**
 * Enrichit une ligne de l'état réellement appliqué par l'application.
 *
 * On réutilise `computeSubscriptionState` plutôt que de relire le statut
 * stocké : un essai dont l'échéance est passée vaut « expired » pour
 * l'application, et le back-office doit montrer la même chose. Deux vérités
 * divergentes seraient pires que pas de back-office du tout.
 */
function describe(row: OrganizationRow, now: Date) {
  const state = computeSubscriptionState({
    status: row.stored_status,
    current_period_end: row.current_period_end,
    plan_code: row.plan_code,
    plan_name: row.plan_name,
    plan_price_cents: row.plan_price_cents,
    now,
  })

  const periodEnd = row.current_period_end ? new Date(row.current_period_end) : null
  // « Échéance dépassée » ne concerne que les forfaits payants actifs : un
  // essai échu est déjà « expired », ce n'est pas un impayé.
  const pastDue =
    state.status === "active" && periodEnd !== null && periodEnd.getTime() <= now.getTime()

  // Une station dormante n'est ni en panne ni perdue : elle n'a simplement
  // rien enregistré depuis longtemps. C'est le signal le plus précoce d'un
  // client qui s'en va — bien avant l'impayé.
  const lastWash = row.last_wash_at ? new Date(row.last_wash_at) : null
  const idleDays = lastWash
    ? Math.floor((now.getTime() - lastWash.getTime()) / 86_400_000)
    : null

  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    deletion_requested_at: row.deletion_requested_at,
    deletion_scheduled_for: row.deletion_scheduled_for,
    deletion_reason: row.deletion_reason,
    pending_deletion: row.deletion_requested_at !== null,
    last_wash_at: row.last_wash_at,
    idle_days: idleDays,
    dormant: idleDays === null || idleDays >= 14,
    owner_email: row.owner_email,
    owner_phone: row.owner_phone,
    member_count: row.member_count,
    site_count: row.site_count,
    plan_code: row.plan_code,
    plan_name: row.plan_name,
    plan_price_cents: row.plan_price_cents ?? 0,
    status: state.status,
    stored_status: row.stored_status,
    read_only: state.read_only,
    current_period_end: row.current_period_end,
    plan_changed_at: row.plan_changed_at,
    days_remaining: state.days_remaining,
    past_due: pastDue,
    days_past_due:
      pastDue && periodEnd
        ? Math.floor((now.getTime() - periodEnd.getTime()) / 86_400_000)
        : 0,
  }
}

export function createAdminRouter() {
  const r = Router()

  // -------------------------------------------------------------------------
  // GET /api/v1/admin/metrics — l'état du parc en un coup d'œil.
  // -------------------------------------------------------------------------
  r.get(
    "/metrics",
    asyncRoute(async (_req, res) => {
      const now = new Date()
      const q = await adminDb().query<OrganizationRow>(
        `SELECT ${ORGANIZATION_SELECT}
         FROM organizations o
         LEFT JOIN subscriptions s ON s.organization_id = o.id
         LEFT JOIN plans p ON p.id = s.plan_id`,
      )
      const rows = q.rows.map((row) => describe(row, now))

      const pendingQ = await adminDb().query<{ n: number }>(
        `SELECT count(*)::int AS n
         FROM audit_logs a
         WHERE a.action = 'subscription.upgrade_requested'
           AND ${PENDING_CLAUSE}`,
      )

      res.json({
        total: rows.length,
        trialing: rows.filter((o) => o.status === "trialing").length,
        active: rows.filter((o) => o.status === "active").length,
        expired: rows.filter((o) => o.status === "expired").length,
        cancelled: rows.filter((o) => o.status === "cancelled").length,
        past_due: rows.filter((o) => o.past_due).length,
        pending_requests: pendingQ.rows[0]?.n ?? 0,
        // Revenu mensuel récurrent des seuls forfaits actifs, en centimes.
        mrr_cents: rows
          .filter((o) => o.status === "active")
          .reduce((sum, o) => sum + o.plan_price_cents, 0),
        server_time: now.toISOString(),
      })
    }),
  )

  // -------------------------------------------------------------------------
  // GET /api/v1/admin/organizations — le parc, filtrable.
  // -------------------------------------------------------------------------
  r.get(
    "/organizations",
    asyncRoute(async (req, res) => {
      const now = new Date()
      const search = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : ""
      const status = typeof req.query.status === "string" ? req.query.status : ""
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
      const offset = Math.max(Number(req.query.offset) || 0, 0)

      const conditions: string[] = []
      const values: unknown[] = []
      if (search) {
        values.push(`%${search.toLowerCase()}%`)
        conditions.push(
          `(lower(o.name) LIKE $${values.length} OR EXISTS (
              SELECT 1 FROM organization_members m
              JOIN users u ON u.id = m.user_id
              WHERE m.organization_id = o.id AND lower(u.email) LIKE $${values.length}))`,
        )
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""

      const q = await adminDb().query<OrganizationRow>(
        `SELECT ${ORGANIZATION_SELECT}
         FROM organizations o
         LEFT JOIN subscriptions s ON s.organization_id = o.id
         LEFT JOIN plans p ON p.id = s.plan_id
         ${where}
         ORDER BY o.created_at DESC`,
        values,
      )

      // Le statut est calculé, pas stocké : il se filtre après coup.
      let rows = q.rows.map((row) => describe(row, now))
      if (status === "past_due") rows = rows.filter((o) => o.past_due)
      else if (status) rows = rows.filter((o) => o.status === status)

      res.json({
        organizations: rows.slice(offset, offset + limit),
        total: rows.length,
        limit,
        offset,
      })
    }),
  )

  // -------------------------------------------------------------------------
  // GET /api/v1/admin/organizations/:id — fiche détaillée.
  // -------------------------------------------------------------------------
  r.get(
    "/organizations/:id",
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id)
      const now = new Date()

      const q = await adminDb().query<OrganizationRow>(
        `SELECT ${ORGANIZATION_SELECT}
         FROM organizations o
         LEFT JOIN subscriptions s ON s.organization_id = o.id
         LEFT JOIN plans p ON p.id = s.plan_id
         WHERE o.id = $1::uuid`,
        [id],
      )
      if (!q.rowCount) throw new HttpError(404, "organization_not_found", "Station introuvable.")

      const membersQ = await adminDb().query(
        `SELECT u.email, u.first_name, u.last_name, u.phone, m.role, m.status, m.created_at
         FROM organization_members m JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = $1::uuid ORDER BY m.created_at ASC`,
        [id],
      )

      const historyQ = await adminDb().query(
        `SELECT a.action, a.metadata, a.created_at, u.email AS actor_email
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
         WHERE a.organization_id = $1::uuid AND a.entity_type IN ('subscription','plan')
         ORDER BY a.created_at DESC LIMIT 30`,
        [id],
      )

      res.json({
        organization: describe(q.rows[0], now),
        members: membersQ.rows,
        subscription_history: historyQ.rows,
      })
    }),
  )

  // -------------------------------------------------------------------------
  // GET /api/v1/admin/upgrade-requests — les demandes d'activation.
  // -------------------------------------------------------------------------
  r.get(
    "/upgrade-requests",
    asyncRoute(async (req, res) => {
      const onlyPending = req.query.pending !== "false"
      const q = await adminDb().query(
        `SELECT a.id, a.organization_id, a.created_at, a.metadata,
                o.name AS organization_name,
                u.email AS requester_email, u.phone AS requester_phone,
                ${PENDING_CLAUSE} AS pending
         FROM audit_logs a
         JOIN organizations o ON o.id = a.organization_id
         LEFT JOIN users u ON u.id = a.actor_user_id
         WHERE a.action = 'subscription.upgrade_requested'
         ORDER BY a.created_at DESC
         LIMIT 100`,
      )
      const rows = onlyPending ? q.rows.filter((row) => row.pending) : q.rows
      res.json({ requests: rows, total: rows.length })
    }),
  )

  // -------------------------------------------------------------------------
  // GET /api/v1/admin/payment-intents — la file de validation.
  //
  // Ce que l'éditeur consulte chaque matin : qui dit avoir payé, combien, et
  // avec quelle référence de transaction. La vérification se réduit alors à
  // comparer cette référence au relevé Orange Money ou Wave, puis à cliquer.
  // -------------------------------------------------------------------------
  r.get(
    "/payment-intents",
    asyncRoute(async (req, res) => {
      const status = typeof req.query.status === "string" ? req.query.status : "pending"
      const declaredOnly = req.query.declared === "true"

      const q = await adminDb().query(
        `SELECT i.id, i.reference, i.organization_id, o.name AS organization_name,
                i.plan_code, i.months, i.amount_cents, i.provider, i.status,
                i.declared_reference, i.declared_at, i.created_at, i.settled_at,
                u.email AS requester_email, u.phone AS requester_phone
           FROM payment_intents i
           JOIN organizations o ON o.id = i.organization_id
           LEFT JOIN users u ON u.id = i.created_by
          WHERE ($1 = 'all' OR i.status = $1)
            AND ($2::boolean IS NOT TRUE OR i.declared_at IS NOT NULL)
          ORDER BY i.declared_at DESC NULLS LAST, i.created_at DESC
          LIMIT 100`,
        [status, declaredOnly],
      )
      res.json({ intents: q.rows, total: q.rowCount ?? 0 })
    }),
  )

  // -------------------------------------------------------------------------
  // POST /api/v1/admin/payment-intents/:reference/confirm — valider en un clic.
  //
  // L'éditeur a vu l'argent sur son relevé : il confirme. L'intention porte
  // déjà le forfait, la durée et le montant, donc rien n'est ressaisi — et
  // rien ne peut être saisi de travers.
  //
  // Le passage de `pending` à `paid` est conditionnel dans la requête SQL
  // elle-même : deux clics simultanés ne peuvent pas activer deux fois.
  // -------------------------------------------------------------------------
  r.post(
    "/payment-intents/:reference/confirm",
    asyncRoute(async (req, res) => {
      const operator = req.operator!
      // La référence d'intention n'est pas un UUID (elle se dicte au
      // téléphone) : parseId la rejetterait. On valide son format propre.
      const reference = String(req.params.reference ?? "")
      if (!/^WP-[A-Z2-9]{8}$/.test(reference)) {
        throw new HttpError(400, "invalid_reference", "Référence de paiement invalide.")
      }
      const input = body(
        z.object({ note: z.string().trim().max(500).optional() }).strip(),
        req.body,
      )

      const pool = adminDb()
      const claimed = await pool.query(
        `UPDATE payment_intents
            SET status = 'paid', settled_at = now()
          WHERE reference = $1 AND status = 'pending'
          RETURNING organization_id, plan_code, months, amount_cents, declared_reference`,
        [reference],
      )
      if (!claimed.rowCount) {
        throw new HttpError(
          404,
          "payment_intent_not_found",
          "Aucune demande de paiement en attente ne porte cette référence.",
        )
      }
      const intent = claimed.rows[0] as {
        organization_id: string
        plan_code: string
        months: number
        amount_cents: number
        declared_reference: string | null
      }

      const result = await activateSubscription(pool, {
        organizationId: intent.organization_id,
        planCode: intent.plan_code,
        months: intent.months,
        source: "platform_admin",
        paymentReference: intent.declared_reference ?? reference,
        actorUserId: null,
        note: input.note ?? null,
        extra: {
          operator_email: operator.email,
          intent_reference: reference,
          amount_cents: intent.amount_cents,
        },
      })

      res.json({
        reference,
        organization_id: intent.organization_id,
        plan_code: result.planCode,
        status: "active",
        current_period_end: result.periodEnd,
      })
    }),
  )

  // -------------------------------------------------------------------------
  // POST /api/v1/admin/upgrade-requests/:id/decline — l'autre réponse possible.
  //
  // Valider n'est que la moitié du travail : une demande peut rester sans
  // suite (paiement jamais reçu, doublon, erreur du client). Sans ce geste,
  // elle resterait éternellement « en attente » et le tableau de bord
  // deviendrait un décompte de bruit que plus personne ne regarde.
  //
  // Refuser ne touche pas à l'abonnement : la station garde exactement l'état
  // qu'elle avait. On répond à une demande, on ne sanctionne pas.
  // -------------------------------------------------------------------------
  r.post(
    "/upgrade-requests/:id/decline",
    asyncRoute(async (req, res) => {
      const requestId = parseId(req.params.id)
      const operator = req.operator!
      const input = body(
        z.object({ reason: z.string().trim().min(3).max(300) }).strip(),
        req.body,
      )

      const pool = adminDb()
      const q = await pool.query<{ organization_id: string }>(
        `SELECT organization_id FROM audit_logs
          WHERE id = $1::uuid AND action = 'subscription.upgrade_requested'`,
        [requestId],
      )
      if (!q.rowCount) {
        throw new HttpError(404, "not_found", "Cette demande d'activation n'existe pas.")
      }
      const organizationId = q.rows[0].organization_id

      // Le refus est inscrit chez le client, comme l'activation : il doit
      // pouvoir constater qu'on lui a répondu, et pourquoi.
      await auditPlatformAction(
        pool,
        organizationId,
        operator.email,
        "subscription.request_declined",
        requestId,
        { reason: input.reason, operator_email: operator.email },
      )

      res.json({ request_id: requestId, organization_id: organizationId, pending: false })
    }),
  )

  // -------------------------------------------------------------------------
  // POST /api/v1/admin/organizations/:id/activate — la marche qui manquait.
  // -------------------------------------------------------------------------
  r.post(
    "/organizations/:id/activate",
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id)
      const operator = req.operator!
      const input = body(
        z
          .object({
            plan_code: z.string().trim().min(1).max(40),
            months: z.number().int().min(1).max(MAX_MONTHS).default(1),
            /** Référence du paiement encaissé hors application (mobile money, virement). */
            payment_reference: z.string().trim().max(120).optional(),
            note: z.string().trim().max(500).optional(),
          })
          .strip(),
        req.body,
      )

      const pool = adminDb()

      // L'activation elle-même vit dans server/subscription-service.ts :
      // le webhook d'un agrégateur de paiement appellera exactement le même
      // code. Deux chemins d'activation qui divergent, c'est la panne
      // classique des systèmes d'abonnement.
      const result = await activateSubscription(pool, {
        organizationId: id,
        planCode: input.plan_code,
        months: input.months,
        source: "platform_admin",
        paymentReference: input.payment_reference ?? null,
        actorUserId: null,
        note: input.note ?? null,
        extra: { operator_email: operator.email },
      })

      res.json({
        organization_id: id,
        plan_code: result.planCode,
        status: "active",
        current_period_end: result.periodEnd,
        months: result.months,
        renewed: result.renewed,
      })
    }),
  )

  // -------------------------------------------------------------------------
  // POST /api/v1/admin/organizations/:id/suspend — impayé ou résiliation.
  // -------------------------------------------------------------------------
  r.post(
    "/organizations/:id/suspend",
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id)
      const operator = req.operator!
      const input = body(
        z.object({ reason: z.string().trim().min(3).max(300) }).strip(),
        req.body,
      )

      const pool = adminDb()
      const updated = await pool.query(
        `UPDATE subscriptions SET status = 'cancelled', updated_at = now()
         WHERE organization_id = $1::uuid RETURNING id`,
        [id],
      )
      if (!updated.rowCount) {
        throw new HttpError(404, "subscription_not_found", "Cette station n'a aucun abonnement.")
      }

      await auditPlatformAction(pool, id, operator.email, "subscription.suspended", id, {
        reason: input.reason,
        operator_email: operator.email,
      })
      invalidateSubscriptionCache(id)

      // `cancelled` bascule la station en lecture seule : les données restent
      // consultables et exportables, aucune écriture n'est acceptée.
      res.json({ organization_id: id, status: "cancelled", read_only: true })
    }),
  )

  // -------------------------------------------------------------------------
  // POST /api/v1/admin/organizations/:id/extend-trial — geste commercial.
  // -------------------------------------------------------------------------
  r.post(
    "/organizations/:id/extend-trial",
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id)
      const operator = req.operator!
      const input = body(
        z
          .object({
            days: z.number().int().min(1).max(90),
            reason: z.string().trim().min(3).max(300),
          })
          .strip(),
        req.body,
      )

      const pool = adminDb()
      const currentQ = await pool.query(
        "SELECT current_period_end, status FROM subscriptions WHERE organization_id = $1::uuid",
        [id],
      )
      if (!currentQ.rowCount) {
        throw new HttpError(404, "subscription_not_found", "Cette station n'a aucun abonnement.")
      }
      const row = currentQ.rows[0] as { current_period_end: string | null; status: string }

      // Un forfait payant en cours ne se « prolonge » pas : le repasser en
      // essai effacerait ce que le client a payé. C'est une activation ou une
      // suspension qu'il faut, pas un geste commercial.
      if (row.status === "active") {
        throw new HttpError(
          409,
          "subscription_active",
          "Cette station a un forfait payant en cours. Prolonger l'essai effacerait son abonnement : utilisez l'activation pour le renouveler, ou la suspension.",
        )
      }

      // On n'ajoute des jours à l'échéance existante que s'il s'agit d'un essai
      // encore en cours. Dans tous les autres cas — essai échu, abonnement
      // résilié — on repart d'aujourd'hui : hériter de l'échéance d'un forfait
      // payé offrirait des mois d'essai par accident.
      const existing = row.current_period_end ? new Date(row.current_period_end) : null
      const now = new Date()
      const base =
        row.status === "trialing" && existing && existing.getTime() > now.getTime() ? existing : now
      const periodEnd = new Date(base.getTime() + input.days * 86_400_000)

      await pool.query(
        `UPDATE subscriptions
            SET status = 'trialing', current_period_end = $2::timestamptz, updated_at = now()
          WHERE organization_id = $1::uuid`,
        [id, periodEnd.toISOString()],
      )

      await auditPlatformAction(pool, id, operator.email, "subscription.trial_extended", id, {
        days: input.days,
        reason: input.reason,
        period_end: periodEnd.toISOString(),
        operator_email: operator.email,
      })
      invalidateSubscriptionCache(id)

      res.json({
        organization_id: id,
        status: "trialing",
        current_period_end: periodEnd.toISOString(),
        days: input.days,
      })
    }),
  )


  // -------------------------------------------------------------------------
  // Suppression d'une station, en deux temps.
  //
  // Voir `server/organization-deletion.ts` pour le raisonnement. Côté API,
  // trois verbes distincts plutôt qu'un `DELETE` paramétré : programmer,
  // annuler et purger n'ont ni les mêmes conséquences ni le même public, et
  // les confondre derrière un seul appel rendrait l'irréversible trop facile
  // à déclencher par inadvertance.
  // -------------------------------------------------------------------------
  r.post(
    "/organizations/:id/schedule-deletion",
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id)
      const operator = req.operator!
      const input = body(
        z
          .object({
            reason: z.string().trim().min(10).max(300),
            grace_days: z.number().int().min(1).max(90).optional(),
          })
          .strip(),
        req.body,
      )

      const pool = adminDb()
      const org = await pool.query("SELECT name, deletion_requested_at FROM organizations WHERE id = $1::uuid", [id])
      if (!org.rowCount) {
        throw new HttpError(404, "organization_not_found", "Cette station n'existe pas.")
      }
      if ((org.rows[0] as { deletion_requested_at: string | null }).deletion_requested_at) {
        throw new HttpError(409, "deletion_already_scheduled", "Une suppression est déjà programmée pour cette station.")
      }
      const name = (org.rows[0] as { name: string }).name
      const graceDays = input.grace_days ?? DEFAULT_GRACE_DAYS

      const { scheduled_for } = await scheduleDeletion(pool, id, input.reason, graceDays)

      await auditPlatformAction(pool, id, operator.email, "organization.deletion_scheduled", id, {
        reason: input.reason,
        scheduled_for,
      })
      await logConsoleAction(pool, operator, "organization.deletion_scheduled", id, name, {
        reason: input.reason,
        grace_days: graceDays,
        scheduled_for,
      })
      invalidateSubscriptionCache(id)

      res.json({ organization_id: id, name, scheduled_for, grace_days: graceDays })
    }),
  )

  r.post(
    "/organizations/:id/cancel-deletion",
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id)
      const operator = req.operator!
      const pool = adminDb()

      const org = await pool.query("SELECT name FROM organizations WHERE id = $1::uuid", [id])
      if (!org.rowCount) {
        throw new HttpError(404, "organization_not_found", "Cette station n'existe pas.")
      }
      if (!(await cancelDeletion(pool, id))) {
        throw new HttpError(409, "no_deletion_scheduled", "Aucune suppression n'est programmée pour cette station.")
      }
      const name = (org.rows[0] as { name: string }).name

      await auditPlatformAction(pool, id, operator.email, "organization.deletion_cancelled", id, {})
      await logConsoleAction(pool, operator, "organization.deletion_cancelled", id, name, {})
      invalidateSubscriptionCache(id)

      // L'abonnement reste résilié : restaurer l'accès n'est pas offrir un
      // forfait. À l'opérateur de réactiver explicitement s'il le souhaite.
      res.json({ organization_id: id, name, restored: true, subscription_status: "cancelled" })
    }),
  )

  r.post(
    "/organizations/:id/purge",
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id)
      const operator = req.operator!
      const input = body(z.object({ confirm_name: z.string().trim().min(1).max(200) }).strip(), req.body)

      const pool = adminDb()
      const org = await pool.query("SELECT name, deletion_requested_at FROM organizations WHERE id = $1::uuid", [id])
      if (!org.rowCount) {
        throw new HttpError(404, "organization_not_found", "Cette station n'existe pas.")
      }
      const row = org.rows[0] as { name: string; deletion_requested_at: string | null }

      // Deux verrous, parce que l'acte est irréversible.
      //
      // Le premier impose d'être passé par la programmation : on ne purge pas
      // une station croisée par hasard dans une liste. Le second fait retaper
      // son nom — une confirmation qu'on ne clique pas distraitement, et qui
      // force à relire laquelle on s'apprête à effacer.
      if (!row.deletion_requested_at) {
        throw new HttpError(
          409,
          "deletion_not_scheduled",
          "Programmez d'abord la suppression : la purge immédiate n'est possible que sur une station déjà sortie du service.",
        )
      }
      if (input.confirm_name.trim().toLowerCase() !== row.name.trim().toLowerCase()) {
        throw new HttpError(400, "confirmation_mismatch", "Le nom saisi ne correspond pas à celui de la station.")
      }

      const result = await purgeOrganization(pool, id)
      // Journalisé APRÈS la purge et sans `organization_id` : la ligne doit
      // survivre à la disparition de la clé étrangère qu'elle désignait.
      await logConsoleAction(pool, operator, "organization.purged", null, result.name, {
        trigger: "manual",
        rows_deleted: result.deleted,
        users_deleted: result.users_deleted,
      })
      invalidateSubscriptionCache(id)

      res.json({ purged: true, name: result.name, rows_deleted: result.deleted, users_deleted: result.users_deleted })
    }),
  )

  // -------------------------------------------------------------------------
  // GET /api/v1/console/organizations/:id/members — qui travaille sur cette
  // station, et dans quel état sont leurs comptes.
  // -------------------------------------------------------------------------
  r.get(
    "/organizations/:id/members",
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id)
      const q = await adminDb().query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.status AS user_status,
                m.role, m.status AS membership_status, m.created_at,
                (SELECT max(s.last_used_at) FROM auth_sessions s WHERE s.user_id = u.id) AS last_seen_at
           FROM organization_members m
           JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = $1::uuid
          ORDER BY (m.role = 'owner') DESC, m.created_at ASC`,
        [id],
      )
      res.json({ members: q.rows })
    }),
  )

  // -------------------------------------------------------------------------
  // POST .../members/:userId/reset-password — dépanner un client enfermé dehors.
  //
  // L'opérateur ne CHOISIT pas le mot de passe : il déclenche le même jeton à
  // usage unique que la procédure « mot de passe oublié ». Un administrateur
  // qui fixerait lui-même le secret d'un client pourrait ensuite se connecter
  // à sa place, et le journal du client montrerait une session parfaitement
  // ordinaire. Ici, seul le client peut terminer la manœuvre.
  // -------------------------------------------------------------------------
  r.post(
    "/organizations/:id/members/:userId/reset-password",
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id)
      const userId = parseId(req.params.userId)
      const operator = req.operator!
      const pool = adminDb()

      const member = await pool.query(
        `SELECT u.email, o.name AS org_name FROM organization_members m
           JOIN users u ON u.id = m.user_id
           JOIN organizations o ON o.id = m.organization_id
          WHERE m.organization_id = $1::uuid AND m.user_id = $2::uuid`,
        [id, userId],
      )
      if (!member.rowCount) {
        throw new HttpError(404, "member_not_found", "Ce compte n'appartient pas à cette station.")
      }
      const { email, org_name } = member.rows[0] as { email: string; org_name: string }

      const token = await createPasswordResetToken(pool, userId, 60, null)

      await auditPlatformAction(pool, id, operator.email, "user.password_reset_requested", userId, { email })
      await logConsoleAction(pool, operator, "user.password_reset_requested", id, org_name, { email })

      // Le lien est renvoyé à l'opérateur pour qu'il le transmette lui-même :
      // c'est souvent au téléphone que la demande arrive, et le client n'a
      // pas toujours accès à sa boîte mail.
      res.json({ email, reset_token: token, expires_in_minutes: 60 })
    }),
  )

  // -------------------------------------------------------------------------
  // POST .../members/:userId/status — débloquer ou suspendre un compte.
  // -------------------------------------------------------------------------
  r.post(
    "/organizations/:id/members/:userId/status",
    asyncRoute(async (req, res) => {
      const id = parseId(req.params.id)
      const userId = parseId(req.params.userId)
      const operator = req.operator!
      const input = body(
        z.object({ status: z.enum(["active", "disabled"]), reason: z.string().trim().min(3).max(300) }).strip(),
        req.body,
      )

      const pool = adminDb()
      const member = await pool.query(
        `SELECT u.email, m.role, o.name AS org_name FROM organization_members m
           JOIN users u ON u.id = m.user_id
           JOIN organizations o ON o.id = m.organization_id
          WHERE m.organization_id = $1::uuid AND m.user_id = $2::uuid`,
        [id, userId],
      )
      if (!member.rowCount) {
        throw new HttpError(404, "member_not_found", "Ce compte n'appartient pas à cette station.")
      }
      const { email, role, org_name } = member.rows[0] as { email: string; role: string; org_name: string }

      // Désactiver le dernier propriétaire rendrait la station ingérable par
      // son client : plus personne ne pourrait inviter ni facturer. La même
      // règle protège déjà l'équipe côté client (`last_owner`).
      if (input.status === "disabled" && role === "owner") {
        const owners = await pool.query(
          `SELECT count(*)::int AS n FROM organization_members
            WHERE organization_id = $1::uuid AND role = 'owner' AND status = 'active' AND user_id <> $2::uuid`,
          [id, userId],
        )
        if (((owners.rows[0] as { n: number }).n ?? 0) === 0) {
          throw new HttpError(409, "last_owner", "C'est le dernier propriétaire actif : la station deviendrait ingérable.")
        }
      }

      await pool.query("UPDATE organization_members SET status = $2, updated_at = now() WHERE organization_id = $1::uuid AND user_id = $3::uuid", [id, input.status, userId])
      await pool.query("UPDATE users SET status = $2, updated_at = now() WHERE id = $1::uuid", [userId, input.status])
      if (input.status === "disabled") {
        await pool.query("DELETE FROM auth_sessions WHERE user_id = $1::uuid", [userId])
      }

      const action = input.status === "active" ? "user.enabled" : "user.disabled"
      await auditPlatformAction(pool, id, operator.email, action, userId, { email, reason: input.reason })
      await logConsoleAction(pool, operator, action, id, org_name, { email, reason: input.reason })

      res.json({ user_id: userId, email, status: input.status })
    }),
  )

  // -------------------------------------------------------------------------
  // GET /api/v1/console/audit — le journal de l'éditeur.
  //
  // Distinct de celui des clients : il répond à « qu'avons-NOUS fait », pas à
  // « que s'est-il passé chez ce client ». Il survit à la purge, ce qui en
  // fait la seule trace qu'une station supprimée a existé.
  // -------------------------------------------------------------------------
  r.get(
    "/audit",
    asyncRoute(async (req, res) => {
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300)
      const organizationId = typeof req.query.organization_id === "string" ? req.query.organization_id : null
      const values: unknown[] = [limit]
      let where = ""
      if (organizationId && /^[0-9a-f-]{36}$/i.test(organizationId)) {
        values.push(organizationId)
        where = `WHERE organization_id = $${values.length}::uuid`
      }
      const q = await adminDb().query(
        `SELECT id, operator_email, action, organization_id, organization_name, metadata, created_at
           FROM platform_audit_logs ${where}
          ORDER BY created_at DESC LIMIT $1`,
        values,
      )
      res.json({ entries: q.rows })
    }),
  )

  // -------------------------------------------------------------------------
  // GET /api/v1/admin/plans — le catalogue, pour alimenter le formulaire.
  // -------------------------------------------------------------------------
  r.get(
    "/plans",
    asyncRoute(async (_req, res) => {
      const q = await adminDb().query(
        `SELECT code, name, price_cents, billing_cycle, max_users, max_workers, max_sites
         FROM plans ORDER BY sort_order ASC, price_cents ASC`,
      )
      res.json({ plans: q.rows })
    }),
  )

  return r
}
