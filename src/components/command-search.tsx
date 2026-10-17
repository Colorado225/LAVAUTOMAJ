"use client"

import { useNavigate } from "react-router-dom"
import {
  Search,
  LayoutPanelLeft,
  Shield,
  AlertTriangle,
  Truck,
  Wallet,
  Receipt,
  BarChart3,
  Users,
  Plus,
  List,
  User,
  CreditCard,
  Palette,
  Bell,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"

interface SearchItem {
  title: string
  url: string
  group: string
  icon?: LucideIcon
}

interface CommandSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandSearch({ open, onOpenChange }: CommandSearchProps) {
  const navigate = useNavigate()

  const searchItems: SearchItem[] = [
    // Principal
    {
      title: "Tableau de bord",
      url: "/dashboard",
      group: "Principal",
      icon: LayoutPanelLeft,
    },
    {
      title: "Nouveau lavage",
      url: "/washes",
      group: "Principal",
      icon: Plus,
    },
    {
      title: "Caisse",
      url: "/cash-drawer",
      group: "Principal",
      icon: Wallet,
    },
    {
      title: "Dépenses",
      url: "/expenses",
      group: "Principal",
      icon: Receipt,
    },
    {
      title: "Rapports",
      url: "/reports",
      group: "Principal",
      icon: BarChart3,
    },
    {
      title: "Équipe",
      url: "/team",
      group: "Principal",
      icon: Users,
    },
    // Configuration
    {
      title: "Onboarding",
      url: "/onboarding",
      group: "Configuration",
      icon: Truck,
    },
    {
      title: "Compte",
      url: "/settings/account",
      group: "Configuration",
      icon: User,
    },
    {
      title: "Facturation",
      url: "/settings/billing",
      group: "Configuration",
      icon: CreditCard,
    },
    {
      title: "Apparence",
      url: "/settings/appearance",
      group: "Configuration",
      icon: Palette,
    },
    {
      title: "Notifications",
      url: "/settings/notifications",
      group: "Configuration",
      icon: Bell,
    },
    // Authentification
    {
      title: "Connexion",
      url: "/auth/sign-in",
      group: "Authentification",
      icon: Shield,
    },
    {
      title: "Inscription",
      url: "/auth/sign-up",
      group: "Authentification",
      icon: Shield,
    },
    {
      title: "Mot de passe oublié",
      url: "/auth/forgot-password",
      group: "Authentification",
      icon: Shield,
    },
    // Erreurs
    {
      title: "Non autorisé",
      url: "/errors/unauthorized",
      group: "Erreurs",
      icon: AlertTriangle,
    },
    {
      title: "Interdit",
      url: "/errors/forbidden",
      group: "Erreurs",
      icon: AlertTriangle,
    },
    {
      title: "Introuvable",
      url: "/errors/not-found",
      group: "Erreurs",
      icon: AlertTriangle,
    },
    {
      title: "Erreur serveur",
      url: "/errors/internal-server-error",
      group: "Erreurs",
      icon: AlertTriangle,
    },
    {
      title: "Maintenance",
      url: "/errors/under-maintenance",
      group: "Erreurs",
      icon: AlertTriangle,
    },
    {
      title: "Prestations",
      url: "/services",
      group: "Principal",
      icon: List,
    },
    {
      title: "Catégories de véhicules",
      url: "/vehicle-categories",
      group: "Principal",
      icon: List,
    },
  ]

  const groupedItems = searchItems.reduce(
    (acc, item) => {
      if (!acc[item.group]) {
        acc[item.group] = []
      }
      acc[item.group].push(item)
      return acc
    },
    {} as Record<string, SearchItem[]>
  )

  const handleSelect = (url: string) => {
    navigate(url)
    onOpenChange(false)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Recherche"
      description="Rechercher des pages et des paramètres"
      className="sm:max-w-[640px]"
    >
      <Command>
        <CommandInput placeholder="Que recherchez-vous ?" autoFocus />
        <CommandList className="max-h-[400px]">
          <CommandEmpty>Aucun résultat.</CommandEmpty>
          {Object.entries(groupedItems).map(([group, items]) => (
            <CommandGroup key={group} heading={group}>
              {items.map((item) => {
                const Icon = item.icon
                return (
                  <CommandItem
                    key={item.url}
                    value={item.title}
                    onSelect={() => handleSelect(item.url)}
                  >
                    {Icon && <Icon />}
                    {item.title}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

export function SearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className="relative w-full justify-start font-normal text-muted-foreground sm:pr-12 md:w-36 lg:w-56"
    >
      <Search data-icon="inline-start" />
      Rechercher...
      <Kbd className="absolute top-1/2 right-1.5 hidden -translate-y-1/2 sm:inline-flex">
        ⌘K
      </Kbd>
    </Button>
  )
}
