import { CreateOrganization, useAuth, useOrganization } from "@clerk/clerk-react"
import { Navigate } from "react-router-dom"
import { Logo } from "@/components/logo"
import { LoadingSpinner } from "@/components/ui/loading-spinner"

export default function CreateOrganizationPage() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth()
  const { isLoaded: organizationLoaded, organization } = useOrganization()

  if (!authLoaded || (isSignedIn && !organizationLoaded)) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <LoadingSpinner className="size-8" />
      </div>
    )
  }

  if (!isSignedIn) {
    return <Navigate to="/auth/sign-in" replace />
  }

  if (organization) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-lg flex-col items-center gap-6">
        <a href="/" className="flex items-center gap-2 font-medium">
          <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-md">
            <Logo size={24} />
          </div>
          WashPilot CI
        </a>
        <div className="w-full rounded-xl border bg-card p-4 shadow-sm">
          <h1 className="mb-2 text-center text-xl font-semibold">Créez votre organisation</h1>
          <p className="mb-6 text-center text-sm text-muted-foreground">
            Votre station sera configurée à l’étape suivante.
          </p>
          <CreateOrganization
            routing="virtual"
            afterCreateOrganizationUrl="/onboarding"
            skipInvitationScreen
          />
        </div>
      </div>
    </div>
  )
}
