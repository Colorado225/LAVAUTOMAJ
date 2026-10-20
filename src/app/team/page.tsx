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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
import type { OnboardingSummary } from "@/lib/onboarding-api"
import type { CurrentMember, OrganizationAccount, WorkerInput, WorkerRecord, WorkerRole } from "@/lib/team-api"
import { TableSkeleton } from "@/components/ui/table-skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { Search, UserPlus, Users, RefreshCw, Pencil, UserRoundX, UserRoundCheck } from "lucide-react"

const roleLabels: Record<WorkerRole, string> = {
  car_washer: "Laveur automobile",
  moto_washer: "Laveur moto",
  versatile_washer: "Laveur polyvalent",
  team_lead: "Chef d’équipe",
  custom: "Fonction personnalisée",
}

const accountRoleLabels: Record<string, string> = {
  owner: "Propriétaire",
  manager: "Responsable",
  cashier: "Caissier",
}

const emptyForm = (): WorkerInput => ({
  first_name: "",
  last_name: "",
  phone: null,
  district: null,
  role: "car_washer",
  custom_role: null,
  joined_at: null,
})

function roleLabel(worker: WorkerRecord) {
  return worker.role === "custom" && worker.custom_role
    ? worker.custom_role
    : roleLabels[worker.role]
}

