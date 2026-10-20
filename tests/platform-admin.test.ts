import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import type { Server } from "node:http"
import type { Pool } from "pg"
import { readdir, readFile } from "node:fs/promises"
import { initDatabaseSchema, getPool, closeDatabase } from "../server/db.ts"
import { createApiApp } from "../server/app.ts"
import { invalidateSubscriptionCache } from "../server/entitlements.ts"

// ---------------------------------------------------------------------------
// Back-office de l'éditeur
//
// C'est la seule surface de l'API qui franchit volontairement l'isolation
// entre clients : elle écrit chez autrui. Les tests portent donc d'abord sur
// le refus, et seulement ensuite sur la fonctionnalité.
//
// Le drapeau `platform_admin` est posé directement en base, jamais par une
// route : aucune n'existe, et c'est précisément ce qu'un des tests vérifie.
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

/** Remet l'abonnement de la station de démonstration dans un état connu. */
async function resetSubscription(status: string, planCode: string, daysLeft: number) {
  await pool.query(
    `UPDATE subscriptions
        SET plan_id = (SELECT id FROM plans WHERE code = $2),
            status = $1,
            current_period_end = now() + ($3 || ' days')::interval,
            plan_changed_at = now()
      WHERE organization_id = $4::uuid`,
    [status, planCode, String(daysLeft), organizationId],
  )
  invalidateSubscriptionCache(organizationId)
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

  const org = await pool.query("SELECT id FROM organizations LIMIT 1")
  organizationId = org.rows[0].id

  // Le propriétaire de démonstration devient administrateur de plateforme :
  // c'est ce que ferait PLATFORM_ADMIN_EMAILS au démarrage.
  await pool.query("UPDATE users SET platform_admin = true WHERE email = 'demo@washpilot.ci'")
  await pool.query("UPDATE users SET platform_admin = false WHERE email <> 'demo@washpilot.ci'")

  for (const email of ["demo@washpilot.ci", "gerant@washpilot.ci", "caisse@washpilot.ci"]) {
    await login(email)
  }
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await closeDatabase()
})

// ---------------------------------------------------------------------------
// 1. Le refus d'abord
// ---------------------------------------------------------------------------

test("le back-office est invisible pour un compte ordinaire", async () => {
  // 404 et non 403 : un 403 confirmerait qu'il y a quelque chose à cette
  // adresse. Pour un utilisateur ordinaire, le back-office n'existe pas.
  for (const path of [
    "/api/v1/admin/metrics",
    "/api/v1/admin/organizations",
    "/api/v1/admin/upgrade-requests",
    "/api/v1/admin/plans",
  ]) {
    for (const who of ["gerant@washpilot.ci", "caisse@washpilot.ci"]) {
      const response = await api(path, { as: who })
      assert.equal(response.status, 404, `${who} sur ${path}`)
      assert.equal((await response.json()).error.code, "not_found")
    }
  }
})

test("un propriétaire de station ne peut pas activer son propre forfait", async () => {
  // Le scénario qui compte : le client a tout intérêt à s'offrir le forfait
  // Business. `subscription:manage` ne doit rien y changer.
  const response = await api(`/api/v1/admin/organizations/${organizationId}/activate`, {
    as: "gerant@washpilot.ci",
    method: "POST",
    body: { plan_code: "business", months: 12 },
  })
  assert.equal(response.status, 404)

  const state = await (await api("/api/v1/subscription", { as: "demo@washpilot.ci" })).json()
  assert.notEqual(state.plan_code, "business", "le forfait ne doit pas avoir changé")
})

test("sans session, le back-office répond 401", async () => {
  assert.equal((await api("/api/v1/admin/metrics")).status, 401)
})

