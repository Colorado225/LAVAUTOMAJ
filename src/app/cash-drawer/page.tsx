import { BaseLayout } from "@/components/layouts/base-layout"

export default function CashDrawerPage() {
  return (
    <BaseLayout title="Caisse" description="Ouverture, clôture et suivi de la caisse.">
      <div className="p-4">
        <h1 className="text-2xl font-bold">Caisse</h1>
        <p className="text-muted-foreground">
          Gestion des sessions de caisse en cours de construction (PHASE 4).
        </p>
      </div>
    </BaseLayout>
  )
}
