import { HttpError } from "./auth.ts"
import type { TenantContext } from "./types.ts"

export function isManager(tenant: TenantContext) {
  return tenant.role === "owner" || tenant.role === "manager"
}

export function requireManager(tenant: TenantContext, action = "gérer cette ressource") {
  if (!isManager(tenant)) {
    throw new HttpError(403, "forbidden", `Seuls le propriétaire ou un responsable peuvent ${action}.`)
  }
}
