import { BaseLayout } from "@/components/layouts/base-layout"

export default function WashesPage() {
  return (
    <BaseLayout title="Lavages" description="Enregistrement et historique des lavages.">
      <div className="p-4">
        <h1 className="text-2xl font-bold">Lavages</h1>
        <p className="text-muted-foreground">
          Module d'enregistrement des lavages en cours de construction (PHASE 3).
        </p>
      </div>
    </BaseLayout>
  )
}
