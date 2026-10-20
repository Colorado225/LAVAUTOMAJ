"use client"

import { useMemo, useState, type FormEvent } from "react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { Pencil, Plus, RefreshCw, Search, ToggleLeft, ToggleRight } from "lucide-react"

interface Service {
  id: string
  name: string
  price_cents: number
  price_by_vehicle_type: Record<string, number> | null
  category_id: string | null
  duration_minutes: number | null
  is_active: boolean
}

interface ServiceCategory {
  id: string
  name: string
  is_active: boolean
}

interface ServiceForm {
  name: string
  price_xof: string
  category_id: string | null
  duration_minutes: string
  price_by_vehicle_type: Record<string, string>
}

const emptyForm = (): ServiceForm => ({
  name: "",
  price_xof: "",
  category_id: null,
  duration_minutes: "",
  price_by_vehicle_type: {},
})

function parseXofAmount(value: string): number | null {
  if (!value.trim()) return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return null
  const cents = Math.round(amount * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

function formatXof(cents: number) {
  return `${(cents / 100).toLocaleString("fr-CI", { maximumFractionDigits: 2 })} XOF`
}

export default function ServicesPage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const { data: services, loading, error } = useApi<Service[]>(`/api/v1/services?refresh=${refreshKey}`)
  const { data: categories, loading: categoriesLoading, error: categoriesError } = useApi<ServiceCategory[]>(`/api/v1/service-categories?refresh=${refreshKey}`)
  const { data: vehicleCategories, loading: vehicleCategoriesLoading } = useApi<VehicleCategory[]>(`/api/v1/vehicle-categories?refresh=${refreshKey}`)
  const { data: member } = useApi<CurrentMember>(`/api/v1/auth/me?refresh=${refreshKey}`)
  const servicesList = useMemo(() => services ?? [], [services])
  const categoryById = useMemo(() => new Map((categories ?? []).map((category) => [category.id, category.name])), [categories])
  const vehicleCategoryById = useMemo(() => new Map((vehicleCategories ?? []).map((vc) => [vc.id, vc.name])), [vehicleCategories])
  const canManage = member?.role === "owner" || member?.role === "manager"

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingService, setEditingService] = useState<Service | null>(null)
  const [form, setForm] = useState<ServiceForm>(emptyForm)
  const availableCategories = useMemo(
    () => (categories ?? []).filter((category) => category.is_active || category.id === form.category_id),
    [categories, form.category_id],
  )
  const [search, setSearch] = useState("")
  const [saving, setSaving] = useState(false)
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null)

  const filteredServices = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("fr-CI")
    return servicesList.filter((service) => !query || service.name.toLocaleLowerCase("fr-CI").includes(query))
  }, [servicesList, search])

  function openCreateDialog() {
    setEditingService(null)
    setForm(emptyForm())
    setMutationError(null)
    setMutationSuccess(null)
    setDialogOpen(true)
  }

  function openEditDialog(service: Service) {
    setEditingService(service)
    setForm({
      name: service.name,
      price_xof: String(service.price_cents / 100),
      category_id: service.category_id,
      duration_minutes: service.duration_minutes == null ? "" : String(service.duration_minutes),
      price_by_vehicle_type: Object.fromEntries(
        Object.entries(service.price_by_vehicle_type ?? {}).map(([k, v]) => [k, String(v / 100)])
      ),
    })
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

  async function saveService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = form.name.trim()
    const priceCents = parseXofAmount(form.price_xof)
    const durationMinutes = form.duration_minutes.trim() ? Number(form.duration_minutes) : null
    if (!name || name.length > 100 || priceCents == null) {
      setMutationError("Saisissez un nom (100 caractères maximum) et un prix valide.")
      return
    }
    if (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)) {
      setMutationError("La durée doit être comprise entre 1 et 1 440 minutes.")
      return
    }

    setSaving(true)
    setMutationError(null)
    try {
      const body = {
        name,
        price_cents: priceCents,
        category_id: form.category_id,
        duration_minutes: durationMinutes,
        is_active: editingService?.is_active ?? true,
      }
      const response = await apiFetch(
        editingService ? `/api/v1/services/${encodeURIComponent(editingService.id)}` : "/api/v1/services",
        {
          method: editingService ? "PATCH" : "POST",
          body: JSON.stringify(body),
        },
      )
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      setDialogOpen(false)
      setMutationSuccess(editingService ? "La prestation a été mise à jour dans Neon." : "La prestation a été créée dans Neon.")
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Impossible d’enregistrer la prestation.")
    } finally {
      setSaving(false)
    }
  }

  async function toggleService(service: Service) {
    const nextStatus = !service.is_active
    if (!nextStatus && !window.confirm(`Désactiver « ${service.name} » ? Les lavages historiques conserveront leurs prix enregistrés.`)) return
    setBusyServiceId(service.id)
    setMutationError(null)
    setMutationSuccess(null)
    try {
      const response = await apiFetch(`/api/v1/services/${encodeURIComponent(service.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: nextStatus }),
      })
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      setMutationSuccess(nextStatus ? "La prestation a été réactivée dans Neon." : "La prestation a été désactivée dans Neon.")
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Impossible de modifier la prestation.")
    } finally {
      setBusyServiceId(null)
    }
  }

  return (
    <BaseLayout title="Prestations" description="Gérez les prestations et tarifs utilisés dans les lavages.">
      <div className="space-y-6 p-4">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-sm text-muted-foreground">Les modifications sont enregistrées dans l’organisation active. Les prix historiques restent figés sur chaque lavage.</p>
          </div>
          {canManage && <Button onClick={openCreateDialog}><Plus className="mr-2 size-4" />Nouvelle prestation</Button>}
        </div>

        {mutationSuccess && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{mutationSuccess}</p>}
        {mutationError && !dialogOpen && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{mutationError}</p>}
        {!canManage && member && <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">La création et la modification du catalogue sont réservées au propriétaire et aux responsables.</p>}

        <Card>
          <CardHeader>
            <CardTitle>Catalogue des prestations</CardTitle>
            <CardDescription>{services.length} prestation{services.length === 1 ? "" : "s"} enregistrée{services.length === 1 ? "" : "s"}. Les prestations inactives sont conservées pour l’historique.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher une prestation…" aria-label="Rechercher une prestation" />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {categoriesError && <p role="alert" className="text-sm text-destructive">Impossible de charger les catégories : {categoriesError}</p>}
            {(loading || categoriesLoading) && <p role="status" className="text-sm text-muted-foreground">Synchronisation du catalogue…</p>}
            {!loading && !error && (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead>Prestation</TableHead><TableHead>Catégorie</TableHead><TableHead>Durée</TableHead><TableHead className="text-right">Prix</TableHead><TableHead>Statut</TableHead>{canManage && <TableHead className="text-right">Actions</TableHead>}</TableRow></TableHeader>
                  <TableBody>
                    {filteredServices.length === 0 && <TableRow><TableCell colSpan={canManage ? 6 : 5} className="h-24 text-center text-muted-foreground">{services.length === 0 ? "Aucune prestation enregistrée. Ajoutez-en pour créer des lavages." : "Aucune prestation ne correspond à la recherche."}</TableCell></TableRow>}
                    {filteredServices.map((service) => (
                      <TableRow key={service.id}>
                        <TableCell className="font-medium">{service.name}</TableCell>
                        <TableCell>{service.category_id ? categoryById.get(service.category_id) ?? "Catégorie archivée" : "—"}</TableCell>
                        <TableCell>{service.duration_minutes ? `${service.duration_minutes} min` : "—"}</TableCell>
                        <TableCell className="text-right">{formatXof(service.price_cents)}</TableCell>
                        <TableCell><Badge variant={service.is_active ? "secondary" : "outline"}>{service.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                        {canManage && <TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" aria-label={`Modifier ${service.name}`} onClick={() => openEditDialog(service)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" disabled={busyServiceId === service.id} aria-label={service.is_active ? `Désactiver ${service.name}` : `Réactiver ${service.name}`} onClick={() => void toggleService(service)}>{busyServiceId === service.id ? <RefreshCw className="size-4 animate-spin" /> : service.is_active ? <ToggleLeft className="size-4" /> : <ToggleRight className="size-4" />}</Button></div></TableCell>}
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingService ? "Modifier la prestation" : "Nouvelle prestation"}</DialogTitle>
            <DialogDescription>Les changements sont enregistrés dans la base Neon de l’organisation active.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveService} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">Nom de la prestation<Input required maxLength={100} value={form.name} onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))} placeholder="Ex. Lavage moteur" /></label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">Prix (XOF)<Input required type="number" min={0} step="any" value={form.price_xof} onChange={(event) => setForm((previous) => ({ ...previous, price_xof: event.target.value }))} placeholder="0" /></label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">Durée (minutes)<Input type="number" min={1} max={1440} step={1} value={form.duration_minutes} onChange={(event) => setForm((previous) => ({ ...previous, duration_minutes: event.target.value }))} placeholder="Facultatif" /></label>
              <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">Catégorie
                <Select value={form.category_id ?? "none"} onValueChange={(value) => setForm((previous) => ({ ...previous, category_id: value && value !== "none" ? String(value) : null }))}>
                  <SelectTrigger><SelectValue placeholder="Sans catégorie" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Sans catégorie</SelectItem>{availableCategories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}{category.is_active ? "" : " (inactive)"}</SelectItem>)}</SelectContent>
                </Select>
              </label>
            </div>
            {mutationError && <p role="alert" className="text-sm text-destructive">{mutationError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleDialogChange(false)} disabled={saving}>Annuler</Button>
              <Button type="submit" disabled={saving || !form.name.trim() || parseXofAmount(form.price_xof) == null}>{saving && <RefreshCw className="mr-2 size-4 animate-spin" />}{editingService ? "Enregistrer" : "Créer la prestation"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </BaseLayout>
  )
}
