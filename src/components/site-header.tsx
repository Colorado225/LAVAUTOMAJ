"use client"

import * as React from "react"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Link, useLocation } from "react-router-dom"
import { CommandSearch, SearchTrigger } from "@/components/command-search"
import { ThemeMenu, ThemeToggle } from "@/components/theme-toggle"

const routeLabels: Record<string, string> = {
  "/dashboard": "Tableau de bord",
  "/washes": "Nouveau lavage",
  "/payments": "Encaissements",
  "/cash-drawer": "Caisse",
  "/expenses": "Dépenses",
  "/stock": "Stock",
  "/equipe": "Équipe du jour",
  "/team": "Équipe",
  "/reports": "Rapports",
  "/settings/account": "Compte",
  "/settings/billing": "Facturation",
  "/settings/data": "Données et sauvegarde",
}

export function SiteHeader() {
  const [searchOpen, setSearchOpen] = React.useState(false)
  const { pathname } = useLocation()
  const currentLabel = routeLabels[pathname] ?? "Espace de travail"
  const section = pathname.startsWith("/settings") ? "Configuration" : pathname === "/payments" || pathname === "/cash-drawer" || pathname === "/expenses" ? "Finance" : pathname === "/team" || pathname === "/equipe" ? "Équipe" : "Opérations"

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <>
      <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
        <div className="flex w-full items-center gap-1 px-4 py-3 lg:gap-2 lg:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mx-2 data-vertical:self-center data-vertical:h-4"
          />
          <Breadcrumb className="hidden min-w-0 md:block">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link to="/dashboard" viewTransition />}>Accueil</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link to={pathname} viewTransition />}>{section}</BreadcrumbLink>
              </BreadcrumbItem>
              {currentLabel !== section && <>
                <BreadcrumbSeparator />
                <BreadcrumbItem><BreadcrumbPage>{currentLabel}</BreadcrumbPage></BreadcrumbItem>
              </>}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="max-w-sm flex-1">
            <SearchTrigger onClick={() => setSearchOpen(true)} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            {/* Bascule rapide pour le geste quotidien, menu pour revenir au
                réglage du système. Le menu est masqué sur mobile : la place
                y est comptée, et le choix complet reste dans les réglages. */}
            <ThemeToggle />
            <span className="hidden sm:inline-flex">
              <ThemeMenu />
            </span>
          </div>
        </div>
      </header>
      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  )
}
