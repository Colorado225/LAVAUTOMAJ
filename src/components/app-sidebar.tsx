"use client"

import * as React from "react"
import {
  LayoutPanelLeft,
  Settings,
  Wallet,
  Receipt,
  BarChart3,
  Users,
  List,
  BadgeCheck,
  ShieldCheck,
  History,
  Building2,
  Package,
  Truck,
  UserCheck,
  TrendingUp,
  Clock,
  Droplets,
  RotateCcw,
} from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import { BrandBadge } from "@/components/brand"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { TrialCountdown } from "@/components/trial/trial-countdown"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { previousVisit, routeLabel } from "@/config/navigation"
import { useOnboardingStatus } from "@/lib/onboarding-api"
import { usePermissions, type Permission } from "@/lib/permissions"

/**
 * Barre latérale.
 *
 * Quatre sections, dans l'ordre du métier : **Opérations**, **Équipe**,
 * **Finance**, **Configuration**. Auparavant les entrées étaient rangées par
 * une table de correspondance titre → section ; une entrée oubliée tombait
 * silencieusement dans « Configuration ». Ici chaque groupe porte ses entrées,
 * et un écran ne peut plus changer de section par accident.
 *
 * Le vocabulaire est celui du terrain : « Lavages », « Station » (jamais
 * « site »), « Caisse » (une **session de caisse** à l'intérieur).
 */

export const NAV_GROUPS = [
  {
    label: "Opérations",
    items: [
      {
        title: "Tableau de bord",
        url: "/dashboard",
        icon: LayoutPanelLeft,
        permission: "dashboard:read" as Permission,
      },
      {
        title: "Lavages",
        url: "/washes",
        icon: Droplets,
        permission: "wash:read" as Permission,
      },
      {
        title: "Stock",
        url: "/stock",
        icon: Package,
        permission: "stock:read" as Permission,
      },
      {
        title: "Achats",
        url: "/achats",
        icon: Truck,
        permission: "purchase:manage" as Permission,
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
    ],
  },
  {
    label: "Équipe",
    items: [
      {
        title: "Équipe du jour",
        url: "/equipe",
        icon: UserCheck,
        permission: "attendance:read" as Permission,
      },
      {
        title: "Horaires",
        url: "/horaires",
        icon: Clock,
        permission: "attendance:read" as Permission,
      },
      {
        title: "Rendement",
        url: "/rendement",
        icon: TrendingUp,
        permission: "attendance:read" as Permission,
      },
      {
        title: "Équipe",
        url: "/team",
        icon: Users,
        permission: "worker:read" as Permission,
      },
    ],
  },
  {
    label: "Finance",
    items: [
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
        title: "Catalogue",
        url: "#",
        icon: List,
        permission: "service:read" as Permission,
        items: [
          { title: "Prestations", url: "/services" },
          { title: "Catégories de prestations", url: "/service-categories" },
          { title: "Catégories de véhicules", url: "/vehicle-categories" },
        ],
      },
      {
        title: "Paramètres",
        url: "#",
        icon: Settings,
        items: [
          { title: "Compte", url: "/settings/account" },
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
]

type NavEntry = {
  title: string
  url: string
  icon?: React.ComponentType<{ className?: string }>
  permission?: Permission
  items?: NavEntry[]
}

type NavItems = React.ComponentProps<typeof NavMain>["items"]

/**
 * Masque les entrées dont l'utilisateur n'a pas la permission.
 * Un sous-groupe dont toutes les sous-entrées sont masquées disparaît à son tour.
 */
function filterNav(items: NavEntry[], can: (permission: Permission) => boolean): NavEntry[] {
  return items
    .filter((item) => !item.permission || can(item.permission))
    .map((item) => (item.items ? { ...item, items: filterNav(item.items, can) } : item))
    .filter((item) => !item.items || item.items.length > 0 || item.url !== "#")
}

/**
 * « Reprendre » : l'écran quitté il y a moins d'une session, pour ne pas
 * chercher sa page dans un menu qu'on vient de réorganiser.
 */
function ResumeLastPage() {
  const { pathname } = useLocation()
  // Lecture à chaque rendu : le stockage local est synchrone et la liste est
  // courte. Aucun état intermédiaire à désynchroniser.
  const resumePath = previousVisit(pathname)
  if (!resumePath) return null
  const resume = { path: resumePath, label: routeLabel(resumePath) }

  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel>Reprendre</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={`Reprendre : ${resume.label}`}
            className="cursor-pointer text-muted-foreground"
            render={<Link to={resume.path} viewTransition />}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            <span className="truncate">
              <span className="sr-only">Reprendre : </span>
              {resume.label}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: status } = useOnboardingStatus()
  const { can, loading: permissionsLoading } = usePermissions()
  const { isMobile, setOpenMobile } = useSidebar()
  const { pathname } = useLocation()

  const stationName = status?.station?.name ?? status?.org_name ?? "WashPilot CI"
  const stationCity = status?.station?.city

  // Sur téléphone la navigation est un tiroir : après un choix, il doit se
  // refermer. Sans cela, le nouvel écran reste caché derrière le panneau.
  React.useEffect(() => {
    if (isMobile) setOpenMobile(false)
  }, [pathname, isMobile, setOpenMobile])

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="min-h-11"
              render={<Link to="/dashboard" viewTransition />}
            >
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
        {NAV_GROUPS.map((group) => {
          const items = permissionsLoading
            ? []
            : (filterNav(group.items as NavEntry[], can) as NavItems)
          if (items.length === 0) return null
          return <NavMain key={group.label} label={group.label} items={items} />
        })}
        <ResumeLastPage />
      </SidebarContent>
      <SidebarFooter>
        <TrialCountdown />
        <NavUser user={{ name: "Utilisateur", email: "", avatar: "" }} />
      </SidebarFooter>
    </Sidebar>
  )
}
