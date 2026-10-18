import { Router } from "express"
import type { Pool, PoolClient } from "pg"
import { z } from "zod"
import { getPool } from "./db.ts"
import { HttpError } from "./auth.ts"
import { payloadFingerprint, requireIdempotencyKey } from "./idempotency.ts"
import type { TenantContext } from "./types.ts"
import { isManager, requireManager } from "./permissions.ts"

const MAX_MONEY = Number.MAX_SAFE_INTEGER
const money = z.number().int().nonnegative().max(MAX_MONEY)
const positiveMoney = z.number().int().positive().max(MAX_MONEY)
const id = z.string().uuid()
const paymentMethod = z.enum(["cash", "orange_money", "mtn_momo", "moov_money", "wave", "other"])

const washInputSchema = z.object({
  site_id: id,
  vehicle_category_id: id,
  items: z.array(z.object({ service_id: id, quantity: z.number().int().min(1).max(100) })).min(1).max(100),
  worker_ids: z.array(id).max(250).default([]),
  payment_method: paymentMethod.default("cash"),
  amount_received_cents: money.default(0),
  cash_session_id: id.optional().nullable(),
})

const openSessionSchema = z.object({ site_id: id, opening_amount_cents: money })
const movementSchema = z.object({
  type: z.enum(["entry", "exit"]),
  amount_cents: positiveMoney,
  // Operational sources (wash_payment, expense, opening_balance, etc.) are
  // written only by their owning server-side transaction.
  source: z.literal("manual").optional().default("manual"),
  description: z.string().trim().max(1000).optional().nullable(),
})
const closeSessionSchema = z.object({
  counted_amount_cents: money,
  discrepancy_reason: z.string().trim().max(1000).optional().nullable(),
})
const expenseSchema = z.object({
  category: z.string().trim().min(1).max(100),
  amount_cents: positiveMoney,
  payment_method: paymentMethod,
  site_id: id.optional().nullable(),
  beneficiary: z.string().trim().max(150).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  reference: z.string().trim().max(100).optional().nullable(),
  cash_session_id: id.optional().nullable(),
})

function tenant(req: { tenant?: TenantContext }) {
  if (!req.tenant) throw new HttpError(401, "tenant_required", "Aucune organisation active.")
  return req.tenant
}

function requireCashSessionOperator(current: TenantContext, session: { user_id: string | null }) {
  if (!isManager(current) && session.user_id !== current.userId) {
    throw new HttpError(403, "cash_session_forbidden", "Seul l'agent ayant ouvert cette caisse ou un responsable peut la modifier.")
  }
}

