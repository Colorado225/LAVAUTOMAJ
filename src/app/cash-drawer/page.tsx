"use client"

import * as React from "react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { useApi, apiFetch, getClerkToken } from "@/lib/api"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ArrowDownToLine, ArrowUpFromLine, Plus, WalletCards } from "lucide-react"

interface Site {
  id: string
  name: string
  city: string | null
}

interface CashSession {
  id: string
  site_id: string
  opening_amount_cents: number
  theoretical_balance_cents: number
  counted_amount_cents: number | null
  discrepancy_cents: number | null
  status: string
  opened_at: string
  closed_at: string | null
}

interface CashMovement {
  id: string
  type: string
  amount_cents: number
  source: string
  created_at: string
}

function xofToCents(value: string, requirePositive = false): number | null {
  if (!value.trim()) return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return null
  const cents = Math.round(amount * 100)
  if (!Number.isSafeInteger(cents) || (requirePositive && cents <= 0)) return null
  return cents
}

export default function CashDrawerPage() {
  const { data: sites, loading: sitesLoading, error: sitesError } = useApi<Site[]>("/api/v1/sites")
  const [selectedSiteId, setSelectedSiteId] = React.useState("")
  const siteId = selectedSiteId || sites?.[0]?.id || ""
  const [openDialog, setOpenDialog] = React.useState(false)
  const [openingAmount, setOpeningAmount] = React.useState("0")
  const [movementDialogOpen, setMovementDialogOpen] = React.useState(false)
  const [movementType, setMovementType] = React.useState<"entry" | "exit">("entry")
  const [movementAmount, setMovementAmount] = React.useState("")
  const [movementDescription, setMovementDescription] = React.useState("")
  const [closeDialogOpen, setCloseDialogOpen] = React.useState(false)
  const [countedAmount, setCountedAmount] = React.useState("")
  const [discrepancyReason, setDiscrepancyReason] = React.useState("")
  const [refreshKey, setRefreshKey] = React.useState(0)
  const [saving, setSaving] = React.useState(false)
  const [mutationError, setMutationError] = React.useState<string | null>(null)
  const sessionPath = siteId
    ? `/api/v1/cash-sessions/current?site_id=${encodeURIComponent(siteId)}&refresh=${refreshKey}`
    : ""
  const { data: session, loading, error } = useApi<CashSession | null>(sessionPath)
  const movementPath = session
    ? `/api/v1/cash-sessions/${encodeURIComponent(session.id)}/movements?refresh=${refreshKey}`
    : ""
  const { data: movements } = useApi<CashMovement[]>(movementPath)

  async function openCashSession() {
    const amountCents = xofToCents(openingAmount)
    if (!siteId || amountCents == null) {
      setMutationError("Sélectionnez un site et saisissez un montant valide.")
      return
    }

    setSaving(true)
    setMutationError(null)
    try {
      const token = await getClerkToken()
      const response = await apiFetch(
        "/api/v1/cash-sessions/open",
        {
          method: "POST",
          body: JSON.stringify({
            site_id: siteId,
            opening_amount_cents: amountCents,
          }),
        },
        token
      )
      if (!response.ok) {
        throw new Error((await response.text()) || `Erreur ${response.status}`)
      }
      setOpenDialog(false)
      setOpeningAmount("0")
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Impossible d’ouvrir la caisse.")
    } finally {
      setSaving(false)
    }
  }

  async function addMovement() {
    if (!session) return
    const amountCents = xofToCents(movementAmount, true)
    if (amountCents == null) {
      setMutationError("Saisissez un montant positif valide.")
      return
    }

    setSaving(true)
    setMutationError(null)
    try {
      const token = await getClerkToken()
      const response = await apiFetch(
        `/api/v1/cash-sessions/${encodeURIComponent(session.id)}/movements`,
        {
          method: "POST",
          body: JSON.stringify({
            type: movementType,
            amount_cents: amountCents,
            source: "manual",
            description: movementDescription.trim() || null,
          }),
        },
        token
      )
      if (!response.ok) {
        throw new Error((await response.text()) || `Erreur ${response.status}`)
      }
      setMovementDialogOpen(false)
      setMovementAmount("")
      setMovementDescription("")
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Impossible d’enregistrer le mouvement.")
    } finally {
      setSaving(false)
    }
  }

  async function closeCashSession() {
    if (!session) return
    const countedAmountCents = xofToCents(countedAmount)
    if (countedAmountCents == null) {
      setMutationError("Saisissez le montant réellement compté.")
      return
    }
    const hasDiscrepancy = countedAmountCents !== session.theoretical_balance_cents
    if (hasDiscrepancy && !discrepancyReason.trim()) {
      setMutationError("Justifiez l’écart avant de clôturer la session.")
      return
    }

    setSaving(true)
    setMutationError(null)
    try {
      const token = await getClerkToken()
      const response = await apiFetch(
        `/api/v1/cash-sessions/${encodeURIComponent(session.id)}/close`,
        {
          method: "POST",
          body: JSON.stringify({
            counted_amount_cents: countedAmountCents,
            discrepancy_reason: discrepancyReason.trim() || null,
          }),
        },
        token
      )
      if (!response.ok) {
        throw new Error((await response.text()) || `Erreur ${response.status}`)
      }
      setCloseDialogOpen(false)
      setCountedAmount("")
      setDiscrepancyReason("")
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Impossible de clôturer la caisse.")
    } finally {
      setSaving(false)
    }
  }

  const parsedCountedAmount = xofToCents(countedAmount)
  const countHasDiscrepancy =
    session != null && parsedCountedAmount != null &&
    parsedCountedAmount !== session.theoretical_balance_cents

  return (
    <BaseLayout title="Caisse" description="Ouverture, clôture et suivi de la caisse.">
      <div className="p-4">
        <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Caisse</h1>
            <p className="text-muted-foreground">
              Gérez vos sessions de caisse et vos mouvements d’argent.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex min-w-56 flex-col gap-1 text-sm font-medium">
              Site
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={siteId}
                onChange={(event) => setSelectedSiteId(event.target.value)}
                disabled={sitesLoading || !sites?.length}
              >
                {sites?.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}{site.city ? ` — ${site.city}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <Button
              onClick={() => {
                setMutationError(null)
                setOpenDialog(true)
              }}
              disabled={!siteId || !!session || loading || sitesLoading}
            >
              <Plus className="mr-2 size-4" />
              {session ? "Session ouverte" : "Nouvelle session"}
            </Button>
          </div>
        </div>

        {sitesError && <div className="text-destructive">{sitesError}</div>}
        {!sitesLoading && sites?.length === 0 && (
          <div className="rounded border bg-muted p-4 text-sm text-muted-foreground">
            Aucun site n’est associé à cette organisation. Terminez l’onboarding pour créer le premier site.
          </div>
        )}
        {loading && <div className="text-muted-foreground">Chargement de la caisse…</div>}
        {error && <div className="text-destructive">{error}</div>}

        {!loading && !error && siteId && !session && (
          <div className="rounded border bg-muted p-4">
            <p className="text-sm text-muted-foreground">
              Aucune session ouverte pour ce site. Ouvrez une session pour commencer le suivi.
            </p>
          </div>
        )}

        {!loading && !error && session && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded border bg-card p-4">
                <p className="text-sm text-muted-foreground">Solde théorique</p>
                <p className="text-2xl font-bold">
                  {(session.theoretical_balance_cents / 100).toLocaleString("fr-CI")} XOF
                </p>
              </div>
              <div className="rounded border bg-card p-4">
                <p className="text-sm text-muted-foreground">Montant compté</p>
                <p className="text-2xl font-bold">
                  {session.counted_amount_cents != null
                    ? `${(session.counted_amount_cents / 100).toLocaleString("fr-CI")} XOF`
                    : "—"}
                </p>
              </div>
              <div className="rounded border bg-card p-4">
                <p className="text-sm text-muted-foreground">Écart de caisse</p>
                <p className={`text-2xl font-bold ${session.discrepancy_cents ? "text-destructive" : ""}`}>
                  {session.discrepancy_cents != null
                    ? `${(session.discrepancy_cents / 100).toLocaleString("fr-CI")} XOF`
                    : "—"}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <h2 className="text-lg font-bold">Mouvements de caisse</h2>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setMovementType("entry")
                      setMutationError(null)
                      setMovementDialogOpen(true)
                    }}
                  >
                    <ArrowDownToLine className="mr-2 size-4" /> Entrée
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setMovementType("exit")
                      setMutationError(null)
                      setMovementDialogOpen(true)
                    }}
                  >
                    <ArrowUpFromLine className="mr-2 size-4" /> Sortie
                  </Button>
                  <Button
                    onClick={() => {
                      setCountedAmount("")
                      setDiscrepancyReason("")
                      setMutationError(null)
                      setCloseDialogOpen(true)
                    }}
                  >
                    <WalletCards className="mr-2 size-4" /> Clôturer
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Montant (XOF)</TableHead>
                      <TableHead>Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(movements?.length ?? 0) === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          Aucun mouvement enregistré.
                        </TableCell>
                      </TableRow>
                    )}
                    {movements?.map((movement) => (
                      <TableRow key={movement.id}>
                        <TableCell>{new Date(movement.created_at).toLocaleDateString("fr-CI")}</TableCell>
                        <TableCell>{movement.type === "entry" ? "Entrée" : "Sortie"}</TableCell>
                        <TableCell className="text-right">
                          {(movement.amount_cents / 100).toLocaleString("fr-CI")}
                        </TableCell>
                        <TableCell>{movement.source}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}

        <Dialog open={openDialog} onOpenChange={setOpenDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ouvrir une session de caisse</DialogTitle>
              <DialogDescription>
                Le montant d’ouverture initialise le solde théorique du site sélectionné.
              </DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="opening-amount">
              Fonds de caisse initial (XOF)
              <Input
                id="opening-amount"
                type="number"
                min="0"
                step="1"
                value={openingAmount}
                onChange={(event) => setOpeningAmount(event.target.value)}
                disabled={saving}
              />
            </label>
            {mutationError && <p className="text-sm text-destructive">{mutationError}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenDialog(false)} disabled={saving}>
                Annuler
              </Button>
              <Button onClick={openCashSession} disabled={saving || !siteId}>
                {saving ? "Ouverture…" : "Ouvrir la caisse"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={movementDialogOpen} onOpenChange={setMovementDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {movementType === "entry" ? "Enregistrer une entrée" : "Enregistrer une sortie"}
              </DialogTitle>
              <DialogDescription>
                Le mouvement sera ajouté au journal et au solde de cette session.
              </DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="movement-amount">
              Montant (XOF)
              <Input
                id="movement-amount"
                type="number"
                min="0"
                step="1"
                value={movementAmount}
                onChange={(event) => setMovementAmount(event.target.value)}
                disabled={saving}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="movement-description">
              Description (facultative)
              <Input
                id="movement-description"
                value={movementDescription}
                onChange={(event) => setMovementDescription(event.target.value)}
                disabled={saving}
              />
            </label>
            {mutationError && <p className="text-sm text-destructive">{mutationError}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setMovementDialogOpen(false)} disabled={saving}>
                Annuler
              </Button>
              <Button onClick={addMovement} disabled={saving || !movementAmount}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Clôturer la session de caisse</DialogTitle>
              <DialogDescription>
                Solde théorique : {session
                  ? `${(session.theoretical_balance_cents / 100).toLocaleString("fr-CI")} XOF`
                  : "—"}. Comptez les espèces avant de confirmer.
              </DialogDescription>
            </DialogHeader>
            <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="counted-amount">
              Montant réellement compté (XOF)
              <Input
                id="counted-amount"
                type="number"
                min="0"
                step="1"
                value={countedAmount}
                onChange={(event) => setCountedAmount(event.target.value)}
                disabled={saving}
              />
            </label>
            {countHasDiscrepancy && (
              <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="discrepancy-reason">
                Motif de l’écart obligatoire
                <Input
                  id="discrepancy-reason"
                  value={discrepancyReason}
                  onChange={(event) => setDiscrepancyReason(event.target.value)}
                  disabled={saving}
                />
              </label>
            )}
            {mutationError && <p className="text-sm text-destructive">{mutationError}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCloseDialogOpen(false)} disabled={saving}>
                Annuler
              </Button>
              <Button
                onClick={closeCashSession}
                disabled={saving || parsedCountedAmount == null || (countHasDiscrepancy && !discrepancyReason.trim())}
              >
                {saving ? "Clôture…" : "Confirmer la clôture"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </BaseLayout>
  )
}
