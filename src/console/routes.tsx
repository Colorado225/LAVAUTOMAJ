import type { ComponentType } from "react"
import type { RouteObject } from "react-router-dom"

/**
 * Routes de la console.
 *
 * Même découpage à la demande que l'application cliente : le code de la
 * console ne doit pas peser sur le chargement d'une station, et vice versa.
 */
function page(load: () => Promise<{ default: ComponentType }>) {
  return async () => ({ Component: (await load()).default })
}

export const consoleRoutes: RouteObject[] = [
  { index: true, lazy: page(() => import("@/console/pages/overview")) },
  { path: "stations", lazy: page(() => import("@/console/pages/stations")) },
  { path: "stations/:id", lazy: page(() => import("@/console/pages/station-detail")) },
  { path: "assistance", lazy: page(() => import("@/console/pages/support")) },
  { path: "assistance/:id", lazy: page(() => import("@/console/pages/support-detail")) },
  { path: "comptes", lazy: page(() => import("@/console/pages/accounts")) },
  { path: "comptes/:userId", lazy: page(() => import("@/console/pages/account-detail")) },
  { path: "revenus", lazy: page(() => import("@/console/pages/revenue")) },
  { path: "paiements", lazy: page(() => import("@/console/pages/payments")) },
  { path: "surveillance", lazy: page(() => import("@/console/pages/monitoring")) },
  { path: "surveillance/:id", lazy: page(() => import("@/console/pages/monitoring-error")) },
  { path: "journal", lazy: page(() => import("@/console/pages/journal")) },
]
