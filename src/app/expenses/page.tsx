"use client"

import { useRef, useState, type FormEvent } from "react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { useCapability } from "@/lib/subscription"
import { apiFetch, useApi } from "@/lib/api"
import { createIdempotencyKey } from "@/lib/idempotency"
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
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { TableSkeleton } from "@/components/ui/table-skeleton"
import { SubmitButton } from "@/components/ui/submit-button"
import { EmptyState } from "@/components/ui/empty-state"
import { useSuccessFlash } from "@/hooks/use-success-flash"
import { Lock, Plus, Receipt, X } from "lucide-react"

interface Site {
  id: string
  name: string
  city: string | null
}

interface CashSession {
  id: string
  status: string
  site_id: string
}

interface Expense {
  id: string
  category: string
  amount_cents: number
  expense_date: string
  payment_method: string
  status: string
  site_id: string | null
  cash_session_id: string | null
  description: string | null
  beneficiary: string | null
}

const paymentMethods = [
  { value: "cash", label: "Espèces" },
  { value: "orange_money", label: "Orange Money" },
  { value: "mtn_momo", label: "MTN MoMo" },
  { value: "moov_money", label: "Moov Money" },
  { value: "wave", label: "Wave" },
  { value: "other", label: "Autre" },
]

const expenseCategories = [
  { value: "supply", label: "Approvisionnement" },
  { value: "salary", label: "Salaire" },
  { value: "maintenance", label: "Maintenance" },
  { value: "utilities", label: "Factures (électricité, eau)" },
  { value: "rent", label: "Loyer" },
  { value: "tax", label: "Impôts & taxes" },
  { value: "marketing", label: "Marketing & publicité" },
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

function expenseStatusLabel(status: string): string {
  if (status === "recorded") return "Enregistrée"
  if (status === "cancelled") return "Annulée"
  return status
}

interface CreateExpenseRequest {
  category: string
  amount_cents: number
  payment_method: string
  site_id?: string
  beneficiary?: string
  description?: string
  reference?: string
  cash_session_id?: string
}

export default function ExpensesPage() {
  const manageExpenses = useCapability("expenses.manage")
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, loading, error } = useApi<Expense[]>(`/api/v1/expenses?refresh=${refreshKey}`)
  const expenses = data ?? []
  const { data: sites } = useApi<Site[]>(`/api/v1/sites?refresh=${refreshKey}`)
  const { data: cashSessions } = useApi<CashSession[]>(`/api/v1/cash-sessions?status=open&refresh=${refreshKey}`)

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, flashSaveSuccess] = useSuccessFlash()
  // La dépense qui vient d'être créée est surlignée brièvement dans la liste.
  const [highlightedExpenseId, setHighlightedExpenseId] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null)
  const idempotencyKeys = useRef(new Map<string, string>())

  // Form fields
  const [siteId, setSiteId] = useState("")
  const [category, setCategory] = useState("")
  const [amount, setAmount] = useState("")
  const [paymentMethod, setPaymentMethod] = useState("cash")
  const [beneficiary, setBeneficiary] = useState("")
  const [description, setDescription] = useState("")
  const [reference, setReference] = useState("")
  const [cashSessionId, setCashSessionId] = useState("")

  // Gestionnaires pour les composants Select qui peuvent renvoyer null
  const handleSiteChange = (value: string | null) => setSiteId(value ?? "")
  const handleCategoryChange = (value: string | null) => setCategory(value ?? "")
  const handlePaymentMethodChange = (value: string | null) => setPaymentMethod(value ?? "cash")
  const handleCashSessionChange = (value: string | null) => setCashSessionId(value ?? "")

  const activeSites = sites ?? []
  const openCashSessions = cashSessions ?? []
  const amountCents = parseXofAmount(amount)
  const needsCashSession = paymentMethod === "cash"

  function resetForm() {
    setSiteId("")
    setCategory("")
    setAmount("")
    setPaymentMethod("cash")
    setBeneficiary("")
    setDescription("")
    setReference("")
    setCashSessionId("")
    setMutationError(null)
    setMutationSuccess(null)
  }

  async function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMutationError(null)
    setMutationSuccess(null)

    if (!category) {
      setMutationError("Veuillez sélectionner une catégorie.")
      return
    }
    if (amountCents == null || amountCents <= 0) {
      setMutationError("Le montant doit être un nombre positif valide.")
      return
    }
    if (needsCashSession && !cashSessionId) {
      setMutationError("Une session de caisse ouverte est requise pour les paiements en espèces.")
      return
    }

    setSaving(true)
    try {
      const body: CreateExpenseRequest = {
        category,
        amount_cents: amountCents,
        payment_method: paymentMethod,
      }

      if (siteId) body.site_id = siteId
      if (beneficiary) body.beneficiary = beneficiary
      if (description) body.description = description
      if (reference) body.reference = reference
      if (cashSessionId) body.cash_session_id = cashSessionId

      const fingerprint = JSON.stringify(body)
      let requestKey = idempotencyKeys.current.get(fingerprint)
      if (!requestKey) {
        requestKey = createIdempotencyKey()
        idempotencyKeys.current.set(fingerprint, requestKey)
      }

      const response = await apiFetch("/api/v1/expenses", {
        method: "POST",
        headers: { "Idempotency-Key": requestKey },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `Erreur ${response.status}`)
      }

      idempotencyKeys.current.clear()
      const created = (await response.json().catch(() => null)) as { id?: string } | null
      if (created?.id) setHighlightedExpenseId(created.id)
      flashSaveSuccess()
      setMutationSuccess("Dépense enregistrée avec succès !")
      setTimeout(() => {
        setOpen(false)
        resetForm()
        setRefreshKey((key) => key + 1)
      }, 1500)
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Échec de l'enregistrement de la dépense.")
    } finally {
      setSaving(false)
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen && !saving) {
      resetForm()
    }
    setOpen(isOpen)
  }

  return (
    <BaseLayout title="Dépenses" description="Enregistrement et suivi des dépenses.">
      <div className="p-4">
        <div className="flex md:flex-row flex-col md:items-center justify-between gap-4 mb-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Dépenses</h1>
            <p className="text-muted-foreground">
              Enregistrez et suivez les dépenses de votre station.
            </p>
          </div>
          <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger
              render={
                <Button
                  disabled={!manageExpenses.allowed}
                  title={manageExpenses.reason ?? undefined}
                />
              }
            >
              {manageExpenses.allowed ? (
                <Plus className="mr-2 h-4 w-4" />
              ) : (
                <Lock className="mr-2 h-4 w-4" />
              )}{" "}
              Nouvelle dépense
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Nouvelle dépense</DialogTitle>
                <DialogDescription>
                  Enregistrez une nouvelle dépense pour votre station.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={submitExpense} className="space-y-6 py-4">
                {mutationError && (
                  <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                    {mutationError}
                  </div>
                )}
                {mutationSuccess && (
                  <div className="p-3 bg-green-100 text-green-800 rounded-md text-sm">
                    {mutationSuccess}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="site">Site (optionnel)</Label>
                    <Select value={siteId} onValueChange={handleSiteChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionner un site" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeSites.map((site) => (
                          <SelectItem key={site.id} value={site.id}>
                            {site.name} {site.city ? `(${site.city})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="category">Catégorie *</Label>
                    <Select value={category} onValueChange={handleCategoryChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Sélectionner une catégorie" />
                      </SelectTrigger>
                      <SelectContent>
                        {expenseCategories.map((cat) => (
                          <SelectItem key={cat.value} value={cat.value}>
                            {cat.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="amount">Montant (XOF) *</Label>
                    <Input
                      id="amount"
                      type="number"
                      min="0"
                      step="100"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="50000"
                    />
                    {amountCents && amountCents > 0 && (
                      <p className="text-sm text-muted-foreground">
                        {formatXof(amountCents)}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="payment_method">Moyen de paiement *</Label>
                    <Select value={paymentMethod} onValueChange={handlePaymentMethodChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Moyen de paiement" />
                      </SelectTrigger>
                      <SelectContent>
                        {paymentMethods.map((method) => (
                          <SelectItem key={method.value} value={method.value}>
                            {method.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {needsCashSession && (
                    <div className="space-y-2">
                      <Label htmlFor="cash_session">Session de caisse *</Label>
                      <Select value={cashSessionId} onValueChange={handleCashSessionChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Session ouverte" />
                        </SelectTrigger>
                        <SelectContent>
                          {openCashSessions.length === 0 ? (
                            <SelectItem value="" disabled>
                              Aucune session ouverte
                            </SelectItem>
                          ) : (
                            openCashSessions.map((session) => (
                              <SelectItem key={session.id} value={session.id}>
                                Session #{session.id.slice(0, 8)}...
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="beneficiary">Bénéficiaire (optionnel)</Label>
                    <Input
                      id="beneficiary"
                      value={beneficiary}
                      onChange={(e) => setBeneficiary(e.target.value)}
                      placeholder="Nom du bénéficiaire"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reference">Référence (optionnel)</Label>
                    <Input
                      id="reference"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="Facture #123"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description (optionnel)</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Détails supplémentaires..."
                    rows={3}
                  />
                </div>

                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handleOpenChange(false)}
                    disabled={saving}
                  >
                    <X className="mr-2 h-4 w-4" /> Annuler
                  </Button>
                  <SubmitButton
                    type="submit"
                    pending={saving}
                    success={saveSuccess}
                    successLabel="Dépense enregistrée"
                  >
                    Enregistrer la dépense
                  </SubmitButton>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {loading && <TableSkeleton rows={6} cols={6} label="Chargement des dépenses" />}
        {error && <div className="text-destructive">{error}</div>}

        {!loading && !error && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Bénéficiaire</TableHead>
                  <TableHead className="text-right">Montant (XOF)</TableHead>
                  <TableHead>Moyen de paiement</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState
                        icon={Receipt}
                        title="Aucune dépense enregistrée"
                        description="Les sorties d'argent (carburant, produits, salaires…) apparaîtront ici dès la première saisie."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {expenses.map((e, index) => (
                  <TableRow
                    key={e.id}
                    className={`row-in transition-colors ${e.id === highlightedExpenseId ? "row-flash" : ""}`}
                    style={{ "--row": Math.min(index, 10) } as React.CSSProperties}
                  >
                    <TableCell>{new Date(e.expense_date).toLocaleDateString("fr-CI")}</TableCell>
                    <TableCell>{expenseCategories.find(c => c.value === e.category)?.label || e.category}</TableCell>
                    <TableCell>{e.beneficiary || "-"}</TableCell>
                    <TableCell className="text-right font-medium">
                      {(e.amount_cents / 100).toLocaleString("fr-CI")}
                    </TableCell>
                    <TableCell>{paymentMethods.find(m => m.value === e.payment_method)?.label || e.payment_method}</TableCell>
                    <TableCell>{expenseStatusLabel(e.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </BaseLayout>
  )
}