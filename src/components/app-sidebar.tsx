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
  BadgeCheck,
  ShieldCheck,
  History,
  Building2,
} from "lucide-react"
import { Link } from "react-router-dom"
import { BrandBadge } from "@/components/brand"
import { useOnboardingStatus } from "@/lib/onboarding-api"
import { TrialCountdown } from "@/components/trial/trial-countdown"
import { usePermissions, type Permission } from "@/lib/permissions"

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
          permission: "dashboard:read" as Permission,
        },
        {
          title: "Nouveau lavage",
          url: "/washes",
          icon: Plus,
          permission: "wash:read" as Permission,
        },
        {
          title: "Encaissements",
          url: "/payments",
          icon: BadgeCheck,
          permission: "payment:read" as Permission,
        },
        {
          title: "Caisse",
          url: "/cash-drawer",
          icon: Wallet,
          permission: "cash_session:read" as Permission,
        },
        {
          title: "Dépenses",
          url: "/expenses",
          icon: Receipt,
          permission: "expense:read" as Permission,
        },
        {
          title: "Rapports",
          url: "/reports",
          icon: BarChart3,
          permission: "report:operational" as Permission,
        },
        {
          title: "Historique",
          url: "/history",
          icon: History,
          permission: "audit:read" as Permission,
        },
        {
          title: "Équipe",
          url: "/team",
          icon: Users,
          permission: "worker:read" as Permission,
        },
        {
          title: "Catalogue",
          url: "#",
          icon: List,
          permission: "service:read" as Permission,
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
          // `settings:manage` et non `wash:read` : le serveur laisse tout le
          // monde *lire* la liste des stations, mais créer, modifier et
          // désactiver exigent `settings:manage`. Avec `wash:read`, un agent
          // de lavage voyait une rubrique « Configuration » ne contenant
          // qu'un écran aux boutons tous grisés. On n'annonce pas une porte
          // qu'on ne peut pas ouvrir ; l'URL reste accessible en lecture.
          title: "Stations",
          url: "/sites",
          icon: Building2,
          permission: "settings:manage" as Permission,
        },
        {
          title: "Gestion des accès",
          url: "/settings/access",
          icon: ShieldCheck,
          permission: "user:manage" as Permission,
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
              permission: "subscription:manage" as Permission,
            },
            {
              title: "Données et sauvegarde",
              url: "/settings/data",
              permission: "data:export" as Permission,
            },
          ],
        },
      ],
    },
  ],
}

type NavItems = React.ComponentProps<typeof NavMain>["items"]
type NavEntry = NavItems[number] & { permission?: Permission; items?: NavEntry[] }

/**
 * Masque les entrées dont l'utilisateur n'a pas la permission.
 * Un groupe dont toutes les sous-entrées sont masquées disparaît à son tour.
 */
function filterNav(items: NavEntry[], can: (permission: Permission) => boolean): NavEntry[] {
  return items
    .filter((item) => !item.permission || can(item.permission))
    .map((item) => (item.items ? { ...item, items: filterNav(item.items, can) } : item))
    .filter((item) => !item.items || item.items.length > 0 || item.url !== "#")
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: status } = useOnboardingStatus()
  const { can, loading: permissionsLoading } = usePermissions()
  const stationName = status?.station?.name ?? status?.org_name ?? "WashPilot CI"
  const stationCity = status?.station?.city

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/dashboard" viewTransition />}>
              <BrandBadge height={32} />
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
        {data.navGroups.map((group) => {
          // Tant que les permissions ne sont pas chargées, on n'affiche rien
          // plutôt qu'un menu complet qui se réduirait sous les yeux.
          const items = permissionsLoading
            ? []
            : (filterNav(group.items as NavEntry[], can) as NavItems)
          if (items.length === 0) return null
          return <NavMain key={group.label} label={group.label} items={items} />
        })}
      </SidebarContent>
      <SidebarFooter>
        <TrialCountdown />
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
