import { test } from "node:test"
import assert from "node:assert/strict"
import { parseReportRange } from "../server/reports.ts"

test("parseReportRange accepts a valid range", () => {
  const range = parseReportRange({ from: "2026-01-01", to: "2026-01-31" })
  assert.deepEqual(range, { from: "2026-01-01", to: "2026-01-31" })
})

test("parseReportRange accepts a single-day range", () => {
  const range = parseReportRange({ from: "2026-10-19", to: "2026-10-19" })
  assert.equal(range.from, range.to)
})

test("parseReportRange rejects an inverted range", () => {
  assert.throws(() => parseReportRange({ from: "2026-02-01", to: "2026-01-01" }))
})

test("parseReportRange rejects malformed dates", () => {
  assert.throws(() => parseReportRange({ from: "2026-1-1", to: "2026-01-31" }))
  assert.throws(() => parseReportRange({ from: "not-a-date", to: "2026-01-31" }))
  assert.throws(() => parseReportRange({ from: "2026-02-30", to: "2026-03-01" }))
})

test("parseReportRange rejects ranges longer than a year", () => {
  assert.throws(() => parseReportRange({ from: "2024-01-01", to: "2026-01-01" }))
})
