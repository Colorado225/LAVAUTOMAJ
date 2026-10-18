import fs from "node:fs/promises"
import path from "node:path"
import pg from "pg"
import { fileURLToPath } from "node:url"
import { env } from "./env.ts"

const { Pool } = pg
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATION_LOCK_ID = "washpilot_schema_migrations_v1"

let poolInstance: pg.Pool | null = null
let dbReady = false

export function getPool(): pg.Pool | null {
  if (!env.DATABASE_URL) return null
  if (!poolInstance) {
    const needsSsl =
      env.DATABASE_URL.includes("neon.tech") ||
      env.DATABASE_URL.includes("sslmode=require") ||
      env.NODE_ENV === "production"

    poolInstance = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.PG_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
      ssl: needsSsl ? { rejectUnauthorized: true } : undefined,
    })

    poolInstance.on("error", (error) => {
      console.error("[db] PostgreSQL pool error:", error.message)
    })
  }
  return poolInstance
}

export function isDatabaseReady(): boolean {
  return dbReady && poolInstance !== null
}

export async function closeDatabase(): Promise<void> {
  if (!poolInstance) return
  const currentPool = poolInstance
  poolInstance = null
  dbReady = false
  await currentPool.end()
}

/** Apply additive, versioned SQL migrations exactly once (safe for concurrent starts). */
export async function initDatabaseSchema(): Promise<boolean> {
  const pool = getPool()
  if (!pool) {
    dbReady = false
    console.warn("[db] DATABASE_URL is not configured; Neon-backed routes will return 503.")
    return false
  }

  const client = await pool.connect()
  let lockAcquired = false
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [MIGRATION_LOCK_ID])
    lockAcquired = true
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_schema_migrations (
        version VARCHAR(120) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const migrationDir = path.join(__dirname, "migrations")
    const files = (await fs.readdir(migrationDir))
      .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
      .sort()

    for (const file of files) {
      const version = file.replace(/\.sql$/i, "")
      const { rowCount } = await client.query(
        "SELECT 1 FROM app_schema_migrations WHERE version = $1",
        [version]
      )
      if (rowCount) continue

      const sql = await fs.readFile(path.join(migrationDir, file), "utf8")
      console.info(`[db] Applying ${version}`)
      await client.query("BEGIN")
      try {
        await client.query(sql)
        await client.query(
          "INSERT INTO app_schema_migrations(version) VALUES ($1)",
          [version]
        )
        await client.query("COMMIT")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      }
    }

    await client.query("SELECT 1")
    dbReady = true
    console.info("[db] Neon connection ready; schema migrations are current.")
    return true
  } catch (error) {
    dbReady = false
    console.error("[db] Database initialization failed:", error instanceof Error ? error.message : "Unknown database error")
    throw error
  } finally {
    if (lockAcquired) {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_ID]).catch(() => undefined)
    }
    client.release()
  }
}
