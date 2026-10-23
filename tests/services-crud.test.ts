/**
 * CRUD d'une prestation : type de service, catégorie de véhicule, prix.
 *
 * C'est le parcours qui manquait : le catalogue permettait de nommer une
 * prestation et de lui donner un prix, mais ni de la rattacher à une catégorie
 * de véhicule précise depuis l'interface, ni de la supprimer. Ce fichier
 * vérifie la chaîne complète, dans l'ordre où elle casse :
 *
 *   1. la prestation se crée avec sa catégorie de véhicule et son prix ;
 *   2. c'est **ce prix-là** qui part dans le lavage, pas le prix de base ;
 *   3. une modification de tarif s'applique au lavage suivant ;
 *   4. la suppression est propre : refusée si un lavage la référence, les
 *      consommables partent avec elle, et rien ne traverse les organisations.
 */
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import type { Server } from "node:http"
import type { Pool } from "pg"
import { initDatabaseSchema, getPool, closeDatabase } from "../server/db.ts"
import { createApiApp } from "../server/app.ts"
import { invalidateSubscriptionCache } from "../server/entitlements.ts"

let server: Server
let baseUrl: string
let pool: Pool
let orgId: string
let siteId: string
let vehicleCategoryId: string
let siblingCategoryId: string
let serviceId: string

const PASSWORD = "WashPilot2026!"
let cookie = ""

async function api(
  path: string,
  options: { method?: string; body?: unknown; key?: string } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (cookie) headers.Cookie = cookie
  if (options.key) headers["Idempotency-Key"] = options.key
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

before(async () => {
  const ready = await initDatabaseSchema()
  assert.ok(ready, "base de test initialisée")
  pool = getPool() as Pool

  const app = createApiApp()
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  baseUrl = `http://127.0.0.1:${port}`

  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@washpilot.ci", password: PASSWORD }),
  })
  assert.equal(login.status, 200, "connexion de la démonstration")
  cookie = login.headers.getSetCookie?.().join("; ") ?? login.headers.get("set-cookie") ?? ""

  const org = await pool.query(
    "SELECT m.organization_id FROM organization_members m JOIN users u ON u.id = m.user_id WHERE u.email='demo@washpilot.ci'",
  )
  orgId = org.rows[0].organization_id
  siteId = (await pool.query("SELECT id FROM sites WHERE organization_id=$1::uuid LIMIT 1", [orgId])).rows[0].id
  // Le plan Pro ouvre la caisse et le stock : sans lui, les routes répondent
  // 402 et le test mesurerait l'abonnement, pas le CRUD.
  await pool.query(
    `UPDATE subscriptions SET plan_id = (SELECT id FROM plans WHERE code='pro'),
       status='active', plan_changed_at=now(), updated_at=now() WHERE organization_id=$1::uuid`,
    [orgId],
  )
  invalidateSubscriptionCache(orgId)
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await closeDatabase()
})

// ---------------------------------------------------------------------------
// 1. Création : type de service + catégorie de véhicule + prix
// ---------------------------------------------------------------------------

test("créer une prestation avec sa catégorie de véhicule et son prix", async () => {
  const first = await api("/api/v1/vehicle-categories", {
    method: "POST",
    body: { name: "SUV clientèle pro", family: "suv" },
  })
  assert.equal(first.status, 201, JSON.stringify(await first.clone().json()))
  const category = await first.json()
  vehicleCategoryId = category.id
  assert.equal(category.family, "suv")

  // Une seconde catégorie de la même famille : elle doit retomber sur le
  // tarif de famille, et non sur celui de sa voisine.
  const sibling = await api("/api/v1/vehicle-categories", {
    method: "POST",
    body: { name: "SUV familial test", family: "suv" },
  })
  siblingCategoryId = (await sibling.json()).id

  const response = await api("/api/v1/services", {
    method: "POST",
    body: {
      name: "Lavage intérieur simple",
      description: "Aspiration, tableau de bord et plastiques.",
      price_cents: 150000,
      duration_minutes: 20,
      price_by_vehicle_type: { suv: 200000, [vehicleCategoryId]: 300000 },
    },
  })
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  const service = await response.json()
  serviceId = service.id
  assert.equal(service.name, "Lavage intérieur simple")
  assert.equal(service.duration_minutes, 20)
  assert.equal(service.price_by_vehicle_type[vehicleCategoryId], 300000)
  assert.equal(service.price_by_vehicle_type.suv, 200000)
})

// ---------------------------------------------------------------------------
// 2. Facturation : le prix de la catégorie l'emporte
// ---------------------------------------------------------------------------

async function washTotal(categoryId: string): Promise<number> {
  const response = await api("/api/v1/washes", {
    method: "POST",
    key: `crud-${categoryId}-${Math.random().toString(36).slice(2)}`,
    body: {
      site_id: siteId,
      vehicle_category_id: categoryId,
      plate: "7777 CRUD 01",
      customer_name: "Client CRUD",
      payment_method: "cash",
      amount_received_cents: 0,
      worker_ids: [],
      items: [{ service_id: serviceId, quantity: 1 }],
    },
  })
  assert.ok([200, 201].includes(response.status), JSON.stringify(await response.clone().json()))
  return Number((await response.json()).total_cents)
}

