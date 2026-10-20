import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import type { Server } from "node:http"
import type { Pool } from "pg"
import { initDatabaseSchema, getPool, closeDatabase } from "../server/db.ts"
import { createApiApp } from "../server/app.ts"
import { invalidateSubscriptionCache } from "../server/entitlements.ts"

// ---------------------------------------------------------------------------
// Parcours de souscription : intention → paiement → déclaration → validation
//
// Le scénario réel : l'essai expire, le client veut payer. Ce qui est testé
// ici est moins la mécanique que les refus — une déclaration n'est pas un
// paiement, et deux validations simultanées ne valent qu'un mois.
// ---------------------------------------------------------------------------

let server: Server
let baseUrl: string
let pool: Pool
let organizationId: string

const PASSWORD = "WashPilot2026!"
const sessions = new Map<string, string>()

async function api(path: string, options: { as?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (options.as) {
    const cookie = sessions.get(options.as)
    if (cookie) headers.Cookie = cookie
  }
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

async function login(email: string) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  assert.equal(response.status, 200, `connexion ${email}`)
  const cookie = response.headers.getSetCookie?.().join("; ") ?? response.headers.get("set-cookie") ?? ""
  sessions.set(email, cookie)
}

async function resetSubscription(status: string, planCode: string, daysLeft: number) {
  await pool.query(
    `UPDATE subscriptions
        SET plan_id = (SELECT id FROM plans WHERE code = $2),
            status = $1,
            current_period_end = now() + ($3 || ' days')::interval
      WHERE organization_id = $4::uuid`,
    [status, planCode, String(daysLeft), organizationId],
  )
  invalidateSubscriptionCache(organizationId)
}

before(async () => {
  assert.ok(await initDatabaseSchema(), "base de test initialisée")
  pool = getPool() as Pool

  const app = createApiApp()
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`

  organizationId = (await pool.query("SELECT id FROM organizations LIMIT 1")).rows[0].id
  await pool.query("UPDATE users SET platform_admin = (email = 'demo@washpilot.ci')")

  for (const email of ["demo@washpilot.ci", "gerant@washpilot.ci", "caisse@washpilot.ci"]) {
    await login(email)
  }
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await closeDatabase()
})

test("un essai expiré peut encore ouvrir une intention de paiement", async () => {
  // Le point crucial : lecture seule ne doit pas vouloir dire « impossible de
  // payer ». Un client bloqué qui ne peut pas souscrire est un client perdu.
  await resetSubscription("trialing", "starter", -3)
  const state = await (await api("/api/v1/subscription", { as: "demo@washpilot.ci" })).json()
  assert.equal(state.read_only, true, "la station est bien en lecture seule")

  const response = await api("/api/v1/subscription/checkout", {
    as: "demo@washpilot.ci",
    method: "POST",
    body: { plan_code: "pro", months: 1 },
  })
  assert.equal(response.status, 201)
  const intent = await response.json()
  assert.match(intent.reference, /^WP-[A-Z2-9]{8}$/)
  assert.equal(intent.amount_cents, 2_000_000)
  assert.equal(intent.provider, "manual")
})

test("le montant suit la durée achetée", async () => {
  const response = await api("/api/v1/subscription/checkout", {
    as: "demo@washpilot.ci",
    method: "POST",
    body: { plan_code: "business", months: 3 },
  })
  assert.equal((await response.json()).amount_cents, 3_500_000 * 3)
})

test("cliquer deux fois ne crée pas deux références", async () => {
  // Sinon le client en paie une et personne ne sait laquelle.
  const first = await (
    await api("/api/v1/subscription/checkout", {
      as: "demo@washpilot.ci",
      method: "POST",
      body: { plan_code: "pro", months: 1 },
    })
  ).json()
  const second = await (
    await api("/api/v1/subscription/checkout", {
      as: "demo@washpilot.ci",
      method: "POST",
      body: { plan_code: "pro", months: 1 },
    })
  ).json()
  assert.equal(first.reference, second.reference)
})

test("déclarer un paiement n'active rien", async () => {
  // Une déclaration est une affirmation du client, pas une preuve.
  const intent = await (
    await api("/api/v1/subscription/checkout", {
      as: "demo@washpilot.ci",
      method: "POST",
      body: { plan_code: "pro", months: 1 },
    })
  ).json()

  const declared = await api(`/api/v1/subscription/checkout/${intent.reference}/declare`, {
    as: "demo@washpilot.ci",
    method: "POST",
    body: { transaction_reference: "OM-77412093", paid_with: "Orange Money" },
  })
  assert.equal(declared.status, 200)

  const state = await (await api("/api/v1/subscription", { as: "demo@washpilot.ci" })).json()
  assert.equal(state.read_only, true, "toujours en lecture seule tant que rien n'est vérifié")
  assert.notEqual(state.plan_code, "pro")
})

test("l'éditeur voit la déclaration dans sa file, et valide en un clic", async () => {
  const file = await (
    await api("/api/v1/admin/payment-intents?declared=true", { as: "demo@washpilot.ci" })
  ).json()
  const intent = file.intents[0]
  assert.equal(intent.declared_reference, "OM-77412093")
  assert.equal(intent.organization_name.length > 0, true)
  assert.equal(intent.plan_code, "pro")

  const confirmed = await api(`/api/v1/admin/payment-intents/${intent.reference}/confirm`, {
    as: "demo@washpilot.ci",
    method: "POST",
    body: {},
  })
  assert.equal(confirmed.status, 200)

  // L'effet doit être immédiat côté client.
  const state = await (await api("/api/v1/subscription", { as: "demo@washpilot.ci" })).json()
  assert.equal(state.plan_code, "pro")
  assert.equal(state.status, "active")
  assert.equal(state.read_only, false)
})

test("une validation déjà faite ne se rejoue pas", async () => {
  const file = await (
    await api("/api/v1/admin/payment-intents?status=paid", { as: "demo@washpilot.ci" })
  ).json()
  const reference = file.intents[0].reference

  const replay = await api(`/api/v1/admin/payment-intents/${reference}/confirm`, {
    as: "demo@washpilot.ci",
    method: "POST",
    body: {},
  })
  assert.equal(replay.status, 404, "le second appel ne doit pas activer un mois de plus")
})

test("deux validations simultanées n'activent qu'un seul mois", async () => {
  // Le cas qui n'arrive jamais en test manuel et toujours en production :
  // double clic, ou webhook rejoué pendant que l'éditeur valide.
  await resetSubscription("trialing", "starter", 5)
  const intent = await (
    await api("/api/v1/subscription/checkout", {
      as: "demo@washpilot.ci",
      method: "POST",
      body: { plan_code: "pro", months: 1 },
    })
  ).json()

  const [a, b] = await Promise.all([
    api(`/api/v1/admin/payment-intents/${intent.reference}/confirm`, {
      as: "demo@washpilot.ci",
      method: "POST",
      body: {},
    }),
    api(`/api/v1/admin/payment-intents/${intent.reference}/confirm`, {
      as: "demo@washpilot.ci",
      method: "POST",
      body: {},
    }),
  ])
  const codes = [a.status, b.status].sort()
  assert.deepEqual(codes, [200, 404], "exactement une des deux doit aboutir")

  const activations = await pool.query(
    `SELECT count(*)::int AS n FROM audit_logs
      WHERE organization_id = $1::uuid
        AND action = 'subscription.activated'
        AND metadata->>'intent_reference' = $2`,
    [organizationId, intent.reference],
  )
  assert.equal(activations.rows[0].n, 1, "une seule activation journalisée")
})

test("un caissier ne peut pas souscrire", async () => {
  const response = await api("/api/v1/subscription/checkout", {
    as: "caisse@washpilot.ci",
    method: "POST",
    body: { plan_code: "pro", months: 1 },
  })
  assert.equal(response.status, 403)
})

test("une station ne voit pas l'intention d'une autre", async () => {
  const response = await api("/api/v1/subscription/checkout/WP-ZZZZZZZZ/declare", {
    as: "demo@washpilot.ci",
    method: "POST",
    body: { transaction_reference: "FAUX-123" },
  })
  assert.equal(response.status, 404)
})

test("la file de validation reste fermée aux clients", async () => {
  assert.equal((await api("/api/v1/admin/payment-intents", { as: "gerant@washpilot.ci" })).status, 404)
})

test("une référence mal formée est refusée proprement, pas en erreur serveur", async () => {
  const response = await api("/api/v1/admin/payment-intents/pas-une-reference/confirm", {
    as: "demo@washpilot.ci",
    method: "POST",
    body: {},
  })
  assert.ok(response.status >= 400 && response.status < 500, `attendu 4xx, reçu ${response.status}`)
})
