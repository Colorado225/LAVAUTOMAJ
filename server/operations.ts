import { Router } from "express"
import { z } from "zod"
import type { Pool } from "pg"
import { getPool } from "./db.ts"
import { asyncRoute, body, tenant, parseId, requireRole } from "./http.ts"
import { HttpError } from "./auth.ts"
import { fingerprint, withIdempotency } from "./idempotency.ts"

export const operationValidators = {
  openSession: z
    .object({
      site_id: z.string().uuid(),
      opening_amount_cents: z.number().int().min(0).max(100000000),
    })
    .strip(),
  movement: z
    .object({
      type: z.enum(["entry", "exit"]),
      amount_cents: z.number().int().positive().max(100000000),
      description: z.string().trim().max(500).nullable().optional(),
    })
    .strip(),
  closeSession: z
    .object({
      counted_amount_cents: z.number().int().min(0).max(100000000),
      discrepancy_reason: z.string().trim().max(500).nullable().optional(),
    })
    .strip(),
  expense: z
    .object({
      category: z.enum(["supply", "salary", "maintenance", "utilities", "rent", "tax", "marketing", "other"]),
      amount_cents: z.number().int().positive().max(100000000),
      payment_method: z.enum(["cash", "orange_money", "mtn_momo", "moov_money", "wave", "other"]),
      site_id: z.string().uuid().optional(),
      beneficiary: z.string().trim().max(200).optional(),
      description: z.string().trim().max(1000).optional(),
      reference: z.string().trim().max(120).optional(),
      cash_session_id: z.string().uuid().optional(),
    })
    .strip(),
}

function db(): Pool {
  const pool = getPool()
  if (!pool) throw new HttpError(503, "database_not_configured", "Base de données indisponible.")
  return pool
}

/**
 * Cash session projection: the theoretical balance is opening + entries − exits,
 * and the discrepancy compares the counted amount against it.
 */
const SESSION_SELECT = `
  SELECT cs.id, cs.organization_id, cs.site_id, cs.opened_by, cs.closed_by,
    cs.opening_amount_cents, cs.status, cs.opened_at, cs.closed_at, cs.discrepancy_reason,
    cs.closing_amount_cents AS counted_amount_cents,
    (cs.opening_amount_cents + COALESCE(m.entries,0) - COALESCE(m.exits,0))::int AS theoretical_balance_cents,
    CASE WHEN cs.closing_amount_cents IS NULL THEN NULL
         ELSE (cs.closing_amount_cents - (cs.opening_amount_cents + COALESCE(m.entries,0) - COALESCE(m.exits,0)))::int
    END AS discrepancy_cents
  FROM cash_sessions cs
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(amount_cents) FILTER (WHERE type='entry'),0)::int AS entries,
           COALESCE(SUM(amount_cents) FILTER (WHERE type='exit'),0)::int AS exits
    FROM cash_movements WHERE cash_session_id = cs.id
  ) m ON true`

const EXPENSE_FIELDS =
  "id, site_id, category, amount_cents, payment_method, cash_session_id, description, beneficiary, reference, status, expense_date, created_at"

