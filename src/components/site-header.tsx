"use client"

import * as React from "react"
import { MoonStar, Sun } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { CommandSearch, SearchTrigger } from "@/components/command-search"
import { useCircularTransition } from "@/hooks/use-circular-transition"
import { useTheme } from "@/hooks/use-theme"
import { useMediaQuery } from "@/hooks/use-media-query"

/**
 * Bascule clair/sombre : la nouvelle interface est révélée par un cercle qui
 * s'ouvre depuis le point cliqué (API View Transitions, repli instantané sur
 * les navigateurs qui ne la gèrent pas).
 */
function ThemeToggle() {
  const { theme } = useTheme()
  const { toggleTheme } = useCircularTransition()
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)")
  const isDark = theme === "dark" || (theme === "system" && prefersDark)

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={isDark ? "Activer le thème clair" : "Activer le thème sombre"}
      title={isDark ? "Thème clair" : "Thème sombre"}
      className="relative overflow-hidden"
    >
      <Sun
        className={`size-4 transition-all duration-300 ${
          isDark ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
        }`}
        aria-hidden="true"
      />
      <MoonStar
        className={`absolute size-4 transition-all duration-300 ${
          isDark ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0"
        }`}
        aria-hidden="true"
      />
    </Button>
  )
}

export function SiteHeader() {
  const [searchOpen, setSearchOpen] = React.useState(false)

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
          <div className="max-w-sm flex-1">
            <SearchTrigger onClick={() => setSearchOpen(true)} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  )
}