export default function TeamPage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, loading, error } = useApi<WorkerRecord[]>(`/api/v1/workers?refresh=${refreshKey}`)
  const { data: accounts, loading: accountsLoading, error: accountsError } = useApi<OrganizationAccount[]>(`/api/v1/users?refresh=${refreshKey}`)
  const { data: summary } = useApi<OnboardingSummary>("/api/v1/onboarding/summary")
  const { data: currentMember } = useApi<CurrentMember>(`/api/v1/auth/me?refresh=${refreshKey}`)
  const workers = useMemo(() => data ?? [], [data])
  const activeWorkers = useMemo(() => workers.filter((worker) => worker.status === "active"), [workers])
  const inactiveWorkers = workers.length - activeWorkers.length
  const workerLimit = summary?.plan?.max_workers
  const canManage = currentMember?.role === "owner" || currentMember?.role === "manager"

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingWorker, setEditingWorker] = useState<WorkerRecord | null>(null)
  const [form, setForm] = useState<WorkerInput>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [busyWorkerId, setBusyWorkerId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null)

  const filteredWorkers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("fr-CI")
    return workers.filter((worker) => {
      if (statusFilter !== "all" && worker.status !== statusFilter) return false
      if (!query) return true
      return [worker.first_name, worker.last_name, worker.phone, worker.district, roleLabel(worker)]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("fr-CI").includes(query))
    })
  }, [workers, search, statusFilter])

  function openCreateDialog() {
    setEditingWorker(null)
    setForm(emptyForm())
    setMutationError(null)
    setMutationSuccess(null)
    setDialogOpen(true)
  }

  function openEditDialog(worker: WorkerRecord) {
    setEditingWorker(worker)
    setForm({
      first_name: worker.first_name,
      last_name: worker.last_name,
      phone: worker.phone,
      district: worker.district,
      role: worker.role,
      custom_role: worker.custom_role,
      joined_at: worker.joined_at,
    })
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

  async function saveWorker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMutationError(null)
    const input: WorkerInput = {
      ...form,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      phone: form.phone?.trim() || null,
      district: form.district?.trim() || null,
      custom_role: form.role === "custom" ? form.custom_role?.trim() || null : null,
      joined_at: form.joined_at || null,
    }

    if (!input.first_name || !input.last_name) {
      setMutationError("Le prénom et le nom sont obligatoires.")
      return
    }
    if (input.role === "custom" && (!input.custom_role || input.custom_role.length < 2)) {
      setMutationError("Précisez la fonction personnalisée (2 caractères minimum).")
      return
    }

    setSaving(true)
    try {
      const response = await apiFetch(
        editingWorker ? `/api/v1/workers/${encodeURIComponent(editingWorker.id)}` : "/api/v1/workers",
        {
          method: editingWorker ? "PATCH" : "POST",
          body: JSON.stringify(input),
        },
      )
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      setDialogOpen(false)
      setMutationSuccess(editingWorker ? "Les informations du travailleur ont été mises à jour." : "Le travailleur a été ajouté à l’équipe.")
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Impossible d’enregistrer le travailleur.")
    } finally {
      setSaving(false)
    }
  }

  async function toggleWorkerStatus(worker: WorkerRecord) {
    const nextStatus = worker.status === "active" ? "inactive" : "active"
    if (nextStatus === "inactive" && !window.confirm(`Désactiver ${worker.first_name} ${worker.last_name} ? Son historique de lavages sera conservé.`)) {
      return
    }
    setBusyWorkerId(worker.id)
    setMutationError(null)
    setMutationSuccess(null)
    try {
      const response = await apiFetch(`/api/v1/workers/${encodeURIComponent(worker.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      })
      if (!response.ok) throw new Error(await apiErrorMessage(response))
      setMutationSuccess(nextStatus === "active" ? "Le travailleur a été réactivé." : "Le travailleur a été désactivé.")
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Impossible de modifier le statut du travailleur.")
    } finally {
      setBusyWorkerId(null)
    }
  }

  return (
    <BaseLayout title="Équipe" description="Gérez les travailleurs affectés aux opérations de lavage.">
      <div className="space-y-6 p-4">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-sm text-muted-foreground">
              Les travailleurs n’ont pas besoin d’un compte de connexion.
            </p>
          </div>
          {canManage && (
            <Button onClick={openCreateDialog} disabled={workerLimit !== null && workerLimit !== undefined && activeWorkers.length >= workerLimit}>
              <UserPlus className="mr-2 size-4" /> Ajouter un travailleur
            </Button>
          )}
        </div>

        {mutationSuccess && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{mutationSuccess}</p>}
        {mutationError && !dialogOpen && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{mutationError}</p>}

        {!canManage && currentMember && (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            La gestion de l’équipe est réservée au propriétaire et aux responsables. Vous pouvez consulter les membres et les travailleurs ci-dessous.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardDescription>Travailleurs actifs</CardDescription>
              <Users className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold">{loading ? "…" : activeWorkers.length}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardDescription>Limite du forfait</CardDescription>
              <Users className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold">{summary?.plan ? workerLimit === null ? "Illimité" : workerLimit : "—"}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardDescription>Inactifs</CardDescription>
              <UserRoundX className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold">{loading ? "…" : inactiveWorkers}</p></CardContent>
          </Card>
        </div>

        {workerLimit !== null && workerLimit !== undefined && activeWorkers.length >= workerLimit && canManage && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            La limite de {workerLimit} travailleurs actifs de votre forfait est atteinte. Désactivez un profil ou changez de forfait pour en ajouter un autre.
          </p>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Travailleurs</CardTitle>
            <CardDescription>
              {workers.length} profil{workers.length === 1 ? "" : "s"} enregistré{workers.length === 1 ? "" : "s"}. Les profils désactivés restent dans l’historique.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un nom, une fonction, un téléphone…" aria-label="Rechercher un travailleur" />
              </div>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(String(value ?? "all"))}>
                <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Tous les statuts" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="active">Actifs</SelectItem>
                  <SelectItem value="inactive">Inactifs</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {loading && <TableSkeleton rows={5} cols={6} label="Chargement de l’équipe" />}
            {!loading && !error && (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Travailleur</TableHead>
                      <TableHead>Fonction</TableHead>
                      <TableHead>Téléphone</TableHead>
                      <TableHead>Quartier</TableHead>
                      <TableHead>Entrée</TableHead>
                      <TableHead>Statut</TableHead>
                      {canManage && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredWorkers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={canManage ? 7 : 6} className="p-0">
                          <EmptyState
                            icon={Users}
                            title={workers.length === 0 ? "Aucun travailleur enregistré" : "Aucun résultat"}
                            description={
                              workers.length === 0
                                ? "Ajoutez l’équipe de votre station pour pouvoir attribuer les lavages et suivre les performances."
                                : "Aucun travailleur ne correspond à ces filtres. Modifiez la recherche ou le statut."
                            }
                          />
                        </TableCell>
                      </TableRow>
                    )}
                    {filteredWorkers.map((worker, index) => (
                      <TableRow
                        key={worker.id}
                        /* Ligne en cours de mise à jour : estompée tant que le
                           serveur n'a pas répondu (retour immédiat). */
                        className={`row-in transition-all duration-200 ${
                          busyWorkerId === worker.id ? "scale-[0.995] opacity-50" : "hover:bg-muted/40"
                        }`}
                        style={{ "--row": Math.min(index, 10) } as React.CSSProperties}
                      >
                        <TableCell>
                          <div className="font-medium">{worker.first_name} {worker.last_name}</div>
                        </TableCell>
                        <TableCell>{roleLabel(worker)}</TableCell>
                        <TableCell>{worker.phone || "—"}</TableCell>
                        <TableCell>{worker.district || "—"}</TableCell>
                        <TableCell>{worker.joined_at ? new Date(`${worker.joined_at}T00:00:00Z`).toLocaleDateString("fr-CI", { timeZone: "Africa/Abidjan" }) : "—"}</TableCell>
                        <TableCell><Badge variant={worker.status === "active" ? "secondary" : "outline"}>{worker.status === "active" ? "Actif" : "Inactif"}</Badge></TableCell>
                        {canManage && (
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" aria-label={`Modifier ${worker.first_name} ${worker.last_name}`} onClick={() => openEditDialog(worker)}>
                                <Pencil className="size-4" />
                              </Button>
                              <Button variant="ghost" size="icon" disabled={busyWorkerId === worker.id || (worker.status !== "active" && workerLimit !== null && workerLimit !== undefined && activeWorkers.length >= workerLimit)} aria-label={worker.status === "active" ? `Désactiver ${worker.first_name} ${worker.last_name}` : `Réactiver ${worker.first_name} ${worker.last_name}`} onClick={() => void toggleWorkerStatus(worker)}>
                                {busyWorkerId === worker.id ? <RefreshCw className="size-4 animate-spin" /> : worker.status === "active" ? <UserRoundX className="size-4" /> : <UserRoundCheck className="size-4" />}
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Comptes ayant accès à WashPilot</CardTitle>
            <CardDescription>Utilisateurs disposant d’un compte de connexion dans cette organisation.</CardDescription>
          </CardHeader>
          <CardContent>
            {accountsError && <p role="alert" className="mb-3 text-sm text-destructive">{accountsError}</p>}
            {accountsLoading ? (
              <TableSkeleton rows={3} cols={3} label="Chargement des comptes" />
            ) : accounts && accounts.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead>Nom</TableHead><TableHead>E-mail</TableHead><TableHead>Rôle</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {accounts.map((account) => (
                      <TableRow key={account.id}>
                        <TableCell className="font-medium">{[account.first_name, account.last_name].filter(Boolean).join(" ") || account.email}</TableCell>
                        <TableCell>{account.email}</TableCell>
                        <TableCell><Badge variant="outline">{accountRoleLabels[account.role] ?? account.role}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : !accountsError ? (
              <p className="text-sm text-muted-foreground">Aucun compte d’accès synchronisé.</p>
            ) : null}
            <p className="mt-3 text-xs text-muted-foreground">Cette liste est en lecture seule. La gestion des invitations arrive prochainement.</p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingWorker ? "Modifier un travailleur" : "Ajouter un travailleur"}</DialogTitle>
            <DialogDescription>
              Enregistrez les informations utiles aux opérations. Ce profil n’est pas un compte de connexion.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveWorker} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Prénom <span className="sr-only">obligatoire</span>
                <Input required maxLength={100} value={form.first_name} onChange={(event) => setForm((previous) => ({ ...previous, first_name: event.target.value }))} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Nom <span className="sr-only">obligatoire</span>
                <Input required maxLength={100} value={form.last_name} onChange={(event) => setForm((previous) => ({ ...previous, last_name: event.target.value }))} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Téléphone
                <Input type="tel" maxLength={50} value={form.phone ?? ""} onChange={(event) => setForm((previous) => ({ ...previous, phone: event.target.value || null }))} placeholder="+225 …" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Quartier
                <Input maxLength={255} value={form.district ?? ""} onChange={(event) => setForm((previous) => ({ ...previous, district: event.target.value || null }))} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Fonction
                <Select value={form.role} onValueChange={(value) => setForm((previous) => ({ ...previous, role: String(value ?? "car_washer") as WorkerRole, custom_role: value === "custom" ? previous.custom_role : null }))}>
                  <SelectTrigger><SelectValue placeholder="Choisir une fonction" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="car_washer">Laveur automobile</SelectItem>
                    <SelectItem value="moto_washer">Laveur moto</SelectItem>
                    <SelectItem value="versatile_washer">Laveur polyvalent</SelectItem>
                    <SelectItem value="team_lead">Chef d’équipe</SelectItem>
                    <SelectItem value="custom">Autre fonction</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              {form.role === "custom" && (
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Fonction personnalisée
                  <Input required minLength={2} maxLength={100} value={form.custom_role ?? ""} onChange={(event) => setForm((previous) => ({ ...previous, custom_role: event.target.value || null }))} />
                </label>
              )}
              <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
                Date d’entrée
                <Input type="date" value={form.joined_at ?? ""} onChange={(event) => setForm((previous) => ({ ...previous, joined_at: event.target.value || null }))} />
              </label>
            </div>
            {mutationError && <p role="alert" className="text-sm text-destructive">{mutationError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleDialogChange(false)} disabled={saving}>Annuler</Button>
              <Button type="submit" disabled={saving || !form.first_name.trim() || !form.last_name.trim()}>
                {saving && <RefreshCw className="mr-2 size-4 animate-spin" />}
                {editingWorker ? "Enregistrer les modifications" : "Ajouter à l’équipe"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </BaseLayout>
  )
}
