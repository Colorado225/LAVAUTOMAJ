"use client"

import * as React from "react"
import {
  LayoutPanelLeft,
  Shield,
  Settings,
  Truck,
  Wallet,
  Receipt,
  BarChart3,
  Users,
  Plus,
  List,
} from "lucide-react"
import { Link } from "react-router-dom"
import { Logo } from "@/components/logo"
import { useOnboardingStatus } from "@/lib/onboarding-api"
import { SidebarNotification } from "@/components/sidebar-notification"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const data = {
  user: {
    name: "Gérant",
    email: "gerant@example.com",
    avatar: "",
  },
  navGroups: [
    {
      label: "Principal",
      items: [
        {
          title: "Tableau de bord",
          url: "/dashboard",
          icon: LayoutPanelLeft,
        },
        {
          title: "Nouveau lavage",
          url: "/washes",
          icon: Plus,
        },
        {
          title: "Caisse",
          url: "/cash-drawer",
          icon: Wallet,
        },
        {
          title: "Dépenses",
          url: "/expenses",
          icon: Receipt,
        },
        {
          title: "Rapports",
          url: "/reports",
          icon: BarChart3,
        },
        {
          title: "Équipe",
          url: "/team",
          icon: Users,
        },
        {
          title: "Catalogue",
          url: "#",
          icon: List,
          items: [
            {
              title: "Prestations",
              url: "/services",
            },
            {
              title: "Catégories de véhicules",
              url: "/vehicle-categories",
            },
          ],
        },
      ],
    },
    {
      label: "Configuration",
      items: [
        {
          title: "Onboarding",
          url: "/onboarding",
          icon: Truck,
        },
        {
          title: "Paramètres",
          url: "#",
          icon: Settings,
          items: [
            {
              title: "Compte",
              url: "/settings/account",
            },
            {
              title: "Facturation",
              url: "/settings/billing",
            },
            {
              title: "Apparence",
              url: "/settings/appearance",
            },
            {
              title: "Notifications",
              url: "/settings/notifications",
            },
          ],
        },
      ],
    },
    {
      label: "Authentification",
      items: [
        {
          title: "Connexion",
          url: "/auth/sign-in",
          icon: Shield,
        },
        {
          title: "Inscription",
          url: "/auth/sign-up",
          icon: Shield,
        },
        {
          title: "Mot de passe oublié",
          url: "/auth/forgot-password",
          icon: Shield,
        },
      ],
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  // Dashboard dynamique (§10 du WORKFLOW) : nom réel de la station depuis le
  // serveur ; repli discret tant que la station n'est pas configurée.
  const { data: status } = useOnboardingStatus()
  const stationName = status?.station?.name ?? status?.org_name ?? "WashPilot CI"
  const stationCity = status?.station?.city
  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/dashboard" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Logo size={24} className="text-current" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{stationName}</span>
                <span className="truncate text-xs">
                  {stationCity ?? "Gestion de station de lavage"}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {data.navGroups.map((group) => (
          <NavMain key={group.label} label={group.label} items={group.items} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarNotification />
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
