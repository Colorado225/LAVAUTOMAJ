"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Link, useViewTransitionState } from "react-router-dom"
import { BaseLayout } from "@/components/layouts/base-layout"
import { useAccess } from "@/lib/permissions"
import { BlockedReason } from "@/components/access/blocked-reason"
import {
  isWashButtonClickable,
  resolvePendingOpen,
  washButtonState,
  washPrerequisites,
  washSubmitBlockedReason,
} from "@/lib/action-blocking"
import { apiFetch, useApi } from "@/lib/api"
import { createIdempotencyKey } from "@/lib/idempotency"
import { isNetworkError } from "@/lib/offline-queue"
import { enqueueMutation } from "@/lib/offline-sync"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { plateKey } from "@/lib/plate"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TableSkeleton } from "@/components/ui/table-skeleton"
import { SubmitButton } from "@/components/ui/submit-button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { useSuccessFlash } from "@/hooks/use-success-flash"
import { WashReceiptButton } from "@/components/receipt/wash-receipt"
import { ArrowRight, Check, Droplets, Loader2, Lock, Plus } from "lucide-react"

interface Site {
  id: string
  name: string
  city: string | null
  is_active: boolean
}

interface VehicleCategory {
  id: string
  name: string
  is_active: boolean
}

interface Service {
  id: string
  category_id: string | null
  name: string
  price_cents: number
  is_active: boolean
}

interface Worker {
  id: string
  first_name: string
  last_name: string
  role: string
  status: string
}

interface CashSession {
  id: string
  status: string
}

interface VehicleHistory {
  plate: string | null
  visits: number
  cancelled: number
  total_cents: number
  first_visit_at: string | null
  last_visit_at: string | null
}

interface Wash {
  plate: string | null
  id: string
  reference: string
  site_id: string | null
  vehicle_category_id: string | null
  total_cents: number
  status: string
  payment_status: string
  created_at: string
}

const paymentMethods = [
  { value: "cash", label: "Espèces" },
  { value: "orange_money", label: "Orange Money" },
  { value: "mtn_momo", label: "MTN MoMo" },
  { value: "moov_money", label: "Moov Money" },
  { value: "wave", label: "Wave" },
  { value: "other", label: "Autre" },
]

