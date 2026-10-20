import { Router } from "express"
import { z } from "zod"
import type { Pool } from "pg"
import { getPool } from "./db.ts"
import { asyncRoute, body, tenant, parseId, requirePermission, HttpError } from "./http.ts"
import { fingerprint, withIdempotency } from "./idempotency.ts"
import { initialPaymentStatus, resolvePaymentStatus, PAYMENT_METHODS } from "./payments.ts"

export const catalogValidators = {
  category: z
    .object({
      name: z.string().trim().min(1, "Le nom est obligatoire.").max(100),
      is_active: z.boolean().optional(),
    })
    .strip(),
  service: z
    .object({
      name: z.string().trim().min(1, "Le nom est obligatoire.").max(120),
      description: z.string().max(1000).nullable().optional(),
      category_id: z.string().uuid().nullable().optional(),
      price_cents: z.number().int().min(0).max(100000000),
      duration_minutes: z.number().int().min(1).max(1440).nullable().optional(),
      is_active: z.boolean().optional(),
      price_by_vehicle_type: z.record(z.string(), z.number().int().min(0).max(100000000)).optional(),
    })
    .strip(),
  site: z
    .object({
      name: z.string().trim().min(2).max(120),
      city: z.string().trim().min(1).max(120),
      address: z.string().trim().max(300).nullable().optional(),
      phone: z.string().trim().max(30).nullable().optional(),
      email: z.string().trim().max(200).nullable().optional(),
      description: z.string().trim().max(1000).nullable().optional(),
      is_active: z.boolean().optional(),
    })
    .strip(),
}

export const washValidators = {
  create: z
    .object({
      site_id: z.string().uuid(),
      vehicle_category_id: z.string().uuid(),
      items: z
        .array(
          z.object({
            service_id: z.string().uuid(),
            quantity: z.number().int().min(1).max(100),
          }),
        )
        .min(1, "Sélectionnez au moins une prestation."),
      worker_ids: z.array(z.string().uuid()).max(50).default([]),
      payment_method: z.enum(PAYMENT_METHODS),
      amount_received_cents: z.number().int().min(0).max(100000000),
      cash_session_id: z.string().uuid().optional(),
    })
    .strip(),
  cancel: z
    .object({
      reason: z.string().trim().min(3, "Indiquez le motif de l’annulation.").max(500),
    })
    .strip(),
}

function db(): Pool {
  const pool = getPool()
  if (!pool) throw new HttpError(503, "database_not_configured", "Base de données indisponible.")
  return pool
}

const WASH_FIELDS = `id, reference, site_id, vehicle_category_id, customer_id, status, payment_status,
  total_cents, payment_method, created_by AS author_id, cancelled_by AS cancelled_by_id,
  cancelled_at, cancellation_reason, created_at`

