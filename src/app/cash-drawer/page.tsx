"use client"

import { BaseLayout } from "@/components/layouts/base-layout"
import { useApi } from "@/lib/api"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

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

export default function CashDrawerPage() {
  const siteId = ""
  const { data: session, loading, error } = useApi<CashSession>(
    siteId ? `/api/v1/cash-sessions/current?site_id=${encodeURIComponent(siteId)}` : ""
  )
  const { data: movements } = useApi<CashMovement[]>(session ? `/api/v1/cash-movements?session_id=${session.id}` : "")

  return (
    <BaseLayout title="Caisse" description="Ouverture, clôture et suivi de la caisse.">
      <div className="p-4">
        <div className="flex md:flex-row flex-col md:items-center justify-between gap-4 mb-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Caisse</h1>
            <p className="text-muted-foreground">
              Gérez vos sessions de caisse et vos mouvements d’argent.
            </p>
          </div>
          <Button onClick={() => {}}>
            <Plus className="mr-2" /> Nouvelle session
          </Button>
        </div>

        {loading && <div className="text-muted-foreground">Chargement…</div>}
        {error && <div className="text-destructive">{error}</div>}

        <div>
          {!loading && !error && !session && (
            <div className="border rounded p-4 bg-muted">
              <p className="text-sm text-muted-foreground">
                Aucune session de caisse ouverte. Sélectionnez un site et ouvrez une session.
              </p>
            </div>
          )}

          {!loading && !error && session && (
            <>
              <div className="space-y-6">
                <div className="bg-card p-4 rounded border">
                  <p className="text-sm text-muted-foreground">Solde théorique</p>
                  <p className="text-2xl font-bold">
                    {(session.theoretical_balance_cents / 100).toLocaleString("fr-CI")} XOF
                  </p>
                </div>
                <div className="bg-card p-4 rounded border">
                  <p className="text-sm text-muted-foreground">Montant compté</p>
                  <p className="text-2xl font-bold">
                    {session.counted_amount_cents != null
                      ? (session.counted_amount_cents / 100).toLocaleString("fr-CI")
                      : "—"
                    } XOF
                  </p>
                </div>
                <div className="bg-card p-4 rounded border">
                  <p className="text-sm text-muted-foreground">Écart de caisse</p>
                  <p className={`text-2xl font-bold ${session.discrepancy_cents && session.discrepancy_cents !== 0 ? "text-destructive" : ""}`}>
                    {session.discrepancy_cents != null
                      ? (session.discrepancy_cents / 100).toLocaleString("fr-CI")
                      : "—"
                    } XOF
                  </p>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-4">
                <h2 className="text-lg font-bold">Mouvements de caisse</h2>
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
                      {movements?.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell>{new Date(m.created_at).toLocaleDateString("fr-CI")}</TableCell>
                          <TableCell>{m.type === "entry" ? "Entrée" : "Sortie"}</TableCell>
                          <TableCell className="text-right">
                            {(m.amount_cents / 100).toLocaleString("fr-CI")}
                          </TableCell>
                          <TableCell>{m.source}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </BaseLayout>
  )
}
