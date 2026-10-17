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

interface Expense {
  id: string
  category: string
  amount_cents: number
  expense_date: string
  payment_method: string
  status: string
}

export default function ExpensesPage() {
  const { data, loading, error } = useApi<Expense[]>("/api/v1/expenses")
  const expenses = data ?? []

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
          <Button disabled title="La saisie de dépense n’est pas encore disponible">
            <Plus className="mr-2" /> Nouvelle dépense
          </Button>
        </div>

        {loading && <div className="text-muted-foreground">Chargement…</div>}
        {error && <div className="text-destructive">{error}</div>}

        {!loading && !error && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead className="text-right">Montant (XOF)</TableHead>
                  <TableHead>Moyen de paiement</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Aucune dépense enregistrée.
                    </TableCell>
                  </TableRow>
                )}
                {expenses.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{new Date(e.expense_date).toLocaleDateString("fr-CI")}</TableCell>
                    <TableCell>{e.category}</TableCell>
                    <TableCell className="text-right">
                      {(e.amount_cents / 100).toLocaleString("fr-CI")}
                    </TableCell>
                    <TableCell>{e.payment_method}</TableCell>
                    <TableCell>{e.status}</TableCell>
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
