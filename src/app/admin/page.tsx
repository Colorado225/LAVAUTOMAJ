"use client"

import { useMemo, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  CirclePause,
  Clock,
  Search,
  TrendingUp,
  TriangleAlert,
} from "lucide-react"

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
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { TableSkeleton } from "@/components/ui/table-skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useApi } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { toastError, toastSuccess } from "@/lib/toast"
import {
  activatePlan,
  extendTrial,
  formatFcfa,
  STATUS_LABELS,
  suspendOrganization,
  type AdminMetrics,
  type AdminOrganization,
  type AdminPlan,
  type AdminSubscriptionStatus,
  declineUpgradeRequest,
  confirmPaymentIntent,
  type AdminPaymentIntent,
  type UpgradeRequest,
} from "@/lib/admin-api"

// ---------------------------------------------------------------------------
// Back-office de l'éditeur
//
// Écran volontairement à part : pas de `BaseLayout`, donc pas de barre latérale
// de station. Deux raisons.
//
//   1. Technique : `BaseLayout` monte les contextes d'abonnement et de
//      permissions, qui interrogent des routes rattachées à une station. Un
//      administrateur de plateforme peut n'appartenir à aucune organisation.
//
//   2. Surtout : on agit ici sur les données d'autrui. Une coquille distincte
//      empêche de confondre « ma station » et « le parc », confusion qui finit
//      toujours par un geste fait sur le mauvais client.
// ---------------------------------------------------------------------------

const DURATIONS = [1, 3, 6, 12] as const

const STATUS_TONE: Record<AdminSubscriptionStatus, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  trialing: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  expired: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  cancelled: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  pending: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  none: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
}

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Toutes" },
  { value: "trialing", label: "En essai" },
  { value: "active", label: "Actives" },
  { value: "past_due", label: "Échéance dépassée" },
  { value: "expired", label: "Expirées" },
  { value: "cancelled", label: "Suspendues" },
]

