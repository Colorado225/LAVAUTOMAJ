"use client"

import { useMemo, useState, type FormEvent } from "react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { useAccess } from "@/lib/permissions"
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
import { TableSkeleton } from "@/components/ui/table-skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { apiErrorMessage, apiFetch, useApi } from "@/lib/api"
import type { OnboardingSummary } from "@/lib/onboarding-api"
import {
  emptySiteInput,
  siteInputFrom,
  type SiteInput,
  type SiteRecord,
} from "@/lib/sites-api"
import {
  Building2,
  MapPin,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
} from "lucide-react"

export default function SitesPage() {
  const canManage = useAccess("settings:manage")
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, loading, error } = useApi<SiteRecord[]>(`/api/v1/sites?refresh=${refreshKey}`)
  const { data: summary } = useApi<OnboardingSummary>("/api/v1/onboarding/summary")

  const sites = useMemo(() => data ?? [], [data])
  const activeSites = useMemo(() => sites.filter((site) => site.is_active), [sites])
  const siteLimit = summary?.plan?.max_sites
  const limitReached =
    siteLimit !== null && siteLimit !== undefined && activeSites.length >= siteLimit

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSite, setEditingSite] = useState<SiteRecord | null>(null)
  const [form, setForm] = useState<SiteInput>(emptySiteInput)
  const [saving, setSaving] = useState(false)
  const [busySiteId, setBusySiteId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null)

  function openCreateDialog() {
    setEditingSite(null)
    setForm(emptySiteInput())
    setMutationError(null)
    setMutationSuccess(null)
    setDialogOpen(true)
  }

  function openEditDialog(site: SiteRecord) {
    setEditingSite(site)
    setForm(siteInputFrom(site))
    setMutationError(null)
    setMutationSuccess(null)
    setDialogOpen(true)
  }

  function handleDialogChange(open: boolean) {
    if (!open && !saving) {
      setDialogOpen(false)
      setMutationError(null)
    } else if (open) {
      setDialogOpen(true)
    }
  }

  async function saveSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMutationError(null)
    const input: SiteInput = {
      ...form,
      name: form.name.trim(),
      city: form.city.trim(),
      address: form.address?.trim() || null,
      phone: form.phone?.trim() || null,
      email: form.email?.trim() || null,
      description: form.description?.trim() || null,
    }
    if (!input.name || !input.city) {
      setMutationError("Le nom et la ville de la station sont obligatoires.")
      return
    }

    setSaving(true)
    try {
      const response = await apiFetch(
        editingSite ? `/api/v1/sites/${encodeURIComponent(editingSite.id)}` : "/api/v1/sites",
        { method: editingSite ? "PATCH" : "POST", body: JSON.stringify(input) },
      )
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      setDialogOpen(false)
      setMutationSuccess(
        editingSite ? "La station a été mise à jour." : "La station a été ajoutée.",
      )
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setMutationError(
        err instanceof Error ? err.message : "Impossible d’enregistrer la station.",
      )
    } finally {
      setSaving(false)
    }
  }

  /**
   * Désactiver plutôt que supprimer : une station fermée garde ses lavages,
   * ses caisses et ses dépenses dans les rapports des mois précédents.
   */
  async function toggleSite(site: SiteRecord) {
    const next = !site.is_active
    if (
      !next &&
      !window.confirm(
        `Désactiver « ${site.name} » ? Elle disparaîtra des nouveaux enregistrements, mais son historique reste dans les rapports.`,
      )
    ) {
      return
    }
    setBusySiteId(site.id)
    setMutationError(null)
    setMutationSuccess(null)
    try {
      const response = await apiFetch(`/api/v1/sites/${encodeURIComponent(site.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: next }),
      })
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      setMutationSuccess(next ? "La station a été réactivée." : "La station a été désactivée.")
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setMutationError(
        err instanceof Error ? err.message : "Impossible de modifier la station.",
      )
    } finally {
      setBusySiteId(null)
    }
  }

  /**
   * La suppression n'est utile que pour une station créée par erreur. Dès
   * qu'un lavage l'a référencée, le serveur répond 409 et oriente vers la
   * désactivation — on relaie son message tel quel.
   */
  async function deleteSite(site: SiteRecord) {
    if (
      !window.confirm(
        `Supprimer définitivement « ${site.name} » ? Cette action n’est possible que si aucune activité n’y est rattachée.`,
      )
    ) {
      return
    }
    setBusySiteId(site.id)
    setMutationError(null)
    setMutationSuccess(null)
    try {
      const response = await apiFetch(`/api/v1/sites/${encodeURIComponent(site.id)}`, {
        method: "DELETE",
      })
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      setMutationSuccess("La station a été supprimée.")
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setMutationError(
        err instanceof Error ? err.message : "Impossible de supprimer la station.",
      )
    } finally {
      setBusySiteId(null)
    }
  }

  return (
    <BaseLayout
      title="Stations"
      description="Gérez les points de lavage de votre organisation."
    >
      <div className="space-y-6 p-4">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Chaque lavage, session de caisse et dépense est rattaché à une station.
            C’est ce rattachement qui permet de comparer les points de vente dans
            les rapports.
          </p>
          <Button
            onClick={openCreateDialog}
            title={
              !canManage.allowed
                ? (canManage.reason ?? undefined)
                : limitReached
                  ? `Votre forfait autorise ${siteLimit} station${(siteLimit ?? 0) > 1 ? "s" : ""} active${(siteLimit ?? 0) > 1 ? "s" : ""}.`
                  : undefined
            }
            disabled={!canManage.allowed || limitReached}
          >
            <Plus className="mr-2 size-4" /> Ajouter une station
          </Button>
        </div>

        {mutationSuccess && (
          <p
            role="status"
            className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
          >
            {mutationSuccess}
          </p>
        )}
        {mutationError && !dialogOpen && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {mutationError}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardDescription>Stations actives</CardDescription>
              <Building2 className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{loading ? "…" : activeSites.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardDescription>Limite du forfait</CardDescription>
              <Building2 className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {summary?.plan
                  ? siteLimit === null || siteLimit === undefined
                    ? "Illimité"
                    : siteLimit
                  : "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardDescription>Inactives</CardDescription>
              <PowerOff className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {loading ? "…" : sites.length - activeSites.length}
              </p>
            </CardContent>
          </Card>
        </div>

        {limitReached && canManage.allowed && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            La limite de {siteLimit} station{(siteLimit ?? 0) > 1 ? "s" : ""} active
            {(siteLimit ?? 0) > 1 ? "s" : ""} de votre forfait est atteinte. Désactivez une
            station ou passez à un forfait supérieur pour en ouvrir une nouvelle.
          </p>
        )}

        {!canManage.allowed && (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            La création et la modification des stations sont réservées au propriétaire.
            Vous pouvez consulter la liste ci-dessous.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="size-4" /> Points de lavage
            </CardTitle>
            <CardDescription>
              Une station inactive reste visible dans les rapports historiques.
            </CardDescription>
          </CardHeader>
          <CardContent aria-busy={loading}>
            {loading ? (
              <TableSkeleton rows={3} cols={4} label="Chargement des stations" />
            ) : sites.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="Aucune station enregistrée"
                description="Ajoutez votre premier point de lavage pour commencer à y rattacher des opérations."
                action={
                  canManage.allowed ? (
                    <Button onClick={openCreateDialog}>
                      <Plus className="mr-2 size-4" /> Ajouter une station
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nom</TableHead>
                      <TableHead>Ville</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sites.map((site) => (
                      <TableRow key={site.id}>
                        <TableCell>
                          <p className="font-medium">{site.name}</p>
                          {site.address && (
                            <p className="text-xs text-muted-foreground">{site.address}</p>
                          )}
                        </TableCell>
                        <TableCell>{site.city}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {site.phone || site.email || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={site.is_active ? "outline" : "secondary"}>
                            {site.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Modifier ${site.name}`}
                              title={canManage.reason ?? undefined}
                              disabled={!canManage.allowed || busySiteId === site.id}
                              onClick={() => openEditDialog(site)}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={
                                site.is_active
                                  ? `Désactiver ${site.name}`
                                  : `Réactiver ${site.name}`
                              }
                              title={canManage.reason ?? undefined}
                              disabled={!canManage.allowed || busySiteId === site.id}
                              onClick={() => toggleSite(site)}
                            >
                              {site.is_active ? (
                                <PowerOff className="size-4" />
                              ) : (
                                <Power className="size-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Supprimer ${site.name}`}
                              title={canManage.reason ?? undefined}
                              disabled={!canManage.allowed || busySiteId === site.id}
                              onClick={() => deleteSite(site)}
                            >
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
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
            <DialogTitle>
              {editingSite ? "Modifier la station" : "Ajouter une station"}
            </DialogTitle>
            <DialogDescription>
              Le nom et la ville suffisent pour démarrer ; les autres champs
              apparaissent sur les documents remis aux clients.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveSite} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Nom de la station <span className="sr-only">obligatoire</span>
                <Input
                  required
                  maxLength={150}
                  value={form.name}
                  placeholder="Station Cocody Riviera"
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, name: event.target.value }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Ville <span className="sr-only">obligatoire</span>
                <Input
                  required
                  maxLength={100}
                  value={form.city}
                  placeholder="Abidjan"
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, city: event.target.value }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
                Adresse
                <Input
                  maxLength={255}
                  value={form.address ?? ""}
                  placeholder="Rue des Jardins, face à la pharmacie"
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      address: event.target.value || null,
                    }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Téléphone
                <Input
                  type="tel"
                  maxLength={50}
                  value={form.phone ?? ""}
                  placeholder="+225 …"
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      phone: event.target.value || null,
                    }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                E-mail
                <Input
                  type="email"
                  maxLength={255}
                  value={form.email ?? ""}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      email: event.target.value || null,
                    }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
                Description
                <Input
                  maxLength={255}
                  value={form.description ?? ""}
                  placeholder="Station principale, ouverte 7j/7"
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      description: event.target.value || null,
                    }))
                  }
                />
              </label>
            </div>
            {mutationError && (
              <p role="alert" className="text-sm text-destructive">
                {mutationError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleDialogChange(false)}
                disabled={saving}
              >
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={saving || !form.name.trim() || !form.city.trim()}
              >
                {saving && <RefreshCw className="mr-2 size-4 animate-spin" />}
                {editingSite ? "Enregistrer les modifications" : "Ajouter la station"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </BaseLayout>
  )
}
