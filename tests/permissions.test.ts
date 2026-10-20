import test from "node:test"
import assert from "node:assert/strict"
import {
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  OWNER_ONLY_PERMISSIONS,
  GRANTABLE_PERMISSIONS,
  effectivePermissions,
  hasPermission,
  rolePermissions,
  isPermission,
  isRole,
  deniedMessage,
  type Permission,
} from "../server/permissions.ts"
import { requirePermission, assertPermission } from "../server/http.ts"
import { HttpError } from "../server/auth.ts"

// ---------------------------------------------------------------------------
// Matrice des rôles
// ---------------------------------------------------------------------------

test("le propriétaire détient toutes les permissions", () => {
  for (const permission of PERMISSIONS) {
    assert.equal(hasPermission("owner", permission), true, `owner devrait avoir ${permission}`)
  }
})

test("le gérant gère l'opérationnel mais pas les tarifs, les finances ni les utilisateurs", () => {
  // Autorisé
  for (const permission of [
    "wash:create",
    "wash:read",
    "wash:update",
    "payment:create",
    "payment:verify",
    "cash_session:manage",
    "service:read",
    "worker:create",
    "report:operational",
  ] as Permission[]) {
    assert.equal(hasPermission("manager", permission), true, `manager devrait avoir ${permission}`)
  }
  // Refusé
  for (const permission of [
    "service:manage",
    "wash:cancel",
    "payment:cancel",
    "expense:create",
    "report:financial",
    "worker:delete",
    "user:manage",
    "settings:manage",
    "subscription:manage",
    "data:export",
  ] as Permission[]) {
    assert.equal(hasPermission("manager", permission), false, `manager ne devrait pas avoir ${permission}`)
  }
})

test("l'agent de lavage ne voit ni les encaissements, ni les dépenses, ni les rapports", () => {
  assert.deepEqual([...rolePermissions("washer")], ["wash:read", "service:read"])
  for (const permission of [
    "payment:read",
    "expense:read",
    "report:operational",
    "report:financial",
    "cash_session:read",
    "dashboard:read",
  ] as Permission[]) {
    assert.equal(hasPermission("washer", permission), false, `washer ne devrait pas avoir ${permission}`)
  }
})

test("le caissier tient la caisse sans toucher au catalogue ni aux droits", () => {
  assert.equal(hasPermission("cashier", "cash_session:manage"), true)
  assert.equal(hasPermission("cashier", "payment:create"), true)
  assert.equal(hasPermission("cashier", "expense:create"), true)
  assert.equal(hasPermission("cashier", "service:manage"), false)
  assert.equal(hasPermission("cashier", "user:manage"), false)
  assert.equal(hasPermission("cashier", "report:financial"), false)
})

test("un rôle inconnu n'obtient rien : refus par défaut", () => {
  assert.deepEqual([...rolePermissions("admin")], [])
  assert.equal(hasPermission("", "wash:read"), false)
  assert.equal(hasPermission("OWNER", "wash:read"), false, "la casse ne doit pas être permissive")
})

test("seuls les quatre rôles prévus sont reconnus", () => {
  assert.deepEqual([...ROLES], ["owner", "manager", "cashier", "washer"])
  assert.equal(isRole("owner"), true)
  assert.equal(isRole("superadmin"), false)
  assert.equal(isPermission("wash:create"), true)
  assert.equal(isPermission("wash:destroy"), false)
})

// ---------------------------------------------------------------------------
// Exceptions accordées par le propriétaire
// ---------------------------------------------------------------------------

test("le propriétaire peut accorder une permission à titre exceptionnel", () => {
  const permissions = effectivePermissions("manager", [{ permission: "expense:create", granted: true }])
  assert.equal(permissions.has("expense:create"), true)
  // L'exception ne déborde pas sur les autres droits du même domaine.
  assert.equal(permissions.has("expense:manage"), false)
})

test("le propriétaire peut retirer une permission venant du rôle", () => {
  const permissions = effectivePermissions("manager", [{ permission: "cash_session:manage", granted: false }])
  assert.equal(permissions.has("cash_session:manage"), false)
  assert.equal(permissions.has("wash:create"), true)
})

test("les permissions réservées au propriétaire ne sont jamais déléguées", () => {
  for (const permission of OWNER_ONLY_PERMISSIONS) {
    const permissions = effectivePermissions("manager", [{ permission, granted: true }])
    assert.equal(permissions.has(permission), false, `${permission} ne doit pas être délégable`)
  }
  assert.equal(GRANTABLE_PERMISSIONS.includes("user:manage"), false)
  assert.equal(GRANTABLE_PERMISSIONS.includes("expense:create"), true)
})

test("un propriétaire ne peut pas se faire retirer ses propres droits", () => {
  const permissions = effectivePermissions("owner", [
    { permission: "user:manage", granted: false },
    { permission: "settings:manage", granted: false },
  ])
  assert.equal(permissions.has("user:manage"), true)
  assert.equal(permissions.has("settings:manage"), true)
})

test("une exception portant sur une permission inconnue est ignorée", () => {
  const permissions = effectivePermissions("manager", [{ permission: "wash:destroy", granted: true }])
  assert.equal(permissions.size, ROLE_PERMISSIONS.manager.length)
})

// ---------------------------------------------------------------------------
// Middleware de contrôle d'accès
// ---------------------------------------------------------------------------

/** Fabrique une requête Express minimale pour tester le middleware. */
function fakeRequest(role: string | null) {
  if (!role) return {} as never
  const permissions = effectivePermissions(role)
  return {
    tenant: {
      organizationId: "org-1",
      userId: "user-1",
      role,
      permissions,
      can: (permission: Permission) => permissions.has(permission),
    },
  } as never
}

function runMiddleware(role: string | null, permission: Permission) {
  let captured: unknown = "non-appelé"
  const middleware = requirePermission(permission)
  middleware(fakeRequest(role), {} as never, ((error?: unknown) => {
    captured = error ?? null
  }) as never)
  return captured
}

test("une requête non authentifiée reçoit 401", () => {
  const error = runMiddleware(null, "wash:read")
  assert.ok(error instanceof HttpError)
  assert.equal(error.status, 401)
  assert.equal(error.code, "authentication_required")
})

test("une requête autorisée passe au gestionnaire suivant", () => {
  assert.equal(runMiddleware("owner", "service:manage"), null)
  assert.equal(runMiddleware("manager", "wash:create"), null)
})

test("une requête interdite reçoit 403, même venant d'un appel direct à l'API", () => {
  const error = runMiddleware("manager", "service:manage")
  assert.ok(error instanceof HttpError)
  assert.equal(error.status, 403)
  assert.equal(error.code, "forbidden")
  assert.match(error.message, /non autorisée/i)
})

test("le middleware exige toutes les permissions demandées", () => {
  let captured: unknown = "non-appelé"
  requirePermission("wash:read", "report:financial")(fakeRequest("manager"), {} as never, ((e?: unknown) => {
    captured = e ?? null
  }) as never)
  assert.ok(captured instanceof HttpError)
  assert.equal((captured as HttpError).status, 403)
})

test("assertPermission lève la même erreur depuis un gestionnaire", () => {
  assert.doesNotThrow(() => assertPermission(fakeRequest("owner"), "payment:cancel"))
  assert.throws(
    () => assertPermission(fakeRequest("cashier"), "payment:cancel"),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  )
})

test("le message de refus nomme l'action refusée", () => {
  assert.match(deniedMessage("service:manage"), /prestations/i)
  assert.match(deniedMessage("report:financial"), /financiers/i)
})
