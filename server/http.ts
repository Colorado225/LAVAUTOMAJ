import type { Request, Response, NextFunction } from "express"
import { z } from "zod"
import { HttpError } from "./auth.ts"

export { HttpError } from "./auth.ts"

/** Wrap an async Express handler so rejections reach the error middleware. */
export function asyncRoute(fn: (req: Request, res: Response, next: NextFunction) => unknown) {
  return (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next)
}

/** Validate a request body against a zod schema, raising a 400 on failure. */
export function body<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new HttpError(400, "invalid_data", result.error.issues.map((i) => i.message).join("; "))
  }
  return result.data
}

/** Return the tenant context attached by requireTenantContext, or raise a 401. */
export function tenant(req: Request) {
  if (!req.tenant) throw new HttpError(401, "tenant_required", "Organisation active requise.")
  return req.tenant
}

/** Restrict a route to the given organization roles. */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.tenant || !roles.includes(req.tenant.role)) {
      return next(new HttpError(403, "forbidden", "Vous n’avez pas l’autorisation."))
    }
    next()
  }
}

/** Parse a route parameter as a UUID, raising a 400 on failure. */
export function parseId(value: string | string[] | undefined) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_id", "Identifiant invalide.")
  const result = z.string().uuid().safeParse(value)
  if (!result.success) throw new HttpError(400, "invalid_id", "Identifiant invalide.")
  return result.data
}

/** Extract pagination parameters (?page, ?limit) with sane bounds. */
export function pageParams(req: Request) {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 25))
  return { page, limit, offset: (page - 1) * limit }
}
