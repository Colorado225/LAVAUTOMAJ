import { BaseLayout } from "@/components/layouts/base-layout"

export default function DashboardPage() {
  return (
    <BaseLayout title="Tableau de bord" description="Vue d'ensemble de votre station de lavage.">
      <div className="p-4">
        <h1 className="text-2xl font-bold">Tableau de bord</h1>
        <p className="text-muted-foreground">
          Indicateurs d'activité en cours de construction (PHASE 2).
        </p>
      </div>
    </BaseLayout>
  )
}
