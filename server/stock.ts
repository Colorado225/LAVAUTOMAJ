// ---------------------------------------------------------------------------
// Stock : produits, catégories, mouvements.
//
// Un seul principe gouverne ce module : **le stock n'est jamais écrit, il est
// toujours recalculé**. Il n'existe pas de colonne « quantité en stock » dans
// la base ; le stock d'un produit est la somme signée de ses mouvements.
//
// Conséquences, toutes voulues :
//   • aucune route ne permet de « fixer » un stock. Pour le corriger, on
//     enregistre un inventaire, qui écrit l'écart constaté ;
//   • un mouvement ne se modifie ni ne se supprime. On le contrepasse par un
//     mouvement inverse qui le référence. Même le propriétaire ne peut pas
//     réécrire le passé ;
//   • chaque mouvement fige le coût unitaire du moment, comme `wash_items`
//     fige le prix d'une prestation.
// ---------------------------------------------------------------------------

import { Router } from "express"
import { z } from "zod"
import type { Pool } from "pg"
import { getPool } from "./db.ts"
import { asyncRoute, body, tenant, parseId, requirePermission } from "./http.ts"
import { HttpError } from "./auth.ts"
import { fingerprint, withIdempotency } from "./idempotency.ts"
import { signedQuantity, canApply, isLowStock, inventoryDelta, UNITS } from "./stock-rules.ts"

function db(): Pool {
  const pool = getPool()
  if (!pool) throw new HttpError(503, "database_not_configured", "Base de données indisponible.")
  return pool
}

/** Quantité en millièmes d'unité. Plafonnée à un million d'unités. */
const quantityMilli = z.number().int().positive().max(1_000_000_000)

export const stockValidators = {
  category: z
    .object({
      name: z.string().trim().min(1, "Donnez un nom à la catégorie.").max(120),
    })
    .strip(),
  product: z
    .object({
      name: z.string().trim().min(1, "Donnez un nom au produit.").max(200),
      category_id: z.string().uuid().nullable().optional(),
      unit: z.enum(UNITS).default("unite"),
      unit_cost_cents: z.number().int().min(0).max(100_000_000).default(0),
      low_stock_threshold_milli: z.number().int().min(0).max(1_000_000_000).default(0),
      initial_quantity_milli: z.number().int().min(0).max(1_000_000_000).default(0),
    })
    .strip(),
  productPatch: z
    .object({
      name: z.string().trim().min(1).max(200).optional(),
      category_id: z.string().uuid().nullable().optional(),
      unit_cost_cents: z.number().int().min(0).max(100_000_000).optional(),
      low_stock_threshold_milli: z.number().int().min(0).max(1_000_000_000).optional(),
      is_active: z.boolean().optional(),
    })
    .strip(),
  movement: z
    .object({
      product_id: z.string().uuid(),
      kind: z.enum(["entry", "exit"]),
      quantity_milli: quantityMilli,
      site_id: z.string().uuid().nullable().optional(),
      reason: z.string().trim().max(500).nullable().optional(),
      reference: z.string().trim().max(120).nullable().optional(),
    })
    .strip(),
  inventory: z
    .object({
      counted_milli: z.number().int().min(0).max(1_000_000_000),
      reason: z.string().trim().max(500).nullable().optional(),
    })
    .strip(),
  reversal: z
    .object({
      reason: z.string().trim().min(1, "Indiquez pourquoi ce mouvement est annulé.").max(500),
    })
    .strip(),
}

const PRODUCT_FIELDS = `p.id, p.name, p.category_id, p.unit, p.unit_cost_cents,
  p.low_stock_threshold_milli, p.is_active, p.created_at`

const MOVEMENT_FIELDS = `m.id, m.product_id, m.site_id, m.kind, m.quantity_milli,
  m.unit_cost_cents, m.reason, m.reference, m.reverses_movement_id, m.created_at`

