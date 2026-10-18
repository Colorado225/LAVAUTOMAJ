import { Router } from "express"
import { z } from "zod"
import { HttpError } from "./auth.ts"
import { getPool } from "./db.ts"
import { requireManager } from "./permissions.ts"
import type { TenantContext } from "./types.ts"

const reportRangeSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
})

export function parseReportRange(input: unknown) {
  const parsed = reportRangeSchema.safeParse(input)
  if (!parsed.success) {
    throw new HttpError(400, "invalid_report_range", "Choisissez une date de début et une date de fin valides.")
  }
  const fromMs = Date.parse(`${parsed.data.from}T00:00:00Z`)
  const toMs = Date.parse(`${parsed.data.to}T00:00:00Z`)
  const days = (toMs - fromMs) / 86_400_000 + 1
  if (days < 1) {
    throw new HttpError(400, "invalid_report_range", "La date de début doit précéder la date de fin.")
  }
  if (days > 366) {
    throw new HttpError(400, "report_range_too_large", "La période maximale d'un rapport est de 366 jours.")
  }
  return { from: parsed.data.from, to: parsed.data.to }
}

function tenant(req: { tenant?: TenantContext }) {
  if (!req.tenant) throw new HttpError(401, "tenant_required", "Aucune organisation active.")
  if (!req.tenant.onboardingCompleted) {
    throw new HttpError(403, "onboarding_required", "Terminez l'onboarding avant de consulter les rapports.")
  }
  return req.tenant
}

function database() {
  const pool = getPool()
  if (!pool) throw new HttpError(503, "database_not_configured", "La base de données Neon n'est pas configurée.")
  return pool
}

function safeCount(value: string | number | null | undefined) {
  const count = Number(value ?? 0)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new HttpError(500, "invalid_report_value", "Une valeur du rapport dépasse la limite de calcul autorisée.")
  }
  return count
}

function dateBoundsSql(column: string) {
  return `${column} >= ($2::date::timestamp AT TIME ZONE 'Africa/Abidjan')
    AND ${column} < (($3::date + 1)::timestamp AT TIME ZONE 'Africa/Abidjan')`
}

interface ReportSummaryRow {
  total_washes: string
  completed_washes: string
  revenue_cents: string
  expenses_cents: string
  paid_washes: string
}

interface DailyReportRow {
  date: string
  wash_count: string
  revenue_cents: string
  expenses_cents: string
}

interface ServiceReportRow {
  name: string
  wash_count: string
  quantity: string
  amount_cents: string
}

interface PaymentReportRow {
  method: string
  payment_count: string
  amount_cents: string
}

interface ExpenseReportRow {
  category: string
  expense_count: string
  amount_cents: string
}