export function createOperationsRouter() {
  const r = Router()

  // -------------------------------------------------------- cash sessions --
  r.get(
    "/cash-sessions",
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const status = typeof req.query.status === "string" && ["open", "closed"].includes(req.query.status) ? req.query.status : null
      const q = await db().query(
        `${SESSION_SELECT} WHERE cs.organization_id=$1 AND ($2::text IS NULL OR cs.status=$2) ORDER BY cs.opened_at DESC LIMIT 100`,
        [t.organizationId, status],
      )
      res.json(q.rows)
    }),
  )

  r.get(
    "/cash-sessions/current",
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const siteId = typeof req.query.site_id === "string" && req.query.site_id ? parseId(req.query.site_id) : null
      const q = await db().query(
        `${SESSION_SELECT} WHERE cs.organization_id=$1 AND cs.status='open' AND ($2::uuid IS NULL OR cs.site_id=$2)
         ORDER BY cs.opened_at DESC LIMIT 1`,
        [t.organizationId, siteId],
      )
      res.json(q.rows[0] ?? null)
    }),
  )

  r.post(
    "/cash-sessions/open",
    requireRole("owner", "manager", "cashier"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const input = body(operationValidators.openSession, req.body)
      const pool = db()

      await withIdempotency(pool, req, res, t.organizationId, fingerprint({ op: "cash-session-open", ...input }), async () => {
        const client = await pool.connect()
        try {
          await client.query("BEGIN")
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1 || $2))", [t.organizationId, input.site_id])

          const siteQ = await client.query("SELECT id FROM sites WHERE id=$1 AND organization_id=$2 AND is_active", [input.site_id, t.organizationId])
          if (!siteQ.rowCount) throw new HttpError(400, "invalid_site", "Station invalide.")

          const openQ = await client.query(
            "SELECT 1 FROM cash_sessions WHERE organization_id=$1 AND site_id=$2 AND status='open' LIMIT 1",
            [t.organizationId, input.site_id],
          )
          if (openQ.rowCount) {
            throw new HttpError(409, "cash_session_already_open", "Une session de caisse est déjà ouverte pour cette station.")
          }

          const insertQ = await client.query(
            "INSERT INTO cash_sessions(organization_id, site_id, opened_by, opening_amount_cents) VALUES($1,$2,$3,$4) RETURNING id",
            [t.organizationId, input.site_id, t.userId, input.opening_amount_cents],
          )
          const sessionQ = await client.query(`${SESSION_SELECT} WHERE cs.id=$1`, [insertQ.rows[0].id])
          await client.query("COMMIT")
          return { status: 201, body: sessionQ.rows[0] }
        } catch (error) {
          await client.query("ROLLBACK")
          throw error
        } finally {
          client.release()
        }
      })
    }),
  )

  r.get(
    "/cash-sessions/:id",
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const q = await db().query(`${SESSION_SELECT} WHERE cs.id=$1 AND cs.organization_id=$2`, [id, t.organizationId])
      if (!q.rowCount) throw new HttpError(404, "cash_session_not_found", "Session introuvable.")
      res.json(q.rows[0])
    }),
  )

  r.get(
    "/cash-sessions/:id/movements",
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const sessionQ = await db().query("SELECT 1 FROM cash_sessions WHERE id=$1 AND organization_id=$2", [id, t.organizationId])
      if (!sessionQ.rowCount) throw new HttpError(404, "cash_session_not_found", "Session introuvable.")
      const q = await db().query(
        "SELECT id, type, amount_cents, source, description, wash_id, created_at FROM cash_movements WHERE cash_session_id=$1 ORDER BY created_at DESC",
        [id],
      )
      res.json(q.rows)
    }),
  )

  r.post(
    "/cash-sessions/:id/movements",
    requireRole("owner", "manager", "cashier"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const input = body(operationValidators.movement, req.body)
      const pool = db()

      await withIdempotency(pool, req, res, t.organizationId, fingerprint({ op: "cash-movement", session: id, ...input }), async () => {
        const client = await pool.connect()
        try {
          await client.query("BEGIN")
          const sessionQ = await client.query(
            "SELECT id, status FROM cash_sessions WHERE id=$1 AND organization_id=$2 FOR UPDATE",
            [id, t.organizationId],
          )
          if (!sessionQ.rowCount) throw new HttpError(404, "cash_session_not_found", "Session introuvable.")
          if (sessionQ.rows[0].status !== "open") {
            throw new HttpError(409, "cash_session_closed", "Cette session de caisse est clôturée.")
          }
          const q = await client.query(
            `INSERT INTO cash_movements(organization_id, cash_session_id, type, amount_cents, source, description, created_by)
             VALUES($1,$2,$3,$4,'manual',$5,$6)
             RETURNING id, type, amount_cents, source, description, wash_id, created_at`,
            [t.organizationId, id, input.type, input.amount_cents, input.description || null, t.userId],
          )
          await client.query("COMMIT")
          return { status: 201, body: q.rows[0] }
        } catch (error) {
          await client.query("ROLLBACK")
          throw error
        } finally {
          client.release()
        }
      })
    }),
  )

  r.post(
    "/cash-sessions/:id/close",
    requireRole("owner", "manager", "cashier"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const input = body(operationValidators.closeSession, req.body)
      const pool = db()
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const lockQ = await client.query(
          "SELECT id FROM cash_sessions WHERE id=$1 AND organization_id=$2 FOR UPDATE",
          [id, t.organizationId],
        )
        if (!lockQ.rowCount) throw new HttpError(404, "cash_session_not_found", "Session introuvable.")
        const sessionQ = await client.query(`${SESSION_SELECT} WHERE cs.id=$1`, [id])
        const session = sessionQ.rows[0]
        if (session.status !== "open") {
          throw new HttpError(409, "cash_session_closed", "Cette session de caisse est déjà clôturée.")
        }

        const theoretical = Number(session.theoretical_balance_cents)
        const discrepancy = input.counted_amount_cents - theoretical
        if (discrepancy !== 0 && !input.discrepancy_reason?.trim()) {
          throw new HttpError(400, "discrepancy_reason_required", "Justifiez l’écart avant de clôturer la session.")
        }

        await client.query(
          `UPDATE cash_sessions SET status='closed', closed_by=$3, closed_at=now(),
             closing_amount_cents=$4, expected_amount_cents=$5, discrepancy_reason=$6
           WHERE id=$1 AND organization_id=$2`,
          [id, t.organizationId, t.userId, input.counted_amount_cents, theoretical, discrepancy !== 0 ? input.discrepancy_reason?.trim() || null : null],
        )
        await client.query(
          "INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata) VALUES($1,$2,'cash_session.closed','cash_session',$3,$4)",
          [t.organizationId, t.userId, id, JSON.stringify({ counted_amount_cents: input.counted_amount_cents, discrepancy_cents: discrepancy })],
        )
        const closedQ = await client.query(`${SESSION_SELECT} WHERE cs.id=$1`, [id])
        await client.query("COMMIT")
        res.json(closedQ.rows[0])
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }
    }),
  )

  // ------------------------------------------------------------- expenses --
  r.get(
    "/expenses",
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const q = await db().query(
        `SELECT ${EXPENSE_FIELDS} FROM expenses WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 200`,
        [t.organizationId],
      )
      res.json(q.rows)
    }),
  )

  r.post(
    "/expenses",
    requireRole("owner", "manager", "cashier"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const input = body(operationValidators.expense, req.body)
      const pool = db()

      await withIdempotency(pool, req, res, t.organizationId, fingerprint({ op: "expense", ...input }), async () => {
        const client = await pool.connect()
        try {
          await client.query("BEGIN")

          let siteId: string | null = input.site_id ?? null
          if (siteId) {
            const siteQ = await client.query("SELECT 1 FROM sites WHERE id=$1 AND organization_id=$2", [siteId, t.organizationId])
            if (!siteQ.rowCount) throw new HttpError(400, "invalid_site", "Station invalide.")
          }

          let cashSessionId: string | null = null
          if (input.payment_method === "cash") {
            if (!input.cash_session_id) {
              throw new HttpError(400, "cash_session_required", "Une session de caisse ouverte est requise pour une dépense en espèces.")
            }
            const sessionQ = await client.query(
              "SELECT id, site_id, status FROM cash_sessions WHERE id=$1 AND organization_id=$2 FOR UPDATE",
              [input.cash_session_id, t.organizationId],
            )
            if (!sessionQ.rowCount || sessionQ.rows[0].status !== "open") {
              throw new HttpError(400, "cash_session_invalid", "Session de caisse introuvable ou clôturée.")
            }
            cashSessionId = sessionQ.rows[0].id
            if (!siteId) siteId = sessionQ.rows[0].site_id
          }

          const q = await client.query(
            `INSERT INTO expenses(organization_id, site_id, category, amount_cents, payment_method, cash_session_id, description, beneficiary, reference, created_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${EXPENSE_FIELDS}`,
            [
              t.organizationId,
              siteId,
              input.category,
              input.amount_cents,
              input.payment_method,
              cashSessionId,
              input.description || null,
              input.beneficiary || null,
              input.reference || null,
              t.userId,
            ],
          )
          const expense = q.rows[0]

          if (cashSessionId) {
            await client.query(
              `INSERT INTO cash_movements(organization_id, cash_session_id, type, amount_cents, source, description, created_by)
               VALUES($1,$2,'exit',$3,'expense',$4,$5)`,
              [t.organizationId, cashSessionId, input.amount_cents, input.description || `Dépense ${input.category}`, t.userId],
            )
          }

          await client.query(
            "INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id) VALUES($1,$2,'expense.created','expense',$3)",
            [t.organizationId, t.userId, expense.id],
          )
          await client.query("COMMIT")
          return { status: 201, body: expense }
        } catch (error) {
          await client.query("ROLLBACK")
          throw error
        } finally {
          client.release()
        }
      })
    }),
  )

  return r
}