test("aucune route n'accorde le droit d'administration", async () => {
  // Le drapeau ne s'obtient que par PLATFORM_ADMIN_EMAILS au démarrage. S'il
  // devenait délégable depuis l'application, le premier propriétaire curieux
  // obtiendrait la lecture et l'écriture sur toutes les autres stations.
  //
  // La garantie se vérifie à la source : une seule fonction écrit cette
  // colonne, et elle n'est atteignable par aucune requête HTTP.
  const files = await readdir(new URL("../server/", import.meta.url))
  const writers: string[] = []
  for (const file of files.filter((f) => f.endsWith(".ts"))) {
    const source = await readFile(new URL(`../server/${file}`, import.meta.url), "utf8")
    for (const line of source.split("\n")) {
      if (/platform_admin/.test(line) && /\b(UPDATE|INSERT|SET)\b/.test(line)) {
        writers.push(file)
        break
      }
    }
  }
  assert.deepEqual(
    [...new Set(writers)],
    ["db.ts"],
    "seul syncPlatformAdmins() doit écrire platform_admin",
  )

  // Et à l'exécution : une tentative passée par les routes qui touchent aux
  // comptes ne doit pas poser le drapeau.
  await api("/api/v1/auth/profile", {
    as: "gerant@washpilot.ci",
    method: "PATCH",
    body: { full_name: "Kofi Mensah", platform_admin: true },
  })
  const q = await pool.query("SELECT platform_admin FROM users WHERE email = 'gerant@washpilot.ci'")
  assert.equal(q.rows[0].platform_admin, false)
})

// ---------------------------------------------------------------------------
// 2. L'activation — la marche qui manquait
// ---------------------------------------------------------------------------

test("l'administrateur active un forfait payant, et la capacité suit", async () => {
  await resetSubscription("trialing", "starter", 3)

  // En Starter, l'historique est refusé par le forfait.
  assert.equal((await api("/api/v1/audit-logs", { as: "demo@washpilot.ci" })).status, 402)

  const response = await api(`/api/v1/admin/organizations/${organizationId}/activate`, {
    as: "demo@washpilot.ci",
    method: "POST",
    body: { plan_code: "pro", months: 3, payment_reference: "WAVE-884213" },
  })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.plan_code, "pro")
  assert.equal(result.status, "active")

  // L'effet doit être réel côté client, pas seulement en base.
  const state = await (await api("/api/v1/subscription", { as: "demo@washpilot.ci" })).json()
  assert.equal(state.plan_code, "pro")
  assert.equal(state.status, "active")
  assert.equal(state.read_only, false)
  assert.equal((await api("/api/v1/audit-logs", { as: "demo@washpilot.ci" })).status, 200)
})

test("l'activation est inscrite au journal de la station, pas ailleurs", async () => {
  // Le propriétaire doit pouvoir constater l'intervention chez lui : une
  // action de l'éditeur invisible du client serait une porte dérobée.
  const logs = await (
    await api("/api/v1/audit-logs?action=subscription.activated", { as: "demo@washpilot.ci" })
  ).json()
  assert.ok(logs.entries.length > 0, "l'activation figure dans l'historique du client")
  const entry = logs.entries[0]
  assert.equal(entry.metadata.by, "platform_admin")
  assert.equal(entry.metadata.plan_code, "pro")
  assert.equal(entry.metadata.payment_reference, "WAVE-884213")
})

test("un renouvellement anticipé ne fait pas perdre les jours payés", async () => {
  await resetSubscription("active", "pro", 20)
  const before = await (
    await api(`/api/v1/admin/organizations/${organizationId}`, { as: "demo@washpilot.ci" })
  ).json()
  const previousEnd = new Date(before.organization.current_period_end).getTime()

  await api(`/api/v1/admin/organizations/${organizationId}/activate`, {
    as: "demo@washpilot.ci",
    method: "POST",
    body: { plan_code: "pro", months: 1 },
  })

  const after = await (
    await api(`/api/v1/admin/organizations/${organizationId}`, { as: "demo@washpilot.ci" })
  ).json()
  const newEnd = new Date(after.organization.current_period_end).getTime()
  assert.ok(
    newEnd > previousEnd + 25 * 86_400_000,
    "le mois ajouté doit partir de l'échéance en cours, pas d'aujourd'hui",
  )
})

test("activer un forfait inconnu est refusé", async () => {
  const response = await api(`/api/v1/admin/organizations/${organizationId}/activate`, {
    as: "demo@washpilot.ci",
    method: "POST",
    body: { plan_code: "platine", months: 1 },
  })
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error.code, "plan_not_found")
})

// ---------------------------------------------------------------------------
// 3. Suspension et geste commercial
// ---------------------------------------------------------------------------

