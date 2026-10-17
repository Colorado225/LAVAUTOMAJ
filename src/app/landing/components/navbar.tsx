import { useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ArrowRight, Menu, X } from "lucide-react"
import { Link } from "react-router-dom"
import { Logo } from "@/components/logo"

const navigationItems = [
  { name: "Les enjeux", href: "#enjeux" },
  { name: "La démo", href: "#demo" },
  { name: "Fonctionnalités", href: "#fonctionnalites" },
  { name: "Questions", href: "#faq" },
]

export function LandingNavbar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const motionPreference = useReducedMotion()
  const reduceMotion = motionPreference !== false

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link to="/landing" className="flex shrink-0 items-center gap-3 rounded-xl outline-none focus-visible:ring-4 focus-visible:ring-blue-200">
          <span className="grid size-10 place-items-center rounded-2xl bg-[#0c2852] text-white shadow-md shadow-blue-950/15">
            <Logo size={25} />
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-[16px] font-extrabold leading-none tracking-[-0.04em] text-[#102342]">
              WashPilot <span className="text-blue-600">CI</span>
            </span>
            <span className="hidden text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400 sm:block">
              Gestion de station de lavage
            </span>
          </span>
        </Link>

        <nav aria-label="Navigation principale" className="hidden items-center gap-1 lg:flex">
          {navigationItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-full px-3.5 py-2 text-[13px] font-semibold text-slate-600 transition-colors hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none"
            >
              {item.name}
            </a>
          ))}
        </nav>

        <div className="hidden shrink-0 items-center gap-3 lg:flex">
          <Link
            to="/auth/sign-in"
            className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-blue-800 motion-reduce:transition-none"
          >
            Connexion
          </Link>
          <Link
            to="/auth/sign-up"
            className="group inline-flex items-center gap-2 rounded-full bg-[#123d79] px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-blue-900/15 transition duration-200 hover:-translate-y-0.5 hover:bg-[#0d3268] hover:shadow-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/25 motion-reduce:transition-none"
          >
            Créer mon espace <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
          </Link>
        </div>

        <button
          type="button"
          aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-landing-menu"
          onClick={() => setMenuOpen((open) => !open)}
          className="grid size-10 place-items-center rounded-xl border border-slate-200 text-[#102342] transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:hidden motion-reduce:transition-none"
        >
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {menuOpen ? (
          <motion.div
            id="mobile-landing-menu"
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
            className="overflow-hidden border-t border-slate-100 bg-white lg:hidden"
          >
            <nav aria-label="Navigation mobile" className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 sm:px-6">
              {navigationItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl px-3 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-blue-50 hover:text-blue-800 motion-reduce:transition-none"
                >
                  {item.name}
                </a>
              ))}
              <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4">
                <Link
                  to="/auth/sign-in"
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700"
                >
                  Connexion
                </Link>
                <Link
                  to="/auth/sign-up"
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#123d79] px-3 text-sm font-bold text-white"
                >
                  Créer mon espace <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
            </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  )
}
