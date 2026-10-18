import { Router } from "express"
import { z } from "zod"
import { getPool } from "./db.ts"
import { HttpError } from "./auth.ts"
import type { TenantContext } from "./types.ts"

const stages = ["station", "services", "workers", "plan", "review"] as const
const stageIndex = (stage: string) => stages.indexOf(stage as (typeof stages)[number])
const phoneSchema = z.string().trim().max(50).refine(
  (value) => value === "" || /^[+\d][\d\s().-]{6,32}$/.test(value),
  "Numéro de téléphone invalide."
)
const dateOnlySchema = z.string().trim().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}, "Date invalide.")

const stationSchema = z.object({
  name: z.string().trim().min(2, "Le nom de la station doit contenir au moins 2 caractères.").max(255),
  phone: phoneSchema.optional().default(""),
  email: z.union([z.string().trim().email().max(255), z.literal("")]).optional().default(""),
  address: z.string().trim().max(255).optional().default(""),
  city: z.string().trim().min(1, "La ville ou commune est obligatoire.").max(120),
  description: z.string().trim().max(2000).optional().default(""),
  logo_url: z.string().trim().max(2048).optional().default(""),
})
const stationDraftSchema = z.object({
  name: z.string().trim().max(255).optional().default(""),
  phone: z.string().trim().max(50).optional().default(""),
  email: z.string().trim().max(255).optional().default(""),
  address: z.string().trim().max(255).optional().default(""),
  city: z.string().trim().max(120).optional().default(""),
  description: z.string().trim().max(2000).optional().default(""),
  logo_url: z.string().trim().max(2048).optional().default(""),
})

const selectedServiceSchema = z.object({
  template_id: z.string().uuid(),
  name: z.string().trim().min(1).max(160).optional(),
  price_cents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
})

const customServiceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  category: z.string().trim().min(2).max(60).optional().default("autre"),
  price_cents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional().default(null),
})

const servicesSchema = z.object({
  selected: z.array(selectedServiceSchema).max(100).default([]),
  custom: z.array(customServiceSchema).max(100).default([]),
}).refine((value) => value.selected.length + value.custom.length > 0, {
  message: "Sélectionnez ou ajoutez au moins une prestation.",
})

const workerSchema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  phone: phoneSchema.optional().default(""),
  district: z.string().trim().max(255).optional().default(""),
  role: z.enum(["car_washer", "moto_washer", "versatile_washer", "team_lead", "custom"]),
  custom_role: z.string().trim().max(100).optional().default(""),
  joined_at: dateOnlySchema.optional().or(z.literal("")), 
}).refine((worker) => worker.role !== "custom" || worker.custom_role.length >= 2, {
  message: "Précisez la fonction personnalisée.",
  path: ["custom_role"],
})

const workersSchema = z.object({ workers: z.array(workerSchema).max(250).default([]) })
const workerDraftSchema = z.object({
  first_name: z.string().trim().max(100).optional().default(""),
  last_name: z.string().trim().max(100).optional().default(""),
  phone: z.string().trim().max(50).optional().default(""),
  district: z.string().trim().max(255).optional().default(""),
  role: z.enum(["car_washer", "moto_washer", "versatile_washer", "team_lead", "custom"]).optional().default("car_washer"),
  custom_role: z.string().trim().max(100).optional().default(""),
  joined_at: dateOnlySchema.optional().or(z.literal("")), 
})
const servicesDraftSchema = z.object({
  selected: z.array(selectedServiceSchema).max(100).default([]),
  custom: z.array(customServiceSchema).max(100).default([]),
})
const workersDraftSchema = z.object({ workers: z.array(workerDraftSchema).max(250).default([]) })
const planSchema = z.string().trim().min(1).max(50)

export const onboardingValidators = {
  station: stationSchema,
  services: servicesSchema,
  workers: workersSchema,
  plan: planSchema,
}

