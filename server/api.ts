import { Router } from "express"
import type { Pool, PoolClient } from "pg"
import { z } from "zod"
import { getPool } from "./db.ts"
import { HttpError } from "./auth.ts"
import type { TenantContext } from "./types.ts"
import { requireManager } from "./permissions.ts"

const serviceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  price_cents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  category_id: z.string().uuid().nullable().optional(),
  duration_minutes: z.number().int().min(1).max(1440).nullable().optional(),
  is_active: z.boolean().optional().default(true),
})

const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  is_active: z.boolean().optional().default(true),
})

export const catalogValidators = {
  service: serviceSchema,
  category: categorySchema,
}

function tenant(req: { tenant?: TenantContext }) {
  if (!req.tenant) throw new HttpError(401, "tenant_required", "Aucune organisation active.")
  if (!req.tenant.onboardingCompleted) {
    throw new HttpError(403, "onboarding_required", "Terminez l'onboarding avant d'accéder aux données de la station.")
  }
  return req.tenant
}

function db() {
  const pool = getPool()
  if (!pool) throw new HttpError(503, "database_not_configured", "La base de données Neon n'est pas configurée.")
  return pool
}

function invalid(error: z.ZodError) {
  return new HttpError(400, "validation_error", error.issues[0]?.message || "Les données ne sont pas valides.")
}

function safeInteger(value: string | number | null | undefined) {
  const number = Number(value ?? 0)
  if (!Number.isSafeInteger(number)) {
    throw new HttpError(500, "invalid_numeric_value", "Une valeur numérique dépasse la limite de calcul autorisée.")
  }
  return number
}

async function assertServiceLimit(organizationId: string, queryable: Pool | PoolClient = db()) {
  const { rows } = await queryable.query<{ max_services: number | null; active_count: string }>(
    `SELECT p.max_services, COUNT(s.id)::text AS active_count
     FROM organizations o
     JOIN plans p ON p.code = o.plan
     LEFT JOIN services s ON s.organization_id = o.id AND s.is_active = true
     WHERE o.id = $1
     GROUP BY p.max_services`,
    [organizationId]
  )
  const plan = rows[0]
  if (!plan) throw new HttpError(409, "subscription_required", "Aucun forfait actif n'est associé à cette organisation.")
  if (plan.max_services !== null && safeInteger(plan.active_count) >= plan.max_services) {
    throw new HttpError(403, "plan_service_limit", `Votre forfait autorise au maximum ${plan.max_services} prestations actives.`)
  }
}