test("le lavage facture le prix de la catégorie, puis celui de la famille", async () => {
  // Catégorie nommée dans le tarif : 3 000 F.
  assert.equal(await washTotal(vehicleCategoryId), 300000)
  // Catégorie sœur, non nommée : elle hérite du tarif de la famille SUV.
  assert.equal(await washTotal(siblingCategoryId), 200000)
})

test("modifier le prix d'une catégorie s'applique au lavage suivant", async () => {
  const response = await api(`/api/v1/services/${serviceId}`, {
    method: "PATCH",
    body: { price_by_vehicle_type: { suv: 200000, [vehicleCategoryId]: 350000 } },
  })
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
  assert.equal((await response.json()).price_by_vehicle_type[vehicleCategoryId], 350000)
  assert.equal(await washTotal(vehicleCategoryId), 350000)

  // Le changement est journalisé : un tarif qui bouge sans trace est un
  // litige de caisse qui ne se tranche pas.
  const audit = await pool.query(
    "SELECT action FROM audit_logs WHERE organization_id=$1::uuid AND entity_id=$2::text AND action='service.updated' LIMIT 1",
    [orgId, serviceId],
  )
  assert.ok(audit.rowCount, "aucune trace d'audit pour la modification de prix")
})

test("un prix de catégorie inconnue de la station est refusé", async () => {
  const otherOrg = await pool.query("INSERT INTO organizations(name) VALUES('Station voisine CRUD') RETURNING id")
  const foreign = await pool.query(
    "INSERT INTO vehicle_categories(organization_id, name, family) VALUES($1::uuid,'Catégorie voisine','suv') RETURNING id",
    [otherOrg.rows[0].id],
  )
  const response = await api(`/api/v1/services/${serviceId}`, {
    method: "PATCH",
    body: { price_by_vehicle_type: { [foreign.rows[0].id]: 900000 } },
  })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.code, "invalid_vehicle_category")
})

// ---------------------------------------------------------------------------
// 3. Suppression
// ---------------------------------------------------------------------------

test("une prestation déjà vendue ne se supprime pas, elle se désactive", async () => {
  const response = await api(`/api/v1/services/${serviceId}`, { method: "DELETE" })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, "service_in_use")
  const still = await pool.query("SELECT is_active FROM services WHERE id=$1::uuid", [serviceId])
  assert.equal(still.rowCount, 1, "la prestation a disparu malgré le refus")
})

test("supprimer une prestation jamais vendue, consommables compris", async () => {
  const created = await api("/api/v1/services", {
    method: "POST",
    body: { name: "Lustrage de la carrosserie", price_cents: 500000, duration_minutes: 60 },
  })
  assert.equal(created.status, 201)
  const service = await created.json()

  // Un consommable rattaché : sa clé étrangère bloquerait la suppression si
  // elle n'était pas traitée, et le gérant lirait une erreur 500.
  const product = await pool.query(
    `INSERT INTO products(organization_id, name, unit, unit_cost_cents, low_stock_threshold_milli)
     VALUES($1::uuid,'Cire de lustrage','litre',0,0) RETURNING id`,
    [orgId],
  )
  await pool.query(
    "INSERT INTO service_consumables(organization_id, service_id, product_id, quantity_milli) VALUES($1::uuid,$2::uuid,$3::uuid,250)",
    [orgId, service.id, product.rows[0].id],
  )

  const response = await api(`/api/v1/services/${service.id}`, { method: "DELETE" })
  assert.equal(response.status, 204)

  const gone = await pool.query("SELECT 1 FROM services WHERE id=$1::uuid", [service.id])
  assert.equal(gone.rowCount, 0, "la prestation est toujours là")
  const consumables = await pool.query("SELECT 1 FROM service_consumables WHERE service_id=$1::uuid", [service.id])
  assert.equal(consumables.rowCount, 0, "le consommable survit à sa prestation")

  const audit = await pool.query(
    "SELECT 1 FROM audit_logs WHERE organization_id=$1::uuid AND entity_id=$2::text AND action='service.deleted'",
    [orgId, service.id],
  )
  assert.ok(audit.rowCount, "aucune trace d'audit pour la suppression")

  // Deuxième suppression : la prestation n'existe plus.
  const again = await api(`/api/v1/services/${service.id}`, { method: "DELETE" })
  assert.equal(again.status, 404)
})

test("on ne supprime pas la prestation d'une autre station", async () => {
  const otherOrg = await pool.query("INSERT INTO organizations(name) VALUES('Station lointaine CRUD') RETURNING id")
  const foreign = await pool.query(
    "INSERT INTO services(organization_id, name, price_cents) VALUES($1::uuid,'Prestation voisine',100000) RETURNING id",
    [otherOrg.rows[0].id],
  )
  const response = await api(`/api/v1/services/${foreign.rows[0].id}`, { method: "DELETE" })
  assert.equal(response.status, 404)
  const still = await pool.query("SELECT 1 FROM services WHERE id=$1::uuid", [foreign.rows[0].id])
  assert.equal(still.rowCount, 1, "une autre station a pu supprimer la prestation")
})