async function lockIdempotencyKey(client: PoolClient, organizationId: string, operation: string, key: string) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${operation}:${organizationId}:${key}`]
  )
}

function db() {
  const pool = getPool()
  if (!pool) throw new HttpError(503, "database_not_configured", "La base de données Neon n'est pas configurée.")
  return pool
}

function invalid(error: z.ZodError) {
  return new HttpError(400, "validation_error", error.issues[0]?.message || "Les données ne sont pas valides.")
}

function isOnboarded(current: TenantContext) {
  if (!current.onboardingCompleted) {
    throw new HttpError(403, "onboarding_required", "Terminez la configuration de votre station avant d'accéder aux opérations.")
  }
}

function cents(value: string | number | null | undefined) {
  const numberValue = Number(value ?? 0)
  if (!Number.isSafeInteger(numberValue)) throw new HttpError(500, "invalid_money_value", "Un montant dépasse la capacité de calcul autorisée.")
  return numberValue
}

type Queryable = Pool | PoolClient

async function getWashDetail(queryable: Queryable, organizationId: string, washId: string) {
  const washResult = await queryable.query(
    `SELECT id, organization_id, site_id, vehicle_category_id, total_cents, status,
            payment_status, reference, author_id, cancelled_at, cancelled_by_id,
            cancellation_reason, created_at
     FROM washes WHERE organization_id = $1 AND id = $2`,
    [organizationId, washId]
  )
  if (!washResult.rows[0]) return null
  const [items, workers, payments] = await Promise.all([
    queryable.query(
      `SELECT id, wash_id, service_id, service_name_snapshot, price_cents_snapshot, quantity
       FROM wash_items WHERE wash_id = $1 ORDER BY created_at, id`,
      [washId]
    ),
    queryable.query(
      `SELECT w.id, w.organization_id, w.first_name, w.last_name, w.phone,
              w.role, w.status, w.custom_role, w.joined_at
       FROM wash_worker_assignments a JOIN workers w ON w.id = a.worker_id
       WHERE a.wash_id = $1 AND w.organization_id = $2 ORDER BY w.first_name, w.last_name`,
      [washId, organizationId]
    ),
    queryable.query(
      `SELECT id, organization_id, wash_id, cash_session_id, amount_cents,
              method, status, reference, received_at, author_id, created_at
       FROM payments WHERE organization_id = $1 AND wash_id = $2 ORDER BY created_at`,
      [organizationId, washId]
    ),
  ])
  return {
    wash: { ...washResult.rows[0], total_cents: cents(washResult.rows[0].total_cents) },
    items: items.rows.map((item: Record<string, unknown>) => ({
      ...item,
      price_cents_snapshot: cents(item.price_cents_snapshot as string | number),
    })),
    workers: workers.rows,
    payments: payments.rows.map((payment: Record<string, unknown>) => ({
      ...payment,
      amount_cents: cents(payment.amount_cents as string | number),
    })),
  }
}

export function fingerprintWashInput(input: z.infer<typeof washInputSchema>) {
  return payloadFingerprint({
    site_id: input.site_id,
    vehicle_category_id: input.vehicle_category_id,
    items: [...input.items].sort((a, b) => a.service_id.localeCompare(b.service_id)),
    worker_ids: [...input.worker_ids].sort(),
    payment_method: input.payment_method,
    amount_received_cents: input.amount_received_cents,
    cash_session_id: input.cash_session_id ?? null,
  })
}

export function fingerprintCashSessionOpen(input: z.infer<typeof openSessionSchema>) {
  return payloadFingerprint(input)
}

export function fingerprintCashMovementInput(sessionId: string, input: z.infer<typeof movementSchema>) {
  return payloadFingerprint({ cash_session_id: sessionId, ...input })
}

export function fingerprintExpenseInput(input: z.infer<typeof expenseSchema>) {
  return payloadFingerprint(input)
}

function parseApiBody<T>(req: { body: unknown }, schema: z.ZodType<T>): T {
  const result = schema.safeParse(req.body)
  if (!result.success) throw invalid(result.error)
  return result.data
}

export function createOperationsRouter() {
  const router = Router()

  router.get("/washes", async (req, res) => {
    const current = tenant(req)
    isOnboarded(current)
    const { rows } = await db().query(
      `SELECT id, organization_id, site_id, vehicle_category_id, total_cents,
              status, payment_status, reference, author_id, created_at
       FROM washes WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [current.organizationId]
    )
    res.json(rows.map((wash) => ({ ...wash, total_cents: cents(wash.total_cents) })))
  })

  router.get("/washes/:washID", async (req, res) => {
    const current = tenant(req)
    isOnboarded(current)
    const detail = await getWashDetail(db(), current.organizationId, req.params.washID)
    if (!detail) throw new HttpError(404, "wash_not_found", "Lavage introuvable.")
    res.json(detail)
  })

  router.post("/washes", async (req, res) => {
    const current = tenant(req)
    isOnboarded(current)
    const input = parseApiBody(req, washInputSchema)
    const idempotencyKey = requireIdempotencyKey(req.header("Idempotency-Key"))
    const fingerprint = fingerprintWashInput(input)
    const client = await db().connect()
    try {
      await client.query("BEGIN")
      await lockIdempotencyKey(client, current.organizationId, "wash", idempotencyKey)
      const existing = await client.query<{ id: string; idempotency_fingerprint: string | null }>(
        `SELECT id, idempotency_fingerprint FROM washes WHERE organization_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [current.organizationId, idempotencyKey]
      )
      if (existing.rows[0]) {
        if (existing.rows[0].idempotency_fingerprint !== fingerprint) {
          throw new HttpError(409, "idempotency_conflict", "Cette clé d'idempotence a déjà été utilisée avec une autre demande.")
        }
        const detail = await getWashDetail(client, current.organizationId, existing.rows[0].id)
        await client.query("COMMIT")
        res.setHeader("Idempotency-Replayed", "true")
        res.status(200).json(detail)
        return
      }

      const siteResult = await client.query(
        `SELECT 1 FROM sites WHERE organization_id = $1 AND id = $2 AND is_active = true`,
        [current.organizationId, input.site_id]
      )
      if (!siteResult.rowCount) throw new HttpError(400, "invalid_site", "Le site sélectionné n'appartient pas à cette organisation.")
      const categoryResult = await client.query(
        `SELECT 1 FROM vehicle_categories WHERE organization_id = $1 AND id = $2 AND is_active = true`,
        [current.organizationId, input.vehicle_category_id]
      )
      if (!categoryResult.rowCount) throw new HttpError(400, "invalid_vehicle_category", "La catégorie de véhicule n'appartient pas à cette organisation.")

      const serviceIds = input.items.map((item) => item.service_id)
      if (new Set(serviceIds).size !== serviceIds.length) throw new HttpError(400, "duplicate_service_item", "Une prestation ne peut apparaître qu'une fois par lavage.")
      const servicesResult = await client.query<{ id: string; name: string; price_cents: string | number }>(
        `SELECT id, name, price_cents FROM services
         WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND is_active = true`,
        [current.organizationId, serviceIds]
      )
      if (servicesResult.rows.length !== serviceIds.length) throw new HttpError(400, "invalid_service", "Une prestation sélectionnée est inactive ou n'appartient pas à cette organisation.")
      const servicesById = new Map(servicesResult.rows.map((service) => [service.id, service]))
      let totalCents = 0
      for (const item of input.items) {
        const service = servicesById.get(item.service_id)
        if (!service) throw new HttpError(400, "invalid_service", "Prestation introuvable.")
        const line = cents(service.price_cents) * item.quantity
        totalCents += line
        if (!Number.isSafeInteger(totalCents)) throw new HttpError(400, "invalid_total", "Le montant total dépasse la limite autorisée.")
      }
      if (input.amount_received_cents > totalCents) throw new HttpError(400, "payment_exceeds_total", "Le paiement reçu ne peut pas dépasser le montant total.")

      if (new Set(input.worker_ids).size !== input.worker_ids.length) {
        throw new HttpError(400, "duplicate_worker", "Un travailleur ne peut être affecté qu'une seule fois au même lavage.")
      }
      if (input.worker_ids.length) {
        const workerResult = await client.query(
          `SELECT id FROM workers WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
          [current.organizationId, input.worker_ids]
        )
        if (workerResult.rows.length !== new Set(input.worker_ids).size) throw new HttpError(400, "invalid_worker", "Un travailleur sélectionné est inactif ou n'appartient pas à cette organisation.")
      }

      let cashSessionId: string | null = null
      if (input.amount_received_cents > 0 && input.payment_method === "cash") {
        if (!input.cash_session_id) throw new HttpError(409, "cash_session_required", "Ouvrez une session de caisse pour enregistrer un paiement en espèces.")
        const sessionResult = await client.query<{
          id: string
          site_id: string
          user_id: string | null
          theoretical_balance_cents: string
        }>(
          `SELECT id, site_id, user_id, theoretical_balance_cents FROM cash_sessions
           WHERE organization_id = $1 AND site_id = $2 AND id = $3 AND status = 'open'
           FOR UPDATE`,
          [current.organizationId, input.site_id, input.cash_session_id]
        )
        const cashSession = sessionResult.rows[0]
        if (!cashSession) throw new HttpError(409, "cash_session_unavailable", "La session de caisse est fermée ou n'appartient pas au site sélectionné.")
        requireCashSessionOperator(current, cashSession)
        const nextBalance = cents(cashSession.theoretical_balance_cents) + input.amount_received_cents
        if (!Number.isSafeInteger(nextBalance)) throw new HttpError(400, "invalid_cash_balance", "Le solde de caisse dépasse la limite de calcul autorisée.")
        cashSessionId = cashSession.id
      } else if (input.cash_session_id && input.amount_received_cents > 0) {
        throw new HttpError(400, "unexpected_cash_session", "Une session de caisse ne peut être liée qu'à un paiement en espèces.")
      } else if (input.cash_session_id) {
        throw new HttpError(400, "unexpected_cash_session", "Une session de caisse ne peut être liée qu'à un paiement d'un montant positif.")
      }

      // Initialize the tenant/year counter once from legacy references, then
      // allocate atomically without scanning the entire washes table per write.
      const year = new Date().getUTCFullYear()
      await client.query(
        `INSERT INTO wash_reference_counters (organization_id, reference_year, next_number)
         SELECT $1, $2, COALESCE(MAX(SUBSTRING(reference FROM $3)::bigint), 0) + 1
         FROM washes
         WHERE organization_id = $1 AND reference LIKE $4
         ON CONFLICT (organization_id, reference_year) DO NOTHING`,
        [current.organizationId, year, `^LAV-${year}-([0-9]+)$`, `LAV-${year}-%`]
      )
      const counter = await client.query<{ reference_number: string }>(
        `UPDATE wash_reference_counters
         SET next_number = next_number + 1, updated_at = NOW()
         WHERE organization_id = $1 AND reference_year = $2
         RETURNING (next_number - 1)::text AS reference_number`,
        [current.organizationId, year]
      )
      const referenceNumber = counter.rows[0]?.reference_number
      if (!referenceNumber) throw new Error("Wash reference counter allocation returned no number")
      const reference = `LAV-${year}-${referenceNumber.padStart(5, "0")}`
      const paymentStatus = input.amount_received_cents >= totalCents
        ? "paid"
        : input.amount_received_cents > 0
          ? "partial"
          : "unpaid"

      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO washes (
           organization_id, site_id, vehicle_category_id, reference, total_cents,
           status, payment_status, author_id, idempotency_key, idempotency_fingerprint
         ) VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9)
         ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [current.organizationId, input.site_id, input.vehicle_category_id, reference, totalCents, paymentStatus, current.userId, idempotencyKey, fingerprint]
      )
      const washId = insertResult.rows[0]?.id
      if (!washId) {
        const retry = await client.query<{ id: string; idempotency_fingerprint: string | null }>(
          `SELECT id, idempotency_fingerprint FROM washes WHERE organization_id = $1 AND idempotency_key = $2`,
          [current.organizationId, idempotencyKey]
        )
        if (!retry.rows[0] || retry.rows[0].idempotency_fingerprint !== fingerprint) {
          throw new HttpError(409, "idempotency_conflict", "Cette opération a été envoyée simultanément avec des données différentes.")
        }
        const detail = await getWashDetail(client, current.organizationId, retry.rows[0].id)
        await client.query("COMMIT")
        res.setHeader("Idempotency-Replayed", "true")
        res.status(200).json(detail)
        return
      }

      for (const item of input.items) {
        const service = servicesById.get(item.service_id)!
        await client.query(
          `INSERT INTO wash_items (wash_id, service_id, service_name_snapshot, price_cents_snapshot, quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [washId, item.service_id, service.name, cents(service.price_cents), item.quantity]
        )
      }
      for (const workerId of input.worker_ids) {
        await client.query(`INSERT INTO wash_worker_assignments (wash_id, worker_id) VALUES ($1, $2)`, [washId, workerId])
      }

      if (input.amount_received_cents > 0) {
        const payment = await client.query<{ id: string }>(
          `INSERT INTO payments (organization_id, wash_id, cash_session_id, amount_cents, method, status, reference, author_id)
           VALUES ($1, $2, $3, $4, $5, 'verified', $6, $7) RETURNING id`,
          [current.organizationId, washId, cashSessionId, input.amount_received_cents, input.payment_method, `REC-${reference}`, current.userId]
        )
        if (cashSessionId) {
          await client.query(
            `UPDATE cash_sessions SET theoretical_balance_cents = theoretical_balance_cents + $3, updated_at = NOW()
             WHERE organization_id = $1 AND id = $2`,
            [current.organizationId, cashSessionId, input.amount_received_cents]
          )
          await client.query(
            `INSERT INTO cash_movements (organization_id, cash_session_id, type, amount_cents, source, reference_id, description, author_id, idempotency_key)
             VALUES ($1, $2, 'entry', $3, 'wash_payment', $4, $5, $6, $7)`,
            [current.organizationId, cashSessionId, input.amount_received_cents, payment.rows[0].id, `Paiement lavage ${reference}`, current.userId, `payment:${payment.rows[0].id}`]
          )
        }
      }

      const detail = await getWashDetail(client, current.organizationId, washId)
      await client.query("COMMIT")
      res.status(201).json(detail)
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      if (typeof error === "object" && error !== null && "code" in error) {
        const pgError = error as { code?: string; constraint?: string }
        if (pgError.code === "23505" && pgError.constraint?.includes("idempotency")) {
          throw new HttpError(409, "idempotency_conflict", "Cette clé d'idempotence est déjà utilisée.")
        }
      }
      throw error
    } finally {
      client.release()
    }
  })

  router.post("/washes/:washID/cancel", async (req, res) => {
    const current = tenant(req)
    isOnboarded(current)
    requireManager(current, "annuler un lavage")
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : ""
    if (!reason || reason.length > 1000) throw new HttpError(400, "reason_required", "Indiquez un motif d'annulation valide.")
    const client = await db().connect()
    try {
      await client.query("BEGIN")
      const washResult = await client.query<{
        id: string
        organization_id: string
        site_id: string | null
        vehicle_category_id: string | null
        total_cents: string
        status: string
        payment_status: string
        reference: string
        author_id: string | null
        cancelled_at: string | null
        cancelled_by_id: string | null
        cancellation_reason: string | null
        created_at: string
      }>(
        `SELECT id, organization_id, site_id, vehicle_category_id, total_cents,
                status, payment_status, reference, author_id, cancelled_at,
                cancelled_by_id, cancellation_reason, created_at
         FROM washes WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [current.organizationId, req.params.washID]
      )
      const wash = washResult.rows[0]
      if (!wash) throw new HttpError(404, "wash_not_found", "Lavage introuvable.")
      if (wash.status === "cancelled") {
        await client.query("COMMIT")
        res.setHeader("Idempotency-Replayed", "true")
        res.json({ wash: { ...wash, total_cents: cents(wash.total_cents) } })
        return
      }
      const paymentResult = await client.query(
        `SELECT 1 FROM payments WHERE organization_id = $1 AND wash_id = $2 AND status = 'verified' LIMIT 1`,
        [current.organizationId, wash.id]
      )
      if (paymentResult.rowCount) throw new HttpError(409, "payment_must_be_refunded", "Remboursez ou annulez d'abord le paiement vérifié.")
      const { rows } = await client.query(
        `UPDATE washes SET status = 'cancelled', cancellation_reason = $3,
             cancelled_at = NOW(), cancelled_by_id = $4, updated_at = NOW()
         WHERE organization_id = $1 AND id = $2
         RETURNING id, organization_id, site_id, vehicle_category_id, total_cents, status,
                   payment_status, reference, author_id, cancelled_at, cancelled_by_id,
                   cancellation_reason, created_at`,
        [current.organizationId, wash.id, reason, current.userId]
      )
      await client.query("COMMIT")
      res.json({ wash: { ...rows[0], total_cents: cents(rows[0].total_cents) } })
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  })

  router.get("/cash-sessions/current", async (req, res) => {
    const current = tenant(req)
    isOnboarded(current)
    const siteId = typeof req.query.site_id === "string" ? req.query.site_id : null
    const { rows } = await db().query(
      `SELECT id, organization_id, site_id, user_id, opening_amount_cents,
              theoretical_balance_cents, counted_amount_cents, discrepancy_cents,
              discrepancy_reason, status, opened_at, closed_at, closed_by_id, created_at, updated_at
       FROM cash_sessions WHERE organization_id = $1 AND status = 'open'
         AND ($2::uuid IS NULL OR site_id = $2)
       ORDER BY opened_at DESC LIMIT 1`,
      [current.organizationId, siteId]
    )
    const session = rows[0]
    res.json(session ? {
      ...session,
      opening_amount_cents: cents(session.opening_amount_cents),
      theoretical_balance_cents: cents(session.theoretical_balance_cents),
    } : null)
  })

  router.get("/cash-sessions", async (req, res) => {
    const current = tenant(req)
    isOnboarded(current)
    const status = typeof req.query.status === "string" ? req.query.status : null
    const { rows } = await db().query(
      `SELECT id, organization_id, site_id, user_id, opening_amount_cents,
              theoretical_balance_cents, counted_amount_cents, discrepancy_cents,
              discrepancy_reason, status, opened_at, closed_at, closed_by_id, created_at, updated_at
       FROM cash_sessions WHERE organization_id = $1 AND ($2::varchar IS NULL OR status = $2)
       ORDER BY opened_at DESC LIMIT 500`,
      [current.organizationId, status]
    )
    res.json(rows.map((session) => ({
      ...session,
      opening_amount_cents: cents(session.opening_amount_cents),
      theoretical_balance_cents: cents(session.theoretical_balance_cents),
      counted_amount_cents: session.counted_amount_cents === null ? null : cents(session.counted_amount_cents),
      discrepancy_cents: session.discrepancy_cents === null ? null : cents(session.discrepancy_cents),
    })))
  })

  router.post("/cash-sessions/open", async (req, res) => {
    const current = tenant(req)
    isOnboarded(current)
    const input = parseApiBody(req, openSessionSchema)
    const idempotencyKey = requireIdempotencyKey(req.header("Idempotency-Key"))
    const fingerprint = fingerprintCashSessionOpen(input)
    const client = await db().connect()
    try {
      await client.query("BEGIN")
      await lockIdempotencyKey(client, current.organizationId, "cash-session-open", idempotencyKey)
      const existing = await client.query<{ id: string; idempotency_fingerprint: string | null }>(
        `SELECT id, idempotency_fingerprint FROM cash_sessions
         WHERE organization_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [current.organizationId, idempotencyKey]
      )
      if (existing.rows[0]) {
        if (existing.rows[0].idempotency_fingerprint !== fingerprint) {
          throw new HttpError(409, "idempotency_conflict", "Cette clé d'idempotence a déjà été utilisée avec une autre ouverture de caisse.")
        }
        const replay = await client.query(
          `SELECT id, organization_id, site_id, user_id, opening_amount_cents,
                  theoretical_balance_cents, counted_amount_cents, discrepancy_cents,
                  discrepancy_reason, status, opened_at, closed_at, closed_by_id, created_at, updated_at
           FROM cash_sessions WHERE organization_id = $1 AND id = $2`,
          [current.organizationId, existing.rows[0].id]
        )
        const session = replay.rows[0]
        if (!session) throw new Error("Idempotent cash session record disappeared")
        await client.query("COMMIT")
        res.setHeader("Idempotency-Replayed", "true")
        res.status(200).json({
          ...session,
          opening_amount_cents: cents(session.opening_amount_cents),
          theoretical_balance_cents: cents(session.theoretical_balance_cents),
          counted_amount_cents: session.counted_amount_cents === null ? null : cents(session.counted_amount_cents),
        })
        return
      }

      const site = await client.query(
        `SELECT id FROM sites WHERE organization_id = $1 AND id = $2 AND is_active = true FOR UPDATE`,
        [current.organizationId, input.site_id]
      )
      if (!site.rowCount) throw new HttpError(400, "invalid_site", "Le site sélectionné n'appartient pas à votre organisation.")
      const openSession = await client.query(
        `SELECT 1 FROM cash_sessions WHERE organization_id = $1 AND site_id = $2 AND status = 'open' LIMIT 1`,
        [current.organizationId, input.site_id]
      )
      if (openSession.rowCount) throw new HttpError(409, "cash_session_already_open", "Une session de caisse est déjà ouverte pour ce site.")
      const session = await client.query(
        `INSERT INTO cash_sessions (organization_id, site_id, user_id, opening_amount_cents,
             theoretical_balance_cents, idempotency_key, idempotency_fingerprint)
         VALUES ($1, $2, $3, $4, $4, $5, $6)
         RETURNING id, organization_id, site_id, user_id, opening_amount_cents,
                   theoretical_balance_cents, counted_amount_cents, discrepancy_cents,
                   discrepancy_reason, status, opened_at, closed_at, closed_by_id, created_at, updated_at`,
        [current.organizationId, input.site_id, current.userId, input.opening_amount_cents, idempotencyKey, fingerprint]
      )
      const newSession = session.rows[0]
      if (input.opening_amount_cents > 0) {
        await client.query(
          `INSERT INTO cash_movements (organization_id, cash_session_id, type, amount_cents, source, description, author_id)
           VALUES ($1, $2, 'entry', $3, 'opening_balance', 'Fond de caisse initial ouverture', $4)`,
          [current.organizationId, newSession.id, input.opening_amount_cents, current.userId]
        )
      }
      await client.query("COMMIT")
      res.status(201).json({
        ...newSession,
        opening_amount_cents: cents(newSession.opening_amount_cents),
        theoretical_balance_cents: cents(newSession.theoretical_balance_cents),
      })
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505") {
        throw new HttpError(409, "cash_session_already_open", "Une session de caisse est déjà ouverte pour ce site.")
      }
      throw error
    } finally {
      client.release()
    }
  })

  router.get("/cash-sessions/:sessionID/movements", async (req, res) => {
    const current = tenant(req)
    isOnboarded(current)
    const { rows } = await db().query(
      `SELECT id, organization_id, cash_session_id, type, amount_cents, source,
              reference_id, description, author_id, created_at
       FROM cash_movements WHERE organization_id = $1 AND cash_session_id = $2
       ORDER BY created_at, id`,
      [current.organizationId, req.params.sessionID]
    )
    res.json(rows.map((item) => ({ ...item, amount_cents: cents(item.amount_cents) })))
  })

  router.post("/cash-sessions/:sessionID/movements", async (req, res) => {
    const current = tenant(req)
    isOnboarded(current)
    const input = parseApiBody(req, movementSchema)
    const idempotencyKey = requireIdempotencyKey(req.header("Idempotency-Key"))
    const fingerprint = fingerprintCashMovementInput(req.params.sessionID, input)
    const client = await db().connect()
    try {
      await client.query("BEGIN")
      await lockIdempotencyKey(client, current.organizationId, "cash-movement", idempotencyKey)
      const existing = await client.query<{ id: string; idempotency_fingerprint: string | null }>(
        `SELECT id, idempotency_fingerprint FROM cash_movements
         WHERE organization_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [current.organizationId, idempotencyKey]
      )
      if (existing.rows[0]) {
        if (existing.rows[0].idempotency_fingerprint !== fingerprint) {
          throw new HttpError(409, "idempotency_conflict", "Cette clé d'idempotence a déjà été utilisée avec d'autres données.")
        }
        const replay = await client.query(
          `SELECT id, organization_id, cash_session_id, type, amount_cents, source,
                  reference_id, description, author_id, created_at
           FROM cash_movements WHERE organization_id = $1 AND id = $2`,
          [current.organizationId, existing.rows[0].id]
        )
        if (!replay.rows[0]) throw new Error("Idempotent cash movement record disappeared")
        await client.query("COMMIT")
        res.setHeader("Idempotency-Replayed", "true")
        res.status(200).json({ ...replay.rows[0], amount_cents: cents(replay.rows[0].amount_cents) })
        return
      }

      const sessionResult = await client.query<{
        id: string
        user_id: string | null
        theoretical_balance_cents: string
        status: string
      }>(
        `SELECT id, user_id, theoretical_balance_cents, status FROM cash_sessions
         WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [current.organizationId, req.params.sessionID]
      )
      const session = sessionResult.rows[0]
      if (!session) throw new HttpError(404, "cash_session_not_found", "Session de caisse introuvable.")
      if (session.status !== "open") throw new HttpError(409, "cash_session_closed", "Cette session de caisse est clôturée.")
      requireCashSessionOperator(current, session)
      const nextBalance = cents(session.theoretical_balance_cents) + (input.type === "entry" ? input.amount_cents : -input.amount_cents)
      if (nextBalance < 0) throw new HttpError(409, "insufficient_cash_balance", "Le solde de la caisse ne permet pas cette sortie.")
      if (!Number.isSafeInteger(nextBalance)) throw new HttpError(400, "invalid_cash_balance", "Le solde de caisse dépasse la limite de calcul autorisée.")
      const { rows } = await client.query(
        `INSERT INTO cash_movements (organization_id, cash_session_id, type, amount_cents,
             source, description, author_id, idempotency_key, idempotency_fingerprint)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, organization_id, cash_session_id, type, amount_cents, source,
                   reference_id, description, author_id, created_at`,
        [current.organizationId, session.id, input.type, input.amount_cents, input.source,
          input.description ?? null, current.userId, idempotencyKey, fingerprint]
      )
      await client.query(
        `UPDATE cash_sessions SET theoretical_balance_cents = $3, updated_at = NOW() WHERE organization_id = $1 AND id = $2`,
        [current.organizationId, session.id, nextBalance]
      )
      await client.query("COMMIT")
      res.status(201).json({ ...rows[0], amount_cents: cents(rows[0].amount_cents) })
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  })

  router.post("/cash-sessions/:sessionID/close", async (req, res) => {
    const current = tenant(req)
    isOnboarded(current)
    const input = parseApiBody(req, closeSessionSchema)
    const reason = input.discrepancy_reason?.trim() || null
    const client = await db().connect()
    try {
      await client.query("BEGIN")
      const sessionResult = await client.query<{
        id: string
        user_id: string | null
        theoretical_balance_cents: string
        counted_amount_cents: string | null
        discrepancy_reason: string | null
        status: string
      }>(
        `SELECT id, user_id, theoretical_balance_cents, counted_amount_cents,
                discrepancy_reason, status FROM cash_sessions
         WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [current.organizationId, req.params.sessionID]
      )
      const session = sessionResult.rows[0]
      if (!session) throw new HttpError(404, "cash_session_not_found", "Session de caisse introuvable.")
      requireCashSessionOperator(current, session)

      if (session.status !== "open") {
        if (session.counted_amount_cents === null ||
            cents(session.counted_amount_cents) !== input.counted_amount_cents ||
            (session.discrepancy_reason?.trim() || null) !== reason) {
          throw new HttpError(409, "cash_session_closed", "Cette session de caisse est déjà clôturée avec d'autres valeurs.")
        }
        const replay = await client.query(
          `SELECT id, organization_id, site_id, user_id, opening_amount_cents,
                  theoretical_balance_cents, counted_amount_cents, discrepancy_cents,
                  discrepancy_reason, status, opened_at, closed_at, closed_by_id, created_at, updated_at
           FROM cash_sessions WHERE organization_id = $1 AND id = $2`,
          [current.organizationId, session.id]
        )
        const closed = replay.rows[0]
        if (!closed) throw new Error("Closed cash session record disappeared")
        await client.query("COMMIT")
        res.setHeader("Idempotency-Replayed", "true")
        res.json({
          ...closed,
          opening_amount_cents: cents(closed.opening_amount_cents),
          theoretical_balance_cents: cents(closed.theoretical_balance_cents),
          counted_amount_cents: cents(closed.counted_amount_cents),
          discrepancy_cents: cents(closed.discrepancy_cents),
        })
        return
      }

      const discrepancy = input.counted_amount_cents - cents(session.theoretical_balance_cents)
      if (!Number.isSafeInteger(discrepancy)) throw new HttpError(400, "invalid_cash_discrepancy", "L'écart dépasse la limite de calcul autorisée.")
      if (discrepancy !== 0 && !reason) {
        throw new HttpError(400, "discrepancy_reason_required", "Justifiez l'écart avant de clôturer la session.")
      }
      const { rows } = await client.query(
        `UPDATE cash_sessions SET status = 'closed', counted_amount_cents = $3,
             discrepancy_cents = $4, discrepancy_reason = $5, closed_at = NOW(),
             closed_by_id = $6, updated_at = NOW()
         WHERE organization_id = $1 AND id = $2
         RETURNING id, organization_id, site_id, user_id, opening_amount_cents,
                   theoretical_balance_cents, counted_amount_cents, discrepancy_cents,
                   discrepancy_reason, status, opened_at, closed_at, closed_by_id, created_at, updated_at`,
        [current.organizationId, session.id, input.counted_amount_cents, discrepancy, reason, current.userId]
      )
      await client.query("COMMIT")
      res.json({
        ...rows[0],
        opening_amount_cents: cents(rows[0].opening_amount_cents),
        theoretical_balance_cents: cents(rows[0].theoretical_balance_cents),
        counted_amount_cents: cents(rows[0].counted_amount_cents),
        discrepancy_cents: cents(rows[0].discrepancy_cents),
      })
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  })

  router.get("/expenses", async (req, res) => {
    const current = tenant(req)
    isOnboarded(current)
    const { rows } = await db().query(
      `SELECT id, organization_id, site_id, category, amount_cents, expense_date,
              payment_method, beneficiary, description, reference, status,
              cash_session_id, author_id, created_at, updated_at
       FROM expenses WHERE organization_id = $1 ORDER BY expense_date DESC LIMIT 500`,
      [current.organizationId]
    )
    res.json(rows.map((expense) => ({ ...expense, amount_cents: cents(expense.amount_cents) })))
  })

  router.post("/expenses", async (req, res) => {
    const current = tenant(req)
    isOnboarded(current)
    const input = parseApiBody(req, expenseSchema)
    if (input.payment_method === "cash" && !input.cash_session_id) {
      throw new HttpError(409, "cash_session_required", "Ouvrez une session de caisse pour une dépense en espèces.")
    }
    if (input.payment_method !== "cash" && input.cash_session_id) {
      throw new HttpError(400, "unexpected_cash_session", "La session de caisse ne s'applique qu'aux dépenses en espèces.")
    }
    const idempotencyKey = requireIdempotencyKey(req.header("Idempotency-Key"))
    const fingerprint = fingerprintExpenseInput(input)
    const client = await db().connect()
    try {
      await client.query("BEGIN")
      await lockIdempotencyKey(client, current.organizationId, "expense", idempotencyKey)
      const existing = await client.query<{ id: string; idempotency_fingerprint: string | null }>(
        `SELECT id, idempotency_fingerprint FROM expenses
         WHERE organization_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [current.organizationId, idempotencyKey]
      )
      if (existing.rows[0]) {
        if (existing.rows[0].idempotency_fingerprint !== fingerprint) {
          throw new HttpError(409, "idempotency_conflict", "Cette clé d'idempotence a déjà été utilisée avec d'autres données.")
        }
        const replay = await client.query(
          `SELECT id, organization_id, site_id, category, amount_cents, expense_date,
                  payment_method, beneficiary, description, reference, status,
                  cash_session_id, author_id, created_at, updated_at
           FROM expenses WHERE organization_id = $1 AND id = $2`,
          [current.organizationId, existing.rows[0].id]
        )
        if (!replay.rows[0]) throw new Error("Idempotent expense record disappeared")
        await client.query("COMMIT")
        res.setHeader("Idempotency-Replayed", "true")
        res.status(200).json({ ...replay.rows[0], amount_cents: cents(replay.rows[0].amount_cents) })
        return
      }

      let siteId = input.site_id ?? null
      if (siteId) {
        const site = await client.query(
          `SELECT 1 FROM sites WHERE organization_id = $1 AND id = $2 AND is_active = true`,
          [current.organizationId, siteId]
        )
        if (!site.rowCount) throw new HttpError(400, "invalid_site", "Le site sélectionné n'appartient pas à votre organisation.")
      }
      let cashSessionBalance: number | null = null
      if (input.cash_session_id) {
        const session = await client.query<{
          id: string
          site_id: string
          user_id: string | null
          status: string
          theoretical_balance_cents: string
        }>(
          `SELECT id, site_id, user_id, status, theoretical_balance_cents
           FROM cash_sessions WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
          [current.organizationId, input.cash_session_id]
        )
        const cashSession = session.rows[0]
        if (!cashSession || cashSession.status !== "open") throw new HttpError(409, "cash_session_unavailable", "La session de caisse est fermée ou introuvable.")
        requireCashSessionOperator(current, cashSession)
        if (siteId && cashSession.site_id !== siteId) throw new HttpError(400, "cash_session_site_mismatch", "La session de caisse n'appartient pas au site sélectionné.")
        siteId ??= cashSession.site_id
        const balance = cents(cashSession.theoretical_balance_cents)
        if (balance < input.amount_cents) {
          throw new HttpError(409, "insufficient_cash_balance", "Le solde de la caisse ne permet pas cette dépense.")
        }
        cashSessionBalance = balance - input.amount_cents
      }

      const { rows } = await client.query(
        `INSERT INTO expenses (organization_id, site_id, category, amount_cents,
             expense_date, payment_method, beneficiary, description, reference,
             status, cash_session_id, author_id, idempotency_key, idempotency_fingerprint)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, 'recorded', $9, $10, $11, $12)
         RETURNING id, organization_id, site_id, category, amount_cents, expense_date,
                   payment_method, beneficiary, description, reference, status,
                   cash_session_id, author_id, created_at, updated_at`,
        [current.organizationId, siteId, input.category, input.amount_cents,
          input.payment_method, input.beneficiary ?? null, input.description ?? null,
          input.reference ?? null, input.cash_session_id ?? null, current.userId,
          idempotencyKey, fingerprint]
      )
      if (input.cash_session_id && cashSessionBalance !== null) {
        await client.query(
          `UPDATE cash_sessions SET theoretical_balance_cents = $3, updated_at = NOW()
           WHERE organization_id = $1 AND id = $2`,
          [current.organizationId, input.cash_session_id, cashSessionBalance]
        )
        await client.query(
          `INSERT INTO cash_movements (organization_id, cash_session_id, type, amount_cents, source, reference_id, description, author_id)
           VALUES ($1, $2, 'exit', $3, 'expense', $4, $5, $6)`,
          [current.organizationId, input.cash_session_id, input.amount_cents, rows[0].id, `Dépense: ${input.description || input.category}`, current.userId]
        )
      }
      await client.query("COMMIT")
      res.status(201).json({ ...rows[0], amount_cents: cents(rows[0].amount_cents) })
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  })

  router.get("/expenses/:expenseID", async (req, res) => {
    const current = tenant(req)
    isOnboarded(current)
    const { rows } = await db().query(
      `SELECT id, organization_id, site_id, category, amount_cents, expense_date,
              payment_method, beneficiary, description, reference, status, cash_session_id,
              author_id, created_at, updated_at
       FROM expenses WHERE organization_id = $1 AND id = $2`,
      [current.organizationId, req.params.expenseID]
    )
    if (!rows[0]) throw new HttpError(404, "expense_not_found", "Dépense introuvable.")
    res.json({ ...rows[0], amount_cents: cents(rows[0].amount_cents) })
  })

  router.post("/expenses/:expenseID/cancel", async (req, res) => {
    const current = tenant(req)
    isOnboarded(current)
    requireManager(current, "annuler une dépense")
    const client = await db().connect()
    try {
      await client.query("BEGIN")
      const { rows: expenseRows } = await client.query<{
        id: string; status: string; cash_session_id: string | null; amount_cents: string; description: string | null; category: string
      }>(
        `SELECT id, status, cash_session_id, amount_cents, description, category
         FROM expenses WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [current.organizationId, req.params.expenseID]
      )
      const expense = expenseRows[0]
      if (!expense) throw new HttpError(404, "expense_not_found", "Dépense introuvable.")
      if (expense.status === "cancelled") {
        const replay = await client.query(
          `SELECT id, organization_id, site_id, category, amount_cents, expense_date,
                  payment_method, beneficiary, description, reference, status,
                  cash_session_id, author_id, created_at, updated_at
           FROM expenses WHERE organization_id = $1 AND id = $2`,
          [current.organizationId, expense.id]
        )
        await client.query("COMMIT")
        res.setHeader("Idempotency-Replayed", "true")
        res.json({ expense: { ...replay.rows[0], amount_cents: cents(replay.rows[0].amount_cents) } })
        return
      }
      if (expense.cash_session_id) {
        const session = await client.query<{ id: string; status: string; theoretical_balance_cents: string }>(
          `SELECT id, status, theoretical_balance_cents FROM cash_sessions WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
          [current.organizationId, expense.cash_session_id]
        )
        if (session.rows[0]?.status !== "open") throw new HttpError(409, "cash_session_closed", "La session de caisse est clôturée; utilisez un ajustement de caisse plutôt que de modifier son historique.")
        const restoredBalance = cents(session.rows[0].theoretical_balance_cents) + cents(expense.amount_cents)
        if (!Number.isSafeInteger(restoredBalance)) throw new HttpError(409, "invalid_cash_balance", "Le solde de caisse dépasse la limite de calcul autorisée.")
        await client.query(
          `UPDATE cash_sessions SET theoretical_balance_cents = $3, updated_at = NOW()
           WHERE organization_id = $1 AND id = $2`,
          [current.organizationId, expense.cash_session_id, restoredBalance]
        )
        await client.query(
          `INSERT INTO cash_movements (organization_id, cash_session_id, type, amount_cents, source, reference_id, description, author_id)
           VALUES ($1, $2, 'entry', $3, 'expense_cancellation', $4, $5, $6)`,
          [current.organizationId, expense.cash_session_id, expense.amount_cents, expense.id, `Annulation dépense: ${expense.description || expense.category}`, current.userId]
        )
      }
      const result = await client.query(
        `UPDATE expenses SET status = 'cancelled', updated_at = NOW()
         WHERE organization_id = $1 AND id = $2
         RETURNING id, organization_id, site_id, category, amount_cents, expense_date,
                   payment_method, beneficiary, description, reference, status,
                   cash_session_id, author_id, created_at, updated_at`,
        [current.organizationId, expense.id]
      )
      await client.query("COMMIT")
      res.json({ expense: { ...result.rows[0], amount_cents: cents(result.rows[0].amount_cents) } })
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  })

  router.get("/payments", async (req, res) => {
    const current = tenant(req)
    isOnboarded(current)
    const { rows } = await db().query(
      `SELECT id, organization_id, wash_id, cash_session_id, amount_cents,
              method, status, reference, received_at, author_id, created_at
       FROM payments WHERE organization_id = $1 ORDER BY received_at DESC LIMIT 500`,
      [current.organizationId]
    )
    res.json(rows.map((payment) => ({ ...payment, amount_cents: cents(payment.amount_cents) })))
  })

  return router
}