export function createApiRouter() {
  const r = Router()

  // ---------------------------------------------------------------- sites --
  r.get(
    "/sites",
    requirePermission("wash:read"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const q = await db().query(
        "SELECT id, name, city, address, phone, email, description, logo_url, slug, is_active, created_at, updated_at FROM sites WHERE organization_id=$1::uuid ORDER BY created_at",
        [t.organizationId],
      )
      res.json(q.rows)
    }),
  )

  r.get(
    "/sites/:id",
    requirePermission("wash:read"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const q = await db().query("SELECT * FROM sites WHERE id=$1::uuid AND organization_id=$2::uuid", [id, t.organizationId])
      if (!q.rowCount) throw new HttpError(404, "site_not_found", "Station introuvable.")
      res.json(q.rows[0])
    }),
  )

  r.post(
    "/sites",
    requirePermission("settings:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const input = body(catalogValidators.site, req.body)
      const q = await db().query(
        `INSERT INTO sites(organization_id, name, city, address, phone, email, description, is_active)
         VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8,true)) RETURNING *`,
        [t.organizationId, input.name, input.city, input.address ?? null, input.phone ?? null, input.email ?? null, input.description ?? null, input.is_active ?? null],
      )
      res.status(201).json(q.rows[0])
    }),
  )

  r.patch(
    "/sites/:id",
    requirePermission("settings:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const input = body(catalogValidators.site.partial(), req.body)
      const oldQ = await db().query("SELECT * FROM sites WHERE id=$1::uuid AND organization_id=$2::uuid", [id, t.organizationId])
      if (!oldQ.rowCount) throw new HttpError(404, "site_not_found", "Station introuvable.")
      const merged = { ...oldQ.rows[0], ...input }
      const q = await db().query(
        `UPDATE sites SET name=$3, city=$4, address=$5, phone=$6, email=$7, description=$8, is_active=$9, updated_at=now()
         WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`,
        [id, t.organizationId, merged.name, merged.city, merged.address, merged.phone, merged.email, merged.description, merged.is_active],
      )
      res.json(q.rows[0])
    }),
  )

  // DELETE /api/v1/sites/:id — refuse when washes, sessions, expenses or workers still reference the site.
  r.delete(
    "/sites/:id",
    requirePermission("settings:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const pool = db()
      const siteQ = await pool.query("SELECT 1 FROM sites WHERE id=$1::uuid AND organization_id=$2::uuid", [id, t.organizationId])
      if (!siteQ.rowCount) throw new HttpError(404, "site_not_found", "Station introuvable.")
      const refs = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM washes WHERE site_id=$1::uuid) +
           (SELECT COUNT(*) FROM cash_sessions WHERE site_id=$1::uuid) +
           (SELECT COUNT(*) FROM expenses WHERE site_id=$1::uuid) +
           (SELECT COUNT(*) FROM workers WHERE site_id=$1::uuid)::int AS ref_count`,
        [id],
      )
      if (Number(refs.rows[0].ref_count) > 0) {
        throw new HttpError(409, "site_in_use", "Des lavages, caisses, dépenses ou travailleurs référencent cette station. Désactivez-la plutôt.")
      }
      await pool.query("DELETE FROM sites WHERE id=$1::uuid AND organization_id=$2::uuid", [id, t.organizationId])
      res.status(204).send()
    }),
  )

  // --------------------------------------------------- service categories --
  r.get(
    "/service-categories",
    requirePermission("service:read"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const q = await db().query(
        "SELECT id, name, is_active, created_at, updated_at FROM service_categories WHERE organization_id=$1::uuid ORDER BY name",
        [t.organizationId],
      )
      res.json(q.rows)
    }),
  )

  r.post(
    "/service-categories",
    requirePermission("service:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const input = body(catalogValidators.category, req.body)
      try {
        const q = await db().query(
          "INSERT INTO service_categories(organization_id, name, is_active) VALUES($1,$2,COALESCE($3,true)) RETURNING id, name, is_active, created_at, updated_at",
          [t.organizationId, input.name, input.is_active ?? null],
        )
        res.status(201).json(q.rows[0])
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new HttpError(409, "category_exists", "Une catégorie portant ce nom existe déjà.")
        }
        throw error
      }
    }),
  )

  r.patch(
    "/service-categories/:id",
    requirePermission("service:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const input = body(catalogValidators.category.partial(), req.body)
      const oldQ = await db().query("SELECT * FROM service_categories WHERE id=$1::uuid AND organization_id=$2::uuid", [id, t.organizationId])
      if (!oldQ.rowCount) throw new HttpError(404, "category_not_found", "Catégorie introuvable.")
      const merged = { ...oldQ.rows[0], ...input }
      try {
        const q = await db().query(
          "UPDATE service_categories SET name=$3, is_active=$4, updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING id, name, is_active, created_at, updated_at",
          [id, t.organizationId, merged.name, merged.is_active],
        )
        res.json(q.rows[0])
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new HttpError(409, "category_exists", "Une catégorie portant ce nom existe déjà.")
        }
        throw error
      }
    }),
  )

  r.delete(
    "/service-categories/:id",
    requirePermission("service:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const used = await db().query("SELECT 1 FROM services WHERE category_id=$1::uuid AND organization_id=$2::uuid LIMIT 1", [id, t.organizationId])
      if (used.rowCount) {
        throw new HttpError(409, "category_in_use", "Des prestations utilisent cette catégorie. Désactivez-la plutôt.")
      }
      const q = await db().query("DELETE FROM service_categories WHERE id=$1::uuid AND organization_id=$2::uuid", [id, t.organizationId])
      if (!q.rowCount) throw new HttpError(404, "category_not_found", "Catégorie introuvable.")
      res.status(204).send()
    }),
  )

  // --------------------------------------------------- vehicle categories --
  r.get(
    "/vehicle-categories",
    requirePermission("service:read"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const q = await db().query(
        "SELECT id, name, is_active, created_at, created_at AS updated_at FROM vehicle_categories WHERE organization_id=$1::uuid ORDER BY name",
        [t.organizationId],
      )
      res.json(q.rows)
    }),
  )

  r.post(
    "/vehicle-categories",
    requirePermission("service:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const input = body(catalogValidators.category, req.body)
      try {
        const q = await db().query(
          "INSERT INTO vehicle_categories(organization_id, name, is_active) VALUES($1,$2,COALESCE($3,true)) RETURNING id, name, is_active, created_at, created_at AS updated_at",
          [t.organizationId, input.name, input.is_active ?? null],
        )
        res.status(201).json(q.rows[0])
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new HttpError(409, "category_exists", "Une catégorie portant ce nom existe déjà.")
        }
        throw error
      }
    }),
  )

  r.patch(
    "/vehicle-categories/:id",
    requirePermission("service:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const input = body(catalogValidators.category.partial(), req.body)
      const oldQ = await db().query("SELECT * FROM vehicle_categories WHERE id=$1::uuid AND organization_id=$2::uuid", [id, t.organizationId])
      if (!oldQ.rowCount) throw new HttpError(404, "category_not_found", "Catégorie introuvable.")
      const merged = { ...oldQ.rows[0], ...input }
      try {
        const q = await db().query(
          "UPDATE vehicle_categories SET name=$3, is_active=$4 WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING id, name, is_active, created_at, created_at AS updated_at",
          [id, t.organizationId, merged.name, merged.is_active],
        )
        res.json(q.rows[0])
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new HttpError(409, "category_exists", "Une catégorie portant ce nom existe déjà.")
        }
        throw error
      }
    }),
  )

  r.delete(
    "/vehicle-categories/:id",
    requirePermission("service:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const used = await db().query("SELECT 1 FROM washes WHERE vehicle_category_id=$1::uuid AND organization_id=$2::uuid LIMIT 1", [id, t.organizationId])
      if (used.rowCount) {
        throw new HttpError(409, "category_in_use", "Des lavages utilisent cette catégorie. Désactivez-la plutôt.")
      }
      const q = await db().query("DELETE FROM vehicle_categories WHERE id=$1::uuid AND organization_id=$2::uuid", [id, t.organizationId])
      if (!q.rowCount) throw new HttpError(404, "category_not_found", "Catégorie introuvable.")
      res.status(204).send()
    }),
  )

  // ------------------------------------------------------------- services --
  r.get(
    "/services",
    requirePermission("service:read"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const q = await db().query(
        "SELECT id, name, description, category_id, price_cents, price_by_vehicle_type, duration_minutes, is_active, created_at, updated_at FROM services WHERE organization_id=$1::uuid ORDER BY name",
        [t.organizationId],
      )
      res.json(q.rows)
    }),
  )

  r.get(
    "/services/:id",
    requirePermission("service:read"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const q = await db().query("SELECT * FROM services WHERE id=$1::uuid AND organization_id=$2::uuid", [id, t.organizationId])
      if (!q.rowCount) throw new HttpError(404, "service_not_found", "Prestation introuvable.")
      res.json(q.rows[0])
    }),
  )

  r.post(
    "/services",
    requirePermission("service:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const input = body(catalogValidators.service, req.body)
      if (input.category_id) {
        const categoryQ = await db().query("SELECT 1 FROM service_categories WHERE id=$1::uuid AND organization_id=$2::uuid", [input.category_id, t.organizationId])
        if (!categoryQ.rowCount) throw new HttpError(400, "invalid_category", "Catégorie de prestation invalide.")
      }
      const q = await db().query(
        `INSERT INTO services(organization_id, name, description, category_id, price_cents, price_by_vehicle_type, duration_minutes, is_active)
         VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8,true)) RETURNING *`,
        [t.organizationId, input.name, input.description ?? null, input.category_id ?? null, input.price_cents, JSON.stringify(input.price_by_vehicle_type ?? {}), input.duration_minutes ?? null, input.is_active ?? null],
      )
      res.status(201).json(q.rows[0])
    }),
  )

  r.patch(
    "/services/:id",
    requirePermission("service:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const input = body(catalogValidators.service.partial(), req.body)
      const oldQ = await db().query("SELECT * FROM services WHERE id=$1::uuid AND organization_id=$2::uuid", [id, t.organizationId])
      if (!oldQ.rowCount) throw new HttpError(404, "service_not_found", "Prestation introuvable.")
      if (input.category_id) {
        const categoryQ = await db().query("SELECT 1 FROM service_categories WHERE id=$1::uuid AND organization_id=$2::uuid", [input.category_id, t.organizationId])
        if (!categoryQ.rowCount) throw new HttpError(400, "invalid_category", "Catégorie de prestation invalide.")
      }
      const merged = { ...oldQ.rows[0], ...input }
      const q = await db().query(
        `UPDATE services SET name=$3, description=$4, category_id=$5::uuid, price_cents=$6, price_by_vehicle_type=$7, duration_minutes=$8, is_active=$9, updated_at=now()
         WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING *`,
        [id, t.organizationId, merged.name, merged.description, merged.category_id, merged.price_cents, JSON.stringify(merged.price_by_vehicle_type ?? {}), merged.duration_minutes, merged.is_active],
      )
      res.json(q.rows[0])
    }),
  )

  r.delete(
    "/services/:id",
    requirePermission("service:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const used = await db().query("SELECT 1 FROM wash_items WHERE service_id=$1::uuid LIMIT 1", [id])
      if (used.rowCount) {
        throw new HttpError(409, "service_in_use", "Des lavages référencent cette prestation. Désactivez-la plutôt.")
      }
      const q = await db().query("DELETE FROM services WHERE id=$1::uuid AND organization_id=$2::uuid", [id, t.organizationId])
      if (!q.rowCount) throw new HttpError(404, "service_not_found", "Prestation introuvable.")
      res.status(204).send()
    }),
  )

  // --------------------------------------------------------------- washes --
  r.get(
    "/washes",
    requirePermission("wash:read"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const q = await db().query(
        `SELECT ${WASH_FIELDS} FROM washes WHERE organization_id=$1::uuid ORDER BY created_at DESC LIMIT 200`,
        [t.organizationId],
      )
      res.json(q.rows)
    }),
  )

  r.get(
    "/washes/:id",
    requirePermission("wash:read"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const pool = db()
      const washQ = await pool.query(`SELECT ${WASH_FIELDS} FROM washes WHERE id=$1::uuid AND organization_id=$2::uuid`, [id, t.organizationId])
      if (!washQ.rowCount) throw new HttpError(404, "wash_not_found", "Lavage introuvable.")
      const [items, workers, payments] = await Promise.all([
        pool.query(
          "SELECT id, service_id, service_name AS service_name_snapshot, unit_price_cents AS price_cents_snapshot, quantity, line_total_cents FROM wash_items WHERE wash_id=$1::uuid",
          [id],
        ),
        pool.query(
          `SELECT w.id, w.first_name, w.last_name, w.role FROM wash_assignments a
           JOIN workers w ON w.id = a.worker_id WHERE a.wash_id=$1::uuid`,
          [id],
        ),
        pool.query(
          "SELECT id, amount_cents, method, status, reference, created_at AS received_at FROM payments WHERE wash_id=$1::uuid ORDER BY created_at",
          [id],
        ),
      ])
      res.json({ wash: washQ.rows[0], items: items.rows, workers: workers.rows, payments: payments.rows })
    }),
  )

  // POST /api/v1/washes — idempotent creation: items are priced server-side
  // from the catalog, cash payments require an open cash session.
  r.post(
    "/washes",
    requirePermission("wash:create"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const input = body(washValidators.create, req.body)
      const pool = db()

      await withIdempotency(pool, req, res, t.organizationId, fingerprint(input), async () => {
        const client = await pool.connect()
        try {
          await client.query("BEGIN")

          const siteQ = await client.query("SELECT id FROM sites WHERE id=$1::uuid AND organization_id=$2::uuid AND is_active", [input.site_id, t.organizationId])
          if (!siteQ.rowCount) throw new HttpError(400, "invalid_site", "Station invalide.")

          const categoryQ = await client.query(
            "SELECT id FROM vehicle_categories WHERE id=$1::uuid AND organization_id=$2::uuid AND is_active",
            [input.vehicle_category_id, t.organizationId],
          )
          if (!categoryQ.rowCount) throw new HttpError(400, "invalid_vehicle_category", "Catégorie de véhicule invalide.")

          const serviceIds = input.items.map((item) => item.service_id)
          const servicesQ = await client.query(
            "SELECT id, name, price_cents, price_by_vehicle_type FROM services WHERE organization_id=$1::uuid AND id = ANY($2::uuid[]) AND is_active",
            [t.organizationId, serviceIds],
          )
          if (servicesQ.rowCount !== new Set(serviceIds).size) {
            throw new HttpError(400, "invalid_service", "Une prestation sélectionnée est invalide ou inactive.")
          }
          const serviceById = new Map(servicesQ.rows.map((row) => [row.id as string, row]))

          const resolvePrice = (service: { price_cents: number; price_by_vehicle_type: Record<string, number> | null }, vehicleCategoryId: string): number => {
            if (service.price_by_vehicle_type && service.price_by_vehicle_type[vehicleCategoryId] != null) {
              return Number(service.price_by_vehicle_type[vehicleCategoryId])
            }
            return Number(service.price_cents)
          }

          if (input.worker_ids.length) {
            const workersQ = await client.query(
              "SELECT id FROM workers WHERE organization_id=$1::uuid AND id = ANY($2::uuid[]) AND status='active'",
              [t.organizationId, input.worker_ids],
            )
            if (workersQ.rowCount !== new Set(input.worker_ids).size) {
              throw new HttpError(400, "invalid_worker", "Un travailleur sélectionné est invalide ou inactif.")
            }
          }

          const totalCents = input.items.reduce((total, item) => {
            const service = serviceById.get(item.service_id)!
            return total + resolvePrice(service, input.vehicle_category_id) * item.quantity
          }, 0)
          if (input.amount_received_cents > totalCents) {
            throw new HttpError(400, "amount_exceeds_total", "Le montant reçu dépasse le total du lavage.")
          }

          const isCash = input.payment_method === "cash" && input.amount_received_cents > 0
          let cashSessionId: string | null = null
          if (isCash) {
            if (!input.cash_session_id) {
              throw new HttpError(400, "cash_session_required", "Une session de caisse ouverte est requise pour un paiement en espèces.")
            }
            const sessionQ = await client.query(
              "SELECT id FROM cash_sessions WHERE id=$1::uuid AND organization_id=$2::uuid AND site_id=$3::uuid AND status='open' FOR UPDATE",
              [input.cash_session_id, t.organizationId, input.site_id],
            )
            if (!sessionQ.rowCount) {
              throw new HttpError(400, "cash_session_invalid", "Session de caisse introuvable, fermée ou d'une autre station.")
            }
            cashSessionId = sessionQ.rows[0].id
          }

          const paymentStatus = resolvePaymentStatus(totalCents, input.amount_received_cents)

          const washQ = await client.query(
            `INSERT INTO washes(organization_id, site_id, vehicle_category_id, status, payment_status, total_cents, payment_method, created_by, reference)
             VALUES($1,$2,$3,'completed',$4,$5,$6,$7,
               'LAV-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(md5(random()::text),1,6)))
             RETURNING ${WASH_FIELDS}`,
            [t.organizationId, input.site_id, input.vehicle_category_id, paymentStatus, totalCents, input.payment_method, t.userId],
          )
          const wash = washQ.rows[0]

          for (const item of input.items) {
            const service = serviceById.get(item.service_id)!
            const unitPrice = resolvePrice(service, input.vehicle_category_id)
            await client.query(
              "INSERT INTO wash_items(wash_id, service_id, service_name, quantity, unit_price_cents, line_total_cents) VALUES($1,$2,$3,$4,$5,$6)",
              [wash.id, item.service_id, service.name, item.quantity, unitPrice, unitPrice * item.quantity],
            )
          }
          for (const workerId of new Set(input.worker_ids)) {
            await client.query("INSERT INTO wash_assignments(wash_id, worker_id) VALUES($1,$2)", [wash.id, workerId])
          }

          if (input.amount_received_cents > 0) {
            await client.query(
              "INSERT INTO payments(organization_id, wash_id, method, amount_cents, status) VALUES($1,$2,$3,$4,$5)",
              [t.organizationId, wash.id, input.payment_method, input.amount_received_cents, initialPaymentStatus(input.payment_method)],
            )
          }
          if (isCash && cashSessionId) {
            await client.query(
              `INSERT INTO cash_movements(organization_id, cash_session_id, type, amount_cents, source, description, wash_id, created_by)
               VALUES($1,$2,'entry',$3,'wash',$4,$5,$6)`,
              [t.organizationId, cashSessionId, input.amount_received_cents, `Encaissement lavage ${wash.reference}`, wash.id, t.userId],
            )
          }

          await client.query(
            "INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id) VALUES($1,$2,'wash.created','wash',$3)",
            [t.organizationId, t.userId, wash.id],
          )
          await client.query("COMMIT")
          return { status: 201, body: wash }
        } catch (error) {
          await client.query("ROLLBACK")
          throw error
        } finally {
          client.release()
        }
      })
    }),
  )

  // POST /api/v1/washes/:id/cancel — soft cancellation with mandatory reason.
  r.post(
    "/washes/:id/cancel",
    requirePermission("wash:cancel"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const input = body(washValidators.cancel, req.body)
      const pool = db()
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const washQ = await client.query(
          "SELECT id, reference, status FROM washes WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE",
          [id, t.organizationId],
        )
        if (!washQ.rowCount) throw new HttpError(404, "wash_not_found", "Lavage introuvable.")
        if (washQ.rows[0].status === "cancelled") {
          throw new HttpError(409, "wash_already_cancelled", "Ce lavage est déjà annulé.")
        }

        // Reverse the cash entry when the originating session is still open.
        const movementQ = await client.query(
          `SELECT m.cash_session_id, m.amount_cents FROM cash_movements m
           JOIN cash_sessions s ON s.id = m.cash_session_id
           WHERE m.wash_id=$1::uuid AND m.type='entry' AND s.status='open'`,
          [id],
        )
        for (const movement of movementQ.rows) {
          await client.query(
            `INSERT INTO cash_movements(organization_id, cash_session_id, type, amount_cents, source, description, wash_id, created_by)
             VALUES($1,$2,'exit',$3,'wash_cancellation',$4,$5,$6)`,
            [t.organizationId, movement.cash_session_id, movement.amount_cents, `Annulation lavage ${washQ.rows[0].reference}`, id, t.userId],
          )
        }

        const hadPayments = await client.query("SELECT 1 FROM payments WHERE wash_id=$1::uuid LIMIT 1", [id])
        await client.query("UPDATE payments SET status='refunded' WHERE wash_id=$1::uuid", [id])

        const q = await client.query(
          `UPDATE washes SET status='cancelled', payment_status=CASE WHEN $4 THEN 'refunded' ELSE payment_status END,
             cancelled_at=now(), cancelled_by=$3, cancellation_reason=$5
           WHERE id=$1::uuid AND organization_id=$2::uuid RETURNING ${WASH_FIELDS}`,
          [id, t.organizationId, t.userId, Boolean(hadPayments.rowCount), input.reason],
        )
        await client.query(
          "INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata) VALUES($1,$2,'wash.cancelled','wash',$3,$4)",
          [t.organizationId, t.userId, id, JSON.stringify({ reason: input.reason })],
        )
        await client.query("COMMIT")
        res.json(q.rows[0])
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }
    }),
  )

  return r
}