function formatDate(value: string | null): string {
  if (!value) return "—"
  return new Date(value).toLocaleDateString("fr-CI", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export default function AdminPage() {
  const { user, organization } = useAuth()
  // Une station réellement configurée, et non la coquille créée à
  // l'inscription : sans cela, « Mon espace » mène à l'assistant.
  const hasStation = organization?.onboardingCompleted === true
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("all")
  const [refreshKey, setRefreshKey] = useState(0)

  const suffix = `${filter === "all" ? "" : `status=${filter}&`}k=${refreshKey}`
  const { data: metrics } = useApi<AdminMetrics>(`/api/v1/admin/metrics?k=${refreshKey}`)
  const { data, loading, error } = useApi<{ organizations: AdminOrganization[]; total: number }>(
    `/api/v1/admin/organizations?${suffix}`,
  )
  const { data: planData } = useApi<{ plans: AdminPlan[] }>("/api/v1/admin/plans")
  const { data: requestData } = useApi<{ requests: UpgradeRequest[] }>(
    `/api/v1/admin/upgrade-requests?k=${refreshKey}`,
  )
  // La file du matin : qui dit avoir payé, combien, avec quelle référence.
  const { data: intentData } = useApi<{ intents: AdminPaymentIntent[] }>(
    `/api/v1/admin/payment-intents?declared=true&k=${refreshKey}`,
  )

  const organizations = useMemo(() => {
    const rows = data?.organizations ?? []
    const needle = query.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(
      (o) =>
        o.name.toLowerCase().includes(needle) ||
        (o.owner_email ?? "").toLowerCase().includes(needle),
    )
  }, [data, query])

  const plans = planData?.plans ?? []
  const requests = requestData?.requests ?? []
  const intents = intentData?.intents ?? []

  // --- Dialogues -----------------------------------------------------------
  const [activating, setActivating] = useState<AdminOrganization | null>(null)
  const [suspending, setSuspending] = useState<AdminOrganization | null>(null)
  const [extending, setExtending] = useState<AdminOrganization | null>(null)
  const [declining, setDeclining] = useState<UpgradeRequest | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [planCode, setPlanCode] = useState("pro")
  const [months, setMonths] = useState("1")
  const [reference, setReference] = useState("")
  const [note, setNote] = useState("")
  const [reason, setReason] = useState("")
  const [days, setDays] = useState("7")

  function refresh() {
    setRefreshKey((k) => k + 1)
  }

  function openActivate(organization: AdminOrganization) {
    setPlanCode(organization.plan_code ?? "pro")
    setMonths("1")
    setReference("")
    setNote("")
    setActivating(organization)
  }

  async function submitActivate(event: FormEvent) {
    event.preventDefault()
    if (!activating) return
    setBusy(true)
    try {
      await activatePlan(activating.id, {
        plan_code: planCode,
        months: Number(months),
        payment_reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      })
      toastSuccess(
        "Forfait activé",
        `${activating.name} passe en ${planCode} pour ${months} mois.`,
      )
      setActivating(null)
      refresh()
    } catch (e) {
      toastError("Activation impossible", e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  async function submitSuspend(event: FormEvent) {
    event.preventDefault()
    if (!suspending) return
    setBusy(true)
    try {
      await suspendOrganization(suspending.id, reason.trim())
      toastSuccess("Station suspendue", `${suspending.name} passe en lecture seule.`)
      setSuspending(null)
      setReason("")
      refresh()
    } catch (e) {
      toastError("Suspension impossible", e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  async function confirmIntent(intent: AdminPaymentIntent) {
    setConfirming(intent.reference)
    try {
      await confirmPaymentIntent(intent.reference)
      toastSuccess(
        "Paiement confirmé",
        `${intent.organization_name} passe en ${intent.plan_code} pour ${intent.months} mois.`,
      )
      refresh()
    } catch (e) {
      toastError("Confirmation impossible", e instanceof Error ? e.message : undefined)
    } finally {
      setConfirming(null)
    }
  }

  async function submitDecline(event: FormEvent) {
    event.preventDefault()
    if (!declining) return
    setBusy(true)
    try {
      await declineUpgradeRequest(declining.id, reason.trim())
      toastSuccess(
        "Demande déclinée",
        `${declining.organization_name} a été informée dans son historique.`,
      )
      setDeclining(null)
      setReason("")
      refresh()
    } catch (e) {
      toastError("Refus impossible", e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  async function submitExtend(event: FormEvent) {
    event.preventDefault()
    if (!extending) return
    setBusy(true)
    try {
      await extendTrial(extending.id, { days: Number(days), reason: reason.trim() })
      toastSuccess("Essai prolongé", `${extending.name} gagne ${days} jours.`)
      setExtending(null)
      setReason("")
      refresh()
    } catch (e) {
      toastError("Prolongation impossible", e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  // L'écran est servi par une route que le serveur protège déjà (404 pour tout
  // autre compte). Ce garde n'est qu'un confort d'affichage, jamais la sécurité.
  if (user && !user.platformAdmin) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl items-center px-6">
        <EmptyState
          icon={TriangleAlert}
          title="Page introuvable"
          description="Cette adresse ne correspond à aucune page de votre espace."
          action={
            <Button render={<Link to="/dashboard" />}>Retour au tableau de bord</Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-foreground text-background">
              <Building2 className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-base font-semibold leading-none">Administration</h1>
              <p className="text-xs text-muted-foreground">
                Parc clients · {user?.email}
              </p>
            </div>
          </div>
          {/* Le créateur de l'application n'exploite pas forcément de station.
              Lui proposer « Mon espace » le renverrait vers l'assistant de
              configuration, boucle dont il ne comprendrait pas la cause. */}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            render={<Link to={hasStation ? "/dashboard" : "/onboarding"} />}
          >
            <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
            {hasStation ? "Mon espace" : "Configurer une station"}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {/* --- Indicateurs ------------------------------------------------ */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={TrendingUp}
            label="Revenu mensuel"
            value={metrics ? formatFcfa(metrics.mrr_cents) : "—"}
            hint={metrics ? `${metrics.active} forfait(s) actif(s)` : undefined}
          />
          <MetricCard
            icon={Clock}
            label="En essai"
            value={metrics ? String(metrics.trialing) : "—"}
            hint={metrics ? `${metrics.expired} essai(s) expiré(s)` : undefined}
          />
          <MetricCard
            icon={TriangleAlert}
            label="Échéance dépassée"
            value={metrics ? String(metrics.past_due) : "—"}
            hint="À relancer — aucune coupure automatique"
            tone={metrics && metrics.past_due > 0 ? "warn" : undefined}
          />
          <MetricCard
            icon={CalendarClock}
            label="Demandes en attente"
            value={metrics ? String(metrics.pending_requests) : "—"}
            hint="Activations réclamées par les clients"
            tone={metrics && metrics.pending_requests > 0 ? "warn" : undefined}
          />
        </div>

        {/* --- Paiements déclarés, en attente de vérification -------------- */}
        {intents.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Paiements déclarés ({intents.length})
              </CardTitle>
              <CardDescription>
                Vérifiez la référence de transaction sur votre relevé Orange Money
                ou Wave, puis confirmez. Le forfait, la durée et le montant sont
                déjà portés par la demande : rien n'est ressaisi.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {intents.map((intent) => (
                <div
                  key={intent.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm"
                >
                  <div className="min-w-44">
                    <p className="font-medium">{intent.organization_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {intent.requester_email ?? "—"}
                      {intent.requester_phone ? ` · ${intent.requester_phone}` : ""}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground">Demandé</p>
                    <p className="font-medium">
                      {intent.plan_code} · {intent.months} mois
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground">Montant attendu</p>
                    <p className="font-semibold tabular-nums">
                      {formatFcfa(intent.amount_cents)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground">Sa transaction</p>
                    <p className="font-mono text-xs">{intent.declared_reference ?? "—"}</p>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground">Référence</p>
                    <p className="font-mono text-xs">{intent.reference}</p>
                  </div>

                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDate(intent.declared_at)}
                  </span>

                  <Button
                    size="sm"
                    disabled={confirming === intent.reference}
                    onClick={() => void confirmIntent(intent)}
                  >
                    {confirming === intent.reference ? "Confirmation…" : "Confirmer le paiement"}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* --- Demandes d'activation -------------------------------------- */}
        {requests.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Demandes d'activation en attente</CardTitle>
              <CardDescription>
                Le paiement est encaissé hors application. Vérifiez la réception,
                puis activez le forfait depuis la liste ci-dessous.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {requests.map((request) => (
                <div
                  key={request.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
                >
                  <span className="font-medium">{request.organization_name}</span>
                  <Badge variant="outline">{request.metadata?.plan_code ?? "—"}</Badge>
                  <span className="text-muted-foreground">
                    {request.requester_email ?? "—"}
                    {request.requester_phone ? ` · ${request.requester_phone}` : ""}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDate(request.created_at)}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        const target = organizations.find(
                          (o) => o.id === request.organization_id,
                        )
                        if (!target) return
                        setPlanCode(request.metadata?.plan_code ?? "pro")
                        setMonths("1")
                        setReference("")
                        setNote("")
                        setActivating(target)
                      }}
                    >
                      Valider
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReason("")
                        setDeclining(request)
                      }}
                    >
                      Décliner
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* --- Le parc ----------------------------------------------------- */}
        <Card>
          <CardHeader className="gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Stations clientes</CardTitle>
                <CardDescription>
                  {data ? `${data.total} station(s)` : "Chargement…"}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Nom ou e-mail du propriétaire"
                    className="w-64 pl-8"
                    aria-label="Rechercher une station"
                  />
                </div>
                <Select value={filter} onValueChange={(v: string | null) => setFilter(v ?? "all")}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FILTERS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent aria-busy={loading}>
            {error ? (
              <EmptyState
                icon={TriangleAlert}
                title="Chargement impossible"
                description={error}
              />
            ) : loading ? (
              <TableSkeleton rows={4} cols={6} label="Chargement du parc" />
            ) : organizations.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="Aucune station"
                description="Aucune station ne correspond à ce filtre."
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Station</TableHead>
                      <TableHead>Forfait</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead>Échéance</TableHead>
                      <TableHead className="text-right">Taille</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {organizations.map((organization) => (
                      <TableRow key={organization.id}>
                        <TableCell>
                          <div className="font-medium">{organization.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {organization.owner_email ?? "sans propriétaire actif"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>{organization.plan_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatFcfa(organization.plan_price_cents)} / mois
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_TONE[organization.status]}>
                            {STATUS_LABELS[organization.status]}
                          </Badge>
                          {organization.past_due && (
                            <div className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                              {organization.days_past_due} j de retard
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDate(organization.current_period_end)}
                          {organization.status === "trialing" && (
                            <div className="text-xs text-muted-foreground">
                              {organization.days_remaining} j restants
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {organization.member_count} membre(s)
                          <div className="text-xs text-muted-foreground">
                            {organization.site_count} site(s)
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              onClick={() => openActivate(organization)}
                              title="Activer ou renouveler un forfait payant"
                            >
                              <CheckCircle2 className="mr-1 size-3.5" aria-hidden="true" />
                              Activer
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setReason("")
                                setDays("7")
                                setExtending(organization)
                              }}
                              title="Prolonger l'essai (geste commercial)"
                            >
                              <CalendarClock className="size-3.5" aria-hidden="true" />
                              <span className="sr-only">Prolonger l'essai</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setReason("")
                                setSuspending(organization)
                              }}
                              title="Suspendre (passe la station en lecture seule)"
                            >
                              <CirclePause className="size-3.5" aria-hidden="true" />
                              <span className="sr-only">Suspendre</span>
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
      </main>

      {/* --- Activation --------------------------------------------------- */}
      <Dialog open={activating !== null} onOpenChange={(open) => !open && setActivating(null)}>
        <DialogContent>
          <form onSubmit={submitActivate}>
            <DialogHeader>
              <DialogTitle>Activer un forfait — {activating?.name}</DialogTitle>
              <DialogDescription>
                Le paiement est encaissé hors application. N'activez qu'après
                avoir constaté la réception des fonds.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="plan">Forfait</Label>
                <Select value={planCode} onValueChange={(v: string | null) => setPlanCode(v ?? "pro")}>
                  <SelectTrigger id="plan">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map((plan) => (
                      <SelectItem key={plan.code} value={plan.code}>
                        {plan.name} — {formatFcfa(plan.price_cents)} / mois
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="months">Durée</Label>
                <Select value={months} onValueChange={(v: string | null) => setMonths(v ?? "1")}>
                  <SelectTrigger id="months">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATIONS.map((value) => (
                      <SelectItem key={value} value={String(value)}>
                        {value} mois
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {activating?.status === "active" && (
                  <p className="text-xs text-muted-foreground">
                    Renouvellement anticipé : la durée s'ajoute à l'échéance en
                    cours, les jours déjà payés ne sont pas perdus.
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="reference">Référence du paiement</Label>
                <Input
                  id="reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Ex. WAVE-884213, virement du 20/10"
                />
                <p className="text-xs text-muted-foreground">
                  Inscrite au journal de la station : c'est la trace qui permet
                  de retrouver l'encaissement plus tard.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="note">Note (facultatif)</Label>
                <Textarea
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setActivating(null)}>
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Activation…" : "Activer le forfait"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- Suspension ---------------------------------------------------- */}
      <Dialog open={suspending !== null} onOpenChange={(open) => !open && setSuspending(null)}>
        <DialogContent>
          <form onSubmit={submitSuspend}>
            <DialogHeader>
              <DialogTitle>Suspendre — {suspending?.name}</DialogTitle>
              <DialogDescription>
                La station passe en lecture seule : ses données restent
                consultables et exportables, mais plus aucune opération n'est
                enregistrée. Rien n'est supprimé.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 py-4">
              <Label htmlFor="suspend-reason">Motif</Label>
              <Textarea
                id="suspend-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Ex. impayé, deux relances sans réponse"
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSuspending(null)}>
                Annuler
              </Button>
              <Button type="submit" variant="destructive" disabled={busy || reason.trim().length < 3}>
                {busy ? "Suspension…" : "Suspendre"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- Refus d'une demande ------------------------------------------- */}
      <Dialog open={declining !== null} onOpenChange={(open) => !open && setDeclining(null)}>
        <DialogContent>
          <form onSubmit={submitDecline}>
            <DialogHeader>
              <DialogTitle>Décliner la demande — {declining?.organization_name}</DialogTitle>
              <DialogDescription>
                L'abonnement de la station n'est pas modifié : elle garde l'état
                qu'elle a aujourd'hui. Le motif est inscrit dans son historique,
                pour qu'elle sache qu'on lui a répondu.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 py-4">
              <Label htmlFor="decline-reason">Motif</Label>
              <Textarea
                id="decline-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Ex. paiement non reçu à ce jour"
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeclining(null)}>
                Annuler
              </Button>
              <Button type="submit" disabled={busy || reason.trim().length < 3}>
                {busy ? "Enregistrement…" : "Décliner la demande"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- Prolongation d'essai ------------------------------------------ */}
      <Dialog open={extending !== null} onOpenChange={(open) => !open && setExtending(null)}>
        <DialogContent>
          <form onSubmit={submitExtend}>
            <DialogHeader>
              <DialogTitle>Prolonger l'essai — {extending?.name}</DialogTitle>
              <DialogDescription>
                Geste commercial. Un forfait payant en cours ne peut pas être
                prolongé ainsi : il serait remplacé par un essai.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="days">Jours ajoutés</Label>
                <Input
                  id="days"
                  type="number"
                  min={1}
                  max={90}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="extend-reason">Motif</Label>
                <Textarea
                  id="extend-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="Ex. installation retardée, matériel non livré"
                  required
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setExtending(null)}>
                Annuler
              </Button>
              <Button type="submit" disabled={busy || reason.trim().length < 3}>
                {busy ? "Prolongation…" : "Prolonger"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof TrendingUp
  label: string
  value: string
  hint?: string
  tone?: "warn"
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 pt-6">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-lg ${
            tone === "warn"
              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : "bg-muted text-muted-foreground"
          }`}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums">{value}</p>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
