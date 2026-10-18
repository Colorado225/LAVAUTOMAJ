import express from "express"
import type { NextFunction, Request, Response } from "express"
import cors from "cors"
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { verifyWebhook } from "@clerk/backend/webhooks"
import { env } from "./server/env.ts"
import { initDatabaseSchema, isDatabaseReady, closeDatabase, getPool } from "./server/db.ts"
import {
  getClerkOrganizationMembershipRole,
  getClerkOrganizationProfile,
  getClerkUserProfile,
  HttpError,
  invalidateClerkOrganizationCache,
  invalidateClerkOrganizationMembershipCache,
  invalidateClerkProfileCache,
  requireClerkSession,
} from "./server/auth.ts"
import {
  assertOrganizationUserCapacity,
  requireTenantContext,
  roleFromClerkRole,
} from "./server/tenant.ts"
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
    if (!origin) return callback(null, false)
    if (env.CORS_ORIGINS.includes(origin)) return callback(null, true)
    if (env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      return callback(null, true)
    }
    return callback(null, false)
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "svix-id", "svix-timestamp", "svix-signature"],
  exposedHeaders: ["Idempotency-Replayed"],
  maxAge: 600,
}))

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" })
})

app.get("/readyz", (_req, res) => {
  const missingDependencies = [
    ...(!isDatabaseReady() ? ["database"] : []),
    ...(!env.CLERK_SECRET_KEY ? ["clerk"] : []),
  ]
  if (missingDependencies.length) {
    res.status(503).json({ status: "not_ready", dependencies: missingDependencies })
    return
  }
  res.status(200).json({ status: "ready" })
})

