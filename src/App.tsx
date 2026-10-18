import { createBrowserRouter, RouterProvider } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { RootFallback, RootLayout } from "@/components/router/root-layout"
import { routes } from "@/config/routes"
import { useEffect } from "react"
import { initGTM } from "@/utils/analytics"
import { ClerkProvider } from "@clerk/clerk-react"
import { ClerkTokenBridge } from "@/lib/api"

const publishableKey =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

// Get basename from environment (for deployment) or use empty string for development
const basename = import.meta.env.VITE_BASENAME || ""

const router = createBrowserRouter(
  [
    {
      element: <RootLayout />,
      HydrateFallback: RootFallback,
      children: routes,
    },
  ],
  { basename }
)

function App() {
  // Initialize GTM on app load
  useEffect(() => {
    initGTM()
  }, [])

  if (!publishableKey) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center text-slate-900">
        <h1 className="text-2xl font-bold">Configuration Clerk requise</h1>
        <p className="max-w-xl text-sm leading-6 text-slate-600">
          Ajoutez <code className="rounded bg-slate-200 px-1.5 py-0.5">VITE_CLERK_PUBLISHABLE_KEY</code> (ou l'alias public <code className="rounded bg-slate-200 px-1.5 py-0.5">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code>) à votre environnement puis redémarrez le serveur. L'authentification est gérée par Clerk et les profils sont synchronisés dans Neon côté serveur.
        </p>
      </main>
    )
  }

  return (
    <div
      className="font-sans antialiased"
      style={{ fontFamily: "var(--font-inter)" }}
    >
      <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
        <ClerkProvider publishableKey={publishableKey}>
          <ClerkTokenBridge />
          <Toaster>
            <RouterProvider router={router} />
          </Toaster>
        </ClerkProvider>
      </ThemeProvider>
    </div>
  )
}

export default App
