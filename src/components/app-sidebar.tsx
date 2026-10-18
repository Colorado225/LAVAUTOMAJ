"use client"

import * as React from "react"
import {
  LayoutPanelLeft,
  Settings,
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
    name: "Utilisateur",
    email: "",
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
              title: "Catégories de prestations",
              url: "/service-categories",
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
          ],
        },
      ],
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
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
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
