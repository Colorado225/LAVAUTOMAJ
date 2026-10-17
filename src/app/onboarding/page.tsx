import { BaseLayout } from "@/components/layouts/base-layout"

export default function OnboardingPage() {
  return (
    <BaseLayout title="Onboarding" description="Création et configuration de votre entreprise.">
      <div className="p-4">
        <h1 className="text-2xl font-bold">Onboarding</h1>
        <p className="text-muted-foreground">
          Assistant de création d'entreprise en cours de construction (PHASE 1 / MODULE 1).
        </p>
      </div>
    </BaseLayout>
  )
}
