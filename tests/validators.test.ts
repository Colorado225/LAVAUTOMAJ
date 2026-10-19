import { test } from "node:test"
import assert from "node:assert/strict"
import { workerValidators } from "../server/team.ts"
import { onboardingValidators } from "../server/onboarding.ts"
import { washValidators, catalogValidators } from "../server/api.ts"
import { operationValidators } from "../server/operations.ts"

const UUID = "3f2c7a1e-9d42-4a08-a600-2f4f7a9b1c11"

// ----------------------------------------------------------------- workers --

test("workerValidators.create accepts a standard worker", () => {
  const result = workerValidators.create.safeParse({
    first_name: "Awa",
    last_name: "Koné",
    phone: "+225 07 00 00 00 00",
    district: "Cocody",
    role: "car_washer",
    custom_role: null,
    joined_at: "2026-01-15",
  })
  assert.ok(result.success)
})

test("workerValidators.create requires custom_role for custom roles", () => {
  assert.equal(workerValidators.create.safeParse({ first_name: "A", last_name: "B", role: "custom" }).success, false)
  assert.ok(workerValidators.create.safeParse({ first_name: "A", last_name: "B", role: "custom", custom_role: "Vigile" }).success)
})

test("workerValidators.patch accepts a lone status toggle", () => {
  assert.ok(workerValidators.patch.safeParse({ status: "inactive" }).success)
})

// -------------------------------------------------------------- onboarding --

test("onboarding station stage requires name and city", () => {
  assert.ok(onboardingValidators.station.safeParse({ name: "Star Wash", city: "Abidjan" }).success)
  assert.equal(onboardingValidators.station.safeParse({ name: "S", city: "Abidjan" }).success, false)
  assert.equal(onboardingValidators.station.safeParse({ name: "Star Wash", city: "" }).success, false)
})

test("onboarding services stage needs at least one service", () => {
  assert.equal(onboardingValidators.services.safeParse({ selected: [], custom: [] }).success, false)
  assert.ok(
    onboardingValidators.services.safeParse({
      selected: [{ template_id: UUID, name: "Nettoyage extérieur", price_cents: 5000 }],
      custom: [],
    }).success,
  )
  assert.ok(
    onboardingValidators.services.safeParse({
      selected: [],
      custom: [{ name: "Lavage tapis", category: "detailing", price_cents: null }],
    }).success,
  )
})

test("onboarding workers stage accepts an empty team", () => {
  assert.ok(onboardingValidators.workers.safeParse({ workers: [] }).success)
})

// ------------------------------------------------------------------ washes --

test("washValidators.create accepts a cash wash with a session", () => {
  const result = washValidators.create.safeParse({
    site_id: UUID,
    vehicle_category_id: UUID,
    items: [{ service_id: UUID, quantity: 1 }],
    worker_ids: [UUID],
    payment_method: "cash",
    amount_received_cents: 5000,
    cash_session_id: UUID,
  })
  assert.ok(result.success)
})

test("washValidators.create rejects empty items and bad quantities", () => {
  const base = { site_id: UUID, vehicle_category_id: UUID, payment_method: "cash", amount_received_cents: 0 }
  assert.equal(washValidators.create.safeParse({ ...base, items: [] }).success, false)
  assert.equal(washValidators.create.safeParse({ ...base, items: [{ service_id: UUID, quantity: 0 }] }).success, false)
  assert.equal(washValidators.create.safeParse({ ...base, items: [{ service_id: UUID, quantity: 101 }] }).success, false)
})

test("washValidators.create rejects unknown payment methods", () => {
  const result = washValidators.create.safeParse({
    site_id: UUID,
    vehicle_category_id: UUID,
    items: [{ service_id: UUID, quantity: 1 }],
    payment_method: "bitcoin",
    amount_received_cents: 0,
  })
  assert.equal(result.success, false)
})

test("washValidators.cancel requires a meaningful reason", () => {
  assert.equal(washValidators.cancel.safeParse({ reason: "ok" }).success, false)
  assert.ok(washValidators.cancel.safeParse({ reason: "Erreur de saisie du montant" }).success)
})

// ----------------------------------------------------------------- catalog --

test("catalogValidators.service bounds price and duration", () => {
  assert.ok(catalogValidators.service.safeParse({ name: "Lustrage", price_cents: 15000 }).success)
  assert.equal(catalogValidators.service.safeParse({ name: "Lustrage", price_cents: -1 }).success, false)
  assert.equal(catalogValidators.service.safeParse({ name: "Lustrage", price_cents: 1000, duration_minutes: 2000 }).success, false)
})

// -------------------------------------------------------------- operations --

test("operationValidators.movement requires a positive amount", () => {
  assert.equal(operationValidators.movement.safeParse({ type: "entry", amount_cents: 0 }).success, false)
  assert.ok(operationValidators.movement.safeParse({ type: "exit", amount_cents: 2500, description: null }).success)
})

test("operationValidators.expense accepts the UI payload shape", () => {
  const result = operationValidators.expense.safeParse({
    category: "supply",
    amount_cents: 12000,
    payment_method: "cash",
    site_id: UUID,
    beneficiary: "Fournisseur X",
    description: "Savon et chiffons",
    reference: "FACT-001",
    cash_session_id: UUID,
  })
  assert.ok(result.success)
})

test("operationValidators.expense rejects unknown categories", () => {
  assert.equal(
    operationValidators.expense.safeParse({ category: "divers", amount_cents: 100, payment_method: "cash" }).success,
    false,
  )
})
