"use client"

import * as React from "react"
import { Link, useLocation } from "react-router-dom"
import { Search } from "lucide-react"

import { SearchTrigger, useSearch } from "@/components/command-search"
import { NewWashButton } from "@/components/actions/new-wash-button"
import { NotificationCenter, SyncStatus } from "@/components/notifications/notification-center"
import { ThemeMenu, ThemeToggle } from "@/components/theme-toggle"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { breadcrumbsFor, routeLabel, sectionOf } from "@/config/navigation"
import { cn } from "@/lib/utils"

/**
 * En-tête : fil d'Ariane, recherche, action principale, notifications.
 *
 * Le fil d'Ariane est **calculé**, pas écrit à la main dans chaque écran : il
 * suit le référentiel `config/navigation.ts` (Accueil › Section › Rubrique ›
 * Page). Les quatre écrans qui avaient leur propre libellé n'en ont plus.
 */
export function SiteHeader({
  /** Actions propres à la page, insérées à droite du fil d'Ariane. */
  actions,
}: {
  actions?: React.ReactNode
}) {
  const { pathname } = useLocation()
  const { openSearch } = useSearch()
  const crumbs = breadcrumbsFor(pathname)
  const current = routeLabel(pathname)
  const section = sectionOf(pathname)

  return (
    <header className="sticky top-0 z-30 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
      <div className="flex w-full min-w-0 items-center gap-1 px-3 py-3 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1 size-9 md:size-8" aria-label="Ouvrir ou fermer la navigation" />
        <Separator
          orientation="vertical"
          className="mx-1 hidden data-vertical:h-4 data-vertical:self-center sm:block"
        />

        {/* Fil d'Ariane complet à partir de md ; sur mobile, la page courante
            suffit — un fil tronqué au milieu ne situe personne. */}
        <Breadcrumb className="hidden min-w-0 md:block">
          <BreadcrumbList aria-label="Fil d'Ariane">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1
              return (
                <React.Fragment key={`${crumb.label}-${index}`}>
                  {index > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem className={cn(index === 1 && "hidden lg:flex")}>
                    {last ? (
                      <BreadcrumbPage aria-current="page">{crumb.label}</BreadcrumbPage>
                    ) : crumb.href ? (
                      <BreadcrumbLink render={<Link to={crumb.href} viewTransition />}>
                        {crumb.label}
                      </BreadcrumbLink>
                    ) : (
                      <span>{crumb.label}</span>
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              )
            })}
          </BreadcrumbList>
        </Breadcrumb>

        <p className="min-w-0 flex-1 truncate text-sm font-medium md:hidden">
          <span className="sr-only">{section} — </span>
          {current}
        </p>

        <div className="hidden min-w-0 flex-1 justify-end sm:flex md:max-w-sm">
          <SearchTrigger onClick={openSearch} />
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={openSearch}
          aria-label="Rechercher"
          aria-keyshortcuts="Control+K Meta+K"
          className="size-9 shrink-0 sm:hidden"
        >
          <Search aria-hidden="true" />
        </Button>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {actions}
          {/* Visible dès le mobile : un caissier doit savoir s'il est
              synchronisé sans ouvrir un menu. Sous lg, seule l'icône parle. */}
          <SyncStatus />
          <span className="hidden sm:inline-flex">
            <NewWashButton />
          </span>
          <NotificationCenter />
          <ThemeToggle />
          <span className="hidden sm:inline-flex">
            <ThemeMenu />
          </span>
        </div>
      </div>
    </header>
  )
}
