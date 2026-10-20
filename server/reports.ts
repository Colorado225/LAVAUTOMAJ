import { Router } from "express"
import { z } from "zod"
import type { Pool } from "pg"
import { getPool } from "./db.ts"
import { asyncRoute, tenant, requirePermission } from "./http.ts"
import { HttpError } from "./auth.ts"
import { clampReportRange, EXPIRED_REPORT_WINDOW_DAYS } from "./entitlements.ts"

/** Validate ?from/?to (ISO dates, chronological, at most ~1 year). */
export function parseReportRange(query: { from?: unknown; to?: unknown }) {
  const schema = z
    .object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .refine(
      (v) =>
        !Number.isNaN(Date.parse(v.from)) &&
        !Number.isNaN(Date.parse(v.to)) &&
        new Date(v.from).toISOString().slice(0, 10) === v.from &&
        new Date(v.to).toISOString().slice(0, 10) === v.to &&
        v.from <= v.to,
      { message: "invalid range" },
    )
    .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86400000 <= 366, { message: "range too long" })
  const result = schema.safeParse(query)
  if (!result.success) throw new HttpError(400, "invalid_report_range", "Période de rapport invalide ou trop longue.")
  return result.data
}

/**
 * Granularité des rapports : jour, semaine (lundi → dimanche) ou mois.
 *
 * Les valeurs sont contrôlées ici puis injectées telles quelles dans le SQL :
 * elles ne peuvent provenir que de cette liste blanche.
 */
export const REPORT_GRANULARITIES = ["day", "week", "month"] as const
export type ReportGranularity = (typeof REPORT_GRANULARITIES)[number]

export function parseGranularity(value: unknown): ReportGranularity {
  if (value == null || value === "") return "day"
  const parsed = z.enum(REPORT_GRANULARITIES).safeParse(value)
  if (!parsed.success) {
    throw new HttpError(400, "invalid_granularity", "Granularité invalide : utilisez day, week ou month.")
  }
  return parsed.data
}

/** Pas de la série temporelle pour `generate_series`. */
export function granularityStep(granularity: ReportGranularity): string {
  return { day: "1 day", week: "1 week", month: "1 month" }[granularity]
}

/** Libellé lisible, utilisé dans les messages et les exports. */
export function granularityLabel(granularity: ReportGranularity): string {
  return { day: "Jour", week: "Semaine", month: "Mois" }[granularity]
}

function db(): Pool {
  const pool = getPool()
  if (!pool) throw new HttpError(503, "database_not_configured", "Base de données indisponible.")
  return pool
}

