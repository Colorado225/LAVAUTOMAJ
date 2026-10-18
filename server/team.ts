import { Router } from "express"
import type { PoolClient } from "pg"
import { z } from "zod"
import { HttpError } from "./auth.ts"
import { getPool } from "./db.ts"
import { requireManager } from "./permissions.ts"
import type { TenantContext } from "./types.ts"

const workerFields = {
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(50).nullable().optional(),
  district: z.string().trim().max(255).nullable().optional(),
  role: z.enum(["car_washer", "moto_washer", "versatile_washer", "team_lead", "custom"]),
  custom_role: z.string().trim().max(100).nullable().optional(),
  joined_at: z.string().date().nullable().optional(),
} satisfies z.ZodRawShape

function validateCustomRole(
  worker: { role?: string; custom_role?: string | null },
  context: z.RefinementCtx,
) {
  if (worker.role === "custom" && (!worker.custom_role || worker.custom_role.trim().length < 2)) {
    context.addIssue({
      code: "custom",
      path: ["custom_role"],
      message: "Précisez la fonction personnalisée (2 caractères minimum).",
    })
  }
}

const workerInputSchema = z.object(workerFields).superRefine(validateCustomRole)
const workerFullSchema = z.object({
  ...workerFields,
  status: z.enum(["active", "inactive"]),
}).superRefine(validateCustomRole)
const workerPatchSchema = z.object({
  ...workerFields,
  status: z.enum(["active", "inactive"]),
}).partial().strict()

export const workerValidators = {
  create: workerInputSchema,
  patch: workerPatchSchema,
  full: workerFullSchema,
}

function tenant(req: { tenant?: TenantContext }) {
  if (!req.tenant) throw new HttpError(401, "tenant_required", "Aucune organisation active.")
  if (!req.tenant.onboardingCompleted) {
    throw new HttpError(403, "onboarding_required", "Terminez l'onboarding avant de gérer l'équipe.")
  }
  return req.tenant
}

function invalid(error: z.ZodError) {
  return new HttpError(400, "validation_error", error.issues[0]?.message || "Les données ne sont pas valides.")
}

function database() {
  const pool = getPool()
  if (!pool) throw new HttpError(503, "database_not_configured", "La base de données Neon n'est pas configurée.")
  return pool
}

function requireWorkerId(value: string) {
  const parsed = z.string().uuid().safeParse(value)
  if (!parsed.success) throw new HttpError(400, "invalid_worker_id", "L'identifiant du travailleur n'est pas valide.")
  return parsed.data
}

/** Serialize worker activation so concurrent requests cannot exceed a plan quota. */
export async function assertWorkerCapacity(client: PoolClient, organizationId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`worker-limit:${organizationId}`])
  const result = await client.query<{ max_workers: number | null; active_count: string }>(
    `SELECT p.max_workers, COUNT(w.id)::text AS active_count
     FROM organizations o
     JOIN plans p ON p.code = o.plan
     LEFT JOIN workers w ON w.organization_id = o.id AND w.status = 'active'
     WHERE o.id = $1
     GROUP BY p.max_workers`,
    [organizationId],
  )
  const plan = result.rows[0]
  if (!plan) throw new HttpError(409, "subscription_required", "Aucun forfait n'est associé à cette organisation.")
  const activeCount = Number(plan.active_count)
  if (!Number.isSafeInteger(activeCount)) {
    throw new HttpError(500, "invalid_worker_count", "Le nombre de travailleurs dépasse la limite de calcul autorisée.")
  }
  if (plan.max_workers !== null && activeCount >= plan.max_workers) {
    throw new HttpError(403, "plan_worker_limit", `Votre forfait autorise au maximum ${plan.max_workers} travailleurs actifs.`)
  }
}

function workerValues(worker: z.infer<typeof workerFullSchema>) {
  return [
    worker.first_name,
    worker.last_name,
    worker.phone?.trim() || null,
    worker.district?.trim() || null,
    worker.role,
    worker.role === "custom" ? worker.custom_role?.trim() || null : null,
    worker.joined_at || null,
    worker.status,
  ]
}

const workerColumns = `id, organization_id, first_name, last_name, phone, district,
  role, status, custom_role, joined_at::text AS joined_at, created_at, updated_at`

export function createTeamRouter() {
  const router = Router()

  router.post("/workers", async (req, res) => {
    const current = tenant(req)
    requireManager(current)
    const parsed = workerInputSchema.safeParse(req.body)
    if (!parsed.success) throw invalid(parsed.error)

    const pool = database()
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      await assertWorkerCapacity(client, current.organizationId)
      const { rows } = await client.query(
        `INSERT INTO workers (
           organization_id, first_name, last_name, phone, district,
           role, custom_role, joined_at, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9)
         RETURNING ${workerColumns}`,
        [current.organizationId, ...workerValues({ ...parsed.data, status: "active" })],
      )
      await client.query("COMMIT")
      res.status(201).json(rows[0])
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  })

  router.patch("/workers/:workerID", async (req, res) => {
    const current = tenant(req)
    requireManager(current)
    const workerId = requireWorkerId(req.params.workerID)
    const parsedPatch = workerPatchSchema.safeParse(req.body)
    if (!parsedPatch.success) throw invalid(parsedPatch.error)
    if (!Object.keys(parsedPatch.data).length) {
      throw new HttpError(400, "empty_worker_update", "Indiquez au moins un champ à modifier.")
    }

    const pool = database()
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const existingResult = await client.query<Record<string, unknown>>(
        `SELECT ${workerColumns} FROM workers
         WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
        [current.organizationId, workerId],
      )
      const existing = existingResult.rows[0]
      if (!existing) throw new HttpError(404, "worker_not_found", "Travailleur introuvable.")

      const parsedWorker = workerFullSchema.safeParse({ ...existing, ...parsedPatch.data })
      if (!parsedWorker.success) throw invalid(parsedWorker.error)
      if (existing.status !== "active" && parsedWorker.data.status === "active") {
        await assertWorkerCapacity(client, current.organizationId)
      }

      const { rows } = await client.query(
        `UPDATE workers SET
           first_name = $3, last_name = $4, phone = $5, district = $6,
           role = $7, custom_role = $8, joined_at = $9::date, status = $10,
           updated_at = NOW()
         WHERE organization_id = $1 AND id = $2
         RETURNING ${workerColumns}`,
        [current.organizationId, workerId, ...workerValues(parsedWorker.data)],
      )
      await client.query("COMMIT")
      res.json(rows[0])
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  })

  return router
}
