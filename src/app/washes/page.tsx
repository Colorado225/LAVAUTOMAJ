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

interface Wash {
  id: string
  reference: string
  total_cents: number
  status: string
  payment_status: string
  created_at: string
}

export default function WashesPage() {
  const { data, loading, error } = useApi<Wash[]>("/api/v1/washes")
  const washes = data ?? []

  return (
    <BaseLayout title="Lavages" description="Enregistrement et historique des lavages.">
      <div className="p-4">
        <div className="flex md:flex-row flex-col md:items-center justify-between gap-4 mb-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Lavages</h1>
            <p className="text-muted-foreground">
              Enregistrez un nouveau lavage ou consultez l’historique.
            </p>
          </div>
          <Button onClick={() => {}}>
            <Plus className="mr-2" /> Nouveau lavage
          </Button>
        </div>

        {loading && <div className="text-muted-foreground">Chargement…</div>}
        {error && <div className="text-destructive">{error}</div>}

        {!loading && !error && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead className="text-right">Total (XOF)</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Paiement</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {washes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Aucun lavage enregistré.
                    </TableCell>
                  </TableRow>
                )}
                {washes.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell>{w.reference}</TableCell>
                    <TableCell className="text-right">
                      {(w.total_cents / 100).toLocaleString("fr-CI")}
                    </TableCell>
                    <TableCell>{w.status}</TableCell>
                    <TableCell>{w.payment_status}</TableCell>
                    <TableCell>{new Date(w.created_at).toLocaleDateString("fr-CI")}</TableCell>
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
