import express from "express"
import type { NextFunction, Request, Response } from "express"
import cors from "cors"
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { env } from "./server/env.ts"
import { initDatabaseSchema, isDatabaseReady, closeDatabase } from "./server/db.ts"
import { HttpError, requireSession } from "./server/auth.ts"
import { requireTenantContext } from "./server/tenant.ts"
import { createAuthRouter } from "./server/auth-router.ts"
import { createOnboardingRouter } from "./server/onboarding.ts"
import { createApiRouter } from "./server/api.ts"
import { createOperationsRouter } from "./server/operations.ts"
import { createTeamRouter } from "./server/team.ts"
import { createReportsRouter } from "./server/reports.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const app = express()
const port = env.PORT

app.disable("x-powered-by")
app.set("trust proxy", 1)

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
  next()
})

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true)
    if (env.CORS_ORIGINS.includes(origin)) return callback(null, true)
    if (env.NODE_ENV !== "production") return callback(null, true)
    return callback(null, false)
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Idempotency-Key", "Authorization", "X-Session-Token"],
  exposedHeaders: ["Idempotency-Replayed"],
  maxAge: 600,
}))

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" })
})

app.get("/readyz", (_req, res) => {
  const missingDependencies = [
    ...(!isDatabaseReady() ? ["database"] : []),
  ]
  if (missingDependencies.length) {
    res.status(503).json({ status: "not_ready", dependencies: missingDependencies })
    return
  }
  res.status(200).json({ status: "ready" })
})

app.use(express.json({ limit: "1mb" }))

// Tenant-scoped application responses can contain personal or financial data.
app.use("/api/v1", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store")
  next()
})

// Health endpoints and /api/v1/auth/* are public (the auth router enforces
// its own session checks); every other application route requires a session.
app.use("/api/v1/auth", createAuthRouter())
app.use("/api/v1", requireSession)
app.use("/api/v1", requireTenantContext)
app.use("/api/v1", createOnboardingRouter())
app.use("/api/v1", createApiRouter())
app.use("/api/v1", createTeamRouter())
app.use("/api/v1", createReportsRouter())
app.use("/api/v1", createOperationsRouter())

app.use("/api/v1", (_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Cette route API n'existe pas." } })
})

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  void next
  let status = error instanceof HttpError ? error.status : 500
  let code = error instanceof HttpError ? error.code : "internal_error"
  let message = error instanceof HttpError
    ? error.message
    : "Une erreur interne est survenue. Réessayez dans quelques instants."

  if (!(error instanceof HttpError) && typeof error === "object" && error !== null && "type" in error) {
    const parserType = (error as { type?: unknown }).type
    if (parserType === "entity.parse.failed") {
      status = 400
      code = "invalid_json"
      message = "Le corps de la requête contient un JSON invalide."
    } else if (parserType === "entity.too.large") {
      status = 413
      code = "payload_too_large"
      message = "Le corps de la requête dépasse la taille maximale autorisée."
    } else if (parserType === "encoding.unsupported" || parserType === "charset.unsupported") {
      status = 415
      code = "unsupported_request_encoding"
      message = "L'encodage de la requête n'est pas pris en charge."
    } else if (parserType === "request.aborted") {
      status = 400
      code = "request_aborted"
      message = "La requête a été interrompue avant sa réception complète."
    }
  }

  if (!(error instanceof HttpError) && typeof error === "object" && error !== null && "code" in error) {
    const databaseCode = (error as { code?: string }).code
    if (databaseCode === "23505") {
      status = 409
      code = "resource_conflict"
      message = "Cette ressource existe déjà dans votre organisation."
    } else if (databaseCode === "23503") {
      status = 400
      code = "invalid_reference"
      message = "Une ressource associée est introuvable ou n'appartient pas à cette organisation."
    } else if (databaseCode === "23514" || databaseCode === "22P02" || databaseCode === "22003") {
      status = 400
      code = "invalid_data"
      message = "Les données envoyées ne respectent pas les contraintes requises."
    } else if (databaseCode === "40001" || databaseCode === "40P01") {
      status = 503
      code = "transaction_retry"
      message = "Conflit temporaire de transaction. Réessayez l'opération."
    }
  }

  if (status >= 500) {
    console.error("[api] Request failed:", error instanceof Error ? error.message : "Unknown API error")
  }
  // Development aid: surface auth/tenant failures so session issues are diagnosable.
  if (env.NODE_ENV !== "production" && (status === 401 || status === 403)) {
    const cookieNames = (_req.get("cookie") || "").split(";").map(v => v.split("=")[0].trim()).filter(Boolean).join(",") || "none"
    const hasAuth = Boolean(_req.get("authorization"))
    const hasCustom = Boolean(_req.get("x-session-token"))
    console.warn(`[auth] ${status} ${code} on ${_req.method} ${_req.originalUrl} | cookies:[${cookieNames}] authHeader:${hasAuth} xSessionToken:${hasCustom} ua:${(_req.get("user-agent") || "?").slice(0, 40)}`)
  }
  res.status(status).json({ error: { code, message } })
})

async function startServer() {
  const isProd = env.NODE_ENV === "production"
  const distPath = path.resolve(__dirname, "dist")

  const databaseReady = await initDatabaseSchema()
  if (isProd && !databaseReady) {
    throw new Error("DATABASE_URL is required in production; refusing to start without Neon.")
  }

  if (!isProd && process.env.ENABLE_LEGACY_DEMO_API === "true") {
    console.warn("[demo] Static mock data endpoints have been removed. ENABLE_LEGACY_DEMO_API is ignored.")
  }

  if (!isProd) {
    const { createServer: createViteServer } = await import("vite")
    const vite = await createViteServer({
      server: { middlewareMode: true, host: "0.0.0.0", port, allowedHosts: true },
      appType: "spa",
    })
    app.use(vite.middlewares)
  } else {
    if (!fs.existsSync(path.join(distPath, "index.html"))) {
      throw new Error("The production frontend build is missing; run npm run build before starting the server.")
    }
    app.use(express.static(distPath))
    app.use((_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"))
    })
  }

  const server = app.listen(port, "0.0.0.0", () => {
    console.info(`WashPilot CI server listening on 0.0.0.0:${port}`)
  })

  const shutdown = (signal: string) => {
    console.info(`[server] ${signal} received; shutting down gracefully.`)
    server.close((error) => {
      if (error) {
        console.error("[server] Error closing HTTP server:", error)
        process.exitCode = 1
      }
      void closeDatabase().finally(() => process.exit())
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.once("SIGINT", () => shutdown("SIGINT"))
  process.once("SIGTERM", () => shutdown("SIGTERM"))
}

startServer().catch((error) => {
  console.error("Failed to start server:", error)
  process.exit(1)
})
