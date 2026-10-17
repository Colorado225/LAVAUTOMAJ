import { Outlet, useNavigation, Navigate } from "react-router-dom"
import { SignedIn, SignedOut } from "@clerk/clerk-react"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { OnboardingGate } from "@/components/router/onboarding-gate"

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
  return (
    <>
      {navigation.state === "loading" && <RouteProgress />}
      {/*
        Garde d'authentification globale (§2-§3 du WORKFLOW) : un visiteur
        non connecté est renvoyé vers la connexion ; un compte non configuré
        est renvoyé vers l'onboarding par OnboardingGate.
      */}
      <SignedOut>
        <Navigate to="/auth/sign-in" replace />
      </SignedOut>
      <SignedIn>
        <OnboardingGate>
          <Outlet />
        </OnboardingGate>
      </SignedIn>
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
