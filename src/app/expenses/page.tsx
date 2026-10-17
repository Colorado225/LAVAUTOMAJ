import { BaseLayout } from "@/components/layouts/base-layout"

export default function ExpensesPage() {
  return (
    <BaseLayout title="Dépenses" description="Enregistrement et suivi des dépenses.">
      <div className="p-4">
        <h1 className="text-2xl font-bold">Dépenses</h1>
        <p className="text-muted-foreground">
          Module de gestion des dépenses en cours de construction (PHASE 4).
        </p>
      </div>
    </BaseLayout>
  )
}
