import { createBrowserRouter, RouterProvider } from "react-router-dom"
import { MotionConfig } from "framer-motion"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { RootFallback, RootLayout } from "@/components/router/root-layout"
import { routes } from "@/config/routes"
import { useEffect } from "react"
import { initGTM } from "@/utils/analytics"
import { AuthProvider } from "@/lib/auth"

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
      {/* reducedMotion="user" : framer-motion neutralise automatiquement les
          animations si le système demande un mouvement réduit. */}
      <MotionConfig reducedMotion="user">
        <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
          <AuthProvider>
            <Toaster>
              <RouterProvider router={router} />
            </Toaster>
          </AuthProvider>
        </ThemeProvider>
      </MotionConfig>
    </div>
  )
}

export default App