/**
 * Stock courant d'un produit, verrou posé.
 *
 * Le `FOR UPDATE` sur la ligne produit sérialise les mouvements concurrents :
 * sans lui, deux sorties simultanées pourraient chacune constater un stock
 * suffisant et le faire passer en négatif à elles deux.
 */
async function lockedStock(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> },
  organizationId: string,
  productId: string,
): Promise<{ product: Record<string, unknown>; stockMilli: number }> {
  const productQ = await client.query(
    `SELECT id, name, unit, unit_cost_cents, low_stock_threshold_milli, is_active
     FROM products WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE`,
    [productId, organizationId],
  )
  if (!productQ.rowCount) throw new HttpError(404, "product_not_found", "Produit introuvable.")

  const stockQ = await client.query(
    `SELECT COALESCE(SUM(quantity_milli),0)::int AS stock_milli
     FROM stock_movements WHERE product_id=$1::uuid AND organization_id=$2::uuid`,
    [productId, organizationId],
  )
  return {
    product: productQ.rows[0],
    stockMilli: Number(stockQ.rows[0].stock_milli ?? 0),
  }
}

/** Vérifie qu'une station appartient bien à l'organisation appelante. */
async function assertSite(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null }> },
  organizationId: string,
  siteId: string | null,
): Promise<void> {
  if (!siteId) return
  const q = await client.query("SELECT 1 FROM sites WHERE id=$1::uuid AND organization_id=$2::uuid", [
    siteId,
    organizationId,
  ])
  if (!q.rowCount) throw new HttpError(400, "invalid_site", "Station invalide.")
}

