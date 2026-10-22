"use client"

import * as React from "react"
import { useLocation } from "react-router-dom"
import { motion } from "framer-motion"

import { AppSidebar } from "@/components/app-sidebar"
import { SearchProvider } from "@/components/command-search"
import { GlobalShortcuts } from "@/components/keyboard-shortcuts"
import { MobileActionBar } from "@/components/mobile-action-bar"
import { SiteHeader } from "@/components/site-header"
import { OfflineIndicator } from "@/components/offline-indicator"
import { SupportButton } from "@/components/support/support-button"
import { TrialBanner } from "@/components/trial/trial-banner"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { rememberVisit, routeLabel } from "@/config/navigation"
import { pageEnter } from "@/lib/motion"

interface BaseLayoutProps {
  children: React.ReactNode
  title?: string
  description?: string
  /** Actions de la page, placées dans l'en-tête collant. */
  actions?: React.ReactNode
  /**
   * La page affiche déjà son propre titre : ne pas en rendre un second.
   * Deux `<h1>` sur le même écran brouillent la navigation par titres des
   * lecteurs d'écran, et le titre reste annoncé via `title`.
   */
  hideHeading?: boolean
}

/**
 * Coquille applicative.
 *
 * Trois éléments d'accessibilité vivent ici, une fois pour toutes :
 *   • un lien d'évitement vers `<main>` (premier élément focusable) ;
 *   • une région `aria-live` qui annonce le nom de l'écran après navigation,
 *     parce qu'une SPA ne recharge pas la page et qu'un lecteur d'écran n'a
 *     sinon aucun moyen de savoir que le contenu a changé ;
 *   • la mémoire de la dernière page visitée, utilisée par la barre latérale
 *     et la recherche.
 */
export function BaseLayout({ children, title, description, actions, hideHeading = false }: BaseLayoutProps) {
  const { pathname } = useLocation()

  React.useEffect(() => {
    rememberVisit(pathname)
    // Une nouvelle page commence en haut : sans cela, on arrive au milieu d'un
    // tableau parce que la page précédente était longue.
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior })
  }, [pathname])

  // Le libellé annoncé combine la page et son titre éventuel — jamais deux fois
  // le même mot.
  const announcement = title && title !== routeLabel(pathname)
    ? `${routeLabel(pathname)} — ${title}`
    : routeLabel(pathname)

  return (
    <SearchProvider>
      <a
        href="#contenu-principal"
        className="sr-only rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-100"
      >
        Aller au contenu principal
      </a>

      <SidebarProvider
        style={
          {
            "--sidebar-width": "16rem",
            "--sidebar-width-icon": "3rem",
            "--header-height": "calc(var(--spacing) * 14)",
          } as React.CSSProperties
        }
      >
        <AppSidebar variant="inset" collapsible="offcanvas" side="left" />
        <SidebarInset>
          <SiteHeader actions={actions} />
          {/* `SidebarInset` est déjà l'élément <main> : on cible ici la zone
              de contenu pour que le lien d'évitement saute l'en-tête. */}
          <div
            id="contenu-principal"
            tabIndex={-1}
            className="flex flex-1 flex-col outline-none"
          >
            <div className="@container/main flex flex-1 flex-col gap-2">
              <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {announcement}
              </p>
              <motion.div
                key={pathname}
                variants={pageEnter}
                initial="hidden"
                animate="visible"
                className="flex flex-col gap-4 py-4 pb-24 md:gap-6 md:py-6 md:pb-6"
              >
                <TrialBanner className="mx-4 lg:mx-6" />
                {/* État du réseau et file d'attente. Placé en tête de toutes
                    les pages : une vente qui attend doit se voir partout, pas
                    seulement sur l'écran où elle a été saisie. */}
                <div className="px-4 lg:px-6">
                  <OfflineIndicator />
                </div>
                {title && !hideHeading && (
                  <div className="px-4 lg:px-6">
                    <div className="flex flex-col gap-1">
                      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
                      {description && (
                        <p className="text-muted-foreground">{description}</p>
                      )}
                    </div>
                  </div>
                )}
                {children}
              </motion.div>
            </div>
          </div>
          <SupportButton />
        </SidebarInset>
      </SidebarProvider>

      <GlobalShortcuts />
      <MobileActionBar />
    </SearchProvider>
  )
}
