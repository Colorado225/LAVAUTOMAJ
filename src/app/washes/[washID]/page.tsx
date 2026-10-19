"use client"

import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Ban, RefreshCw } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { apiFetch, useApi } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

interface Wash {
  id: string
  reference: string
  site_id: string | null
  vehicle_category_id: string | null
  total_cents: number
  status: string
  payment_status: string
  author_id: string
  cancelled_at: string | null
  cancelled_by_id: string | null
  cancellation_reason: string | null
  created_at: string
}

interface WashItem {
  id: string
  service_id: string | null
  service_name_snapshot: string
  price_cents_snapshot: number
  quantity: number
}

interface Worker {
  id: string
  first_name: string
  last_name: string
  role: string
}

interface Payment {
  id: string
  amount_cents: number
  method: string
  status: string
  reference: string | null
  received_at: string
}

interface WashDetail {
  wash: Wash
  items: WashItem[]
  workers: Worker[]
  payments: Payment[]
}

interface Site {
  id: string
  name: string
}

interface VehicleCategory {
  id: string
  name: string
}

function formatXof(cents: number): string {
  return `${(cents / 100).toLocaleString("fr-CI", { maximumFractionDigits: 2 })} XOF`
}

function paymentMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    cash: "Espèces",
    orange_money: "Orange Money",
    mtn_momo: "MTN MoMo",
    moov_money: "Moov Money",
    wave: "Wave",
    other: "Autre",
  }
  return labels[method] ?? method
}

function paymentStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "En attente de vérification",
    verified: "Vérifié",
    failed: "Échoué",
    refunded: "Remboursé",
  }
  return labels[status] ?? status
}

