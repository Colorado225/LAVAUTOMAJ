import assert from "node:assert/strict"
import test from "node:test"
import {
  fingerprintCashMovementInput,
  fingerprintCashSessionOpen,
  fingerprintExpenseInput,
  fingerprintWashInput,
} from "../server/operations.ts"
import { requireIdempotencyKey } from "../server/idempotency.ts"
import { onboardingValidators } from "../server/onboarding.ts"
import { assertOrganizationUserCapacity, roleFromClerkRole } from "../server/tenant.ts"
import { assertWorkerCapacity, workerValidators } from "../server/team.ts"
import { parseReportRange } from "../server/reports.ts"
import { catalogValidators } from "../server/api.ts"

const uuid = "00000000-0000-4000-8000-000000000001"
const otherUuid = "00000000-0000-4000-8000-000000000002"

test("onboarding validates required station identity before advancing", () => {
  assert.equal(onboardingValidators.station.safeParse({ name: "", city: "" }).success, false)
  assert.equal(
    onboardingValidators.station.safeParse({ name: "WashPilot Cocody", city: "Abidjan" }).success,
    true
  )
})

test("onboarding requires at least one service but permits a solo owner", () => {
  assert.equal(onboardingValidators.services.safeParse({ selected: [], custom: [] }).success, false)
  assert.equal(
    onboardingValidators.services.safeParse({
      selected: [{ template_id: uuid, name: "Lavage", price_cents: 100000 }],
      custom: [],
    }).success,
    true
  )
  assert.equal(onboardingValidators.workers.safeParse({ workers: [] }).success, true)
})

test("custom worker roles require a label", () => {
  assert.equal(
    onboardingValidators.workers.safeParse({
      workers: [{ first_name: "Awa", last_name: "Kone", role: "custom", custom_role: "" }],
    }).success,
    false
  )
  assert.equal(
    onboardingValidators.workers.safeParse({
      workers: [{ first_name: "Awa", last_name: "Kone", role: "custom", custom_role: "Superviseuse" }],
    }).success,
    true
  )
})

test("Clerk organization roles map to tenant-scoped application roles", () => {
  assert.equal(roleFromClerkRole("org:admin"), "owner")
  assert.equal(roleFromClerkRole("org:manager"), "manager")
  assert.equal(roleFromClerkRole("org:member"), "cashier")
  assert.equal(roleFromClerkRole(null), "cashier")
})

