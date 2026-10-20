import express from "express"
import type { Express, NextFunction, Request, Response } from "express"
import { HttpError, requireSession } from "./auth.ts"
import { requireTenantContext } from "./tenant.ts"
import { createAuthRouter } from "./auth-router.ts"
import { createOnboardingRouter } from "./onboarding.ts"
import { createApiRouter } from "./api.ts"
import { createOperationsRouter } from "./operations.ts"
import { createTeamRouter } from "./team.ts"
import { createReportsRouter } from "./reports.ts"
import { createSubscriptionRouter } from "./subscription.ts"
import { createPaymentsRouter } from "./payments.ts"
import { createBackupRouter } from "./backup.ts"
import { createSupportRouter } from "./support.ts"
import { createAccessRouter } from "./access.ts"
import { attachSubscription, blockWritesWhenReadOnly } from "./entitlements.ts"

// ---------------------------------------------------------------------------
// Montage de l'API
//
// Extrait de server.ts pour que les tests d'autorisation exercent exactement
// la même pile de middlewares que la production : session → appartenance →
// abonnement → permissions. Tester une pile reconstituée à la main ne
// prouverait rien.
// ---------------------------------------------------------------------------

/**
 * Ordre des contrôles, du plus général au plus précis :
 *   1. `requireSession`        — qui êtes-vous ? (401 sinon)
 *   2. `requireTenantContext`  — de quelle station, avec quel rôle, et le
 *                                compte est-il toujours actif ? (403 sinon)
 *   3. `attachSubscription`    — que permet le forfait ?
 *   4. `requirePermission`     — posé par chaque route (403 sinon)
 */
export function mountApi(app: Express) {
  app.use("/api/v1/auth", createAuthRouter())
  app.use("/api/v1", requireSession)
  app.use("/api/v1", requireTenantContext)
  app.use("/api/v1", attachSubscription)
  app.use("/api/v1", blockWritesWhenReadOnly)
  app.use("/api/v1", createSubscriptionRouter())
  app.use("/api/v1", createOnboardingRouter())
  app.use("/api/v1", createApiRouter())
  app.use("/api/v1", createPaymentsRouter())
  app.use("/api/v1", createBackupRouter())
  app.use("/api/v1", createSupportRouter())
  app.use("/api/v1", createAccessRouter())
  app.use("/api/v1", createTeamRouter())
  app.use("/api/v1", createReportsRouter())
  app.use("/api/v1", createOperationsRouter())

  app.use("/api/v1", (_req: Request, res: Response) => {
    res.status(404).json({ error: { code: "not_found", message: "Cette route API n'existe pas." } })
  })
  return app
}

/** Gestionnaire d'erreurs commun : une erreur ne fuit jamais de détail interne. */
export function apiErrorHandler(error: unknown, _req: Request, res: Response, next: NextFunction) {
  void next
  let status = error instanceof HttpError ? error.status : 500
  let code = error instanceof HttpError ? error.code : "internal_error"
  let message =
    error instanceof HttpError
      ? error.message
      : "Une erreur interne est survenue. Réessayez dans quelques instants."

  if (!(error instanceof HttpError) && typeof error === "object" && error !== null && "type" in error) {
    const type = (error as { type?: string }).type
    if (type === "entity.parse.failed") {
      status = 400
      code = "invalid_json"
      message = "Le corps de la requête n'est pas un JSON valide."
    }
  }
  if (status >= 500) {
    console.error("[api] Request failed:", error instanceof Error ? error.message : error)
  }
  res.status(status).json({ error: { code, message } })
}

/**
 * Application API seule (sans Vite ni fichiers statiques), utilisée par les
 * tests d'autorisation de bout en bout.
 */
export function createApiApp(): Express {
  const app = express()
  app.disable("x-powered-by")
  app.use(express.json({ limit: "1mb" }))
  mountApi(app)
  app.use(apiErrorHandler)
  return app
}
