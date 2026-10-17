import { BaseLayout } from "@/components/layouts/base-layout"

export default function TeamPage() {
  return (
    <BaseLayout title="Équipe" description="Gestion des collaborateurs et employés.">
      <div className="p-4">
        <h1 className="text-2xl font-bold">Équipe</h1>
        <p className="text-muted-foreground">
          Gestion des employés en cours de construction (PHASE 5).
        </p>
      </div>
    </BaseLayout>
  )
}
