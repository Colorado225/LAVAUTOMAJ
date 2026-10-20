"use client"

import type * as React from "react"

import { useMemo, useState, type FormEvent } from "react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { useCapability } from "@/lib/subscription"
import { Badge } from "@/components/ui/badge"
import { TableSkeleton } from "@/components/ui/table-skeleton"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { apiErrorMessage, apiFetch, useApi } from "@/lib/api"
import type { CurrentMember } from "@/lib/team-api"
import { Pencil, Plus, RefreshCw, ToggleLeft, ToggleRight } from "lucide-react"

interface VehicleCategory {
  id: string
  name: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export default function VehicleCategoriesPage() {
  const manageCatalog = useCapability("catalog.manage")
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, loading, error } = useApi<VehicleCategory[]>(`/api/v1/vehicle-categories?refresh=${refreshKey}`)
  const { data: member } = useApi<CurrentMember>(`/api/v1/auth/me?refresh=${refreshKey}`)
  const categories = useMemo(() => data ?? [], [data])
  const canManage = member?.role === "owner" || member?.role === "manager"
  const activeCount = useMemo(() => categories.filter((category) => category.is_active).length, [categories])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<VehicleCategory | null>(null)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [busyCategoryId, setBusyCategoryId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null)

  function openCreateDialog() {
    setEditingCategory(null)
    setName("")
    setMutationError(null)
    setMutationSuccess(null)
    setDialogOpen(true)
  }

  function openEditDialog(category: VehicleCategory) {
    setEditingCategory(category)
    setName(category.name)
    setMutationError(null)
    setMutationSuccess(null)
    setDialogOpen(true)
  }

  function handleDialogChange(open: boolean) {
    if (open) setDialogOpen(true)
    else if (!saving) {
      setDialogOpen(false)
      setMutationError(null)
    }
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName || cleanName.length > 100) {
      setMutationError("Saisissez un nom de catégorie de 1 à 100 caractères.")
      return
    }
    setSaving(true)
    setMutationError(null)
    try {
      const response = await apiFetch(
        editingCategory ? `/api/v1/vehicle-categories/${encodeURIComponent(editingCategory.id)}` : "/api/v1/vehicle-categories",
        {
          method: editingCategory ? "PATCH" : "POST",
          body: JSON.stringify({ name: cleanName, is_active: editingCategory?.is_active ?? true }),
        },
      )
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      setDialogOpen(false)
      setMutationSuccess(editingCategory ? "La catégorie a été mise à jour dans Neon." : "La catégorie a été créée dans Neon.")
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Impossible d’enregistrer la catégorie.")
    } finally {
      setSaving(false)
    }
  }

  async function toggleCategory(category: VehicleCategory) {
    const nextStatus = !category.is_active
    if (!nextStatus && !window.confirm(`Désactiver « ${category.name} » ? Les lavages déjà enregistrés conserveront leur historique.`)) return
    setBusyCategoryId(category.id)
    setMutationError(null)
    setMutationSuccess(null)
    try {
      const response = await apiFetch(`/api/v1/vehicle-categories/${encodeURIComponent(category.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: nextStatus }),
      })
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      setMutationSuccess(nextStatus ? "La catégorie a été réactivée dans Neon." : "La catégorie a été désactivée dans Neon.")
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Impossible de modifier la catégorie.")
    } finally {
      setBusyCategoryId(null)
    }
  }

  return (
    <BaseLayout title="Catégories de véhicules" description="Gérez les catégories de véhicules utilisées lors de la création d’un lavage.">
      <div className="space-y-6 p-4">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div><p className="text-sm text-muted-foreground">La désactivation masque une catégorie des nouveaux lavages sans effacer les anciens enregistrements.</p></div>
          {canManage && <Button onClick={openCreateDialog} disabled={!manageCatalog.allowed} title={manageCatalog.reason ?? undefined}><Plus className="mr-2 size-4" />Nouvelle catégorie</Button>}
        </div>
        {mutationSuccess && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{mutationSuccess}</p>}
        {mutationError && !dialogOpen && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{mutationError}</p>}
        {!canManage && member && <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">La modification du catalogue est réservée au propriétaire et aux responsables.</p>}

        <Card>
          <CardHeader><CardTitle>Catégories</CardTitle><CardDescription>{activeCount} active{activeCount === 1 ? "" : "s"} sur {categories.length} enregistrée{categories.length === 1 ? "" : "s"}.</CardDescription></CardHeader>
          <CardContent>
            {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
            {loading && <div className="mb-3"><TableSkeleton rows={4} cols={3} label="Synchronisation des catégories" /></div>}
            {!loading && !error && (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead>Nom</TableHead><TableHead>Statut</TableHead>{canManage && <TableHead className="text-right">Actions</TableHead>}</TableRow></TableHeader>
                  <TableBody>
                    {categories.length === 0 && <TableRow><TableCell colSpan={canManage ? 3 : 2} className="h-24 text-center text-muted-foreground">Aucune catégorie enregistrée. Ajoutez les types de véhicules pris en charge.</TableCell></TableRow>}
                    {categories.map((category, index) => (
                      <TableRow key={category.id} className="row-in" style={{ "--row": Math.min(index, 10) } as React.CSSProperties}>
                        <TableCell className="font-medium">{category.name}</TableCell>
                        <TableCell><Badge variant={category.is_active ? "secondary" : "outline"}>{category.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                        {canManage && <TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" disabled={!manageCatalog.allowed} title={manageCatalog.reason ?? undefined} aria-label={`Modifier ${category.name}`} onClick={() => openEditDialog(category)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" title={manageCatalog.reason ?? undefined} disabled={!manageCatalog.allowed || busyCategoryId === category.id} aria-label={category.is_active ? `Désactiver ${category.name}` : `Réactiver ${category.name}`} onClick={() => void toggleCategory(category)}>{busyCategoryId === category.id ? <RefreshCw className="size-4 animate-spin" /> : category.is_active ? <ToggleLeft className="size-4" /> : <ToggleRight className="size-4" />}</Button></div></TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editingCategory ? "Modifier la catégorie" : "Nouvelle catégorie"}</DialogTitle><DialogDescription>Les changements sont enregistrés dans Neon et utilisés par les nouveaux lavages.</DialogDescription></DialogHeader>
          <form onSubmit={saveCategory} className="space-y-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium">Nom de la catégorie<Input required autoFocus maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. Voiture, Moto, Utilitaire" /></label>
            {mutationError && <p role="alert" className="text-sm text-destructive">{mutationError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleDialogChange(false)} disabled={saving}>Annuler</Button>
              <Button type="submit" disabled={saving || !name.trim()}>{saving && <RefreshCw className="mr-2 size-4 animate-spin" />}{editingCategory ? "Enregistrer" : "Créer la catégorie"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </BaseLayout>
  )
}
