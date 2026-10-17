import { createBrowserRouter, RouterProvider } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { SidebarConfigProvider } from "@/contexts/sidebar-context"
import { Toaster } from "@/components/ui/toast"
import { RootFallback, RootLayout } from "@/components/router/root-layout"
import { routes } from "@/config/routes"
import { useEffect } from "react"
import { initGTM } from "@/utils/analytics"
import { ClerkProvider } from "@clerk/clerk-react"

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!publishableKey) {
  throw new Error("VITE_CLERK_PUBLISHABLE_KEY is not defined")
}

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

  return (
    <div
      className="font-sans antialiased"
      style={{ fontFamily: "var(--font-inter)" }}
    >
      <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
        <ClerkProvider publishableKey={publishableKey}>
          <SidebarConfigProvider>
            <Toaster>
              <RouterProvider router={router} />
            </Toaster>
          </SidebarConfigProvider>
        </ClerkProvider>
      </ThemeProvider>
    </div>
  )
}

export default App
