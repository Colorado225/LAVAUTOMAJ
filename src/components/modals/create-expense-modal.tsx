"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { apiFetch } from "@/lib/api"
import { toastSuccess, toastError } from "@/lib/toast"
import { RefreshCw, Receipt } from "lucide-react"

const expenseSchema = z.object({
  category: z.enum([
    "supply",
    "salary",
    "maintenance",
    "utilities",
    "rent",
    "tax",
    "marketing",
    "other",
  ]),
  amount_cents: z.number().int().nonnegative("Le montant doit être positif."),
  payment_method: z.enum([
    "cash",
    "orange_money",
    "mtn_momo",
    "moov_money",
    "wave",
    "other",
  ]),
  site_id: z.string().uuid().optional(),
  beneficiary: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  reference: z.string().max(120).optional(),
  cash_session_id: z.string().uuid().optional(),
})

type ExpenseFormData = z.infer<typeof expenseSchema>

interface Site {
  id: string
  name: string
  is_active: boolean
}
interface CashSession {
  id: string
  status: string
}

interface CreateExpenseModalProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onExpenseCreated?: (expense: ExpenseFormData) => void
}

export function CreateExpenseModal({
  open = false,
  onOpenChange,
  onExpenseCreated,
}: CreateExpenseModalProps) {
  const [sites, setSites] = useState<Site[]>([])
  const [cashSession, setCashSession] = useState<CashSession | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      category: "other",
      amount_cents: 0,
      payment_method: "cash",
      beneficiary: "",
      description: "",
      reference: "",
    },
  })

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = form

  const paymentMethod = watch("payment_method")

  useEffect(() => {
    void loadReferenceData()
  }, [])

  async function loadReferenceData() {
    try {
      const sitesRes = await apiFetch("/api/v1/sites")
      if (sitesRes.ok) setSites(await sitesRes.json())
    } catch {
      toastError("Erreur", "Impossible de charger les stations.")
    }
  }

  async function loadCashSession(siteId: string) {
    try {
      const res = await apiFetch(
        "/api/v1/cash-sessions/current?site_id=" +
          encodeURIComponent(siteId)
      )
      if (res.ok) {
        const session: { id: string; status: string } = await res.json()
        setCashSession(session)
        setValue("cash_session_id", session.id as ExpenseFormData["cash_session_id"])
      } else {
        setCashSession(null)
        setValue("cash_session_id", undefined as ExpenseFormData["cash_session_id"])
      }
    } catch {
      setCashSession(null)
      setValue("cash_session_id", "")
    }
  }

  const activeSites = sites.filter((s) => s.is_active)
  const cashNeedsSession = paymentMethod === "cash"
  const cashSessionMissing =
    cashNeedsSession && (!cashSession || cashSession.status !== "open")

  async function onSubmit(data: ExpenseFormData) {
    setIsSubmitting(true)
    try {
      const res = await apiFetch("/api/v1/expenses", {
        method: "POST",
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        throw new Error("Échec de la création de la dépense")
      }
      const created = await res.json()
      toastSuccess("Dépense enregistrée", "La dépense a été créée avec succès.")
      onExpenseCreated?.(created as ExpenseFormData)
      onOpenChange?.(false)
    } catch (err) {
      toastError(
        "Erreur",
        err instanceof Error ? err.message : "Impossible d'enregistrer la dépense."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px] p-6" showCloseButton>
        <DialogHeader>
          <DialogTitle>Enregistrer une nouvelle dépense</DialogTitle>
          <DialogDescription>
            Saisissez le montant, la catégorie et le bénéficiaire de la dépense.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Catégorie *</Label>
              <Select
                onValueChange={(value) =>
                  setValue("category", value as ExpenseFormData["category"])
                }
                defaultValue="other"
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choisir une catégorie…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="supply">Fournitures</SelectItem>
                  <SelectItem value="salary">Salaire</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="utilities">Électricité / Eau</SelectItem>
                  <SelectItem value="rent">Loyer</SelectItem>
                  <SelectItem value="tax">Taxe</SelectItem>
                  <SelectItem value="marketing">Marketing</SelectItem>
                  <SelectItem value="other">Autre</SelectItem>
                </SelectContent>
              </Select>
              {errors.category && (
                <span className="text-xs text-destructive">
                  {errors.category.message}
                </span>
              )}
            </div>
            <div className="space-y-2">
              <Label>Montant (XOF) *</Label>
              <div className="flex items-end gap-2">
                <Input
                  type="number"
                  min={0}
                  step="any"
                  {...register("amount_cents")}
                  placeholder="0"
                />
                <span className="text-xs text-muted-foreground">XOF</span>
              </div>
              {errors.amount_cents && (
                <span className="text-xs text-destructive">
                  {errors.amount_cents.message}
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Mode de paiement *</Label>
              <Select
                onValueChange={(value) =>
                  setValue(
                    "payment_method",
                    value as ExpenseFormData["payment_method"]
                  )
                }
                defaultValue="cash"
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choisir un mode…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Espèces</SelectItem>
                  <SelectItem value="orange_money">Orange Money</SelectItem>
                  <SelectItem value="mtn_momo">MTN MoMo</SelectItem>
                  <SelectItem value="moov_money">Moov Money</SelectItem>
                  <SelectItem value="wave">Wave</SelectItem>
                  <SelectItem value="other">Autre</SelectItem>
                </SelectContent>
              </Select>
              {errors.payment_method && (
                <span className="text-xs text-destructive">
                  {errors.payment_method.message}
                </span>
              )}
            </div>
            <div className="space-y-2">
              <Label>Station</Label>
              <Select
                onValueChange={(value) => {
                  setValue("site_id", (value || "") as ExpenseFormData["site_id"])
                  if (value) void loadCashSession(value as string)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choisir une station…" />
                </SelectTrigger>
                <SelectContent>
                  {activeSites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Bénéficiaire</Label>
            <Input
              {...register("beneficiary")}
              placeholder="Nom du bénéficiaire…"
            />
            {errors.beneficiary && (
              <span className="text-xs text-destructive">
                {errors.beneficiary.message}
              </span>
            )}
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              {...register("description")}
              placeholder="Détails de la dépense…"
              rows={3}
            />
            {errors.description && (
              <span className="text-xs text-destructive">
                {errors.description.message}
              </span>
            )}
          </div>

          <div className="space-y-2">
            <Label>Référence</Label>
            <Input
              {...register("reference")}
              placeholder="Référence (facultatif)…"
            />
            {errors.reference && (
              <span className="text-xs text-destructive">
                {errors.reference.message}
              </span>
            )}
          </div>

          {cashSession && cashSession.status === "open" && (
            <div className="rounded-lg bg-muted/50 p-3 border border-border/50">
              <div className="flex items-center gap-2 text-sm">
                <Receipt className="size-4 text-muted-foreground" />
                <span className="font-medium">Session de caisse ouverte</span>
              </div>
            </div>
          )}
          {cashSessionMissing && paymentMethod === "cash" && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              Aucune session de caisse ouverte pour cette station.
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || cashSessionMissing}
            >
              {isSubmitting ? (
                <RefreshCw className="mr-2 size-4 animate-spin" />
              ) : (
                <Receipt className="mr-2 size-4" />
              )}
              Enregistrer la dépense
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