export function createApiRouter() {
  const router = Router()

  router.get("/plans", async (_req, res) => {
    const { rows } = await db().query(
      `SELECT id, code, name, description, price_cents, billing_cycle,
              max_workers, max_services, max_sites, max_users, features, sort_order
       FROM plans WHERE is_active = true ORDER BY sort_order, name`
    )
    res.json(rows.map((plan) => ({ ...plan, price_cents: safeInteger(plan.price_cents) })))
  })

  router.get("/service-catalog", async (_req, res) => {
    const { rows } = await db().query(
      `SELECT id, category, name, price_cents, sort_order
       FROM service_catalog_templates ORDER BY sort_order, name`
    )
    res.json(rows.map((item) => ({ ...item, price_cents: item.price_cents === null ? null : safeInteger(item.price_cents) })))
  })

  router.get("/sites", async (req, res) => {
    const { organizationId } = tenant(req)
    const { rows } = await db().query(
      `SELECT id, organization_id, name, address, city, commune, phone,
              is_active, created_at, updated_at
       FROM sites WHERE organization_id = $1 AND is_active = true ORDER BY name`,
      [organizationId]
    )
    res.json(rows)
  })

  router.get("/service-categories", async (req, res) => {
    const { organizationId } = tenant(req)
    const { rows } = await db().query(
      `SELECT id, organization_id, name, is_active, created_at, updated_at
       FROM service_categories WHERE organization_id = $1 ORDER BY name`,
      [organizationId]
    )
    res.json(rows)
  })

  router.post("/service-categories", async (req, res) => {
    const currentTenant = tenant(req)
    requireManager(currentTenant)
    const { organizationId } = currentTenant
    const parsed = categorySchema.safeParse(req.body)
    if (!parsed.success) throw invalid(parsed.error)
    const { rows } = await db().query(
      `INSERT INTO service_categories (organization_id, name, is_active)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, name) DO UPDATE SET is_active = EXCLUDED.is_active, updated_at = NOW()
       RETURNING id, organization_id, name, is_active, created_at, updated_at`,
      [organizationId, parsed.data.name, parsed.data.is_active]
    )
    res.status(201).json(rows[0])
  })

  router.patch("/service-categories/:id", async (req, res) => {
    const currentTenant = tenant(req)
    requireManager(currentTenant)
    const { organizationId } = currentTenant
    const parsed = categorySchema.partial().safeParse(req.body)
    if (!parsed.success) throw invalid(parsed.error)
    const values = parsed.data
    const { rows } = await db().query(
      `UPDATE service_categories SET
         name = COALESCE($3, name),
         is_active = COALESCE($4, is_active),
         updated_at = NOW()
       WHERE organization_id = $1 AND id = $2
       RETURNING id, organization_id, name, is_active, created_at, updated_at`,
      [organizationId, req.params.id, values.name ?? null, values.is_active ?? null]
    )
    if (!rows[0]) throw new HttpError(404, "category_not_found", "Catégorie introuvable.")
    res.json(rows[0])
  })

  router.post("/service-categories/:id/deactivate", async (req, res) => {
    const currentTenant = tenant(req)
    requireManager(currentTenant)
    const { organizationId } = currentTenant
    const result = await db().query(
      `UPDATE service_categories SET is_active = false, updated_at = NOW()
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, req.params.id]
    )
    if (!result.rowCount) throw new HttpError(404, "category_not_found", "Catégorie introuvable.")
    res.status(204).end()
  })

  router.get("/vehicle-categories", async (req, res) => {
    const { organizationId } = tenant(req)
    const { rows } = await db().query(
      `SELECT id, organization_id, name, is_active, created_at, updated_at
       FROM vehicle_categories WHERE organization_id = $1 ORDER BY name`,
      [organizationId]
    )
    res.json(rows)
  })

  router.post("/vehicle-categories", async (req, res) => {
    const currentTenant = tenant(req)
    requireManager(currentTenant)
    const { organizationId } = currentTenant
    const parsed = categorySchema.safeParse(req.body)
    if (!parsed.success) throw invalid(parsed.error)
    const { rows } = await db().query(
      `INSERT INTO vehicle_categories (organization_id, name, is_active)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, name) DO UPDATE SET is_active = EXCLUDED.is_active, updated_at = NOW()
       RETURNING id, organization_id, name, is_active, created_at, updated_at`,
      [organizationId, parsed.data.name, parsed.data.is_active]
    )
    res.status(201).json(rows[0])
  })

  router.patch("/vehicle-categories/:id", async (req, res) => {
    const currentTenant = tenant(req)
    requireManager(currentTenant)
    const { organizationId } = currentTenant
    const parsed = categorySchema.partial().safeParse(req.body)
    if (!parsed.success) throw invalid(parsed.error)
    const { rows } = await db().query(
      `UPDATE vehicle_categories SET
         name = COALESCE($3, name),
         is_active = COALESCE($4, is_active),
         updated_at = NOW()
       WHERE organization_id = $1 AND id = $2
       RETURNING id, organization_id, name, is_active, created_at, updated_at`,
      [organizationId, req.params.id, parsed.data.name ?? null, parsed.data.is_active ?? null]
    )
    if (!rows[0]) throw new HttpError(404, "category_not_found", "Catégorie introuvable.")
    res.json(rows[0])
  })

  router.post("/vehicle-categories/:id/deactivate", async (req, res) => {
    const currentTenant = tenant(req)
    requireManager(currentTenant)
    const { organizationId } = currentTenant
    const result = await db().query(
      `UPDATE vehicle_categories SET is_active = false, updated_at = NOW()
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, req.params.id]
    )
    if (!result.rowCount) throw new HttpError(404, "category_not_found", "Catégorie introuvable.")
    res.status(204).end()
  })

  router.get("/services", async (req, res) => {
    const { organizationId } = tenant(req)
    const { rows } = await db().query(
      `SELECT id, organization_id, category_id, name, price_cents,
              duration_minutes, is_active, created_at, updated_at
       FROM services WHERE organization_id = $1 ORDER BY name`,
      [organizationId]
    )
    res.json(rows.map((item) => ({ ...item, price_cents: safeInteger(item.price_cents) })))
  })

  router.post("/services", async (req, res) => {
    const currentTenant = tenant(req)
    requireManager(currentTenant)
    const { organizationId } = currentTenant
    const parsed = serviceSchema.safeParse(req.body)
    if (!parsed.success) throw invalid(parsed.error)
    const input = parsed.data
    const client = await db().connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`service-limit:${organizationId}`])
      if (input.category_id) {
        const category = await client.query(
          `SELECT 1 FROM service_categories WHERE organization_id = $1 AND id = $2`,
          [organizationId, input.category_id]
        )
        if (!category.rowCount) throw new HttpError(400, "invalid_category", "La catégorie sélectionnée n'appartient pas à cette organisation.")
      }
      const existing = await client.query(
        `SELECT 1 FROM services WHERE organization_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
        [organizationId, input.name]
      )
      if (existing.rowCount) {
        throw new HttpError(409, "duplicate_service", "Une prestation existe déjà sous ce nom. Modifiez-la ou réactivez-la depuis le catalogue.")
      }
      if (input.is_active) await assertServiceLimit(organizationId, client)
      const { rows } = await client.query(
        `INSERT INTO services (organization_id, category_id, name, price_cents, duration_minutes, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, organization_id, category_id, name, price_cents,
                   duration_minutes, is_active, created_at, updated_at`,
        [organizationId, input.category_id ?? null, input.name, input.price_cents, input.duration_minutes ?? null, input.is_active]
      )
      await client.query("COMMIT")
      res.status(201).json({ ...rows[0], price_cents: safeInteger(rows[0].price_cents) })
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  })

  router.patch("/services/:id", async (req, res) => {
    const currentTenant = tenant(req)
    requireManager(currentTenant)
    const { organizationId } = currentTenant
    const parsed = serviceSchema.partial().safeParse(req.body)
    if (!parsed.success) throw invalid(parsed.error)
    const input = parsed.data
    const client = await db().connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`service-limit:${organizationId}`])
      const current = await client.query<{ is_active: boolean }>(
        `SELECT is_active FROM services WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [organizationId, req.params.id]
      )
      if (!current.rows[0]) throw new HttpError(404, "service_not_found", "Prestation introuvable.")
      if (input.is_active === true && !current.rows[0].is_active) await assertServiceLimit(organizationId, client)
      if (input.name) {
        const duplicate = await client.query(
          `SELECT 1 FROM services
           WHERE organization_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3
           LIMIT 1`,
          [organizationId, input.name, req.params.id]
        )
        if (duplicate.rowCount) throw new HttpError(409, "duplicate_service", "Une prestation existe déjà sous un nom identique.")
      }
      if (input.category_id) {
        const category = await client.query(
          `SELECT 1 FROM service_categories WHERE organization_id = $1 AND id = $2`,
          [organizationId, input.category_id]
        )
        if (!category.rowCount) throw new HttpError(400, "invalid_category", "La catégorie sélectionnée n'appartient pas à cette organisation.")
      }
      const { rows } = await client.query(
        `UPDATE services SET
           name = COALESCE($3, name),
           price_cents = COALESCE($4, price_cents),
           category_id = CASE WHEN $5::boolean THEN $6::uuid ELSE category_id END,
           duration_minutes = CASE WHEN $7::boolean THEN $8::integer ELSE duration_minutes END,
           is_active = COALESCE($9, is_active),
           updated_at = NOW()
         WHERE organization_id = $1 AND id = $2
         RETURNING id, organization_id, category_id, name, price_cents, duration_minutes, is_active, created_at, updated_at`,
        [
          organizationId,
          req.params.id,
          input.name ?? null,
          input.price_cents ?? null,
          Object.prototype.hasOwnProperty.call(input, "category_id"),
          input.category_id ?? null,
          Object.prototype.hasOwnProperty.call(input, "duration_minutes"),
          input.duration_minutes ?? null,
          input.is_active ?? null,
        ]
      )
      await client.query("COMMIT")
      res.json({ ...rows[0], price_cents: safeInteger(rows[0].price_cents) })
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  })

  router.post("/services/:id/deactivate", async (req, res) => {
    const currentTenant = tenant(req)
    requireManager(currentTenant)
    const { organizationId } = currentTenant
    const result = await db().query(
      `UPDATE services SET is_active = false, updated_at = NOW()
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, req.params.id]
    )
    if (!result.rowCount) throw new HttpError(404, "service_not_found", "Prestation introuvable.")
    res.status(204).end()
  })

  router.get("/workers", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store")
    const { organizationId } = tenant(req)
    const { rows } = await db().query(
      `SELECT id, organization_id, first_name, last_name, phone, district,
              role, status, custom_role, joined_at::text AS joined_at, created_at, updated_at
       FROM workers WHERE organization_id = $1
       ORDER BY (status = 'active') DESC, first_name, last_name`,
      [organizationId]
    )
    res.json(rows)
  })

  router.get("/users", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store")
    const { organizationId } = tenant(req)
    const { rows } = await db().query(
      `SELECT u.id, u.clerk_user_id, u.first_name, u.last_name, u.email,
              m.role, u.status, u.created_at, u.updated_at
       FROM organization_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = $1 AND u.status = 'active'
       ORDER BY u.first_name NULLS LAST, u.last_name NULLS LAST, u.email`,
      [organizationId]
    )
    res.json(rows)
  })

  router.get("/dashboard/metrics", async (req, res) => {
    const { organizationId } = tenant(req)
    const { rows } = await db().query<{
      total_washes: string
      total_revenue_cents: string
      washes_today: string
      revenue_today_cents: string
      active_washers: string
      total_expenses_cents: string
    }>(
      `SELECT
         (SELECT COUNT(*) FROM washes WHERE organization_id = $1 AND status <> 'cancelled')::text AS total_washes,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE organization_id = $1 AND status = 'verified')::text AS total_revenue_cents,
         (SELECT COUNT(*) FROM washes WHERE organization_id = $1 AND status <> 'cancelled' AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'Africa/Abidjan') AT TIME ZONE 'Africa/Abidjan')::text AS washes_today,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE organization_id = $1 AND status = 'verified' AND received_at >= date_trunc('day', NOW() AT TIME ZONE 'Africa/Abidjan') AT TIME ZONE 'Africa/Abidjan')::text AS revenue_today_cents,
         (SELECT COUNT(*) FROM workers WHERE organization_id = $1 AND status = 'active')::text AS active_washers,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM expenses WHERE organization_id = $1 AND status = 'recorded')::text AS total_expenses_cents`,
      [organizationId]
    )
    const row = rows[0]
    res.json(Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [key, safeInteger(value as string | number | null)])))
  })

  return router
}
