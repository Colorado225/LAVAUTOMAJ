import { useApi } from "@/lib/api"
import { OnboardingWizard } from "./components/onboarding-wizard"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Button } from "@/components/ui/button"
import { useAuth } from "@clerk/clerk-react"
import type { OnboardingProgress } from "@/lib/onboarding-api"

/**
 * Assistant d'onboarding multi-étapes (§5-§9 de docs/WORKFLOW.md).
 * L'étape courante vient du serveur (onboarding_progress) : rafraîchir ou
 * se déconnecter ne perd jamais la progression.
 */
export default function OnboardingPage() {
  const { isSignedIn } = useAuth()
  const {
    data: progress,
    loading,
    error,
  } = useApi<OnboardingProgress>("/api/v1/onboarding/progress")

  if (!isSignedIn || loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <LoadingSpinner className="size-8" />
      </div>
    )
  }

  if (error) {
    return (
      <BaseLayout title="Onboarding">
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          <p className="text-destructive">{error}</p>
          <Button onClick={() => window.location.reload()}>Réessayer</Button>
        </div>
      </BaseLayout>
    )
  }

  return (
    <BaseLayout
      title="Onboarding"
      description="Création et configuration de votre station."
    >
      <OnboardingWizard
        progress={progress}
        onDone={() => window.location.reload()}
        onQuit={() => {
          window.location.href = "/dashboard"
        }}
      />
    </BaseLayout>
  )
}
