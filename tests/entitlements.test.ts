import test from "node:test"
import assert from "node:assert/strict"
import {
  TRIAL_DAYS,
  EXPIRED_REPORT_WINDOW_DAYS,
  computeSubscriptionState,
  clampReportRange,
} from "../server/entitlements.ts"

const DAY = 86_400_000
const NOW = new Date("2026-10-20T12:00:00.000Z")

/** Abonnement d'essai dont l'échéance tombe dans `days` jours. */
function trialEndingIn(days: number) {
  return {
    status: "trialing",
    current_period_end: new Date(NOW.getTime() + days * DAY),
    plan_code: "free",
    plan_price_cents: 0,
    plan_features: { "reports.advanced": false, "reports.export": false, "sites.multiple": false },
    now: NOW,
  }
}

test("l'essai gratuit dure 14 jours", () => {
  assert.equal(TRIAL_DAYS, 14)
})

test("un essai qui vient de démarrer laisse 14 jours et tout est autorisé", () => {
  const state = computeSubscriptionState(trialEndingIn(TRIAL_DAYS))

  assert.equal(state.status, "trialing")
  assert.equal(state.is_trial, true)
  assert.equal(state.is_expired, false)
  assert.equal(state.read_only, false)
  assert.equal(state.days_remaining, 14)
  assert.equal(state.ms_remaining, TRIAL_DAYS * DAY)
  assert.equal(state.progress, 0)
  assert.equal(state.capabilities["washes.create"], true)
  assert.equal(state.capabilities["cash.manage"], true)
  assert.deepEqual(state.restricted, ["sites.multiple"])
})

test("l'essai débloque les rapports avancés même sur le forfait Gratuit", () => {
  const state = computeSubscriptionState(trialEndingIn(5))

  assert.equal(state.capabilities["reports.advanced"], true)
  assert.equal(state.capabilities["reports.export"], true)
  // Limite structurelle du forfait : elle n'est pas levée par l'essai.
  assert.equal(state.capabilities["sites.multiple"], false)
})

test("à mi-parcours la progression vaut la moitié", () => {
  const state = computeSubscriptionState(trialEndingIn(7))

  assert.equal(state.days_remaining, 7)
  assert.ok(Math.abs(state.progress - 0.5) < 0.001)
  assert.equal(state.trial_started_at, new Date(NOW.getTime() - 7 * DAY).toISOString())
})

test("passé le délai, l'espace bascule en lecture seule", () => {
  const state = computeSubscriptionState(trialEndingIn(-0.5))

  assert.equal(state.status, "expired")
  assert.equal(state.is_expired, true)
  assert.equal(state.read_only, true)
  assert.equal(state.ms_remaining, 0)
  assert.equal(state.days_remaining, 0)
  assert.equal(state.progress, 1)
  assert.equal(state.report_window_days, EXPIRED_REPORT_WINDOW_DAYS)
})

test("en lecture seule, les écritures et les options payantes sont coupées", () => {
  const state = computeSubscriptionState(trialEndingIn(-1))

  for (const capability of [
    "washes.create",
    "washes.cancel",
    "expenses.manage",
    "cash.manage",
    "catalog.manage",
    "team.manage",
    "reports.export",
    "reports.advanced",
  ] as const) {
    assert.equal(state.capabilities[capability], false, `${capability} devrait être bloquée`)
  }
  assert.equal(state.restricted.length, 9)
})

test("l'échéance exacte compte comme expirée", () => {
  const state = computeSubscriptionState(trialEndingIn(0))
  assert.equal(state.status, "expired")
  assert.equal(state.read_only, true)
})

test("un forfait payant actif n'est jamais restreint par l'essai", () => {
  const state = computeSubscriptionState({
    status: "active",
    current_period_end: null,
    plan_code: "pro",
    plan_price_cents: 1000000,
    plan_features: { "reports.advanced": true, "reports.export": true, "sites.multiple": false },
    now: NOW,
  })

  assert.equal(state.status, "active")
  assert.equal(state.is_trial, false)
  assert.equal(state.read_only, false)
  assert.equal(state.trial_ends_at, null)
  assert.equal(state.capabilities["washes.create"], true)
  assert.equal(state.capabilities["reports.export"], true)
  assert.equal(state.capabilities["sites.multiple"], false)
})

test("un forfait payant en attente de validation reste utilisable", () => {
  const state = computeSubscriptionState({
    status: "pending",
    current_period_end: null,
    plan_code: "pro",
    plan_price_cents: 1000000,
    plan_features: { "reports.advanced": true },
    now: NOW,
  })

  assert.equal(state.status, "pending")
  assert.equal(state.read_only, false)
  assert.equal(state.capabilities["washes.create"], true)
})

test("un abonnement résilié passe aussi en lecture seule", () => {
  const state = computeSubscriptionState({
    status: "cancelled",
    current_period_end: null,
    plan_code: "pro",
    plan_price_cents: 1000000,
    plan_features: {},
    now: NOW,
  })

  assert.equal(state.status, "cancelled")
  assert.equal(state.read_only, true)
  assert.equal(state.capabilities["expenses.manage"], false)
})

test("une organisation sans abonnement n'est pas bloquée (onboarding en cours)", () => {
  const state = computeSubscriptionState({ status: null, current_period_end: null, now: NOW })

  assert.equal(state.status, "none")
  assert.equal(state.read_only, false)
  assert.equal(state.capabilities["washes.create"], true)
})

test("un statut stocké « expired » reste expiré sans date d'échéance", () => {
  const state = computeSubscriptionState({
    status: "expired",
    current_period_end: null,
    plan_code: "free",
    plan_price_cents: 0,
    now: NOW,
  })

  assert.equal(state.read_only, true)
  assert.equal(state.progress, 1)
})

test("la période de rapport est tronquée à la fenêtre autorisée", () => {
  const today = new Date("2026-10-20T00:00:00.000Z")
  const result = clampReportRange(
    { from: "2026-09-01", to: "2026-10-20" },
    EXPIRED_REPORT_WINDOW_DAYS,
    today,
  )

  assert.equal(result.clamped, true)
  assert.equal(result.from, "2026-10-14") // 7 jours, aujourd'hui inclus
  assert.equal(result.to, "2026-10-20")
})

test("une période déjà courte n'est pas modifiée", () => {
  const today = new Date("2026-10-20T00:00:00.000Z")
  const result = clampReportRange({ from: "2026-10-18", to: "2026-10-20" }, EXPIRED_REPORT_WINDOW_DAYS, today)

  assert.equal(result.clamped, false)
  assert.equal(result.from, "2026-10-18")
})

test("sans restriction, la période demandée est conservée", () => {
  const result = clampReportRange({ from: "2026-01-01", to: "2026-10-20" }, null)

  assert.equal(result.clamped, false)
  assert.equal(result.from, "2026-01-01")
})