export default function WashDetailPage() {
  const { washID } = useParams<{ washID: string }>()
  const [refreshKey, setRefreshKey] = useState(0)
  const path = washID ? `/api/v1/washes/${encodeURIComponent(washID)}?refresh=${refreshKey}` : ""
  const { data: detail, loading, error } = useApi<WashDetail>(path)
  const { data: sites } = useApi<Site[]>("/api/v1/sites")
  const { data: categories } = useApi<VehicleCategory[]>("/api/v1/vehicle-categories")
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  async function cancelWash() {
    if (!washID || !reason.trim()) {
      setMutationError("Indiquez le motif de l’annulation.")
      return
    }
    setSaving(true)
    setMutationError(null)
    try {
      const response = await apiFetch(
        `/api/v1/washes/${encodeURIComponent(washID)}/cancel`,
        {
          method: "POST",
          body: JSON.stringify({ reason: reason.trim() }),
        }
      )
      if (!response.ok) throw new Error((await response.text()) || `Erreur ${response.status}`)
      setCancelOpen(false)
      setReason("")
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Impossible d’annuler ce lavage.")
    } finally {
      setSaving(false)
    }
  }

  const wash = detail?.wash
  const hasVerifiedPayment = detail?.payments.some((payment) => payment.status === "verified") ?? false
  const siteName = sites?.find((site) => site.id === wash?.site_id)?.name ?? "—"
  const vehicleCategoryName = categories?.find((category) => category.id === wash?.vehicle_category_id)?.name ?? "—"

  return (
    <BaseLayout title="Détail du lavage" description="Détail et historique d’un lavage.">
      <div className="space-y-6 p-4">
        <div>
          <Button render={<Link to="/washes" />} variant="ghost" className="-ml-2 mb-3">
            <ArrowLeft className="mr-2 size-4" /> Retour aux lavages
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {wash ? `Lavage ${wash.reference}` : "Détail du lavage"}
          </h1>
          <p className="text-sm text-muted-foreground">Consultez les prestations, employés et paiements associés.</p>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Chargement du lavage…</p>}
        {error && <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</div>}

        {!loading && !error && detail && (
          <>
            <section className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Référence</p>
                <p className="font-semibold">{wash?.reference}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Site</p>
                <p className="font-semibold">{siteName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Catégorie</p>
                <p className="font-semibold">{vehicleCategoryName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Date d’enregistrement</p>
                <p className="font-semibold">{wash ? new Date(wash.created_at).toLocaleString("fr-CI") : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Statut</p>
                <p className="font-semibold">{wash?.status === "cancelled" ? "Annulé" : wash?.status === "completed" ? "Terminé" : wash?.status}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Statut du paiement</p>
                <p className="font-semibold">{wash?.payment_status === "paid" ? "Payé" : wash?.payment_status === "partial" ? "Partiel" : wash?.payment_status === "refunded" ? "Remboursé" : "Non payé"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-lg font-bold">{formatXof(wash?.total_cents ?? 0)}</p>
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border bg-card">
              <div className="border-b p-4">
                <h2 className="font-semibold">Prestations enregistrées</h2>
                <p className="text-sm text-muted-foreground">Nom et prix figés au moment de la vente.</p>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Prestation</TableHead>
                      <TableHead className="text-right">Prix unitaire</TableHead>
                      <TableHead className="text-right">Quantité</TableHead>
                      <TableHead className="text-right">Sous-total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Aucune ligne de prestation.</TableCell></TableRow>
                    )}
                    {detail.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.service_name_snapshot}</TableCell>
                        <TableCell className="text-right">{formatXof(item.price_cents_snapshot)}</TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">{formatXof(item.price_cents_snapshot * item.quantity)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-lg border bg-card p-4">
                <h2 className="font-semibold">Employés affectés</h2>
                {detail.workers.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">Aucun employé affecté à ce lavage.</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm">
                    {detail.workers.map((worker) => (
                      <li key={worker.id} className="flex justify-between rounded-md bg-muted/40 px-3 py-2">
                        <span>{worker.first_name} {worker.last_name}</span>
                        <span className="text-muted-foreground">{worker.role.replaceAll("_", " ")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-lg border bg-card p-4">
                <h2 className="font-semibold">Paiements</h2>
                {detail.payments.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">Aucun paiement enregistré.</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm">
                    {detail.payments.map((payment) => (
                      <li key={payment.id} className="rounded-md bg-muted/40 px-3 py-2">
                        <div className="flex justify-between gap-3">
                          <span className="font-medium">{paymentMethodLabel(payment.method)}</span>
                          <span>{formatXof(payment.amount_cents)}</span>
                        </div>
                        <div className="mt-1 flex justify-between gap-3 text-xs text-muted-foreground">
                          <span>{paymentStatusLabel(payment.status)}</span>
                          <time>{new Date(payment.received_at).toLocaleString("fr-CI")}</time>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {wash?.status === "cancelled" && (
              <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <h2 className="font-semibold text-destructive">Lavage annulé</h2>
                <p className="mt-1 text-sm">Motif : {wash.cancellation_reason || "—"}</p>
                {wash.cancelled_at && <p className="mt-1 text-xs text-muted-foreground">Annulé le {new Date(wash.cancelled_at).toLocaleString("fr-CI")}</p>}
              </section>
            )}

            {wash?.status !== "cancelled" && (
              <section className="rounded-lg border p-4">
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                  <div>
                    <h2 className="font-semibold">Annulation</h2>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                      L’annulation conserve le détail pour l’audit. Les paiements vérifiés doivent être remboursés avant de pouvoir annuler le lavage.
                    </p>
                    {hasVerifiedPayment && (
                      <p className="mt-2 text-sm text-destructive">Au moins un paiement est vérifié; l’annulation est bloquée jusqu’au remboursement.</p>
                    )}
                  </div>
                  <Button
                    variant="destructive"
                    disabled={hasVerifiedPayment}
                    onClick={() => {
                      setMutationError(null)
                      setCancelOpen((open) => !open)
                    }}
                  >
                    <Ban className="mr-2 size-4" /> Annuler le lavage
                  </Button>
                </div>
                {cancelOpen && (
                  <div className="mt-4 space-y-3 border-t pt-4">
                    <label className="flex flex-col gap-1.5 text-sm font-medium">
                      Motif de l’annulation
                      <Textarea
                        value={reason}
                        maxLength={500}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="Ex. erreur de saisie, véhicule non pris en charge…"
                      />
                    </label>
                    {mutationError && <p role="alert" className="text-sm text-destructive">{mutationError}</p>}
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setCancelOpen(false)}>Garder le lavage</Button>
                      <Button variant="destructive" disabled={saving || !reason.trim()} onClick={cancelWash}>
                        {saving && <RefreshCw className="mr-2 size-4 animate-spin" />}
                        Confirmer l’annulation
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </BaseLayout>
  )
}