// Clerk webhooks need the unparsed body so the signature can be verified.
app.post("/api/webhooks/clerk", express.text({ type: "application/json", limit: "1mb" }), async (req, res, next) => {
  if (!env.CLERK_WEBHOOK_SIGNING_SECRET) {
    res.status(503).json({ error: { code: "webhook_not_configured", message: "Le webhook Clerk n'est pas configuré." } })
    return
  }

  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value)
    else if (Array.isArray(value)) headers.set(name, value.join(","))
  }

  let event: Awaited<ReturnType<typeof verifyWebhook>>
  try {
    const request = new Request(`https://${req.get("host") || "localhost"}${req.originalUrl}`, {
      method: "POST",
      headers,
      body: typeof req.body === "string" ? req.body : "",
    })
    event = await verifyWebhook(request, { signingSecret: env.CLERK_WEBHOOK_SIGNING_SECRET })
  } catch (error) {
    console.warn("[webhook] Clerk signature verification failed:", error instanceof Error ? error.message : "invalid signature")
    res.status(400).json({ error: { code: "invalid_webhook_signature", message: "Signature webhook invalide." } })
    return
  }

  const eventId = req.get("svix-id") || req.get("webhook-id")
  if (!eventId) {
    res.status(400).json({ error: { code: "webhook_id_missing", message: "Identifiant webhook manquant." } })
    return
  }

  const pool = getPool()
  if (!pool) {
    res.status(503).json({ error: { code: "database_not_configured", message: "La base de données Neon n'est pas configurée." } })
    return
  }

  const duplicateEvent = await pool.query(
    `SELECT 1 FROM clerk_webhook_events WHERE id = $1 LIMIT 1`,
    [eventId]
  )
  if (duplicateEvent.rowCount) {
    res.status(200).json({ received: true, duplicate: true })
    return
  }

  const data = event.data as unknown as Record<string, unknown>
  let membershipProfiles: {
    user: Awaited<ReturnType<typeof getClerkUserProfile>>
    organization: Awaited<ReturnType<typeof getClerkOrganizationProfile>>
    role: string
  } | null = null
  if (event.type === "organizationMembership.created" || event.type === "organizationMembership.updated") {
    const publicUserData = data.public_user_data && typeof data.public_user_data === "object"
      ? data.public_user_data as Record<string, unknown>
      : {}
    const organizationData = data.organization && typeof data.organization === "object"
      ? data.organization as Record<string, unknown>
      : {}
    const clerkUserId = typeof publicUserData.user_id === "string" ? publicUserData.user_id : ""
    const clerkOrgId = typeof organizationData.id === "string"
      ? organizationData.id
      : (typeof data.organization_id === "string" ? data.organization_id : "")
    if (clerkUserId.startsWith("user_") && clerkOrgId.startsWith("org_")) {
      invalidateClerkOrganizationMembershipCache(clerkOrgId, clerkUserId)
      const [user, organization, role] = await Promise.all([
        getClerkUserProfile(clerkUserId),
        getClerkOrganizationProfile(clerkOrgId),
        getClerkOrganizationMembershipRole(clerkOrgId, clerkUserId),
      ])
      if (role) membershipProfiles = { user, organization, role }
    }
  }

  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const eventInsert = await client.query(
      `INSERT INTO clerk_webhook_events (id, event_type) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [eventId, event.type]
    )
    if (!eventInsert.rowCount) {
      await client.query("COMMIT")
      res.status(200).json({ received: true, duplicate: true })
      return
    }

    if (event.type === "user.created" || event.type === "user.updated") {
      const clerkUserId = typeof data.id === "string" ? data.id : ""
      if (clerkUserId.startsWith("user_")) {
        const emailAddresses = Array.isArray(data.email_addresses)
          ? data.email_addresses as Array<{ id?: string; email_address?: string }>
          : []
        const primaryEmailId = typeof data.primary_email_address_id === "string" ? data.primary_email_address_id : ""
        const email = emailAddresses.find((address) => address.id === primaryEmailId)?.email_address
          || emailAddresses[0]?.email_address
        if (email) {
          await client.query(
            `INSERT INTO users (clerk_user_id, email, first_name, last_name, avatar_url, status)
             VALUES ($1, $2, $3, $4, $5, 'active')
             ON CONFLICT (clerk_user_id) DO UPDATE SET
               email = EXCLUDED.email,
               first_name = EXCLUDED.first_name,
               last_name = EXCLUDED.last_name,
               avatar_url = EXCLUDED.avatar_url,
               status = CASE WHEN users.status = 'inactive' THEN users.status ELSE 'active' END,
               updated_at = NOW()`,
            [
              clerkUserId,
              email.trim().toLowerCase(),
              typeof data.first_name === "string" ? data.first_name : null,
              typeof data.last_name === "string" ? data.last_name : null,
              typeof data.image_url === "string" ? data.image_url : null,
            ]
          )
        }
        invalidateClerkProfileCache(clerkUserId)
      }
    } else if (event.type === "user.deleted") {
      const clerkUserId = typeof data.id === "string" ? data.id : ""
      if (clerkUserId.startsWith("user_")) {
        await client.query(
          `UPDATE users SET status = 'inactive', updated_at = NOW() WHERE clerk_user_id = $1`,
          [clerkUserId]
        )
        invalidateClerkProfileCache(clerkUserId)
      }
    } else if (event.type === "organization.created" || event.type === "organization.updated") {
      const organizationId = typeof data.id === "string" ? data.id : ""
      const name = typeof data.name === "string" ? data.name.trim() : ""
      if (organizationId.startsWith("org_") && name) {
        const slug = typeof data.slug === "string" ? data.slug : null
        const orgResult = await client.query<{ id: string }>(
          `INSERT INTO organizations (clerk_org_id, name, slug)
           VALUES ($1, $2, $3)
           ON CONFLICT (clerk_org_id) DO UPDATE SET
             name = CASE WHEN organizations.onboarding_completed THEN organizations.name ELSE EXCLUDED.name END,
             slug = COALESCE(organizations.slug, EXCLUDED.slug), updated_at = NOW()
           RETURNING id`,
          [organizationId, name, slug]
        )
        if (orgResult.rows[0]) {
          await client.query(
            `INSERT INTO onboarding_progress (organization_id, current_stage)
             VALUES ($1, 'station') ON CONFLICT (organization_id) DO NOTHING`,
            [orgResult.rows[0].id]
          )
        }
        invalidateClerkOrganizationCache(organizationId)
      }
    } else if (event.type === "organizationMembership.deleted") {
      const publicUserData = data.public_user_data && typeof data.public_user_data === "object"
        ? data.public_user_data as Record<string, unknown>
        : {}
      const organizationData = data.organization && typeof data.organization === "object"
        ? data.organization as Record<string, unknown>
        : {}
      const clerkUserId = typeof publicUserData.user_id === "string" ? publicUserData.user_id : ""
      const clerkOrgId = typeof organizationData.id === "string"
        ? organizationData.id
        : (typeof data.organization_id === "string" ? data.organization_id : "")
      if (clerkUserId.startsWith("user_") && clerkOrgId.startsWith("org_")) {
        await client.query(
          `DELETE FROM organization_members m
           USING users u, organizations o
           WHERE m.user_id = u.id AND m.organization_id = o.id
             AND u.clerk_user_id = $1 AND o.clerk_org_id = $2`,
          [clerkUserId, clerkOrgId]
        )
        invalidateClerkOrganizationMembershipCache(clerkOrgId, clerkUserId)
      }
    } else if (event.type === "organizationMembership.created" || event.type === "organizationMembership.updated") {
      const publicUserData = data.public_user_data && typeof data.public_user_data === "object"
        ? data.public_user_data as Record<string, unknown>
        : {}
      const organizationData = data.organization && typeof data.organization === "object"
        ? data.organization as Record<string, unknown>
        : {}
      const clerkUserId = typeof publicUserData.user_id === "string" ? publicUserData.user_id : ""
      const clerkOrgId = typeof organizationData.id === "string"
        ? organizationData.id
        : (typeof data.organization_id === "string" ? data.organization_id : "")
      if (clerkUserId.startsWith("user_") && clerkOrgId.startsWith("org_") && membershipProfiles) {
        const { user: userProfile, organization: orgProfile } = membershipProfiles
        const orgResult = await client.query<{ id: string }>(
          `INSERT INTO organizations (clerk_org_id, name, slug) VALUES ($1, $2, $3)
           ON CONFLICT (clerk_org_id) DO UPDATE SET
             name = CASE WHEN organizations.onboarding_completed THEN organizations.name ELSE EXCLUDED.name END,
             slug = COALESCE(organizations.slug, EXCLUDED.slug), updated_at = NOW()
           RETURNING id`,
          [orgProfile.id, orgProfile.name, orgProfile.slug]
        )
        const organization = orgResult.rows[0]
        if (!organization) throw new Error("Unable to synchronize the Clerk organization membership")
        const userResult = await client.query<{ id: string; status: string }>(
          `INSERT INTO users (clerk_user_id, organization_id, first_name, last_name, email, phone, avatar_url, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
           ON CONFLICT (clerk_user_id) DO UPDATE SET
             organization_id = COALESCE(users.organization_id, EXCLUDED.organization_id),
             first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
             email = EXCLUDED.email, phone = EXCLUDED.phone,
             avatar_url = EXCLUDED.avatar_url, updated_at = NOW()
           RETURNING id, status`,
          [userProfile.id, organization.id, userProfile.firstName, userProfile.lastName, userProfile.email, userProfile.phone, userProfile.avatarUrl]
        )
        const user = userResult.rows[0]
        if (user?.status === "active") {
          const role = roleFromClerkRole(membershipProfiles.role)
          let withinPlanLimit = true
          try {
            await assertOrganizationUserCapacity(client, organization.id, user.id)
          } catch (error) {
            if (error instanceof HttpError && error.code === "plan_user_limit") {
              withinPlanLimit = false
              console.warn(`[webhook] Clerk membership ${clerkUserId} is over the organization's user limit.`)
            } else {
              throw error
            }
          }
          if (withinPlanLimit) {
            await client.query(
              `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)
               ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
              [organization.id, user.id, role]
            )
            await client.query(
              `INSERT INTO onboarding_progress (organization_id, current_stage) VALUES ($1, 'station')
               ON CONFLICT (organization_id) DO NOTHING`,
              [organization.id]
            )
          }
        }
        invalidateClerkOrganizationMembershipCache(clerkOrgId, clerkUserId)
        invalidateClerkOrganizationCache(clerkOrgId)
        invalidateClerkProfileCache(clerkUserId)
      }
    }

    await client.query("COMMIT")
    res.status(200).json({ received: true })
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    console.error("[webhook] Clerk event processing failed:", error instanceof Error ? error.message : "Unknown webhook processing error")
    next(error)
  } finally {
    client.release()
  }
})

app.use(express.json({ limit: "1mb" }))

// Tenant-scoped application responses can contain personal or financial data.
app.use("/api/v1", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store")
  next()
})

// Health endpoints are public; all application API routes require a verified Clerk session.
app.use("/api/v1", requireClerkSession)
app.use("/api/v1/auth", createAuthRouter())
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
  res.status(status).json({ error: { code, message } })
})

async function startServer() {
  const isProd = env.NODE_ENV === "production"
  const distPath = path.resolve(__dirname, "dist")

  if (isProd && !env.CLERK_SECRET_KEY) {
    throw new Error("CLERK_SECRET_KEY is required in production for user synchronization.")
  }
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
