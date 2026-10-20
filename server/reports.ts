import { Router } from "express"
import { z } from "zod"
import type { Pool } from "pg"
import { getPool } from "./db.ts"
import { asyncRoute, tenant } from "./http.ts"
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
    asyncRoute(async (req, res) => {
      const t = tenant(req)

      const [
        totalWashes,
        completedWashes,
        inProgressWashes,
        cancelledWashes,
        totalRevenue,
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
        db().query(
          "SELECT COALESCE(SUM(amount_cents),0)::int AS sum FROM payments WHERE organization_id=$1::uuid AND status = 'verified'",
          [t.organizationId],
        ),
        db().query(
          `SELECT TO_CHAR(created_at, 'Mon YYYY') AS month, SUM(amount_cents)::int AS revenue
           FROM payments
           WHERE organization_id=$1::uuid AND status = 'verified'
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

      res.json({
        total_washes: totalWashes.rows[0].count,
        completed_washes: completedWashes.rows[0].count,
        in_progress_washes: inProgressWashes.rows[0].count,
        cancelled_washes: cancelledWashes.rows[0].count,
        total_revenue_cents: totalRevenue.rows[0].sum,
        monthly_revenue: monthlyRevenue.rows,
        recent_washes: recentWashes.rows,
      })
    }),
  )

  // GET /api/v1/reports/summary?from=&to= — full activity report.
  r.get(
    "/reports/summary",
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const today = new Date().toISOString().slice(0, 10)
      const requested = parseReportRange({ from: req.query.from || today, to: req.query.to || today })
      // Essai terminé : l'historique consultable est ramené à 7 jours. On
      // tronque la période au lieu de refuser la requête, pour que l'écran
      // reste utilisable et que la limite soit visible plutôt que bloquante.
      const windowDays = req.subscription?.report_window_days ?? null
      const { clamped, ...range } = clampReportRange(requested, windowDays)
      const pool = db()
      const args = [t.organizationId, range.from, range.to]

      const [summaryQ, expensesQ, dailyQ, servicesQ, paymentsQ, expenseCategoriesQ] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::int AS total_washes,
             COUNT(*) FILTER (WHERE status='completed')::int AS completed_washes,
             COUNT(*) FILTER (WHERE payment_status='paid')::int AS paid_washes,
             (SELECT COALESCE(SUM(p.amount_cents),0)::int FROM payments p
               WHERE p.organization_id=$1::uuid AND p.status <> 'refunded'
                 AND p.created_at >= $2::date AND p.created_at < ($3::date + interval '1 day')) AS revenue_cents
           FROM washes
           WHERE organization_id=$1::uuid AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')`,
          args,
        ),
        pool.query(
          `SELECT COALESCE(SUM(amount_cents),0)::int AS expenses_cents FROM expenses
           WHERE organization_id=$1::uuid AND status='completed' AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')`,
          args,
        ),
        pool.query(
          `SELECT d.day::date::text AS date,
             COALESCE(w.wash_count,0)::int AS wash_count,
             COALESCE(p.revenue_cents,0)::int AS revenue_cents,
             COALESCE(e.expenses_cents,0)::int AS expenses_cents
           FROM generate_series($2::date, $3::date, interval '1 day') AS d(day)
           LEFT JOIN (
             SELECT created_at::date AS day, COUNT(*)::int AS wash_count FROM washes
             WHERE organization_id=$1::uuid AND status <> 'cancelled' GROUP BY 1
           ) w ON w.day = d.day::date
           LEFT JOIN (
             SELECT created_at::date AS day, SUM(amount_cents)::int AS revenue_cents FROM payments
             WHERE organization_id=$1::uuid AND status <> 'refunded' GROUP BY 1
           ) p ON p.day = d.day::date
           LEFT JOIN (
             SELECT created_at::date AS day, SUM(amount_cents)::int AS expenses_cents FROM expenses
             WHERE organization_id=$1::uuid AND status='completed' GROUP BY 1
           ) e ON e.day = d.day::date
           ORDER BY d.day`,
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
        pool.query(
          `SELECT method, COUNT(*)::int AS payment_count, SUM(amount_cents)::int AS amount_cents
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
      ])

      const summary = summaryQ.rows[0]
      const expensesCents = expensesQ.rows[0].expenses_cents

      res.json({
        period: { from: range.from, to: range.to },
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
          revenue_cents: summary.revenue_cents,
          expenses_cents: expensesCents,
          net_cents: summary.revenue_cents - expensesCents,
        },
        daily: dailyQ.rows,
        top_services: servicesQ.rows,
        payment_methods: paymentsQ.rows,
        expense_categories: expenseCategoriesQ.rows,
      })
    }),
  )

  return r
}