export function createReportsRouter() {
  const r = Router()

  // GET /api/v1/dashboard/metrics — headline numbers for the dashboard.
  r.get(
    "/dashboard/metrics",
    requirePermission("dashboard:read"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)

      const [
        totalWashes,
        completedWashes,
        inProgressWashes,
        cancelledWashes,
        revenue,
        monthlyRevenue,
        recentWashes,
      ] = await Promise.all([
        db().query(
          "SELECT COUNT(*)::int AS count FROM washes WHERE organization_id=$1::uuid",
          [t.organizationId],
        ),
        db().query(
          "SELECT COUNT(*)::int AS count FROM washes WHERE organization_id=$1::uuid AND status = 'completed'",
          [t.organizationId],
        ),
        db().query(
          "SELECT COUNT(*)::int AS count FROM washes WHERE organization_id=$1::uuid AND status = 'in_progress'",
          [t.organizationId],
        ),
        db().query(
          "SELECT COUNT(*)::int AS count FROM washes WHERE organization_id=$1::uuid AND status = 'cancelled'",
          [t.organizationId],
        ),
        // Même règle que les rapports : tout encaissement non remboursé compte,
        // avec le détail de ce qui reste à confirmer (mobile money).
        db().query(
          `SELECT COALESCE(SUM(amount_cents),0)::int AS total_cents,
             COALESCE(SUM(amount_cents) FILTER (WHERE status='verified'),0)::int AS verified_cents,
             COALESCE(SUM(amount_cents) FILTER (WHERE status='pending'),0)::int AS pending_cents,
             COUNT(*) FILTER (WHERE status='pending')::int AS pending_count
           FROM payments WHERE organization_id=$1::uuid AND status <> 'refunded'`,
          [t.organizationId],
        ),
        db().query(
          `SELECT TO_CHAR(created_at, 'Mon YYYY') AS month, SUM(amount_cents)::int AS revenue
           FROM payments
           WHERE organization_id=$1::uuid AND status <> 'refunded'
           GROUP BY TO_CHAR(created_at, 'Mon YYYY')
           ORDER BY MIN(created_at)`,
          [t.organizationId],
        ),
        db().query(
          `SELECT w.id, w.reference AS vehicle_plate,
                  COALESCE((SELECT wi.service_name FROM wash_items wi WHERE wi.wash_id = w.id LIMIT 1), 'Service') AS service,
                  w.total_cents AS amount_cents, w.status, w.created_at
           FROM washes w
           WHERE w.organization_id=$1::uuid
           ORDER BY w.created_at DESC
           LIMIT 5`,
          [t.organizationId],
        ),
      ])

      const financial = t.can("report:financial")

      res.json({
        financial_access: financial,
        total_washes: totalWashes.rows[0].count,
        completed_washes: completedWashes.rows[0].count,
        in_progress_washes: inProgressWashes.rows[0].count,
        cancelled_washes: cancelledWashes.rows[0].count,
        total_revenue_cents: revenue.rows[0].total_cents,
        verified_revenue_cents: revenue.rows[0].verified_cents,
        pending_payments_cents: revenue.rows[0].pending_cents,
        pending_payments_count: revenue.rows[0].pending_count,
        monthly_revenue: monthlyRevenue.rows,
        recent_washes: recentWashes.rows,
      })
    }),
  )

  // GET /api/v1/reports/summary?from=&to=&granularity=day|week|month
  r.get(
    "/reports/summary",
    requirePermission("report:operational"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const today = new Date().toISOString().slice(0, 10)
      const requested = parseReportRange({ from: req.query.from || today, to: req.query.to || today })
      const granularity = parseGranularity(req.query.granularity)
      // Essai terminé : l'historique consultable est ramené à 7 jours. On
      // tronque la période au lieu de refuser la requête, pour que l'écran
      // reste utilisable et que la limite soit visible plutôt que bloquante.
      const windowDays = req.subscription?.report_window_days ?? null
      const { clamped, ...range } = clampReportRange(requested, windowDays)
      const pool = db()
      const args = [t.organizationId, range.from, range.to]
      const step = granularityStep(granularity)

      const [summaryQ, expensesQ, seriesQ, servicesQ, paymentsQ, expenseCategoriesQ, workersQ] =
        await Promise.all([
          pool.query(
            `SELECT COUNT(*)::int AS total_washes,
               COUNT(*) FILTER (WHERE status='completed')::int AS completed_washes,
               COUNT(*) FILTER (WHERE payment_status='paid')::int AS paid_washes,
               COUNT(*) FILTER (WHERE payment_status IN ('unpaid','partial') AND status <> 'cancelled')::int AS unpaid_washes,
               (SELECT COALESCE(SUM(p.amount_cents),0)::int FROM payments p
                 WHERE p.organization_id=$1::uuid AND p.status <> 'refunded'
                   AND p.created_at >= $2::date AND p.created_at < ($3::date + interval '1 day')) AS revenue_cents,
               (SELECT COALESCE(SUM(p.amount_cents),0)::int FROM payments p
                 WHERE p.organization_id=$1::uuid AND p.status = 'pending'
                   AND p.created_at >= $2::date AND p.created_at < ($3::date + interval '1 day')) AS pending_cents
             FROM washes
             WHERE organization_id=$1::uuid AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')`,
            args,
          ),
          pool.query(
            `SELECT COALESCE(SUM(amount_cents),0)::int AS expenses_cents FROM expenses
             WHERE organization_id=$1::uuid AND status='completed' AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')`,
            args,
          ),
          // Série temporelle : un point par jour, par semaine ou par mois.
          pool.query(
            `SELECT d.bucket::date::text AS date,
               (d.bucket + interval '${step}' - interval '1 day')::date::text AS period_end,
               COALESCE(w.wash_count,0)::int AS wash_count,
               COALESCE(p.revenue_cents,0)::int AS revenue_cents,
               COALESCE(e.expenses_cents,0)::int AS expenses_cents
             FROM generate_series(
                    date_trunc('${granularity}', $2::timestamp),
                    $3::timestamp,
                    interval '${step}') AS d(bucket)
             LEFT JOIN (
               SELECT date_trunc('${granularity}', created_at) AS bucket, COUNT(*)::int AS wash_count FROM washes
               WHERE organization_id=$1::uuid AND status <> 'cancelled' GROUP BY 1
             ) w ON w.bucket = d.bucket
             LEFT JOIN (
               SELECT date_trunc('${granularity}', created_at) AS bucket, SUM(amount_cents)::int AS revenue_cents FROM payments
               WHERE organization_id=$1::uuid AND status <> 'refunded' GROUP BY 1
             ) p ON p.bucket = d.bucket
             LEFT JOIN (
               SELECT date_trunc('${granularity}', created_at) AS bucket, SUM(amount_cents)::int AS expenses_cents FROM expenses
               WHERE organization_id=$1::uuid AND status='completed' GROUP BY 1
             ) e ON e.bucket = d.bucket
             ORDER BY d.bucket`,
            args,
          ),
          pool.query(
            `SELECT i.service_name AS name,
               COUNT(DISTINCT i.wash_id)::int AS wash_count,
               SUM(i.quantity)::int AS quantity,
               SUM(i.line_total_cents)::int AS amount_cents
             FROM wash_items i JOIN washes w ON w.id = i.wash_id
             WHERE w.organization_id=$1::uuid AND w.status <> 'cancelled'
               AND w.created_at >= $2::date AND w.created_at < ($3::date + interval '1 day')
             GROUP BY i.service_name ORDER BY amount_cents DESC LIMIT 10`,
            args,
          ),
          // Suivi par canal, avec la part encore à confirmer.
          pool.query(
            `SELECT method, COUNT(*)::int AS payment_count,
               SUM(amount_cents)::int AS amount_cents,
               COALESCE(SUM(amount_cents) FILTER (WHERE status='verified'),0)::int AS verified_cents,
               COALESCE(SUM(amount_cents) FILTER (WHERE status='pending'),0)::int AS pending_cents
             FROM payments
             WHERE organization_id=$1::uuid AND status <> 'refunded'
               AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')
             GROUP BY method ORDER BY amount_cents DESC`,
            args,
          ),
          pool.query(
            `SELECT category, COUNT(*)::int AS expense_count, SUM(amount_cents)::int AS amount_cents
             FROM expenses
             WHERE organization_id=$1::uuid AND status='completed'
               AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')
             GROUP BY category ORDER BY amount_cents DESC`,
            args,
          ),
          // Activité par laveur : nombre de lavages et chiffre d'affaires
          // associé. Un lavage à plusieurs laveurs est réparti à parts égales.
          pool.query(
            `SELECT wk.id AS worker_id,
               (wk.first_name || ' ' || wk.last_name) AS name,
               wk.role,
               COUNT(DISTINCT w.id)::int AS wash_count,
               COALESCE(SUM(w.total_cents::numeric / NULLIF(a.team_size,0)),0)::int AS amount_cents
             FROM wash_assignments wa
             JOIN washes w ON w.id = wa.wash_id
             JOIN workers wk ON wk.id = wa.worker_id
             JOIN (SELECT wash_id, COUNT(*)::int AS team_size FROM wash_assignments GROUP BY wash_id) a
               ON a.wash_id = wa.wash_id
             WHERE w.organization_id=$1::uuid AND w.status <> 'cancelled'
               AND w.created_at >= $2::date AND w.created_at < ($3::date + interval '1 day')
             GROUP BY wk.id, wk.first_name, wk.last_name, wk.role
             ORDER BY amount_cents DESC LIMIT 20`,
            args,
          ),
        ])

      const summary = summaryQ.rows[0]
      const expensesCents = expensesQ.rows[0].expenses_cents
      // Le détail financier (dépenses, marge nette, postes de dépense) est
      // réservé aux rôles qui en ont le droit : un gérant voit son activité,
      // pas la rentabilité de la station.
      const financial = t.can("report:financial")

      res.json({
        period: { from: range.from, to: range.to, granularity },
        granularity,
        financial_access: financial,
        // Informe l'interface que la période affichée a été réduite.
        restriction: clamped
          ? {
              reason: "trial_expired",
              requested_from: requested.from,
              window_days: windowDays ?? EXPIRED_REPORT_WINDOW_DAYS,
              message: `Essai terminé : l’historique est limité aux ${windowDays ?? EXPIRED_REPORT_WINDOW_DAYS} derniers jours.`,
            }
          : null,
        summary: {
          total_washes: summary.total_washes,
          completed_washes: summary.completed_washes,
          paid_washes: summary.paid_washes,
          unpaid_washes: summary.unpaid_washes,
          revenue_cents: summary.revenue_cents,
          pending_cents: summary.pending_cents,
          expenses_cents: financial ? expensesCents : null,
          net_cents: financial ? summary.revenue_cents - expensesCents : null,
        },
        series: financial
          ? seriesQ.rows
          : seriesQ.rows.map((row) => ({ ...row, expenses_cents: null })),
        top_services: servicesQ.rows,
        top_workers: workersQ.rows,
        payment_methods: paymentsQ.rows,
        expense_categories: financial ? expenseCategoriesQ.rows : [],
      })
    }),
  )

  return r
}