interface ProgressRow {
  id: string
  organization_id: string
  current_stage: string
  station_data: unknown
  services_data: unknown
  workers_data: unknown
  plan_code: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

interface OrganizationRow {
  id: string
  clerk_org_id: string
  name: string
  slug: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  description: string | null
  logo_url: string | null
  plan: string
  subscription_status: string
  onboarding_completed: boolean
}

interface OnboardingConfirmRow extends ProgressRow {
  clerk_org_id: string
  organization_name: string
  slug: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  description: string | null
  logo_url: string | null
  plan: string
  subscription_status: string
  onboarding_completed: boolean
}

interface PlanRow {
  id: string
  code: string
  name: string
  description: string | null
  price_cents: string | number
  billing_cycle: string
  max_workers: number | null
  max_services: number | null
  max_sites?: number | null
  max_users?: number | null
  features: string[] | Record<string, boolean>
  sort_order: number
}

function getTenant(req: { tenant?: TenantContext }): TenantContext {
  if (!req.tenant) throw new HttpError(401, "tenant_required", "Aucune organisation active.")
  return req.tenant
}

function requireOwner(current: TenantContext) {
  if (current.role !== "owner") {
    throw new HttpError(403, "forbidden", "Seul le propriétaire de l'organisation peut effectuer cette étape.")
  }
}

function getDbPool() {
  const pool = getPool()
  if (!pool) throw new HttpError(503, "database_not_configured", "La base de données Neon n'est pas configurée.")
  return pool
}

function validationError(error: z.ZodError): HttpError {
  const firstIssue = error.issues[0]
  return new HttpError(400, "validation_error", firstIssue?.message || "Les données envoyées ne sont pas valides.")
}

function nullable(value: string | null | undefined) {
  const clean = value?.trim()
  return clean ? clean : null
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "station"
}

function jsonData(value: unknown) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return null
    }
  }
  return value ?? null
}

function safeMoney(value: string | number | null | undefined) {
  const amount = Number(value ?? 0)
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new HttpError(500, "invalid_money_value", "Un montant dépasse la limite de calcul autorisée.")
  }
  return amount
}

function planToApi(row: PlanRow | undefined) {
  if (!row) return null
  return {
    ...row,
    price_cents: safeMoney(row.price_cents),
  }
}

function makeStatus(org: OrganizationRow, progress: ProgressRow) {
  const state = org.onboarding_completed
    ? "completed"
    : progress.station_data
      ? "in_progress"
      : "not_started"
  return {
    state,
    current_stage: org.onboarding_completed ? "completed" : progress.current_stage || "station",
    org_name: org.name,
    station: {
      id: org.id,
      name: org.name,
      phone: org.phone,
      email: org.email,
      address: org.address,
      city: org.city,
      description: org.description,
      logo_url: org.logo_url,
      slug: org.slug,
    },
  }
}