export function createReportsRouter() {
  const router = Router()

  router.get("/reports/summary", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store")
    const current = tenant(req)
    requireManager(current)
    const { from, to } = parseReportRange(req.query)
    const pool = database()
    const client = await pool.connect()

    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY")
      const summaryResult = await client.query<ReportSummaryRow>(
        `SELECT
           (SELECT COUNT(*)::text FROM washes w
            WHERE w.organization_id = $1 AND w.status <> 'cancelled'
              AND ${dateBoundsSql("w.created_at")}) AS total_washes,
           (SELECT COUNT(*)::text FROM washes w
            WHERE w.organization_id = $1 AND w.status = 'completed'
              AND ${dateBoundsSql("w.created_at")}) AS completed_washes,
           (SELECT COALESCE(SUM(p.amount_cents), 0)::text FROM payments p
            WHERE p.organization_id = $1 AND p.status = 'verified'
              AND ${dateBoundsSql("p.received_at")}) AS revenue_cents,
           (SELECT COALESCE(SUM(e.amount_cents), 0)::text FROM expenses e
            WHERE e.organization_id = $1 AND e.status = 'recorded'
              AND ${dateBoundsSql("e.expense_date")}) AS expenses_cents,
           (SELECT COUNT(DISTINCT w.id)::text FROM payments p
            JOIN washes w ON w.id = p.wash_id AND w.organization_id = p.organization_id
            WHERE p.organization_id = $1 AND p.status = 'verified' AND w.payment_status = 'paid'
              AND ${dateBoundsSql("p.received_at")}) AS paid_washes`,
        [current.organizationId, from, to],
      )

      const dailyResult = await client.query<DailyReportRow>(
        `WITH days AS (
           SELECT generate_series($2::date::timestamp, $3::date::timestamp, INTERVAL '1 day')::date AS report_date
         ), wash_daily AS (
           SELECT (w.created_at AT TIME ZONE 'Africa/Abidjan')::date AS report_date,
                  COUNT(*)::text AS wash_count
           FROM washes w
           WHERE w.organization_id = $1 AND w.status <> 'cancelled'
             AND ${dateBoundsSql("w.created_at")}
           GROUP BY 1
         ), revenue_daily AS (
           SELECT (p.received_at AT TIME ZONE 'Africa/Abidjan')::date AS report_date,
                  COALESCE(SUM(p.amount_cents), 0)::text AS revenue_cents
           FROM payments p
           WHERE p.organization_id = $1 AND p.status = 'verified'
             AND ${dateBoundsSql("p.received_at")}
           GROUP BY 1
         ), expenses_daily AS (
           SELECT (e.expense_date AT TIME ZONE 'Africa/Abidjan')::date AS report_date,
                  COALESCE(SUM(e.amount_cents), 0)::text AS expenses_cents
           FROM expenses e
           WHERE e.organization_id = $1 AND e.status = 'recorded'
             AND ${dateBoundsSql("e.expense_date")}
           GROUP BY 1
         )
         SELECT d.report_date::text AS date,
                COALESCE(w.wash_count, '0') AS wash_count,
                COALESCE(r.revenue_cents, '0') AS revenue_cents,
                COALESCE(e.expenses_cents, '0') AS expenses_cents
         FROM days d
         LEFT JOIN wash_daily w ON w.report_date = d.report_date
         LEFT JOIN revenue_daily r ON r.report_date = d.report_date
         LEFT JOIN expenses_daily e ON e.report_date = d.report_date
         ORDER BY d.report_date`,
        [current.organizationId, from, to],
      )

      const servicesResult = await client.query<ServiceReportRow>(
        `SELECT wi.service_name_snapshot AS name,
                COUNT(DISTINCT w.id)::text AS wash_count,
                COALESCE(SUM(wi.quantity), 0)::text AS quantity,
                COALESCE(SUM(wi.price_cents_snapshot::numeric * wi.quantity), 0)::text AS amount_cents
         FROM washes w
         JOIN wash_items wi ON wi.wash_id = w.id
         WHERE w.organization_id = $1 AND w.status <> 'cancelled'
           AND ${dateBoundsSql("w.created_at")}
         GROUP BY wi.service_name_snapshot
         ORDER BY SUM(wi.price_cents_snapshot::numeric * wi.quantity) DESC, wi.service_name_snapshot
         LIMIT 10`,
        [current.organizationId, from, to],
      )

      const paymentsResult = await client.query<PaymentReportRow>(
        `SELECT p.method,
                COUNT(*)::text AS payment_count,
                COALESCE(SUM(p.amount_cents), 0)::text AS amount_cents
         FROM payments p
         WHERE p.organization_id = $1 AND p.status = 'verified'
           AND ${dateBoundsSql("p.received_at")}
         GROUP BY p.method
         ORDER BY SUM(p.amount_cents) DESC, p.method`,
        [current.organizationId, from, to],
      )

      const expensesResult = await client.query<ExpenseReportRow>(
        `SELECT e.category,
                COUNT(*)::text AS expense_count,
                COALESCE(SUM(e.amount_cents), 0)::text AS amount_cents
         FROM expenses e
         WHERE e.organization_id = $1 AND e.status = 'recorded'
           AND ${dateBoundsSql("e.expense_date")}
         GROUP BY e.category
         ORDER BY SUM(e.amount_cents) DESC, e.category`,
        [current.organizationId, from, to],
      )

      await client.query("COMMIT")
      const summary = summaryResult.rows[0]
      const revenueCents = safeCount(summary?.revenue_cents)
      const expensesCents = safeCount(summary?.expenses_cents)
      res.json({
        period: { from, to },
        summary: {
          total_washes: safeCount(summary?.total_washes),
          completed_washes: safeCount(summary?.completed_washes),
          revenue_cents: revenueCents,
          expenses_cents: expensesCents,
          net_cents: revenueCents - expensesCents,
          paid_washes: safeCount(summary?.paid_washes),
        },
        daily: dailyResult.rows.map((row) => ({
          date: row.date,
          wash_count: safeCount(row.wash_count),
          revenue_cents: safeCount(row.revenue_cents),
          expenses_cents: safeCount(row.expenses_cents),
        })),
        top_services: servicesResult.rows.map((row) => ({
          name: row.name,
          wash_count: safeCount(row.wash_count),
          quantity: safeCount(row.quantity),
          amount_cents: safeCount(row.amount_cents),
        })),
        payment_methods: paymentsResult.rows.map((row) => ({
          method: row.method,
          payment_count: safeCount(row.payment_count),
          amount_cents: safeCount(row.amount_cents),
        })),
        expense_categories: expensesResult.rows.map((row) => ({
          category: row.category,
          expense_count: safeCount(row.expense_count),
          amount_cents: safeCount(row.amount_cents),
        })),
      })
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  })

  return router
}
