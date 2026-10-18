import type { AuthenticatedPrincipal, TenantContext } from "./types.ts"

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedPrincipal
      tenant?: TenantContext
    }
  }
}

export {}
