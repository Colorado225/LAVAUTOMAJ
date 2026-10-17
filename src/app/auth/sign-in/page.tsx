import { SignIn, useAuth } from "@clerk/clerk-react"
import { Navigate } from "react-router-dom"
import { Logo } from "@/components/logo"

/**
 * Connexion Clerk, habillée du design existant (carte centrée, logo).
 * Après connexion, OnboardingGate décide de la destination (onboarding ou
 * dashboard) selon l'état de configuration renvoyé par le serveur.
 */
export default function Page() {
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
        <SignIn
          signUpUrl="/auth/sign-up"
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
