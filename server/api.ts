import { Router } from "express";
import { z } from "zod";
import { getPool } from "./db.ts";
import {
  asyncRoute,
  body,
  tenant,
  parseId,
  pageParams,
  requireRole,
  HttpError,
} from "./http.ts";
export const catalogValidators = {
  category: z
    .object({
      name: z.string().trim().min(1).max(100),
      is_active: z.boolean().optional(),
    })
    .strict(),
  service: z
    .object({
      name: z.string().trim().min(1).max(120),
      description: z.string().max(1000).optional(),
      category_id: z.string().uuid().nullable().optional(),
      price_cents: z.number().int().min(0).max(100000000),
      duration_minutes: z.number().int().min(1).max(1440).nullable().optional(),
      is_active: z.boolean().optional(),
    })
    .strict(),
};
const db = () => {
  const p = getPool();
  if (!p)
    throw new HttpError(
      503,
      "database_not_configured",
      "Base de données indisponible.",
    );
  return p;
};
export function createApiRouter() {
  const r = Router();

  // ========== SITES CRUD ==========
  r.get(
    "/sites",
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        pg = pageParams(req),
        q = await db().query(
          "SELECT id,name,city,address,phone,is_active,created_at FROM sites WHERE organization_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
          [t.organizationId, pg.limit, pg.offset],
        );
      res.json({
        data: q.rows,
        pagination: { page: pg.page, limit: pg.limit },
      });
    }),
  );
  r.get(
    "/sites/:id",
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        q = await db().query(
          "SELECT * FROM sites WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!q.rowCount)
        throw new HttpError(404, "site_not_found", "Site introuvable.");
      res.json({ data: q.rows[0] });
    }),
  );
  r.post(
    "/sites",
    requireRole("owner", "manager"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        b = body(
          z
            .object({
              name: z.string().trim().min(1).max(120),
              city: z.string().trim().min(1).max(120),
              address: z.string().max(300).optional(),
              phone: z.string().max(40).optional(),
              is_active: z.boolean().optional(),
            })
            .strict(),
          req.body,
        ),
        q = await db().query(
          "INSERT INTO sites(organization_id,name,city,address,phone,is_active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            t.organizationId,
            b.name,
            b.city,
            b.address || null,
            b.phone || null,
            b.is_active ?? true,
          ],
        );
      res.status(201).json({ data: q.rows[0] });
    }),
  );
  r.patch(
    "/sites/:id",
    requireRole("owner", "manager"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        b = body(
          z
            .object({
              name: z.string().trim().min(1).max(120),
              city: z.string().trim().min(1).max(120),
              address: z.string().max(300).optional(),
              phone: z.string().max(40).optional(),
              is_active: z.boolean().optional(),
            })
            .partial()
            .strict(),
          req.body,
        ),
        old = await db().query(
          "SELECT * FROM sites WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!old.rowCount)
        throw new HttpError(404, "site_not_found", "Site introuvable.");
      const v = { ...old.rows[0], ...b },
        q = await db().query(
          "UPDATE sites SET name=$3,city=$4,address=$5,phone=$6,is_active=$7,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *",
          [
            id,
            t.organizationId,
            v.name,
            v.city,
            v.address || null,
            v.phone || null,
            v.is_active,
          ],
        );
      res.json({ data: q.rows[0] });
    }),
  );
  r.delete(
    "/sites/:id",
    requireRole("owner"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        q = await db().query(
          "DELETE FROM sites WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!q.rowCount)
        throw new HttpError(404, "site_not_found", "Site introuvable.");
      res.status(204).send();
    }),
  );

  // ========== SERVICES CRUD ==========
  r.get(
    "/services",
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        pg = pageParams(req),
        q = await db().query(
          "SELECT * FROM services WHERE organization_id=$1 ORDER BY name LIMIT $2 OFFSET $3",
          [t.organizationId, pg.limit, pg.offset],
        );
      res.json({
        data: q.rows,
        pagination: { page: pg.page, limit: pg.limit },
      });
    }),
  );
  r.get(
    "/services/:id",
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        q = await db().query(
          "SELECT * FROM services WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!q.rowCount)
        throw new HttpError(
          404,
          "service_not_found",
          "Prestation introuvable.",
        );
      res.json({ data: q.rows[0] });
    }),
  );
  r.post(
    "/services",
    requireRole("owner", "manager"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        b = body(catalogValidators.service, req.body),
        q = await db().query(
          "INSERT INTO services(organization_id,category_id,name,description,price_cents,duration_minutes,is_active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            t.organizationId,
            b.category_id || null,
            b.name,
            b.description || null,
            b.price_cents,
            b.duration_minutes ?? null,
            b.is_active ?? true,
          ],
        );
      res.status(201).json({ data: q.rows[0] });
    }),
  );
  r.patch(
    "/services/:id",
    requireRole("owner", "manager"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        b = body(catalogValidators.service.partial(), req.body),
        old = await db().query(
          "SELECT * FROM services WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!old.rowCount)
        throw new HttpError(
          404,
          "service_not_found",
          "Prestation introuvable.",
        );
      const v = { ...old.rows[0], ...b },
        q = await db().query(
          "UPDATE services SET category_id=$3,name=$4,description=$5,price_cents=$6,duration_minutes=$7,is_active=$8,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *",
          [
            id,
            t.organizationId,
            v.category_id,
            v.name,
            v.description,
            v.price_cents,
            v.duration_minutes,
            v.is_active,
          ],
        );
      res.json({ data: q.rows[0] });
    }),
  );
  r.delete(
    "/services/:id",
    requireRole("owner", "manager"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        q = await db().query(
          "DELETE FROM services WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!q.rowCount)
        throw new HttpError(
          404,
          "service_not_found",
          "Prestation introuvable.",
        );
      res.status(204).send();
    }),
  );

  // ========== SERVICE CATEGORIES CRUD ==========
  r.get(
    "/service-categories",
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        pg = pageParams(req),
        q = await db().query(
          "SELECT * FROM service_categories WHERE organization_id=$1 ORDER BY name LIMIT $2 OFFSET $3",
          [t.organizationId, pg.limit, pg.offset],
        );
      res.json({
        data: q.rows,
        pagination: { page: pg.page, limit: pg.limit },
      });
    }),
  );
  r.get(
    "/service-categories/:id",
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        q = await db().query(
          "SELECT * FROM service_categories WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!q.rowCount)
        throw new HttpError(
          404,
          "category_not_found",
          "Catégorie de prestation introuvable.",
        );
      res.json({ data: q.rows[0] });
    }),
  );
  r.post(
    "/service-categories",
    requireRole("owner", "manager"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        b = body(catalogValidators.category, req.body),
        q = await db().query(
          "INSERT INTO service_categories(organization_id,name,is_active) VALUES($1,$2,$3) RETURNING *",
          [t.organizationId, b.name, b.is_active ?? true],
        );
      res.status(201).json({ data: q.rows[0] });
    }),
  );
  r.patch(
    "/service-categories/:id",
    requireRole("owner", "manager"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        b = body(catalogValidators.category.partial(), req.body),
        old = await db().query(
          "SELECT * FROM service_categories WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!old.rowCount)
        throw new HttpError(
          404,
          "category_not_found",
          "Catégorie de prestation introuvable.",
        );
      const v = { ...old.rows[0], ...b },
        q = await db().query(
          "UPDATE service_categories SET name=$3,is_active=$4,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *",
          [id, t.organizationId, v.name, v.is_active],
        );
      res.json({ data: q.rows[0] });
    }),
  );
  r.delete(
    "/service-categories/:id",
    requireRole("owner", "manager"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        q = await db().query(
          "DELETE FROM service_categories WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!q.rowCount)
        throw new HttpError(
          404,
          "category_not_found",
          "Catégorie de prestation introuvable.",
        );
      res.status(204).send();
    }),
  );

  // ========== VEHICLE CATEGORIES CRUD ==========
  r.get(
    "/vehicle-categories",
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        pg = pageParams(req),
        q = await db().query(
          "SELECT * FROM vehicle_categories WHERE organization_id=$1 ORDER BY name LIMIT $2 OFFSET $3",
          [t.organizationId, pg.limit, pg.offset],
        );
      res.json({
        data: q.rows,
        pagination: { page: pg.page, limit: pg.limit },
      });
    }),
  );
  r.get(
    "/vehicle-categories/:id",
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        q = await db().query(
          "SELECT * FROM vehicle_categories WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!q.rowCount)
        throw new HttpError(
          404,
          "vehicle_category_not_found",
          "Catégorie de véhicule introuvable.",
        );
      res.json({ data: q.rows[0] });
    }),
  );
  r.post(
    "/vehicle-categories",
    requireRole("owner", "manager"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        b = body(
          z
            .object({
              name: z.string().trim().min(1).max(100),
              is_active: z.boolean().optional(),
            })
            .strict(),
          req.body,
        ),
        q = await db().query(
          "INSERT INTO vehicle_categories(organization_id,name,is_active) VALUES($1,$2,$3) RETURNING *",
          [t.organizationId, b.name, b.is_active ?? true],
        );
      res.status(201).json({ data: q.rows[0] });
    }),
  );
  r.patch(
    "/vehicle-categories/:id",
    requireRole("owner", "manager"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        b = body(
          z
            .object({
              name: z.string().trim().min(1).max(100),
              is_active: z.boolean().optional(),
            })
            .partial()
            .strict(),
          req.body,
        ),
        old = await db().query(
          "SELECT * FROM vehicle_categories WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!old.rowCount)
        throw new HttpError(
          404,
          "vehicle_category_not_found",
          "Catégorie de véhicule introuvable.",
        );
      const v = { ...old.rows[0], ...b },
        q = await db().query(
          "UPDATE vehicle_categories SET name=$3,is_active=$4,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *",
          [id, t.organizationId, v.name, v.is_active],
        );
      res.json({ data: q.rows[0] });
    }),
  );
  r.delete(
    "/vehicle-categories/:id",
    requireRole("owner", "manager"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        q = await db().query(
          "DELETE FROM vehicle_categories WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!q.rowCount)
        throw new HttpError(
          404,
          "vehicle_category_not_found",
          "Catégorie de véhicule introuvable.",
        );
      res.status(204).send();
    }),
  );

  // ========== EMPLOYEES/WORKERS CRUD ==========
  const workerValidator = z
    .object({
      first_name: z.string().trim().min(1).max(100),
      last_name: z.string().trim().min(1).max(100),
      email: z.string().email().optional(),
      phone: z.string().max(40).optional(),
      role: z.enum(["owner", "manager", "worker"]),
      is_active: z.boolean().optional(),
    })
    .strict();
  r.get(
    "/employees",
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        pg = pageParams(req),
        q = await db().query(
          "SELECT * FROM workers WHERE organization_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
          [t.organizationId, pg.limit, pg.offset],
        );
      res.json({
        data: q.rows,
        pagination: { page: pg.page, limit: pg.limit },
      });
    }),
  );
  r.get(
    "/employees/:id",
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        q = await db().query(
          "SELECT * FROM workers WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!q.rowCount)
        throw new HttpError(404, "employee_not_found", "Employé introuvable.");
      res.json({ data: q.rows[0] });
    }),
  );
  r.post(
    "/employees",
    requireRole("owner", "manager"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        b = body(workerValidator, req.body),
        q = await db().query(
          "INSERT INTO workers(organization_id,first_name,last_name,email,phone,role,is_active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            t.organizationId,
            b.first_name,
            b.last_name,
            b.email || null,
            b.phone || null,
            b.role,
            b.is_active ?? true,
          ],
        );
      res.status(201).json({ data: q.rows[0] });
    }),
  );
  r.patch(
    "/employees/:id",
    requireRole("owner", "manager"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        b = body(workerValidator.partial(), req.body),
        old = await db().query(
          "SELECT * FROM workers WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!old.rowCount)
        throw new HttpError(404, "employee_not_found", "Employé introuvable.");
      const v = { ...old.rows[0], ...b },
        q = await db().query(
          "UPDATE workers SET first_name=$3,last_name=$4,email=$5,phone=$6,role=$7,is_active=$8,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *",
          [
            id,
            t.organizationId,
            v.first_name,
            v.last_name,
            v.email || null,
            v.phone || null,
            v.role,
            v.is_active,
          ],
        );
      res.json({ data: q.rows[0] });
    }),
  );
  r.delete(
    "/employees/:id",
    requireRole("owner"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        q = await db().query(
          "DELETE FROM workers WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!q.rowCount)
        throw new HttpError(404, "employee_not_found", "Employé introuvable.");
      res.status(204).send();
    }),
  );

  // ========== WASHES (LAVAGES) CRUD ==========
  const washItemValidator = z
    .object({
      service_id: z.string().uuid(),
      price_cents: z.number().int().min(0),
      worker_id: z.string().uuid().nullable().optional(),
    })
    .strict();
  const washValidator = z
    .object({
      site_id: z.string().uuid(),
      vehicle_category_id: z.string().uuid().nullable().optional(),
      license_plate: z.string().trim().min(1).max(20),
      customer_name: z.string().trim().min(1).max(200).optional(),
      customer_phone: z.string().max(40).optional(),
      total_amount_cents: z.number().int().min(0),
      payment_method: z.enum(["cash", "mobile_money", "card", "transfer"]),
      status: z
        .enum(["pending", "in_progress", "completed", "cancelled"])
        .optional(),
      items: z.array(washItemValidator).min(1).optional(),
    })
    .strict();
  r.get(
    "/washes",
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        pg = pageParams(req),
        q = await db().query(
          "SELECT * FROM washes WHERE organization_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
          [t.organizationId, pg.limit, pg.offset],
        );
      res.json({
        data: q.rows,
        pagination: { page: pg.page, limit: pg.limit },
      });
    }),
  );
  r.get(
    "/washes/:id",
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        q = await db().query(
          "SELECT * FROM washes WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!q.rowCount)
        throw new HttpError(404, "wash_not_found", "Lavage introuvable.");
      const items = await db().query(
        "SELECT * FROM wash_items WHERE wash_id=$1",
        [id],
      );
      res.json({ data: { ...q.rows[0], items: items.rows } });
    }),
  );
  r.post(
    "/washes",
    requireRole("owner", "manager", "worker"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        b = body(washValidator, req.body);
      const client = db();
      await client.query("BEGIN");
      try {
        const washQ = await client.query(
          "INSERT INTO washes(organization_id,site_id,vehicle_category_id,license_plate,customer_name,customer_phone,total_amount_cents,payment_method,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            t.organizationId,
            b.site_id,
            b.vehicle_category_id || null,
            b.license_plate,
            b.customer_name || null,
            b.customer_phone || null,
            b.total_amount_cents,
            b.payment_method,
            b.status ?? "pending",
          ],
        );
        const washId = washQ.rows[0].id;
        if (b.items) {
          for (const item of b.items) {
            await client.query(
              "INSERT INTO wash_items(wash_id,service_id,price_cents,worker_id) VALUES($1,$2,$3,$4)",
              [
                washId,
                item.service_id,
                item.price_cents,
                item.worker_id || null,
              ],
            );
          }
        }
        await client.query("COMMIT");
        res.status(201).json({ data: washQ.rows[0] });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }),
  );
  r.patch(
    "/washes/:id",
    requireRole("owner", "manager", "worker"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string),
        b = body(washValidator.partial(), req.body),
        old = await db().query(
          "SELECT * FROM washes WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
      if (!old.rowCount)
        throw new HttpError(404, "wash_not_found", "Lavage introuvable.");
      const v = { ...old.rows[0], ...b };

      const updateFields: string[] = [];
      const updateValues: (string | number | null)[] = [id, t.organizationId];
      let paramIndex = 3;

      if (v.site_id !== undefined) {
        updateFields.push(`site_id=$${paramIndex++}`);
        updateValues.push(v.site_id);
      }
      if (v.vehicle_category_id !== undefined) {
        updateFields.push(`vehicle_category_id=$${paramIndex++}`);
        updateValues.push(v.vehicle_category_id);
      }
      if (v.license_plate !== undefined) {
        updateFields.push(`license_plate=$${paramIndex++}`);
        updateValues.push(v.license_plate);
      }
      if (v.customer_name !== undefined) {
        updateFields.push(`customer_name=$${paramIndex++}`);
        updateValues.push(v.customer_name);
      }
      if (v.customer_phone !== undefined) {
        updateFields.push(`customer_phone=$${paramIndex++}`);
        updateValues.push(v.customer_phone);
      }
      if (v.total_amount_cents !== undefined) {
        updateFields.push(`total_amount_cents=$${paramIndex++}`);
        updateValues.push(v.total_amount_cents);
      }
      if (v.payment_method !== undefined) {
        updateFields.push(`payment_method=$${paramIndex++}`);
        updateValues.push(v.payment_method);
      }
      if (v.status !== undefined) {
        updateFields.push(`status=$${paramIndex++}`);
        updateValues.push(v.status);
      }

      updateFields.push("updated_at=now()");

      if (updateFields.length === 1) {
        return res.json({ data: old.rows[0] });
      }

      const q = await db().query(
        `UPDATE washes SET ${updateFields.join(", ")} WHERE id=$1 AND organization_id=$2 RETURNING *`,
        updateValues,
      );
      res.json({ data: q.rows[0] });
    }),
  );
  r.delete(
    "/washes/:id",
    requireRole("owner", "manager"),
    asyncRoute(async (req, res) => {
      const t = tenant(req),
        id = parseId(req.params.id as string);
      const client = db();
      await client.query("BEGIN");
      try {
        await client.query("DELETE FROM wash_items WHERE wash_id=$1", [id]);
        const q = await client.query(
          "DELETE FROM washes WHERE id=$1 AND organization_id=$2",
          [id, t.organizationId],
        );
        if (!q.rowCount) {
          await client.query("ROLLBACK");
          throw new HttpError(404, "wash_not_found", "Lavage introuvable.");
        }
        await client.query("COMMIT");
        res.status(204).send();
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }),
  );
  return r;
}
