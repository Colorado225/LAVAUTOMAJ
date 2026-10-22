"use client"

import * as React from "react"
import { ChevronRight, type LucideIcon } from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import { motion } from "framer-motion"
import { SPRING } from "@/lib/motion"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

export function NavMain({
  label,
  items,
}: {
  label: string
  items: {
    title: string
    url: string
    icon?: LucideIcon
    isActive?: boolean
    items?: {
      title: string
      url: string
      isActive?: boolean
    }[]
  }[]
}) {
  const location = useLocation()

  React.useEffect(() => {
    window.localStorage.setItem("washpilot:last-visited-route", location.pathname)
  }, [location.pathname])

  // Check if any subitem is active to determine if parent should be open
  const shouldBeOpen = (item: (typeof items)[0]) => {
    if (item.isActive) return true
    return (
      item.items?.some((subItem) => location.pathname === subItem.url) || false
    )
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <Collapsible
            key={item.title}
            defaultOpen={shouldBeOpen(item)}
            className="group/collapsible"
            render={<SidebarMenuItem />}
          >
            {item.items?.length ? (
              <>
                <CollapsibleTrigger
                  render={
                    <SidebarMenuButton
                      tooltip={item.title}
                      className="cursor-pointer"
                    />
                  }
                >
                  {item.icon && <item.icon />}
                  <span>{item.title}</span>
                  <ChevronRight className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items?.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <SidebarMenuSubButton
                          className="cursor-pointer"
                          isActive={location.pathname === subItem.url}
                          render={<Link to={subItem.url} viewTransition />}
                        >
                          <span>{subItem.title}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </>
            ) : (
              <SidebarMenuButton
                tooltip={item.title}
                // Le fond actif est dessiné par l'indicateur animé ci-dessous.
                className="group/nav relative isolate cursor-pointer transition-transform duration-150 ease-out hover:translate-x-0.5 data-active:bg-transparent"
                isActive={location.pathname === item.url}
                render={<Link to={item.url} viewTransition />}
              >
                {location.pathname === item.url && (
                  /* Un seul indicateur pour tout le menu : il glisse d'un
                     élément à l'autre au lieu de clignoter d'un écran à l'autre. */
                  <motion.span
                    layoutId="sidebar-active-indicator"
                    className="edge-3d absolute inset-0 -z-10 rounded-md bg-sidebar-accent"
                    transition={SPRING.snappy}
                  />
                )}
                {item.icon && (
                  <item.icon className="transition-transform duration-150 ease-out group-hover/nav:scale-110" />
                )}
                <span>{item.title}</span>
              </SidebarMenuButton>
            )}
          </Collapsible>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