export function createStockRouter() {
  const r = Router()

  // ------------------------------------------------------------ catégories --

  r.get(
    "/product-categories",
    requirePermission("stock:read"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const q = await db().query(
        `SELECT id, name, is_active, created_at FROM product_categories
         WHERE organization_id=$1::uuid ORDER BY name`,
        [t.organizationId],
      )
      res.json(q.rows)
    }),
  )

  r.post(
    "/product-categories",
    requirePermission("stock:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const input = body(stockValidators.category, req.body)
      const existing = await db().query(
        "SELECT 1 FROM product_categories WHERE organization_id=$1::uuid AND lower(name)=lower($2)",
        [t.organizationId, input.name],
      )
      if (existing.rowCount) {
        throw new HttpError(409, "category_exists", "Une catégorie porte déjà ce nom.")
      }
      const q = await db().query(
        `INSERT INTO product_categories(organization_id, name) VALUES($1,$2)
         RETURNING id, name, is_active, created_at`,
        [t.organizationId, input.name],
      )
      res.status(201).json(q.rows[0])
    }),
  )

  // --------------------------------------------------------------- produits --

  // Le stock est calculé ici, par agrégation des mouvements. C'est la seule
  // définition du stock dans tout le produit.
  r.get(
    "/products",
    requirePermission("stock:read"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const q = await db().query(
        `SELECT ${PRODUCT_FIELDS}, c.name AS category_name,
                COALESCE(SUM(m.quantity_milli),0)::int AS stock_milli
         FROM products p
         LEFT JOIN product_categories c ON c.id = p.category_id
         LEFT JOIN stock_movements m ON m.product_id = p.id
         WHERE p.organization_id=$1::uuid
         GROUP BY p.id, c.name
         ORDER BY p.is_active DESC, p.name`,
        [t.organizationId],
      )
      res.json(
        q.rows.map((row) => ({
          ...row,
          low_stock: isLowStock(Number(row.stock_milli), Number(row.low_stock_threshold_milli)),
        })),
      )
    }),
  )

  r.post(
    "/products",
    requirePermission("stock:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const input = body(stockValidators.product, req.body)
      const pool = db()
      const client = await pool.connect()
      try {
        await client.query("BEGIN")

        const existing = await client.query(
          "SELECT 1 FROM products WHERE organization_id=$1::uuid AND lower(name)=lower($2)",
          [t.organizationId, input.name],
        )
        if (existing.rowCount) {
          throw new HttpError(409, "product_exists", "Un produit porte déjà ce nom.")
        }

        if (input.category_id) {
          const catQ = await client.query(
            "SELECT 1 FROM product_categories WHERE id=$1::uuid AND organization_id=$2::uuid",
            [input.category_id, t.organizationId],
          )
          if (!catQ.rowCount) throw new HttpError(400, "invalid_category", "Catégorie invalide.")
        }

        const q = await client.query(
          `INSERT INTO products(organization_id, category_id, name, unit, unit_cost_cents,
             low_stock_threshold_milli, created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7)
           RETURNING id, name, category_id, unit, unit_cost_cents, low_stock_threshold_milli, is_active, created_at`,
          [
            t.organizationId,
            input.category_id ?? null,
            input.name,
            input.unit,
            input.unit_cost_cents,
            input.low_stock_threshold_milli,
            t.userId,
          ],
        )
        const product = q.rows[0]

        // Le stock d'ouverture est un mouvement comme un autre : il laisse une
        // trace datée et signée, au lieu d'apparaître de nulle part.
        if (input.initial_quantity_milli > 0) {
          await client.query(
            `INSERT INTO stock_movements(organization_id, product_id, kind, quantity_milli,
               unit_cost_cents, reason, created_by)
             VALUES($1,$2,'initial',$3,$4,'Stock initial à la création du produit',$5)`,
            [t.organizationId, product.id, input.initial_quantity_milli, input.unit_cost_cents, t.userId],
          )
        }

        await client.query(
          `INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
           VALUES($1,$2,'product.created','product',$3,$4)`,
          [
            t.organizationId,
            t.userId,
            product.id,
            JSON.stringify({ name: product.name, initial_quantity_milli: input.initial_quantity_milli }),
          ],
        )
        await client.query("COMMIT")
        res.status(201).json({ ...product, stock_milli: input.initial_quantity_milli })
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }
    }),
  )

  // Modifie la fiche produit — jamais son stock. Il n'existe volontairement
  // aucun champ de quantité dans ce validateur.
  r.patch(
    "/products/:id",
    requirePermission("stock:manage"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const input = body(stockValidators.productPatch, req.body)
      const client = await db().connect()
      try {
        await client.query("BEGIN")
        const oldQ = await client.query(
          `SELECT id, name, category_id, unit, unit_cost_cents, low_stock_threshold_milli, is_active
           FROM products WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE`,
          [id, t.organizationId],
        )
        if (!oldQ.rowCount) throw new HttpError(404, "product_not_found", "Produit introuvable.")
        const old = oldQ.rows[0]

        if (input.category_id) {
          const catQ = await client.query(
            "SELECT 1 FROM product_categories WHERE id=$1::uuid AND organization_id=$2::uuid",
            [input.category_id, t.organizationId],
          )
          if (!catQ.rowCount) throw new HttpError(400, "invalid_category", "Catégorie invalide.")
        }

        if (input.name && input.name.toLowerCase() !== String(old.name).toLowerCase()) {
          const dup = await client.query(
            "SELECT 1 FROM products WHERE organization_id=$1::uuid AND lower(name)=lower($2) AND id <> $3::uuid",
            [t.organizationId, input.name, id],
          )
          if (dup.rowCount) throw new HttpError(409, "product_exists", "Un produit porte déjà ce nom.")
        }

        const merged = { ...old, ...input }
        const q = await client.query(
          `UPDATE products SET name=$3, category_id=$4, unit_cost_cents=$5,
             low_stock_threshold_milli=$6, is_active=$7
           WHERE id=$1::uuid AND organization_id=$2::uuid
           RETURNING id, name, category_id, unit, unit_cost_cents, low_stock_threshold_milli, is_active, created_at`,
          [
            id,
            t.organizationId,
            merged.name,
            merged.category_id ?? null,
            merged.unit_cost_cents,
            merged.low_stock_threshold_milli,
            merged.is_active,
          ],
        )

        await client.query(
          `INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
           VALUES($1,$2,'product.updated','product',$3,$4)`,
          [
            t.organizationId,
            t.userId,
            id,
            JSON.stringify({
              unit_cost_cents: { from: old.unit_cost_cents, to: merged.unit_cost_cents },
            }),
          ],
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

  // -------------------------------------------------------------- mouvements --

  r.get(
    "/stock-movements",
    requirePermission("stock:read"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const productId = typeof req.query.product_id === "string" ? parseId(req.query.product_id) : null
      const q = await db().query(
        `SELECT ${MOVEMENT_FIELDS}, p.name AS product_name, p.unit,
                u.first_name, u.last_name
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         LEFT JOIN users u ON u.id = m.created_by
         WHERE m.organization_id=$1::uuid AND ($2::uuid IS NULL OR m.product_id=$2::uuid)
         ORDER BY m.created_at DESC LIMIT 200`,
        [t.organizationId, productId],
      )
      res.json(q.rows)
    }),
  )

  r.post(
    "/stock-movements",
    requirePermission("stock:move"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const input = body(stockValidators.movement, req.body)
      const pool = db()

      await withIdempotency(
        pool,
        req,
        res,
        t.organizationId,
        fingerprint({ op: "stock_movement", ...input }),
        async () => {
          const client = await pool.connect()
          try {
            await client.query("BEGIN")
            await assertSite(client, t.organizationId, input.site_id ?? null)

            const { product, stockMilli } = await lockedStock(client, t.organizationId, input.product_id)
            if (!product.is_active) {
              throw new HttpError(409, "product_archived", "Ce produit est archivé. Réactivez-le avant de le mouvementer.")
            }

            const signed = signedQuantity(input.kind, input.quantity_milli)
            if (!canApply(stockMilli, signed)) {
              throw new HttpError(
                409,
                "insufficient_stock",
                "Le stock disponible ne permet pas cette sortie. Enregistrez un inventaire si le stock réel est différent.",
              )
            }

            const q = await client.query(
              `INSERT INTO stock_movements(organization_id, product_id, site_id, kind, quantity_milli,
                 unit_cost_cents, reason, reference, created_by)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${MOVEMENT_FIELDS.replace(/m\./g, "")}`,
              [
                t.organizationId,
                input.product_id,
                input.site_id ?? null,
                input.kind,
                signed,
                product.unit_cost_cents,
                input.reason || null,
                input.reference || null,
                t.userId,
              ],
            )
            const movement = q.rows[0]

            await client.query(
              `INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
               VALUES($1,$2,'stock.moved','stock_movement',$3,$4)`,
              [
                t.organizationId,
                t.userId,
                movement.id,
                JSON.stringify({
                  product_id: input.product_id,
                  kind: input.kind,
                  quantity_milli: signed,
                  stock_after_milli: stockMilli + signed,
                }),
              ],
            )
            await client.query("COMMIT")
            return { status: 201, body: { ...movement, stock_milli: stockMilli + signed } }
          } catch (error) {
            await client.query("ROLLBACK")
            throw error
          } finally {
            client.release()
          }
        },
      )
    }),
  )

  // Inventaire : on n'écrit pas le stock compté, on écrit l'écart. Le
  // mouvement garde ainsi la mémoire de l'erreur au lieu de l'effacer.
  r.post(
    "/products/:id/inventory",
    requirePermission("stock:move"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const input = body(stockValidators.inventory, req.body)
      const client = await db().connect()
      try {
        await client.query("BEGIN")
        const { product, stockMilli } = await lockedStock(client, t.organizationId, id)
        const delta = inventoryDelta(input.counted_milli, stockMilli)

        if (delta === 0) {
          await client.query("COMMIT")
          res.json({ movement: null, stock_milli: stockMilli, delta_milli: 0 })
          return
        }

        const q = await client.query(
          `INSERT INTO stock_movements(organization_id, product_id, kind, quantity_milli,
             unit_cost_cents, reason, created_by)
           VALUES($1,$2,'inventory',$3,$4,$5,$6) RETURNING ${MOVEMENT_FIELDS.replace(/m\./g, "")}`,
          [
            t.organizationId,
            id,
            delta,
            product.unit_cost_cents,
            input.reason || `Inventaire physique : ${input.counted_milli} millièmes comptés`,
            t.userId,
          ],
        )

        await client.query(
          `INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
           VALUES($1,$2,'stock.inventory','stock_movement',$3,$4)`,
          [
            t.organizationId,
            t.userId,
            q.rows[0].id,
            JSON.stringify({
              product_id: id,
              theorique_milli: stockMilli,
              compte_milli: input.counted_milli,
              ecart_milli: delta,
            }),
          ],
        )
        await client.query("COMMIT")
        res.status(201).json({ movement: q.rows[0], stock_milli: input.counted_milli, delta_milli: delta })
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }
    }),
  )

  // Contrepassation : la seule façon d'annuler un mouvement. L'original reste
  // en base, intact et visible.
  r.post(
    "/stock-movements/:id/reverse",
    requirePermission("stock:move"),
    asyncRoute(async (req, res) => {
      const t = tenant(req)
      const id = parseId(req.params.id)
      const input = body(stockValidators.reversal, req.body)
      const client = await db().connect()
      try {
        await client.query("BEGIN")
        const originalQ = await client.query(
          `SELECT id, product_id, site_id, kind, quantity_milli, unit_cost_cents
           FROM stock_movements WHERE id=$1::uuid AND organization_id=$2::uuid FOR UPDATE`,
          [id, t.organizationId],
        )
        if (!originalQ.rowCount) throw new HttpError(404, "movement_not_found", "Mouvement introuvable.")
        const original = originalQ.rows[0]

        if (original.kind === "reversal") {
          throw new HttpError(409, "already_reversal", "Une contrepassation ne peut pas être contrepassée.")
        }
        const alreadyQ = await client.query(
          "SELECT 1 FROM stock_movements WHERE reverses_movement_id=$1::uuid AND organization_id=$2::uuid",
          [id, t.organizationId],
        )
        if (alreadyQ.rowCount) {
          throw new HttpError(409, "already_reversed", "Ce mouvement a déjà été contrepassé.")
        }

        const { stockMilli } = await lockedStock(client, t.organizationId, String(original.product_id))
        const inverse = -Number(original.quantity_milli)
        if (!canApply(stockMilli, inverse)) {
          throw new HttpError(
            409,
            "insufficient_stock",
            "Annuler cette entrée rendrait le stock négatif : une partie a déjà été consommée.",
          )
        }

        const q = await client.query(
          `INSERT INTO stock_movements(organization_id, product_id, site_id, kind, quantity_milli,
             unit_cost_cents, reason, reverses_movement_id, created_by)
           VALUES($1,$2,$3,'reversal',$4,$5,$6,$7,$8) RETURNING ${MOVEMENT_FIELDS.replace(/m\./g, "")}`,
          [
            t.organizationId,
            original.product_id,
            original.site_id,
            inverse,
            original.unit_cost_cents,
            input.reason,
            id,
            t.userId,
          ],
        )

        await client.query(
          `INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
           VALUES($1,$2,'stock.reversed','stock_movement',$3,$4)`,
          [
            t.organizationId,
            t.userId,
            q.rows[0].id,
            JSON.stringify({ reverses: id, reason: input.reason, quantity_milli: inverse }),
          ],
        )
        await client.query("COMMIT")
        res.status(201).json({ ...q.rows[0], stock_milli: stockMilli + inverse })
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
