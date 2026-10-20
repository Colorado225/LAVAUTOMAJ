"use client"

import * as React from "react"
import { CheckCircle2, MessageCircle, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { apiErrorMessage, apiFetch, useApi } from "@/lib/api"
import type { Plan } from "@/lib/onboarding-api"
import { cn } from "cn"

interface UpgradeResponse {
  recorded: boolean
  notified: boolean
  plan: { code: string; name: string; price_cents: number }
  whatsapp_url: string
  support_email: string
}

function formatPrice(priceCents: number, cycle: string) {
  if (priceCents === 0) return "Gratuit"
  return `${(priceCents / 100).toLocaleString("fr-CI")} F CFA / ${cycle === "yearly" ? "an" : "mois"}`
}

/**
 * Demande d'activation d'un forfait payant.
 *
 * Le paiement est traité hors ligne (mobile money, espèces, virement) :
 * la demande est tracée côté serveur, l'assistance est notifiée par e-mail et
 * le gérant finalise la discussion sur WhatsApp.
 */
export function UpgradeRequestCard({ currentPlanCode }: { currentPlanCode?: string | null }) {
  const { data: plans } = useApi<Plan[]>("/api/v1/plans")
  const payablePlans = (plans ?? []).filter((plan) => plan.price_cents > 0)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [note, setNote] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<UpgradeResponse | null>(null)

  const activePlan = selected ?? payablePlans[0]?.code ?? null

  async function submit() {
    if (!activePlan) return
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch("/api/v1/support/upgrade-request", {
        method: "POST",
        body: JSON.stringify({ plan_code: activePlan, note: note.trim() || undefined }),
      })
      if (!response.ok) {
        setError(await apiErrorMessage(response))
        return
      }
      setResult((await response.json()) as UpgradeResponse)
    } catch {
      setError("Demande impossible : serveur injoignable.")
    } finally {
      setBusy(false)
    }
  }

  if (payablePlans.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="size-5" aria-hidden="true" /> Activer un forfait
        </CardTitle>
        <CardDescription>
          Choisissez un forfait : votre demande est transmise à l’assistance, qui vous rappelle
          pour le paiement (mobile money, espèces ou virement). Aucun paiement n’est saisi ici.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {result ? (
          <div className="space-y-3">
            <p className="flex items-start gap-2 rounded-md border border-emerald-600/30 bg-emerald-600/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Demande enregistrée pour le forfait <strong>{result.plan.name}</strong>.
                {result.notified
                  ? " L’assistance a été prévenue par e-mail."
                  : ` Contactez-nous à ${result.support_email} pour accélérer le traitement.`}
              </span>
            </p>
            {result.whatsapp_url && (
              <a
                href={result.whatsapp_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#25D366] px-4 text-sm font-semibold text-white transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98]"
              >
                <MessageCircle className="size-4" aria-hidden="true" />
                Finaliser sur WhatsApp
              </a>
            )}
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {payablePlans.map((plan) => {
                const isActive = activePlan === plan.code
                return (
                  <button
                    key={plan.code}
                    type="button"
                    onClick={() => setSelected(plan.code)}
                    aria-pressed={isActive}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm",
                      isActive ? "border-primary bg-primary/5" : "bg-background",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{plan.name}</span>
                      {plan.code === currentPlanCode && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase">Actuel</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
                    <p className="mt-2 font-medium">{formatPrice(plan.price_cents, plan.billing_cycle)}</p>
                  </button>
                )
              })}
            </div>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Message <span className="font-normal text-muted-foreground">(facultatif)</span>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                placeholder="Ex. je souhaite être rappelé en matinée."
              />
            </label>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="button" className="h-11 self-start" disabled={busy} onClick={() => void submit()}>
              <Send className="mr-2 size-4" aria-hidden="true" />
              {busy ? "Envoi…" : "Demander l’activation"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
