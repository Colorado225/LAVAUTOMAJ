import { BaseLayout } from "@/components/layouts/base-layout"

export default function ReportsPage() {
  return (
    <BaseLayout title="Rapports" description="Rapports journaliers, hebdomadaires et mensuels.">
      <div className="p-4">
        <h1 className="text-2xl font-bold">Rapports</h1>
        <p className="text-muted-foreground">
          Module de rapports en cours de construction (PHASE 5).
        </p>
      </div>
    </BaseLayout>
  )
}
