"use client"

import { useMemo, useState, type FormEvent } from "react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Badge } from "@/components/ui/badge"
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

interface ServiceCategory {
  id: string
  name: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export default function ServiceCategoriesPage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, loading, error } = useApi<ServiceCategory[]>(`/api/v1/service-categories?refresh=${refreshKey}`)
  const { data: member } = useApi<CurrentMember>(`/api/v1/auth/me?refresh=${refreshKey}`)
  const categories = useMemo(() => data ?? [], [data])
  const canManage = member?.role === "owner" || member?.role === "manager"
  const activeCount = useMemo(() => categories.filter((category) => category.is_active).length, [categories])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<ServiceCategory | null>(null)
  const [name, setName] = useState("")
  const [search, setSearch] = useState("")
  const [saving, setSaving] = useState(false)
  const [busyCategoryId, setBusyCategoryId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null)

  const filteredCategories = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("fr-CI")
    return categories.filter((category) => !query || category.name.toLocaleLowerCase("fr-CI").includes(query))
  }, [categories, search])

  function openCreateDialog() {
    setEditingCategory(null)
    setName("")
    setMutationError(null)
    setMutationSuccess(null)
    setDialogOpen(true)
  }

  function openEditDialog(category: ServiceCategory) {
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
        editingCategory ? `/api/v1/service-categories/${encodeURIComponent(editingCategory.id)}` : "/api/v1/service-categories",
        {
          method: editingCategory ? "PATCH" : "POST",
          body: JSON.stringify({ name: cleanName, is_active: editingCategory?.is_active ?? true }),
        },
      )
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      setDialogOpen(false)
      setMutationSuccess(editingCategory ? "La catégorie de prestation a été mise à jour dans Neon." : "La catégorie de prestation a été créée dans Neon.")
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Impossible d’enregistrer la catégorie.")
    } finally {
      setSaving(false)
    }
  }

  async function toggleCategory(category: ServiceCategory) {
    const nextStatus = !category.is_active
    if (!nextStatus && !window.confirm(`Désactiver « ${category.name} » ? Les prestations et lavages historiques seront conservés.`)) return
    setBusyCategoryId(category.id)
    setMutationError(null)
    setMutationSuccess(null)
    try {
      const response = await apiFetch(`/api/v1/service-categories/${encodeURIComponent(category.id)}`, {
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
    <BaseLayout title="Catégories de prestations" description="Organisez le catalogue des prestations de lavage.">
      <div className="space-y-6 p-4">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <p className="max-w-2xl text-sm text-muted-foreground">Les catégories permettent de classer les prestations. La désactivation les retire des nouvelles sélections sans supprimer l’historique.</p>
          {canManage && <Button onClick={openCreateDialog}><Plus className="mr-2 size-4" />Nouvelle catégorie</Button>}
        </div>
        {mutationSuccess && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{mutationSuccess}</p>}
        {mutationError && !dialogOpen && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{mutationError}</p>}
        {!canManage && member && <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">La modification du catalogue est réservée au propriétaire et aux responsables.</p>}

        <Card>
          <CardHeader><CardTitle>Catégories de prestations</CardTitle><CardDescription>{activeCount} active{activeCount === 1 ? "" : "s"} sur {categories.length} enregistrée{categories.length === 1 ? "" : "s"}.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <Input className="max-w-md" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher une catégorie…" aria-label="Rechercher une catégorie" />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {loading && <p role="status" className="text-sm text-muted-foreground">Synchronisation avec Neon…</p>}
            {!loading && !error && (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead>Nom</TableHead><TableHead>Statut</TableHead>{canManage && <TableHead className="text-right">Actions</TableHead>}</TableRow></TableHeader>
                  <TableBody>
                    {filteredCategories.length === 0 && <TableRow><TableCell colSpan={canManage ? 3 : 2} className="h-24 text-center text-muted-foreground">{categories.length === 0 ? "Aucune catégorie. Créez-en une pour structurer les prestations." : "Aucune catégorie ne correspond à la recherche."}</TableCell></TableRow>}
                    {filteredCategories.map((category) => (
                      <TableRow key={category.id}>
                        <TableCell className="font-medium">{category.name}</TableCell>
                        <TableCell><Badge variant={category.is_active ? "secondary" : "outline"}>{category.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                        {canManage && <TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" aria-label={`Modifier ${category.name}`} onClick={() => openEditDialog(category)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" disabled={busyCategoryId === category.id} aria-label={category.is_active ? `Désactiver ${category.name}` : `Réactiver ${category.name}`} onClick={() => void toggleCategory(category)}>{busyCategoryId === category.id ? <RefreshCw className="size-4 animate-spin" /> : category.is_active ? <ToggleLeft className="size-4" /> : <ToggleRight className="size-4" />}</Button></div></TableCell>}
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
          <DialogHeader><DialogTitle>{editingCategory ? "Modifier la catégorie" : "Nouvelle catégorie"}</DialogTitle><DialogDescription>Les changements sont enregistrés dans Neon et reflétés dans le catalogue des prestations.</DialogDescription></DialogHeader>
          <form onSubmit={saveCategory} className="space-y-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium">Nom de la catégorie<Input required autoFocus maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. Extérieur, Intérieur, Premium" /></label>
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