export function createOnboardingRouter() {
  const router = Router()

  router.get("/onboarding/status", async (req, res) => {
    const tenant = getTenant(req)
    const { rows } = await getDbPool().query<OrganizationRow & ProgressRow>(
      `SELECT
         o.id, o.clerk_org_id, o.name, o.slug, o.phone, o.email, o.address,
         o.city, o.description, o.logo_url, o.plan, o.subscription_status,
         o.onboarding_completed, p.current_stage, p.station_data, p.services_data,
         p.workers_data, p.plan_code, p.completed_at, p.created_at, p.updated_at
       FROM organizations o
       JOIN onboarding_progress p ON p.organization_id = o.id
       WHERE o.id = $1`,
      [tenant.organizationId]
    )
    const row = rows[0]
    if (!row) throw new HttpError(404, "organization_not_found", "Organisation introuvable.")
    res.json(makeStatus(row, row))
  })

  router.get("/onboarding/progress", async (req, res) => {
    const tenant = getTenant(req)
    const { rows } = await getDbPool().query<ProgressRow>(
      `SELECT id, organization_id, current_stage, station_data, services_data,
              workers_data, plan_code, completed_at, created_at, updated_at
       FROM onboarding_progress WHERE organization_id = $1`,
      [tenant.organizationId]
    )
    if (!rows[0]) throw new HttpError(404, "onboarding_not_found", "Progression d'inscription introuvable.")
    const progress = rows[0]
    res.json({ ...progress, station_data: jsonData(progress.station_data), services_data: jsonData(progress.services_data), workers_data: jsonData(progress.workers_data) })
  })

  router.put("/onboarding/progress", async (req, res) => {
    const tenant = getTenant(req)
    requireOwner(tenant)
    const stage = typeof req.body?.stage === "string" ? req.body.stage : ""
    if (!(stages as readonly string[]).includes(stage) || stage === "review") {
      throw new HttpError(400, "invalid_stage", "Cette étape d'inscription n'est pas valide.")
    }

    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const progressResult = await client.query<ProgressRow>(
        `SELECT * FROM onboarding_progress WHERE organization_id = $1 FOR UPDATE`,
        [tenant.organizationId]
      )
      const current = progressResult.rows[0]
      if (!current) throw new HttpError(404, "onboarding_not_found", "Progression d'inscription introuvable.")
      if (current.completed_at) throw new HttpError(409, "onboarding_completed", "Cette configuration est déjà terminée.")

      const targetIndex = stageIndex(stage)
      const currentIndex = Math.max(0, stageIndex(current.current_stage))
      if (targetIndex > currentIndex) {
        throw new HttpError(409, "stage_out_of_order", "Enregistrez d'abord l'étape précédente.")
      }

      const data = req.body?.data
      if (req.body?.draft === true) {
        if (stage === "station") {
          const parsed = stationDraftSchema.safeParse(data)
          if (!parsed.success) throw validationError(parsed.error)
          await client.query(
            `UPDATE onboarding_progress SET station_data = $2::jsonb, updated_at = NOW()
             WHERE organization_id = $1`,
            [tenant.organizationId, JSON.stringify(parsed.data)]
          )
        } else if (stage === "services") {
          const parsed = servicesDraftSchema.safeParse(data)
          if (!parsed.success) throw validationError(parsed.error)
          const selectedIds = parsed.data.selected.map((service) => service.template_id)
          if (selectedIds.length) {
            const templates = await client.query(
              `SELECT id FROM service_catalog_templates WHERE id = ANY($1::uuid[])`,
              [selectedIds]
            )
            if (templates.rowCount !== selectedIds.length) throw new HttpError(400, "invalid_service_template", "Une prestation sélectionnée n'existe plus dans le catalogue.")
          }
          await client.query(
            `UPDATE onboarding_progress SET services_data = $2::jsonb, updated_at = NOW()
             WHERE organization_id = $1`,
            [tenant.organizationId, JSON.stringify(parsed.data)]
          )
        } else if (stage === "workers") {
          const parsed = workersDraftSchema.safeParse(data)
          if (!parsed.success) throw validationError(parsed.error)
          await client.query(
            `UPDATE onboarding_progress SET workers_data = $2::jsonb, updated_at = NOW()
             WHERE organization_id = $1`,
            [tenant.organizationId, JSON.stringify(parsed.data)]
          )
        } else {
          const rawCode = req.body?.plan_code ?? data?.plan_code ?? data?.plan ?? null
          const planCode = typeof rawCode === "string" && rawCode.trim() ? planSchema.safeParse(rawCode) : null
          if (planCode && !planCode.success) throw validationError(planCode.error)
          if (planCode?.success) {
            const plan = await client.query("SELECT 1 FROM plans WHERE code = $1 AND is_active = true", [planCode.data])
            if (!plan.rowCount) throw new HttpError(400, "invalid_plan", "Le forfait sélectionné est indisponible.")
          }
          await client.query(
            `UPDATE onboarding_progress SET plan_code = $2, updated_at = NOW()
             WHERE organization_id = $1`,
            [tenant.organizationId, planCode?.success ? planCode.data : null]
          )
        }

        const saved = await client.query<ProgressRow>(
          `SELECT * FROM onboarding_progress WHERE organization_id = $1`,
          [tenant.organizationId]
        )
        await client.query("COMMIT")
        const progress = saved.rows[0]
        res.json({
          ...progress,
          station_data: jsonData(progress.station_data),
          services_data: jsonData(progress.services_data),
          workers_data: jsonData(progress.workers_data),
        })
        return
      }
      let nextStage: string
      if (stage === "station") {
        const parsed = stationSchema.safeParse(data)
        if (!parsed.success) throw validationError(parsed.error)
        await client.query(
          `UPDATE onboarding_progress SET station_data = $2::jsonb, current_stage = 'services', updated_at = NOW()
           WHERE organization_id = $1`,
          [tenant.organizationId, JSON.stringify(parsed.data)]
        )
        nextStage = "services"
      } else if (stage === "services") {
        if (!current.station_data) throw new HttpError(409, "station_required", "Enregistrez d'abord les informations de la station.")
        const parsed = servicesSchema.safeParse(data)
        if (!parsed.success) throw validationError(parsed.error)
        const uniqueIds = new Set(parsed.data.selected.map((service) => service.template_id))
        if (uniqueIds.size !== parsed.data.selected.length) throw new HttpError(400, "duplicate_service", "Une prestation a été sélectionnée plusieurs fois.")
        const uniqueCustomNames = new Set(parsed.data.custom.map((service) => service.name.toLowerCase()))
        if (uniqueCustomNames.size !== parsed.data.custom.length) throw new HttpError(400, "duplicate_service", "Les prestations personnalisées ne peuvent pas avoir le même nom.")
        const selectedIds = parsed.data.selected.map((service) => service.template_id)
        if (selectedIds.length) {
          const templates = await client.query<{ id: string }>(
            `SELECT id FROM service_catalog_templates WHERE id = ANY($1::uuid[])`,
            [selectedIds]
          )
          if (templates.rowCount !== selectedIds.length) throw new HttpError(400, "invalid_service_template", "Une prestation sélectionnée n'existe plus dans le catalogue.")
        }
        await client.query(
          `UPDATE onboarding_progress SET services_data = $2::jsonb, current_stage = 'workers', updated_at = NOW()
           WHERE organization_id = $1`,
          [tenant.organizationId, JSON.stringify(parsed.data)]
        )
        nextStage = "workers"
      } else if (stage === "workers") {
        if (!current.services_data) throw new HttpError(409, "services_required", "Enregistrez d'abord au moins une prestation.")
        const parsed = workersSchema.safeParse(data)
        if (!parsed.success) throw validationError(parsed.error)
        await client.query(
          `UPDATE onboarding_progress SET workers_data = $2::jsonb, current_stage = 'plan', updated_at = NOW()
           WHERE organization_id = $1`,
          [tenant.organizationId, JSON.stringify(parsed.data)]
        )
        nextStage = "plan"
      } else {
        if (!current.workers_data) throw new HttpError(409, "workers_required", "Enregistrez l'étape Travailleurs, même si vous travaillez seul.")
        const code = planSchema.safeParse(req.body?.plan_code ?? data?.plan_code ?? data?.plan)
        if (!code.success) throw validationError(code.error)
        const plan = await client.query("SELECT 1 FROM plans WHERE code = $1 AND is_active = true", [code.data])
        if (!plan.rowCount) throw new HttpError(400, "invalid_plan", "Le forfait sélectionné est indisponible.")
        await client.query(
          `UPDATE onboarding_progress SET plan_code = $2, current_stage = 'review', updated_at = NOW()
           WHERE organization_id = $1`,
          [tenant.organizationId, code.data]
        )
        nextStage = "review"
      }

      const saved = await client.query<ProgressRow>(
        `SELECT * FROM onboarding_progress WHERE organization_id = $1`,
        [tenant.organizationId]
      )
      await client.query("COMMIT")
      const progress = saved.rows[0]
      res.json({
        ...progress,
        current_stage: nextStage,
        station_data: jsonData(progress.station_data),
        services_data: jsonData(progress.services_data),
        workers_data: jsonData(progress.workers_data),
      })
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  })

  router.get("/onboarding/summary", async (req, res) => {
    const tenant = getTenant(req)
    const pool = getDbPool()
    const [progressResult, orgResult] = await Promise.all([
      pool.query<ProgressRow>(
        `SELECT * FROM onboarding_progress WHERE organization_id = $1`,
        [tenant.organizationId]
      ),
      pool.query<OrganizationRow>(
        `SELECT id, clerk_org_id, name, slug, phone, email, address, city, description,
                logo_url, plan, subscription_status, onboarding_completed
         FROM organizations WHERE id = $1`,
        [tenant.organizationId]
      ),
    ])
    const progress = progressResult.rows[0]
    const organization = orgResult.rows[0]
    if (!progress || !organization) throw new HttpError(404, "onboarding_not_found", "Récapitulatif d'inscription introuvable.")

    const selectedPlanCode = progress.plan_code || organization.plan
    const planResult = selectedPlanCode
      ? await pool.query<PlanRow>(
          `SELECT id, code, name, description, price_cents, billing_cycle, max_workers,
                  max_services, max_sites, max_users, features, sort_order
           FROM plans WHERE code = $1 AND is_active = true`,
          [selectedPlanCode]
        )
      : { rows: [] as PlanRow[] }
    const stationData = stationDraftSchema.safeParse(jsonData(progress.station_data))
    const savedServices = servicesDraftSchema.safeParse(jsonData(progress.services_data))
    const selectedIds = savedServices.success ? savedServices.data.selected.map((item) => item.template_id) : []
    const catalogResult = selectedIds.length
      ? await pool.query<{ id: string; name: string; price_cents: string | number | null }>(
          `SELECT id, name, price_cents FROM service_catalog_templates WHERE id = ANY($1::uuid[])`,
          [selectedIds]
        )
      : { rows: [] as Array<{ id: string; name: string; price_cents: string | number | null }> }
    const catalogById = new Map(catalogResult.rows.map((item) => [item.id, item]))
    const services = savedServices.success
      ? {
          selected: savedServices.data.selected.flatMap((item) => {
            const template = catalogById.get(item.template_id)
            return template ? [{ template_id: template.id, name: template.name, price_cents: template.price_cents === null ? null : safeMoney(template.price_cents) }] : []
          }),
          custom: savedServices.data.custom,
        }
      : { selected: [], custom: [] }
    const savedWorkers = workersDraftSchema.safeParse(jsonData(progress.workers_data))
    res.json({
      station: stationData.success ? stationData.data : organization,
      services,
      workers: savedWorkers.success ? savedWorkers.data : { workers: [] },
      plan: planToApi(planResult.rows[0]),
      subscription_status: organization.subscription_status,
      completed: organization.onboarding_completed,
      org_name: organization.name,
    })
  })

  router.post("/onboarding/confirm", async (req, res) => {
    const tenant = getTenant(req)
    requireOwner(tenant)
    const pool = getDbPool()
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const result = await client.query<OnboardingConfirmRow>(
        `SELECT p.*, o.clerk_org_id, o.name AS organization_name, o.slug,
                o.phone, o.email, o.address, o.city, o.description, o.logo_url,
                o.plan, o.subscription_status, o.onboarding_completed
         FROM onboarding_progress p
         JOIN organizations o ON o.id = p.organization_id
         WHERE p.organization_id = $1
         FOR UPDATE OF p, o`,
        [tenant.organizationId]
      )
      const row = result.rows[0]
      if (!row) throw new HttpError(404, "onboarding_not_found", "Progression d'inscription introuvable.")

      if (row.completed_at || row.onboarding_completed) {
        await client.query("COMMIT")
        res.status(200).json({
          organization: {
            id: tenant.organizationId,
            clerk_org_id: tenant.clerkOrgId,
            name: row.organization_name,
            slug: row.slug,
            phone: row.phone,
            email: row.email,
            address: row.address,
            city: row.city,
            onboarding_completed: true,
          },
          already_completed: true,
        })
        return
      }

      const station = stationSchema.safeParse(jsonData(row.station_data))
      const services = servicesSchema.safeParse(jsonData(row.services_data))
      const workers = workersSchema.safeParse(jsonData(row.workers_data))
      const planCode = planSchema.safeParse(row.plan_code)
      if (!station.success) throw new HttpError(400, "station_required", station.error.issues[0]?.message || "Les informations de la station sont incomplètes.")
      if (!services.success) throw new HttpError(400, "services_required", services.error.issues[0]?.message || "Sélectionnez au moins une prestation.")
      if (!workers.success) throw new HttpError(400, "workers_required", "Enregistrez l'étape Travailleurs pour continuer.")
      if (!planCode.success) throw new HttpError(400, "plan_required", "Choisissez un forfait avant de confirmer.")

      const planResult = await client.query<PlanRow>(
        `SELECT id, code, name, price_cents, max_workers, max_services, max_sites, max_users
         FROM plans WHERE code = $1 AND is_active = true FOR SHARE`,
        [planCode.data]
      )
      const plan = planResult.rows[0]
      if (!plan) throw new HttpError(400, "invalid_plan", "Le forfait sélectionné est indisponible.")
      const configuredServiceCount = services.data.selected.length + services.data.custom.length
      if (plan.max_services !== null && plan.max_services !== undefined && configuredServiceCount > plan.max_services) {
        throw new HttpError(403, "plan_service_limit", `Le forfait ${plan.name} autorise au maximum ${plan.max_services} prestations.`)
      }
      if (plan.max_workers !== null && plan.max_workers !== undefined && workers.data.workers.length > plan.max_workers) {
        throw new HttpError(403, "plan_worker_limit", `Le forfait ${plan.name} autorise au maximum ${plan.max_workers} travailleurs.`)
      }
      if (plan.max_sites !== null && plan.max_sites !== undefined && plan.max_sites < 1) {
        throw new HttpError(403, "plan_site_limit", `Le forfait ${plan.name} ne permet pas de créer une station.`)
      }
      if (plan.max_users !== null && plan.max_users !== undefined) {
        const members = await client.query<{ active_count: string }>(
          `SELECT COUNT(*)::text AS active_count
           FROM organization_members m JOIN users u ON u.id = m.user_id
           WHERE m.organization_id = $1 AND u.status = 'active'`,
          [tenant.organizationId]
        )
        if (safeMoney(members.rows[0]?.active_count) > plan.max_users) {
          throw new HttpError(403, "plan_user_limit", `Le forfait ${plan.name} autorise au maximum ${plan.max_users} comptes utilisateurs.`)
        }
      }

      const slug = `${slugify(station.data.name)}-${tenant.organizationId.slice(0, 8)}`
      await client.query(
        `UPDATE organizations SET name = $2, slug = $3, phone = $4, email = $5,
             address = $6, city = $7, description = $8, logo_url = $9,
             plan = $10, onboarding_completed = true, updated_at = NOW()
         WHERE id = $1`,
        [
          tenant.organizationId,
          station.data.name,
          slug,
          nullable(station.data.phone),
          nullable(station.data.email),
          nullable(station.data.address),
          station.data.city,
          nullable(station.data.description),
          nullable(station.data.logo_url),
          plan.code,
        ]
      )

      await client.query(
        `INSERT INTO sites (organization_id, name, address, city, phone, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (organization_id, name) DO UPDATE SET
           address = EXCLUDED.address, city = EXCLUDED.city,
           phone = EXCLUDED.phone, is_active = true, updated_at = NOW()`,
        [tenant.organizationId, station.data.name, nullable(station.data.address), station.data.city, nullable(station.data.phone)]
      )

      const defaultVehicleCategories = ["Voiture", "Moto", "Utilitaire"]
      for (const name of defaultVehicleCategories) {
        await client.query(
          `INSERT INTO vehicle_categories (organization_id, name, is_active)
           VALUES ($1, $2, true) ON CONFLICT (organization_id, name) DO NOTHING`,
          [tenant.organizationId, name]
        )
      }

      const selectedIds = services.data.selected.map((item) => item.template_id)
      const templateResult = selectedIds.length
        ? await client.query<{ id: string; category: string; name: string; price_cents: string | number }>(
            `SELECT id, category, name, price_cents FROM service_catalog_templates WHERE id = ANY($1::uuid[])`,
            [selectedIds]
          )
        : { rows: [] as Array<{ id: string; category: string; name: string; price_cents: string | number }> }
      if (templateResult.rows.length !== selectedIds.length) throw new HttpError(400, "invalid_service_template", "Une prestation sélectionnée n'existe plus dans le catalogue.")
      const templatesById = new Map(templateResult.rows.map((template) => [template.id, template]))
      const normalizedServiceNames = [
        ...templateResult.rows.map((template) => template.name.trim().toLowerCase()),
        ...services.data.custom.map((service) => service.name.trim().toLowerCase()),
      ]
      if (new Set(normalizedServiceNames).size !== normalizedServiceNames.length) {
        throw new HttpError(409, "duplicate_service", "Deux prestations de votre sélection portent le même nom.")
      }

      const categoryLabels: Record<string, string> = {
        exterieur: "Extérieur",
        interieur: "Intérieur",
        complet: "Complet",
        detailing: "Detailing",
        "deux-roues": "Deux-roues",
        utilitaire: "Utilitaire",
        autre: "Autres prestations",
      }
      const categoryIds = new Map<string, string>()
      async function getOrCreateCategory(category: string) {
        const cached = categoryIds.get(category)
        if (cached) return cached
        const label = categoryLabels[category] ?? category
        const categoryResult = await client.query<{ id: string }>(
          `INSERT INTO service_categories (organization_id, name, is_active)
           VALUES ($1, $2, true)
           ON CONFLICT (organization_id, name) DO UPDATE SET is_active = true
           RETURNING id`,
          [tenant.organizationId, label]
        )
        const id = categoryResult.rows[0]?.id
        if (!id) throw new Error("Service category insert returned no row")
        categoryIds.set(category, id)
        return id
      }

      for (const selected of services.data.selected) {
        const template = templatesById.get(selected.template_id)
        if (!template) throw new HttpError(400, "invalid_service_template", "Une prestation sélectionnée n'existe plus dans le catalogue.")
        const categoryId = await getOrCreateCategory(template.category)
        await client.query(
          `INSERT INTO services (organization_id, category_id, name, price_cents, is_active)
           VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (organization_id, name) DO UPDATE SET
             category_id = EXCLUDED.category_id,
             price_cents = EXCLUDED.price_cents,
             is_active = true,
             updated_at = NOW()`,
          [tenant.organizationId, categoryId, template.name, safeMoney(template.price_cents)]
        )
      }

      for (const custom of services.data.custom) {
        const categoryId = await getOrCreateCategory(custom.category)
        const duplicate = await client.query(
          `SELECT 1 FROM services WHERE organization_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
          [tenant.organizationId, custom.name]
        )
        if (duplicate.rowCount) throw new HttpError(409, "duplicate_service", `La prestation « ${custom.name} » existe déjà dans votre catalogue.`)
        await client.query(
          `INSERT INTO services (organization_id, category_id, name, price_cents, is_active)
           VALUES ($1, $2, $3, $4, true)`,
          [tenant.organizationId, categoryId, custom.name, custom.price_cents ?? 0]
        )
      }

      for (const worker of workers.data.workers) {
        await client.query(
          `INSERT INTO workers (organization_id, first_name, last_name, phone, district, role, custom_role, joined_at, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, 'active')`,
          [
            tenant.organizationId,
            worker.first_name,
            worker.last_name,
            nullable(worker.phone),
            nullable(worker.district),
            worker.role,
            worker.role === "custom" ? nullable(worker.custom_role) : null,
            worker.joined_at || null,
          ]
        )
      }

      const subscriptionState = plan.code === "free" ? "active" : "pending"
      await client.query(
        `WITH existing AS (
           SELECT id FROM subscriptions WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE
         )
         UPDATE subscriptions SET plan_id = $2, state = $3, status = $3,
           started_at = CASE WHEN $3 = 'active' THEN COALESCE(started_at, NOW()) ELSE NULL END,
           updated_at = NOW()
         WHERE id IN (SELECT id FROM existing)`,
        [tenant.organizationId, plan.id, subscriptionState]
      )
      const subscriptionExists = await client.query(
        `SELECT 1 FROM subscriptions WHERE organization_id = $1 LIMIT 1`,
        [tenant.organizationId]
      )
      if (!subscriptionExists.rowCount) {
        await client.query(
          `INSERT INTO subscriptions (organization_id, plan_id, state, status, started_at)
           VALUES ($1, $2, $3, $3, CASE WHEN $3 = 'active' THEN NOW() ELSE NULL END)`,
          [tenant.organizationId, plan.id, subscriptionState]
        )
      }

      await client.query(
        `UPDATE organizations SET subscription_status = $2, updated_at = NOW() WHERE id = $1`,
        [tenant.organizationId, subscriptionState]
      )
      await client.query(
        `UPDATE onboarding_progress SET completed_at = NOW(), updated_at = NOW()
         WHERE organization_id = $1`,
        [tenant.organizationId]
      )

      const organizationResult = await client.query<OrganizationRow>(
        `SELECT id, clerk_org_id, name, slug, phone, email, address, city, description,
                logo_url, plan, subscription_status, onboarding_completed
         FROM organizations WHERE id = $1`,
        [tenant.organizationId]
      )
      await client.query("COMMIT")
      res.status(201).json({ organization: organizationResult.rows[0], already_completed: false })
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  })

  return router
}
