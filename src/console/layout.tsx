import * as React from "react"
import { NavLink, Outlet } from "react-router-dom"
import {
  LifeBuoy,
  Users,
  Building2,
  FileClock,
  LayoutDashboard,
  LogOut,
  TrendingUp,
  Wallet,
} from "lucide-react"

import { BrandMark } from "@/components/brand"
import { Button } from "@/components/ui/button"

import { useConsoleAuth } from "./auth"

/**
 * Coquille de la console.
 *
 * Rien de l'application cliente n'est réutilisé ici : ni `BaseLayout`, ni
 * `AppSidebar`, ni les contextes d'abonnement et d'onboarding. Ce n'est pas
 * du purisme — ces composants supposent tous une station courante, et la
 * console n'en a aucune.
 *
 * Le fond sombre n'est pas qu'esthétique : il signale en permanence qu'on
 * n'est pas dans l'espace d'un client. Agir ici engage tout le parc.
 */
const NAV = [
  { to: "/console", end: true, label: "Vue d'ensemble", icon: LayoutDashboard },
  { to: "/console/stations", end: false, label: "Stations", icon: Building2 },
  { to: "/console/assistance", end: false, label: "Assistance", icon: LifeBuoy },
  { to: "/console/comptes", end: false, label: "Comptes", icon: Users },
  { to: "/console/revenus", end: false, label: "Revenus", icon: TrendingUp },
  { to: "/console/paiements", end: false, label: "Paiements", icon: Wallet },
  { to: "/console/journal", end: false, label: "Journal", icon: FileClock },
]

export function ConsoleLayout() {
  const { operator, signOut } = useConsoleAuth()

  return (
    <div className="min-h-svh bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <BrandMark height={30} tone="dark" />
            <div className="hidden sm:block">
              <p className="text-sm font-semibold leading-none">Console</p>
              <p className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">
                Administration du parc
              </p>
            </div>
          </div>

          <nav className="ml-auto flex items-center gap-1 overflow-x-auto" aria-label="Sections de la console">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors duration-150",
                    isActive
                      ? "bg-white/10 font-medium text-white"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                  ].join(" ")
                }
              >
                <item.icon className="size-4" aria-hidden />
                <span className="hidden md:inline">{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3 border-l border-white/10 pl-3">
            <span className="hidden text-xs text-slate-400 lg:inline">{operator?.email}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void signOut()}
              className="text-slate-400 hover:text-white"
            >
              <LogOut className="size-4" aria-hidden />
              <span className="sr-only">Se déconnecter</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}

/** Carte de statistique, reprise par plusieurs écrans de la console. */
export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string
  value: React.ReactNode
  hint?: string
  tone?: "default" | "warning" | "danger" | "success"
}) {
  const toneClass = {
    default: "text-white",
    warning: "text-amber-300",
    danger: "text-red-300",
    success: "text-emerald-300",
  }[tone]

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

/** Panneau standard de la console. */
export function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}
