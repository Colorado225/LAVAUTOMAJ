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

interface Service {
  id: string
  name: string
  price_cents: number
  is_active: boolean
}

export default function ServicesPage() {
  const { data, loading, error } = useApi<Service[]>("/api/v1/services")
  const services = data ?? []

  return (
    <BaseLayout title="Catalogue des prestations" description="Gérez vos prestations de lavage.">
      <div className="p-4">
        <div className="flex md:flex-row flex-col md:items-center justify-between gap-4 mb-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              Catalogue des prestations
            </h1>
            <p className="text-muted-foreground">
              Configurez les prestations proposées dans votre station.
            </p>
          </div>
          <Button onClick={() => {}}>
            <Plus className="mr-2" /> Nouvelle prestation
          </Button>
        </div>

        {loading && <div className="text-muted-foreground">Chargement…</div>}
        {error && <div className="text-destructive">{error}</div>}
        {!loading && !error && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead className="text-right">Prix (XOF)</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      Aucune prestation enregistrée.
                    </TableCell>
                  </TableRow>
                )}
                {services.map((svc) => (
                  <TableRow key={svc.id}>
                    <TableCell>{svc.name}</TableCell>
                    <TableCell className="text-right">
                      {(svc.price_cents / 100).toLocaleString("fr-CI")}
                    </TableCell>
                    <TableCell>
                      {svc.is_active ? "Actif" : "Inactif"}
                    </TableCell>
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
