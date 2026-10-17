"use client"

import { useState, type FormEvent } from "react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { apiFetch, getClerkToken, useApi } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Plus, RefreshCw } from "lucide-react"

interface VehicleCategory {
  id: string
  name: string
  is_active: boolean
}

export default function VehicleCategoriesPage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, loading, error } = useApi<VehicleCategory[]>(
    `/api/v1/vehicle-categories?refresh=${refreshKey}`
  )
  const categories = data ?? []
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) {
      setMutationError("Saisissez le nom de la catégorie.")
      return
    }
    setSaving(true)
    setMutationError(null)
    try {
      const token = await getClerkToken()
      const response = await apiFetch(
        "/api/v1/vehicle-categories",
        {
          method: "POST",
          body: JSON.stringify({ name: cleanName, is_active: true }),
        },
        token
      )
      if (!response.ok) throw new Error((await response.text()) || `Erreur ${response.status}`)
      setName("")
      setFormOpen(false)
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Impossible de créer la catégorie.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <BaseLayout title="Catégories de véhicules" description="Gérez les catégories de véhicules.">
      <div className="space-y-6 p-4">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Catégories de véhicules</h1>
            <p className="text-muted-foreground">
              Configurez les catégories utilisées lors de l’enregistrement d’un lavage.
            </p>
          </div>
          <Button onClick={() => {
            setMutationError(null)
            setFormOpen((open) => !open)
          }}>
            <Plus className="mr-2 size-4" /> Nouvelle catégorie
          </Button>
        </div>

        {formOpen && (
          <form onSubmit={createCategory} className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium">
              Nom de la catégorie
              <Input
                autoFocus
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex. Voiture, Moto, Utilitaire"
              />
            </label>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
              Créer
            </Button>
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Annuler</Button>
            {mutationError && <p role="alert" className="basis-full text-sm text-destructive">{mutationError}</p>}
          </form>
        )}

        {error && <div role="alert" className="text-sm text-destructive">{error}</div>}
        {loading && <div className="text-sm text-muted-foreground">Chargement…</div>}
        {!loading && !error && (
          <div className="overflow-x-auto rounded-lg border bg-card">
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
                    <TableCell colSpan={2} className="h-24 text-center text-muted-foreground">
                      Aucune catégorie enregistrée. Ajoutez-en une pour pouvoir enregistrer des lavages.
                    </TableCell>
                  </TableRow>
                )}
                {categories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">{category.name}</TableCell>
                    <TableCell>{category.is_active ? "Actif" : "Inactif"}</TableCell>
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
