import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, "..")
const environmentAtProcessStart = new Map(Object.entries(process.env))

function loadEnvFile(filename: string, overrideExisting = false) {
  const filePath = path.join(rootDir, filename)
  if (!fs.existsSync(filePath)) return

  const content = fs.readFileSync(filePath, "utf-8")
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eqIndex = line.indexOf("=")
    if (eqIndex <= 0) continue

    const key = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    // Actual process settings always win; otherwise .env.local can override .env.
    const processValue = environmentAtProcessStart.get(key)
    if (processValue) continue
    if (overrideExisting || !process.env[key]) process.env[key] = value
  }
}

try {
  loadEnvFile(".env")
  loadEnvFile(".env.local", true)
} catch (error) {
  console.warn("[env] Unable to load local environment files:", error)
}

export const env = {
  PORT: (() => {
    const configured = Number(process.env.PORT)
    return Number.isInteger(configured) && configured >= 1 && configured <= 65_535 ? configured : 3000
  })(),
  NODE_ENV: process.env.NODE_ENV || "development",
  DATABASE_URL: (process.env.DATABASE_URL || "").trim(),
  PG_POOL_MAX: (() => {
    const configured = Number(process.env.PG_POOL_MAX)
    return Number.isInteger(configured) && configured >= 1 && configured <= 50 ? configured : 10
  })(),
  CLERK_SECRET_KEY: (process.env.CLERK_SECRET_KEY || "").trim(),
  CLERK_JWT_KEY: (process.env.CLERK_JWT_KEY || "").trim(),
  VITE_CLERK_PUBLISHABLE_KEY: (
    process.env.VITE_CLERK_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    process.env.CLERK_PUBLISHABLE_KEY ||
    ""
  ).trim(),
  CLERK_WEBHOOK_SIGNING_SECRET: (
    process.env.CLERK_WEBHOOK_SIGNING_SECRET ||
    process.env.CLERK_WEBHOOK_SECRET ||
    ""
  ).trim(),
  CLERK_AUTHORIZED_PARTIES: (process.env.CLERK_AUTHORIZED_PARTIES || "")
    .split(",")
    .map((party) => party.trim())
    .filter(Boolean),
  CORS_ORIGINS: (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
}
