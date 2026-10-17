"use client"

import { useMemo, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { BaseLayout } from "@/components/layouts/base-layout"
import { apiFetch, getClerkToken, useApi } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowRight, Check, Plus, RefreshCw } from "lucide-react"

interface Site {
  id: string
  name: string
  city: string | null
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

interface Wash {
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

function makeIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function WashesPage() {
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
  const [vehicleCategoryId, setVehicleCategoryId] = useState("")
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([])
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [amountReceived, setAmountReceived] = useState("0")
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null)

  const activeSites = sites ?? []
  const activeCategories = (categories ?? []).filter((item) => item.is_active)
  const activeServices = (serviceCatalog ?? []).filter((item) => item.is_active)
  const activeWorkers = (workers ?? []).filter((worker) => worker.status === "active")
  const washes = washesData ?? []

  const selectedServices = useMemo(
    () => activeServices.filter((service) => (quantities[service.id] ?? 0) > 0),
    [activeServices, quantities]
  )
  const totalCents = selectedServices.reduce(
    (total, service) => total + service.price_cents * (quantities[service.id] ?? 0),
    0
  )
  const amountReceivedCents = parseXofAmount(amountReceived)
  const amountIsValid = amountReceivedCents != null && amountReceivedCents <= totalCents
  const cashNeedsSession = amountReceivedCents != null && amountReceivedCents > 0 && paymentMethod === "cash"

  function markFormChanged() {
    setIdempotencyKey(null)
    setMutationError(null)
    setMutationSuccess(null)
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

    if (!siteId || !vehicleCategoryId || selectedServices.length === 0) {
      setMutationError("Choisissez un site, une catégorie et au moins une prestation.")
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

    const requestKey = idempotencyKey ?? makeIdempotencyKey()
    setIdempotencyKey(requestKey)
    setSaving(true)
    try {
      const token = await getClerkToken()
      const response = await apiFetch(
        "/api/v1/washes",
        {
          method: "POST",
          headers: { "Idempotency-Key": requestKey },
          body: JSON.stringify({
            site_id: siteId,
            vehicle_category_id: vehicleCategoryId,
            items: selectedServices.map((service) => ({
              service_id: service.id,
              quantity: quantities[service.id],
            })),
            worker_ids: selectedWorkerIds,
            payment_method: paymentMethod,
            amount_received_cents: amountReceivedCents,
            ...(cashNeedsSession && cashSession ? { cash_session_id: cashSession.id } : {}),
          }),
        },
        token
      )
      if (!response.ok) {
        throw new Error((await response.text()) || `Erreur ${response.status}`)
      }
      const replayed = response.headers.get("Idempotency-Replayed") === "true"
      setMutationSuccess(replayed ? "Cette opération avait déjà été enregistrée." : "Lavage enregistré avec succès.")
      setQuantities({})
      setSelectedWorkerIds([])
      setVehicleCategoryId("")
      setAmountReceived("0")
      setIdempotencyKey(null)
      setRefreshKey((key) => key + 1)
      setFormOpen(false)
    } catch (err) {
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
            <Button
              onClick={() => {
                setMutationError(null)
                setMutationSuccess(null)
                setFormOpen((open) => !open)
              }}
              disabled={sitesLoading || activeSites.length === 0}
            >
              <Plus className="mr-2 size-4" /> Nouveau lavage
            </Button>
          </div>
        </div>

        {(sitesError || categoriesError || servicesError || workersError) && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {[sitesError, categoriesError, servicesError, workersError].filter(Boolean).join(" · ")}
          </div>
        )}
        {mutationSuccess && (
          <div className="rounded-md border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
            {mutationSuccess}
          </div>
        )}

        {formOpen && (
          <section className="rounded-lg border bg-card p-4 shadow-sm md:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Nouveau lavage</h2>
                <p className="text-sm text-muted-foreground">
                  Les prix du catalogue seront copiés sur le lavage à l’enregistrement.
                </p>
              </div>
              <Button variant="ghost" onClick={() => setFormOpen(false)}>Fermer</Button>
            </div>

            <form onSubmit={submitWash} className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
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
                <div className="flex flex-col gap-1.5 text-sm font-medium">
                  Site sélectionné
                  <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-muted-foreground">
                    {activeSites.find((site) => site.id === siteId)?.name ?? "Aucun site"}
                  </div>
                </div>
              </div>

              <fieldset className="space-y-3">
                <legend className="mb-2 text-sm font-semibold">Prestations</legend>
                {servicesLoading ? (
                  <p className="text-sm text-muted-foreground">Chargement du catalogue…</p>
                ) : activeServices.length === 0 ? (
                  <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    Aucune prestation active. Configurez le catalogue avant d’enregistrer un lavage.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {activeServices.map((service) => {
                      const quantity = quantities[service.id] ?? 0
                      return (
                        <div key={service.id} className="flex items-center gap-3 rounded-md border p-3">
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
                <legend className="mb-2 text-sm font-semibold">Employés affectés <span className="font-normal text-muted-foreground">(facultatif)</span></legend>
                {workersLoading ? (
                  <p className="text-sm text-muted-foreground">Chargement des employés…</p>
                ) : activeWorkers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun employé actif à affecter.</p>
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
                <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Annuler</Button>
                <Button
                  type="submit"
                  disabled={
                    saving || !siteId || !vehicleCategoryId || selectedServices.length === 0 ||
                    !amountIsValid || (cashNeedsSession && (cashSessionLoading || !cashSession))
                  }
                >
                  {saving ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}
                  {saving ? "Enregistrement…" : "Enregistrer le lavage"}
                </Button>
              </div>
            </form>
          </section>
        )}

        <section className="rounded-lg border bg-card">
          <div className="border-b p-4">
            <h2 className="text-lg font-semibold">Historique des lavages</h2>
            <p className="text-sm text-muted-foreground">Les 200 opérations les plus récentes de l’organisation.</p>
          </div>
          {washesLoading && <div className="p-4 text-sm text-muted-foreground">Chargement de l’historique…</div>}
          {washesError && <div className="p-4 text-sm text-destructive">{washesError}</div>}
          {!washesLoading && !washesError && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Référence</TableHead>
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
                      <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                        Aucun lavage enregistré.
                      </TableCell>
                    </TableRow>
                  )}
                  {washes.map((wash) => (
                    <TableRow key={wash.id}>
                      <TableCell className="font-medium">{wash.reference}</TableCell>
                      <TableCell>{activeSites.find((site) => site.id === wash.site_id)?.name ?? "—"}</TableCell>
                      <TableCell>{activeCategories.find((category) => category.id === wash.vehicle_category_id)?.name ?? "—"}</TableCell>
                      <TableCell className="text-right">{formatXof(wash.total_cents)}</TableCell>
                      <TableCell>{washStatusLabel(wash.status)}</TableCell>
                      <TableCell>{paymentStatusLabel(wash.payment_status)}</TableCell>
                      <TableCell>{new Date(wash.created_at).toLocaleString("fr-CI")}</TableCell>
                      <TableCell>
                        <Button
                          render={<Link to={`/washes/${wash.id}`} />}
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Voir ${wash.reference}`}
                        >
                          <ArrowRight className="size-4" />
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
