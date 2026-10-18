import { Outlet, useLocation, useNavigation, Navigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { OnboardingGate } from "@/components/router/onboarding-gate"
import { OrganizationGate } from "@/components/router/organization-gate"

/** Thin top bar shown while the next route's code is loading. */
function RouteProgress() {
  return (
    <div
      role="progressbar"
      aria-label="Chargement de la page"
      className="route-progress fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/15"
    >
      <div className="route-progress-bar h-full w-1/3 bg-primary" />
    </div>
  )
}

function AuthLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status" aria-label="Vérification de la session Clerk">
      <LoadingSpinner className="size-8" />
    </div>
  )
}

export function RootLayout() {
  const navigation = useNavigation()
  const location = useLocation()
  const { isLoaded, isSignedIn } = useAuth()
  const isPublicLandingRoute = location.pathname === "/" || location.pathname === "/landing"
  const isAuthRoute = location.pathname.startsWith("/auth/")
  const isOrganizationCreationRoute = location.pathname === "/auth/create-organization"
  const isOrganizationSelectionRoute = location.pathname === "/auth/select-organization"
  const isSignUpRoute = location.pathname === "/auth/sign-up"

  if (!isLoaded) return <AuthLoading />

  if (isPublicLandingRoute) {
    return <>
      {navigation.state === "loading" && <RouteProgress />}
      <Outlet />
    </>
  }

  if (isAuthRoute) {
    if (!isSignedIn) {
      if (isOrganizationCreationRoute || isOrganizationSelectionRoute) {
        return <Navigate to="/auth/sign-in" replace state={{ from: location.pathname }} />
      }
      return <>
        {navigation.state === "loading" && <RouteProgress />}
        <Outlet />
      </>
    }

    // Sign-up stays reachable to explain an existing session and provide an
    // explicit account-switch flow. Organization creation is also a valid next
    // step for a freshly authenticated user. Sign-in/reset pages redirect.
    if (isOrganizationCreationRoute || isOrganizationSelectionRoute || isSignUpRoute) {
      return <>
        {navigation.state === "loading" && <RouteProgress />}
        <Outlet />
      </>
    }
    return <Navigate to="/dashboard" replace />
  }

  if (!isSignedIn) {
    return <Navigate to="/auth/sign-in" replace state={{ from: `${location.pathname}${location.search}` }} />
  }

  return (
    <>
      {navigation.state === "loading" && <RouteProgress />}
      <OrganizationGate>
        <OnboardingGate>
          <Outlet />
        </OnboardingGate>
      </OrganizationGate>
    </>
  )
}

/** Shown on the very first load, before any route has rendered. */
export function RootFallback() {
  return <AuthLoading />
}