test("la suspension passe la station en lecture seule sans rien détruire", async () => {
  await resetSubscription("active", "pro", 30)

  const response = await api(`/api/v1/admin/organizations/${organizationId}/suspend`, {
    as: "demo@washpilot.ci",
    method: "POST",
    body: { reason: "Impayé : deux relances sans réponse" },
  })
  assert.equal(response.status, 200)

  const state = await (await api("/api/v1/subscription", { as: "demo@washpilot.ci" })).json()
  assert.equal(state.read_only, true)

  // Lecture et export restent ouverts : on suspend un service, on ne retient
  // pas les données d'un client.
  assert.equal((await api("/api/v1/washes", { as: "demo@washpilot.ci" })).status, 200)
  assert.equal((await api("/api/v1/backup/export", { as: "demo@washpilot.ci" })).status, 200)
})

test("un motif est exigé pour suspendre", async () => {
  const response = await api(`/api/v1/admin/organizations/${organizationId}/suspend`, {
    as: "demo@washpilot.ci",
    method: "POST",
    body: { reason: "x" },
  })
  assert.equal(response.status, 400)
})

test("prolonger un essai échu repart d'aujourd'hui", async () => {
  await resetSubscription("trialing", "starter", -5)

  const response = await api(`/api/v1/admin/organizations/${organizationId}/extend-trial`, {
    as: "demo@washpilot.ci",
    method: "POST",
    body: { days: 7, reason: "Installation retardée, matériel non livré" },
  })
  assert.equal(response.status, 200)

  const state = await (await api("/api/v1/subscription", { as: "demo@washpilot.ci" })).json()
  assert.equal(state.status, "trialing")
  assert.equal(state.read_only, false)
  // 7 jours pleins, et non 2 (7 ajoutés à une échéance vieille de 5 jours).
  assert.ok(
    state.days_remaining >= 6 && state.days_remaining <= 7,
    `essai relancé à 7 jours, reçu ${state.days_remaining}`,
  )
})

test("prolonger l'essai d'un forfait payant est refusé", async () => {
  // Le repasser en essai effacerait ce que le client a payé.
  await resetSubscription("active", "business", 60)

  const response = await api(`/api/v1/admin/organizations/${organizationId}/extend-trial`, {
    as: "demo@washpilot.ci",
    method: "POST",
    body: { days: 30, reason: "Geste commercial" },
  })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error.code, "subscription_active")

  const state = await (await api("/api/v1/subscription", { as: "demo@washpilot.ci" })).json()
  assert.equal(state.plan_code, "business")
  assert.equal(state.status, "active")
})

// ---------------------------------------------------------------------------
// 4. Le parc
// ---------------------------------------------------------------------------

test("la liste du parc montre l'état effectif, pas le statut stocké", async () => {
  // Un essai dont l'échéance est passée vaut « expired » pour l'application.
  // Le back-office doit dire la même chose : deux vérités divergentes seraient
  // pires que pas de back-office du tout.
  await resetSubscription("trialing", "starter", -1)

  const data = await (
    await api("/api/v1/admin/organizations", { as: "demo@washpilot.ci" })
  ).json()
  const organization = data.organizations.find(
    (o: { id: string }) => o.id === organizationId,
  )
  assert.equal(organization.stored_status, "trialing")
  assert.equal(organization.status, "expired")
  assert.equal(organization.read_only, true)
})

test("une échéance dépassée est signalée, jamais coupée d'office", async () => {
  await resetSubscription("active", "pro", -10)

  const metrics = await (await api("/api/v1/admin/metrics", { as: "demo@washpilot.ci" })).json()
  assert.ok(metrics.past_due >= 1, "l'échéance dépassée remonte dans les indicateurs")

  const data = await (
    await api("/api/v1/admin/organizations?status=past_due", { as: "demo@washpilot.ci" })
  ).json()
  const organization = data.organizations.find((o: { id: string }) => o.id === organizationId)
  assert.ok(organization, "la station apparaît dans le filtre « échéance dépassée »")
  assert.equal(organization.past_due, true)
  assert.ok(organization.days_past_due >= 9)

  // Mais le client écrit toujours : la décision de couper revient à un humain.
  const state = await (await api("/api/v1/subscription", { as: "demo@washpilot.ci" })).json()
  assert.equal(state.read_only, false)
})

