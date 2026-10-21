"use client"

import * as React from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { SubscriptionProvider } from "@/lib/subscription"
import { PermissionProvider } from "@/lib/permissions"
import { OfflineIndicator } from "@/components/offline-indicator"
import { TrialBanner } from "@/components/trial/trial-banner"
import { SupportButton } from "@/components/support/support-button"
import { motion } from "framer-motion"
import { useLocation } from "react-router-dom"
import { pageEnter } from "@/lib/motion"

interface BaseLayoutProps {
  children: React.ReactNode
  title?: string
  description?: string
}

export function BaseLayout({ children, title, description }: BaseLayoutProps) {
  // La clé change à chaque route : React remonte le bloc, l'animation d'entrée
  // se rejoue. Une seule déclaration ici évite de l'écrire dans chaque écran —
  // et évite surtout que chaque écran choisisse sa propre durée.
  const { pathname } = useLocation()

  return (
    <SubscriptionProvider>
    <PermissionProvider>
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
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <motion.div
              key={pathname}
              variants={pageEnter}
              initial="hidden"
              animate="visible"
              className="flex flex-col gap-4 py-4 md:gap-6 md:py-6"
            >
              <TrialBanner className="mx-4 lg:mx-6" />
              {/* État du réseau et file d'attente. Placé en tête de toutes
                  les pages : une vente qui attend doit se voir partout, pas
                  seulement sur l'écran où elle a été saisie. */}
              <div className="px-4 lg:px-6">
                <OfflineIndicator />
              </div>
              {title && (
                <div className="px-4 lg:px-6">
                  <div className="flex flex-col gap-2">
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
    </PermissionProvider>
    </SubscriptionProvider>
  )
}
