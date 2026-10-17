import { SignUp, useAuth } from "@clerk/clerk-react"
import { Navigate } from "react-router-dom"
import { Logo } from "@/components/logo"

/**
 * Inscription Clerk, habillée du design existant. Après inscription,
 * OnboardingGate démarre automatiquement le parcours d'onboarding.
 */
export default function SignUpPage() {
  const { isSignedIn } = useAuth()
  if (isSignedIn) {
    return <Navigate to="/dashboard" replace />
  }
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <a href="/" className="flex items-center gap-2 self-center font-medium">
          <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-md">
            <Logo size={24} />
          </div>
          WashPilot CI
        </a>
        <SignUp
          signInUrl="/auth/sign-in"
          fallbackRedirectUrl="/dashboard"
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "shadow-none",
            },
          }}
        />
      </div>
    </div>
  )
}