test("le revenu mensuel ne compte que les forfaits réellement actifs", async () => {
  await resetSubscription("active", "pro", 30)
  const active = await (await api("/api/v1/admin/metrics", { as: "demo@washpilot.ci" })).json()
  assert.equal(active.mrr_cents, 2_000_000, "Pro à 20 000 F")

  await resetSubscription("trialing", "business", 10)
  const trial = await (await api("/api/v1/admin/metrics", { as: "demo@washpilot.ci" })).json()
  assert.equal(trial.mrr_cents, 0, "un essai ne rapporte rien")
})

// ---------------------------------------------------------------------------
// 5. Répondre aux demandes : valider ou décliner
// ---------------------------------------------------------------------------

/** Dépose une demande d'activation comme le ferait un client. */
async function requestUpgrade(planCode: string) {
  const response = await api("/api/v1/support/upgrade-request", {
    as: "demo@washpilot.ci",
    method: "POST",
    body: { plan_code: planCode, note: "Je veux passer au forfait supérieur" },
  })
  assert.ok(response.ok, `demande déposée (${response.status})`)
}

test("une demande déclinée cesse d'être en attente", async () => {
  await resetSubscription("trialing", "starter", 5)
  const before = await (await api("/api/v1/admin/metrics", { as: "demo@washpilot.ci" })).json()

  await requestUpgrade("pro")
  const during = await (await api("/api/v1/admin/metrics", { as: "demo@washpilot.ci" })).json()
  assert.equal(during.pending_requests, before.pending_requests + 1)

  const list = await (
    await api("/api/v1/admin/upgrade-requests", { as: "demo@washpilot.ci" })
  ).json()
  const request = list.requests[0]

  const response = await api(`/api/v1/admin/upgrade-requests/${request.id}/decline`, {
    as: "demo@washpilot.ci",
    method: "POST",
    body: { reason: "Paiement non reçu à ce jour" },
  })
  assert.equal(response.status, 200)

  // Le compteur retombe : sans cela, le tableau de bord accumulerait un
  // décompte que plus personne ne regarderait.
  const after = await (await api("/api/v1/admin/metrics", { as: "demo@washpilot.ci" })).json()
  assert.equal(after.pending_requests, before.pending_requests)
})

test("un refus ne touche pas à l'abonnement de la station", async () => {
  await resetSubscription("trialing", "starter", 9)
  await requestUpgrade("business")
  const list = await (
    await api("/api/v1/admin/upgrade-requests", { as: "demo@washpilot.ci" })
  ).json()

  await api(`/api/v1/admin/upgrade-requests/${list.requests[0].id}/decline`, {
    as: "demo@washpilot.ci",
    method: "POST",
    body: { reason: "Doublon" },
  })

  const state = await (await api("/api/v1/subscription", { as: "demo@washpilot.ci" })).json()
  assert.equal(state.plan_code, "starter")
  assert.equal(state.status, "trialing")
  assert.equal(state.read_only, false)
})

test("le client voit le refus dans son propre historique", async () => {
  await resetSubscription("active", "pro", 30) // pour que audit:read soit permis
  const logs = await (
    await api("/api/v1/audit-logs?action=subscription.request_declined", {
      as: "demo@washpilot.ci",
    })
  ).json()
  assert.ok(logs.entries.length > 0, "le refus est inscrit chez le client")
  assert.equal(logs.entries[0].metadata.by, "platform_admin")
  assert.ok(logs.entries[0].metadata.reason.length > 0, "le motif est conservé")
})

test("décliner une demande inexistante répond 404", async () => {
  const response = await api(
    "/api/v1/admin/upgrade-requests/00000000-0000-0000-0000-000000000000/decline",
    { as: "demo@washpilot.ci", method: "POST", body: { reason: "Essai" } },
  )
  assert.equal(response.status, 404)
})

test("le refus reste réservé à l'éditeur", async () => {
  const response = await api(
    "/api/v1/admin/upgrade-requests/00000000-0000-0000-0000-000000000000/decline",
    { as: "gerant@washpilot.ci", method: "POST", body: { reason: "Essai" } },
  )
  assert.equal(response.status, 404)
  assert.equal((await response.json()).error.code, "not_found")
})