function parseXofAmount(value: string): number | null {
  if (!value.trim()) return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return null
  const cents = Math.round(amount * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

function formatXof(cents: number): string {
  return `${(cents / 100).toLocaleString("fr-CI", { maximumFractionDigits: 2 })} XOF`
}

function washStatusLabel(status: string): string {
  if (status === "completed") return "Terminé"
  if (status === "pending") return "En cours"
  if (status === "cancelled") return "Annulé"
  return status
}

function paymentStatusLabel(status: string): string {
  if (status === "paid") return "Payé"
  if (status === "partial") return "Partiel"
  if (status === "refunded") return "Remboursé"
  if (status === "unpaid") return "Non payé"
  return status
}

/**
 * Référence du lavage : pendant la navigation vers la fiche, cet élément porte
 * le même `view-transition-name` que le titre de la page de détail. Le
 * navigateur fait glisser l'un vers l'autre — on comprend d'où vient l'écran.
 */
function WashReference({ washId, reference }: { washId: string; reference: string }) {
  const isTransitioning = useViewTransitionState(`/washes/${washId}`)
  return (
    <span
      style={{ viewTransitionName: isTransitioning ? "wash-reference" : undefined }}
    >
      {reference}
    </span>
  )
}

export default function WashesPage() {
  const createWash = useAccess("wash:create", "washes.create")
  const [selectedSiteId, setSelectedSiteId] = useState("")
  const sitePath = "/api/v1/sites"
  const { data: sites, loading: sitesLoading, error: sitesError } = useApi<Site[]>(sitePath)
  const { data: categories, loading: categoriesLoading, error: categoriesError } =
    useApi<VehicleCategory[]>("/api/v1/vehicle-categories")
  const { data: serviceCatalog, loading: servicesLoading, error: servicesError } =
    useApi<Service[]>("/api/v1/services")
  const { data: workers, loading: workersLoading, error: workersError } =
    useApi<Worker[]>("/api/v1/workers")

  const siteId = selectedSiteId || sites?.[0]?.id || ""
  const [refreshKey, setRefreshKey] = useState(0)
  const { data: cashSession, loading: cashSessionLoading } = useApi<CashSession | null>(
    siteId ? `/api/v1/cash-sessions/current?site_id=${encodeURIComponent(siteId)}&refresh=${refreshKey}` : ""
  )
  const { data: washesData, loading: washesLoading, error: washesError } = useApi<Wash[]>(
    `/api/v1/washes?refresh=${refreshKey}`
  )
  const [formOpen, setFormOpen] = useState(false)
  // Clic reçu avant que les droits soient connus : on le garde pour l'honorer
  // dès qu'ils arrivent, plutôt que de griser le bouton par précaution.
  const [openRequested, setOpenRequested] = useState(false)
  const [vehicleCategoryId, setVehicleCategoryId] = useState("")
  const [plate, setPlate] = useState("")
  // Plaque figee apres une pause de frappe : sans cela, on interrogerait le
  // serveur a chaque caractere pendant que le caissier tape.
  const [plateSettled, setPlateSettled] = useState("")

  useEffect(() => {
    const timer = window.setTimeout(() => setPlateSettled(plate), 400)
    return () => window.clearTimeout(timer)
  }, [plate])

  const plateLookup = plateKey(plateSettled)
  // On n'interroge qu'a partir de quatre caracteres : en dessous, la saisie
  // est trop partielle pour designer un vehicule.
  const { data: vehicleHistory } = useApi<VehicleHistory>(
    plateLookup && plateLookup.length >= 4 ? `/api/v1/vehicles/${encodeURIComponent(plateLookup)}` : "",
  )
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([])
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [amountReceived, setAmountReceived] = useState("0")
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Coche verte du bouton après enregistrement, puis retour à l'état normal.
  const [saveSuccess, flashSaveSuccess] = useSuccessFlash()
  // Identifiant du dernier lavage créé : sa ligne est surlignée une seconde
  // dans l'historique, pour que l'œil retrouve immédiatement l'opération.
  const [highlightedWashId, setHighlightedWashId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null)
  /**
   * Lavage qui vient d'être intégralement réglé.
   *
   * Le reçu n'est pas émis tout seul : une ligne d'émission veut dire qu'un
   * papier est sorti. On le propose donc en un clic, juste après la vente,
   * tant que le client est encore devant le comptoir.
   */
  const [washToReceipt, setWashToReceipt] = useState<{ id: string; reference: string } | null>(null)

  // Deux listes, deux usages distincts.
  //
  // « allSites » sert à retrouver le nom d'une station dans l'historique :
  // fermer une station ne doit pas effacer le nom des lavages déjà passés.
  // « activeSites » sert au formulaire : on n'enregistre pas une vente sur
  // une station qui ne tourne plus.
  const allSites = sites ?? []
  const activeSites = allSites.filter((site) => site.is_active)

  const washFormBlocked = washButtonState({
    sitesLoading,
    accessLoading: createWash.loading,
    activeSiteCount: activeSites.length,
    allowed: createWash.allowed,
    reason: createWash.reason,
  })
  // Le bouton reste actif tant qu'on ne sait pas : un clic reçu pendant
  // l'attente est honoré dès que les droits arrivent, ou abandonné si le
  // refus se confirme — auquel cas le motif est déjà affiché sous le bouton.
  const pendingOutcome = resolvePendingOpen(washFormBlocked)
  // Dérivé plutôt que recopié dans un effet : un clic en attente ouvre le
  // formulaire de lui-même dès que les droits le permettent, et s'efface tout
  // seul si le refus se confirme — le motif est alors déjà sous le bouton.
  const awaitingRights = openRequested && pendingOutcome === "attendre"
  const showForm = formOpen || (openRequested && pendingOutcome === "ouvrir")
  const closeForm = () => {
    setFormOpen(false)
    setOpenRequested(false)
  }
  const activeCategories = (categories ?? []).filter((item) => item.is_active)
  const activeServices = (serviceCatalog ?? []).filter((item) => item.is_active)
  const activeWorkers = (workers ?? []).filter((worker) => worker.status === "active")

  const washes = washesData ?? []

  const selectedServices = useMemo(
    () => activeServices.filter((service) => (quantities[service.id] ?? 0) > 0),
    [activeServices, quantities]
  )
  // Tant qu'une de ces listes charge, on ne conclut rien : annoncer « aucune
  // station » pendant une seconde ferait croire à une installation vide.
  const setupLoading = sitesLoading || servicesLoading || workersLoading
  const missingSetup = washPrerequisites({
    activeSiteCount: activeSites.length,
    activeServiceCount: activeServices.length,
    activeWorkerCount: activeWorkers.length,
  })

  const totalCents = selectedServices.reduce(
    (total, service) => total + service.price_cents * (quantities[service.id] ?? 0),
    0
  )
  const amountReceivedCents = parseXofAmount(amountReceived)
  const amountIsValid = amountReceivedCents != null && amountReceivedCents <= totalCents
  const cashNeedsSession = amountReceivedCents != null && amountReceivedCents > 0 && paymentMethod === "cash"

  const submitBlockedReason = washSubmitBlockedReason({
    allowed: createWash.allowed,
    accessReason: createWash.reason,
    siteId,
    vehicleCategoryId,
    selectedServiceCount: selectedServices.length,
    assignedWorkerCount: selectedWorkerIds.length,
    amountIsValid,
    cashNeedsSession,
    cashSessionLoading,
    hasCashSession: Boolean(cashSession),
  })

  function markFormChanged() {
    setIdempotencyKey(null)
    setMutationError(null)
    setMutationSuccess(null)
    setWashToReceipt(null)
  }

  function toggleService(serviceId: string, checked: boolean) {
    markFormChanged()
    setQuantities((current) => {
      const next = { ...current }
      if (checked) next[serviceId] = 1
      else delete next[serviceId]
      return next
    })
  }

  function changeQuantity(serviceId: string, rawValue: string) {
    const quantity = Number(rawValue)
    markFormChanged()
    setQuantities((current) => {
      const next = { ...current }
      if (!Number.isInteger(quantity) || quantity < 1) delete next[serviceId]
      else next[serviceId] = Math.min(quantity, 100)
      return next
    })
  }

  function toggleWorker(workerId: string, checked: boolean) {
    markFormChanged()
    setSelectedWorkerIds((current) =>
      checked ? [...current, workerId] : current.filter((id) => id !== workerId)
    )
  }

  async function submitWash(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMutationError(null)
    setMutationSuccess(null)
    // Le reçu de la vente précédente ne doit jamais survivre à celle-ci.
    setWashToReceipt(null)

    if (!siteId || !vehicleCategoryId || selectedServices.length === 0) {
      setMutationError("Choisissez un site, une catégorie et au moins une prestation.")
      return
    }
    if (selectedWorkerIds.length === 0) {
      setMutationError("Indiquez qui lave ce véhicule avant de valider.")
      return
    }
    if (amountReceivedCents == null || amountReceivedCents > totalCents) {
      setMutationError("Le montant reçu doit être valide et ne pas dépasser le total.")
      return
    }
    if (cashNeedsSession && (cashSessionLoading || !cashSession)) {
      setMutationError("Ouvrez d’abord une session de caisse pour enregistrer un paiement en espèces.")
      return
    }

    const requestKey = idempotencyKey ?? createIdempotencyKey()
    setIdempotencyKey(requestKey)
    setSaving(true)

    // Sorti de l'appel : le même corps doit pouvoir repartir plus tard, à
    // l'identique, si le réseau manque maintenant.
    const payload = {
      site_id: siteId,
      vehicle_category_id: vehicleCategoryId,
      ...(plate.trim() ? { plate: plate.trim() } : {}),
      items: selectedServices.map((service) => ({
        service_id: service.id,
        quantity: quantities[service.id],
      })),
      worker_ids: selectedWorkerIds,
      payment_method: paymentMethod,
      amount_received_cents: amountReceivedCents,
      ...(cashNeedsSession && cashSession ? { cash_session_id: cashSession.id } : {}),
    }

    try {
      const response = await apiFetch(
        "/api/v1/washes",
        {
          method: "POST",
          headers: { "Idempotency-Key": requestKey },
          body: JSON.stringify(payload),
        }
      )
      if (!response.ok) {
        throw new Error((await response.text()) || `Erreur ${response.status}`)
      }
      const replayed = response.headers.get("Idempotency-Replayed") === "true"
      const created = (await response.json().catch(() => null)) as
        | { id?: string; reference?: string; payment_status?: string }
        | null
      if (created?.id) setHighlightedWashId(created.id)
      setWashToReceipt(
        created?.id && created.payment_status === "paid"
          ? { id: created.id, reference: created.reference ?? "" }
          : null,
      )
      flashSaveSuccess()
      setMutationSuccess(replayed ? "Cette opération avait déjà été enregistrée." : "Lavage enregistré avec succès.")
      setQuantities({})
      setSelectedWorkerIds([])
      setVehicleCategoryId("")
      setPlate("")
      setAmountReceived("0")
      setIdempotencyKey(null)
      setRefreshKey((key) => key + 1)
      closeForm()
    } catch (err) {
      // Réseau coupé : la vente est conservée sur l'appareil et repartira
      // seule. La clé d'idempotence voyage avec elle — c'est elle qui
      // empêchera un doublon si la requête était déjà passée sans que la
      // réponse nous revienne.
      if (isNetworkError(err)) {
        const total = Math.round(totalCents / 100).toLocaleString("fr-FR")
        const queued = await enqueueMutation({
          url: "/api/v1/washes",
          method: "POST",
          body: payload,
          headers: { "Idempotency-Key": requestKey },
          offline: { label: `Lavage ${total} F` },
        })
        if (queued) {
          setMutationSuccess(
            "Pas de réseau : le lavage est enregistré sur cet appareil et sera envoyé automatiquement.",
          )
          setQuantities({})
          setSelectedWorkerIds([])
          setVehicleCategoryId("")
          setPlate("")
          setAmountReceived("0")
          setIdempotencyKey(null)
          closeForm()
          setSaving(false)
          return
        }
      }
      // Keep the key while the payload stays unchanged: retrying after a lost
      // response returns the original record instead of creating a duplicate.
      setMutationError(err instanceof Error ? err.message : "Impossible d’enregistrer le lavage.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <BaseLayout title="Lavages" description="Enregistrement et historique des lavages.">
      <div className="space-y-6 p-4">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Lavages</h1>
            <p className="text-muted-foreground">
              Enregistrez un lavage et consultez son historique détaillé.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex min-w-56 flex-col gap-1 text-sm font-medium">
              Site
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={siteId}
                onChange={(event) => {
                  setSelectedSiteId(event.target.value)
                  markFormChanged()
                }}
                disabled={sitesLoading || activeSites.length === 0}
              >
                {activeSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}{site.city ? ` — ${site.city}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-1.5">
              <Button
                onClick={() => {
                  setMutationError(null)
                  setMutationSuccess(null)
                  if (washFormBlocked.preparing) {
                    setOpenRequested(true)
                    return
                  }
                  if (showForm) {
                    closeForm()
                    return
                  }
                  setFormOpen(true)
                }}
                disabled={!isWashButtonClickable(washFormBlocked)}
                aria-busy={awaitingRights}
                title={washFormBlocked.reason ?? undefined}
              >
                {awaitingRights ? (
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                ) : washFormBlocked.denied ? (
                  <Lock className="mr-2 size-4" />
                ) : (
                  <Plus className="mr-2 size-4" />
                )}{" "}
                Nouveau lavage
              </Button>
              <BlockedReason reason={washFormBlocked.reason} className="max-w-72" />
            </div>
          </div>
        </div>

        {!setupLoading && missingSetup.length > 0 && (
          <section
            className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
            aria-labelledby="mise-en-route"
          >
            <h2 id="mise-en-route" className="text-sm font-semibold">
              Avant d&apos;enregistrer un premier lavage
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Il manque {missingSetup.length === 1 ? "une chose" : `${missingSetup.length} choses`} pour
              pouvoir encaisser. Chaque point se règle en une minute.
            </p>
            <ul className="mt-3 space-y-2">
              {missingSetup.map((item) => (
                <li
                  key={item.to}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2"
                >
                  <span className="text-sm">
                    <span className="font-medium">{item.label}</span>{" "}
                    <span className="text-muted-foreground">{item.why}</span>
                  </span>
                  <Link to={item.to} className={buttonVariants({ size: "sm", variant: "outline" })}>
                    {item.action}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(sitesError || categoriesError || servicesError || workersError) && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {[sitesError, categoriesError, servicesError, workersError].filter(Boolean).join(" · ")}
          </div>
        )}
        {mutationSuccess && (
          <div className="rounded-md border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {mutationSuccess}
                {washToReceipt && " Le client a réglé la totalité : remettez-lui son reçu."}
              </span>
              {washToReceipt && (
                <WashReceiptButton washId={washToReceipt.id} label="Remettre le reçu au client" />
              )}
            </div>
          </div>
        )}

        {showForm && (
          <section className="elev-1 rounded-lg border bg-card p-4 md:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Nouveau lavage</h2>
                <p className="text-sm text-muted-foreground">
                  Les prix du catalogue seront copiés sur le lavage à l’enregistrement.
                </p>
              </div>
              <Button variant="ghost" onClick={closeForm}>Fermer</Button>
            </div>

            <form onSubmit={submitWash} className="space-y-6">
              <div className="grid gap-4 md:grid-cols-3">
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Catégorie du véhicule
                  <select
                    className="h-10 rounded-md border border-input bg-background px-3"
                    value={vehicleCategoryId}
                    onChange={(event) => {
                      setVehicleCategoryId(event.target.value)
                      markFormChanged()
                    }}
                    disabled={categoriesLoading || activeCategories.length === 0}
                    required
                  >
                    <option value="">Sélectionner une catégorie</option>
                    {activeCategories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Plaque <span className="font-normal text-muted-foreground">(facultatif)</span>
                  <Input
                    value={plate}
                    onChange={(event) => {
                      setPlate(event.target.value)
                      markFormChanged()
                    }}
                    placeholder="Ex. 1234 AB 01"
                    maxLength={32}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-10 uppercase"
                  />
                  {vehicleHistory && vehicleHistory.visits > 0 ? (
                    <span className="text-xs font-normal text-muted-foreground">
                      Déjà venu <strong>{vehicleHistory.visits} fois</strong>
                      {vehicleHistory.last_visit_at
                        ? `, la dernière le ${new Date(vehicleHistory.last_visit_at).toLocaleDateString("fr-CI")}`
                        : ""}
                      .
                    </span>
                  ) : (
                    <span className="text-xs font-normal text-muted-foreground">
                      Sert à retrouver l’historique du véhicule. Aucun nom, aucun téléphone.
                    </span>
                  )}
                </label>
                <div className="flex flex-col gap-1.5 text-sm font-medium">
                  Site sélectionné
                  <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-muted-foreground">
                    {allSites.find((site) => site.id === siteId)?.name ?? "Aucun site"}
                  </div>
                </div>
              </div>

              <fieldset className="space-y-3">
                <legend className="mb-2 text-sm font-semibold">Prestations</legend>
                {servicesLoading ? (
                  <div className="grid gap-3 sm:grid-cols-2" role="status" aria-busy="true" aria-label="Chargement du catalogue">
                    {[0, 1, 2, 3].map((item) => (
                      <div
                        key={item}
                        className="row-in flex items-center gap-3 rounded-md border p-3"
                        style={{ "--row": item } as React.CSSProperties}
                      >
                        <Skeleton className="size-4 rounded" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : activeServices.length === 0 ? (
                  <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    Aucune prestation active. Configurez le catalogue avant d’enregistrer un lavage.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {activeServices.map((service) => {
                      const quantity = quantities[service.id] ?? 0
                      return (
                        <div
                          key={service.id}
                          className={`flex items-center gap-3 rounded-md border p-3 transition-all duration-150 ${
                            quantity > 0 ? "border-primary/50 bg-primary/5" : "hover:border-primary/30 hover:bg-muted/40"
                          }`}
                        >
                          <input
                            id={`service-${service.id}`}
                            type="checkbox"
                            checked={quantity > 0}
                            onChange={(event) => toggleService(service.id, event.target.checked)}
                            className="size-4 accent-primary"
                          />
                          <label htmlFor={`service-${service.id}`} className="min-w-0 flex-1 cursor-pointer">
                            <span className="block truncate font-medium">{service.name}</span>
                            <span className="text-xs text-muted-foreground">{formatXof(service.price_cents)} / unité</span>
                          </label>
                          {quantity > 0 && (
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              Qté
                              <Input
                                type="number"
                                min={1}
                                max={100}
                                step={1}
                                className="h-8 w-16"
                                aria-label={`Quantité de ${service.name}`}
                                value={quantity}
                                onChange={(event) => changeQuantity(service.id, event.target.value)}
                              />
                            </label>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="mb-2 text-sm font-semibold">
                  Qui lave ce véhicule&nbsp;?{" "}
                  <span className="font-normal text-muted-foreground">
                    (obligatoire &mdash; plusieurs possibles, la part se partage)
                  </span>
                </legend>
                {workersLoading ? (
                  <div className="flex flex-wrap gap-2" role="status" aria-busy="true" aria-label="Chargement des employés">
                    {[0, 1, 2].map((item) => (
                      <Skeleton
                        key={item}
                        className="row-in h-9 w-32 rounded-md"
                        style={{ "--row": item } as React.CSSProperties}
                      />
                    ))}
                  </div>
                ) : activeWorkers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Aucun employé actif pour le moment. Ajoutez-le dans{" "}
                    <Link to="/team" className="font-medium underline underline-offset-4">
                      Équipe
                    </Link>{" "}
                    pour pouvoir enregistrer un lavage.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {activeWorkers.map((worker) => {
                      const checked = selectedWorkerIds.includes(worker.id)
                      return (
                        <label key={worker.id} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => toggleWorker(worker.id, event.target.checked)}
                            className="size-4 accent-primary"
                          />
                          {worker.first_name} {worker.last_name}
                        </label>
                      )
                    })}
                  </div>
                )}
              </fieldset>

              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">Total des prestations</span>
                  <span className="text-xl font-bold">{formatXof(totalCents)}</span>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Moyen de paiement
                    <select
                      className="h-10 rounded-md border border-input bg-background px-3"
                      value={paymentMethod}
                      onChange={(event) => {
                        setPaymentMethod(event.target.value)
                        markFormChanged()
                      }}
                    >
                      {paymentMethods.map((method) => (
                        <option key={method.value} value={method.value}>{method.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Montant reçu / enregistré (XOF)
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={amountReceived}
                        onChange={(event) => {
                          setAmountReceived(event.target.value)
                          markFormChanged()
                        }}
                        aria-invalid={!amountIsValid}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setAmountReceived((totalCents / 100).toString())
                          markFormChanged()
                        }}
                      >
                        Total
                      </Button>
                    </div>
                  </label>
                </div>
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {amountReceivedCents != null && amountReceivedCents > 0 && amountReceivedCents < totalCents && (
                    <p>Reste à payer : {formatXof(totalCents - amountReceivedCents)}.</p>
                  )}
                  {amountReceivedCents != null && amountReceivedCents > 0 && paymentMethod !== "cash" && (
                    <p>Ce paiement sera enregistré en attente de vérification.</p>
                  )}
                  {cashNeedsSession && !cashSessionLoading && !cashSession && (
                    <p className="text-destructive">
                      Aucune session de caisse ouverte pour ce site. <Link to="/cash-drawer" className="underline">Ouvrir la caisse</Link> ou saisir zéro pour enregistrer le lavage sans paiement.
                    </p>
                  )}
                  {amountReceivedCents != null && amountReceivedCents > totalCents && (
                    <p className="text-destructive">Le paiement ne peut pas dépasser le total du lavage.</p>
                  )}
                  {!amountIsValid && amountReceivedCents == null && (
                    <p className="text-destructive">Saisissez un montant valide.</p>
                  )}
                </div>
              </div>

              {mutationError && (
                <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                  {mutationError}
                </div>
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={closeForm}>Annuler</Button>
                <SubmitButton
                  type="submit"
                  pending={saving}
                  success={saveSuccess}
                  successLabel="Lavage enregistré"
                  idleIcon={<Check className="size-4" />}
                  disabled={submitBlockedReason !== null}
                  title={submitBlockedReason ?? undefined}
                >
                  Enregistrer le lavage
                </SubmitButton>
              </div>
              <BlockedReason reason={submitBlockedReason} className="sm:justify-end sm:text-right" />
            </form>
          </section>
        )}

        <section className="rounded-lg border bg-card">
          <div className="border-b p-4">
            <h2 className="text-lg font-semibold">Historique des lavages</h2>
            <p className="text-sm text-muted-foreground">Les 200 opérations les plus récentes de l’organisation.</p>
          </div>
          {washesLoading && <div className="p-4"><TableSkeleton rows={6} cols={6} label="Chargement de l’historique des lavages" /></div>}
          {washesError && <div className="p-4 text-sm text-destructive">{washesError}</div>}
          {!washesLoading && !washesError && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Référence</TableHead>
                    <TableHead>Plaque</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead>Catégorie</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Paiement</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead><span className="sr-only">Détail</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {washes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="p-0">
                        <EmptyState
                          icon={Droplets}
                          title="Aucun lavage enregistré"
                          description="Enregistrez votre premier lavage : il apparaîtra ici avec sa référence, son montant et son statut de paiement."
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  {washes.map((wash, index) => (
                    <TableRow
                      key={wash.id}
                      className={`row-in transition-colors hover:bg-muted/40 ${wash.id === highlightedWashId ? "row-flash" : ""}`}
                      style={{ "--row": Math.min(index, 10) } as React.CSSProperties}
                    >
                      <TableCell className="font-medium">
                        <WashReference washId={wash.id} reference={wash.reference} />
                      </TableCell>
                      <TableCell className="font-mono text-xs uppercase tabular-nums">{wash.plate ?? "—"}</TableCell>
                      <TableCell>{allSites.find((site) => site.id === wash.site_id)?.name ?? "—"}</TableCell>
                      <TableCell>{activeCategories.find((category) => category.id === wash.vehicle_category_id)?.name ?? "—"}</TableCell>
                      <TableCell className="text-right">{formatXof(wash.total_cents)}</TableCell>
                      <TableCell>{washStatusLabel(wash.status)}</TableCell>
                      <TableCell>{paymentStatusLabel(wash.payment_status)}</TableCell>
                      <TableCell>{new Date(wash.created_at).toLocaleString("fr-CI")}</TableCell>
                      <TableCell>
                        <Button
                          render={<Link to={`/washes/${wash.id}`} viewTransition />}
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Voir ${wash.reference}`}
                        >
                          <ArrowRight className="size-4 transition-transform group-hover/button:translate-x-0.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>
    </BaseLayout>
  )
}