test("tenant membership creation is serialized and respects max_users", async () => {
  const calls: string[] = []
  const client = {
    query: async (sql: string) => {
      calls.push(sql)
      if (sql.includes("SELECT 1 FROM organization_members")) return { rows: [], rowCount: 0 }
      if (sql.includes("SELECT p.max_users")) {
        return { rows: [{ max_users: 2, active_count: "2" }], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    },
  } as unknown as import("pg").PoolClient

  await assert.rejects(
    assertOrganizationUserCapacity(client, uuid, otherUuid),
    { code: "plan_user_limit" }
  )
  assert.equal(calls.some((sql) => sql.includes("pg_advisory_xact_lock")), true)

  const existingMemberClient = {
    query: async (sql: string) => {
      if (sql.includes("SELECT 1 FROM organization_members")) return { rows: [{}], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
  } as unknown as import("pg").PoolClient
  await assert.doesNotReject(assertOrganizationUserCapacity(existingMemberClient, uuid, otherUuid))
})

test("wash idempotency fingerprints are stable across item and worker order", () => {
  const first: Parameters<typeof fingerprintWashInput>[0] = {
    site_id: uuid,
    vehicle_category_id: otherUuid,
    items: [
      { service_id: uuid, quantity: 1 },
      { service_id: otherUuid, quantity: 2 },
    ],
    worker_ids: [uuid, otherUuid],
    payment_method: "cash",
    amount_received_cents: 100000,
    cash_session_id: null,
  }
  const reordered: Parameters<typeof fingerprintWashInput>[0] = {
    ...first,
    items: [...first.items].reverse(),
    worker_ids: [...first.worker_ids].reverse(),
  }
  assert.equal(fingerprintWashInput(first), fingerprintWashInput(reordered))
  assert.notEqual(fingerprintWashInput(first), fingerprintWashInput({ ...first, amount_received_cents: 99999 }))
})

test("financial idempotency fingerprints bind payloads to their resource", () => {
  const opening = { site_id: uuid, opening_amount_cents: 50000 }
  assert.equal(
    fingerprintCashSessionOpen(opening),
    fingerprintCashSessionOpen({ opening_amount_cents: 50000, site_id: uuid })
  )
  assert.notEqual(fingerprintCashSessionOpen(opening), fingerprintCashSessionOpen({ ...opening, opening_amount_cents: 60000 }))

  const movement = { type: "entry" as const, amount_cents: 1000, source: "manual" as const, description: "Fond" }
  assert.equal(
    fingerprintCashMovementInput(uuid, movement),
    fingerprintCashMovementInput(uuid, { description: "Fond", source: "manual", amount_cents: 1000, type: "entry" })
  )
  assert.notEqual(fingerprintCashMovementInput(uuid, movement), fingerprintCashMovementInput(otherUuid, movement))

  const expense: Parameters<typeof fingerprintExpenseInput>[0] = {
    category: "maintenance",
    amount_cents: 25000,
    payment_method: "cash",
    site_id: uuid,
    cash_session_id: otherUuid,
  }
  assert.notEqual(fingerprintExpenseInput(expense), fingerprintExpenseInput({ ...expense, amount_cents: 25001 }))
})

test("idempotency keys are required, normalized and reject control characters", () => {
  assert.equal(requireIdempotencyKey("  client-request-1  "), "client-request-1")
  assert.throws(() => requireIdempotencyKey(undefined), { code: "idempotency_key_required" })
  assert.throws(() => requireIdempotencyKey("bad\nkey"), { code: "idempotency_key_required" })
  assert.throws(() => requireIdempotencyKey("bad\u0085key"), { code: "idempotency_key_required" })
})


test("team worker inputs validate custom roles and partial status updates", () => {
  assert.equal(workerValidators.create.safeParse({
    first_name: "Awa",
    last_name: "Koné",
    role: "car_washer",
  }).success, true)
  assert.equal(workerValidators.create.safeParse({
    first_name: "Awa",
    last_name: "Koné",
    role: "custom",
  }).success, false)
  assert.equal(workerValidators.patch.safeParse({ status: "inactive" }).success, true)
  assert.equal(workerValidators.patch.safeParse({ unknown_field: "ignored" }).success, false)
})

test("worker activation is serialized and enforces the active-worker plan limit", async () => {
  const calls: string[] = []
  const cappedClient = {
    query: async (sql: string) => {
      calls.push(sql)
      if (sql.includes("SELECT p.max_workers")) {
        return { rows: [{ max_workers: 3, active_count: "3" }], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    },
  } as unknown as import("pg").PoolClient

  await assert.rejects(assertWorkerCapacity(cappedClient, uuid), { code: "plan_worker_limit" })
  assert.equal(calls.some((sql) => sql.includes("pg_advisory_xact_lock")), true)

  const unlimitedClient = {
    query: async (sql: string) => sql.includes("SELECT p.max_workers")
      ? { rows: [{ max_workers: null, active_count: "100" }], rowCount: 1 }
      : { rows: [], rowCount: 1 },
  } as unknown as import("pg").PoolClient
  await assert.doesNotReject(assertWorkerCapacity(unlimitedClient, uuid))
})

test("reports accept bounded inclusive date ranges", () => {
  assert.deepEqual(
    parseReportRange({ from: "2026-10-01", to: "2026-10-01" }),
    { from: "2026-10-01", to: "2026-10-01" },
  )
  assert.deepEqual(
    parseReportRange({ from: "2024-01-01", to: "2024-12-31" }),
    { from: "2024-01-01", to: "2024-12-31" },
  )
  assert.throws(() => parseReportRange({ from: "2026-10-02", to: "2026-10-01" }), { code: "invalid_report_range" })
  assert.throws(() => parseReportRange({ from: "2026-02-30", to: "2026-03-01" }), { code: "invalid_report_range" })
  assert.throws(() => parseReportRange({ from: "2023-01-01", to: "2024-01-02" }), { code: "report_range_too_large" })
})


test("catalog CRUD payloads enforce bounded names, prices and optional durations", () => {
  assert.equal(catalogValidators.category.safeParse({ name: "  Premium  " }).success, true)
  assert.equal(catalogValidators.category.safeParse({ name: "" }).success, false)
  assert.equal(catalogValidators.category.safeParse({ name: "Outdoor", is_active: "false" }).success, false)

  assert.equal(catalogValidators.service.safeParse({
    name: "Lavage complet",
    price_cents: 250000,
    category_id: uuid,
    duration_minutes: 45,
    is_active: true,
  }).success, true)
  assert.equal(catalogValidators.service.safeParse({ name: "Lavage", price_cents: -1 }).success, false)
  assert.equal(catalogValidators.service.safeParse({ name: "Lavage", price_cents: 1000, duration_minutes: 0 }).success, false)
  assert.equal(catalogValidators.service.safeParse({ name: "Lavage", price_cents: 1000, duration_minutes: 1441 }).success, false)
})
