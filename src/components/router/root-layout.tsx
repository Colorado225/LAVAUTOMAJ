import { Outlet, useLocation, useNavigation, Navigate } from "react-router-dom"
import { SignedIn, SignedOut } from "@clerk/clerk-react"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { OnboardingGate } from "@/components/router/onboarding-gate"
import { OrganizationGate } from "@/components/router/organization-gate"

/** Thin top bar shown while the next route's code is loading. */
function RouteProgress() {
  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      className="route-progress fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/15"
    >
      <div className="route-progress-bar h-full w-1/3 bg-primary" />
    </div>
  )
}

export function RootLayout() {
  const navigation = useNavigation()
  const location = useLocation()
  const isPublicLandingRoute = location.pathname === "/" || location.pathname === "/landing"
  const isAuthRoute = location.pathname.startsWith("/auth/")
  const isOrganizationCreationRoute = location.pathname === "/auth/create-organization"
  const isSignUpRoute = location.pathname === "/auth/sign-up"

  return (
    <>
      {navigation.state === "loading" && <RouteProgress />}
      {isPublicLandingRoute ? (
        <Outlet />
      ) : isAuthRoute ? (
        <>
          {/* Clerk sign-in/up screens must remain reachable before a session exists. */}
          <SignedOut>
            <Outlet />
          </SignedOut>
          <SignedIn>
            {isOrganizationCreationRoute || isSignUpRoute ? (
              <Outlet />
            ) : (
              <Navigate to="/dashboard" replace />
            )}
          </SignedIn>
        </>
      ) : (
        <>
          <SignedOut>
            <Navigate to="/auth/sign-in" replace state={{ from: location.pathname }} />
          </SignedOut>
          <SignedIn>
            <OrganizationGate>
              <OnboardingGate>
                <Outlet />
              </OnboardingGate>
            </OrganizationGate>
          </SignedIn>
        </>
      )}
    </>
  )
}

/** Shown on the very first load, before any route has rendered. */
export function RootFallback() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <LoadingSpinner />
    </div>
  )
}
