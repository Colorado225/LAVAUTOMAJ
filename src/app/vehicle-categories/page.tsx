"use client"

import { BaseLayout } from "@/components/layouts/base-layout"
import { useApi } from "@/lib/api"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

interface VehicleCategory {
  id: string
  name: string
  is_active: boolean
}

export default function VehicleCategoriesPage() {
  const { data, loading, error } = useApi<VehicleCategory[]>(
    "/api/v1/vehicle-categories"
  )
  const categories = data ?? []

  return (
    <BaseLayout title="Catégories de véhicules" description="Gérez les catégories de véhicules.">
      <div className="p-4">
        <div className="flex md:flex-row flex-col md:items-center justify-between gap-4 mb-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              Catégories de véhicules
            </h1>
            <p className="text-muted-foreground">
              Configurez les catégories de véhicules accueillies.
            </p>
          </div>
          <Button onClick={() => {}}>
            <Plus className="mr-2" /> Nouvelle catégorie
          </Button>
        </div>

        {loading && <div className="text-muted-foreground">Chargement…</div>}
        {error && <div className="text-destructive">{error}</div>}
        {!loading && !error && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground">
                      Aucune catégorie enregistrée.
                    </TableCell>
                  </TableRow>
                )}
                {categories.map((cat) => (
                  <TableRow key={cat.id}>
                    <TableCell>{cat.name}</TableCell>
                    <TableCell>{cat.is_active ? "Actif" : "Inactif"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </BaseLayout>
  )
}
