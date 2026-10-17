"use client"

import { useState, type FormEvent } from "react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { apiFetch, getClerkToken, useApi } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Plus, RefreshCw } from "lucide-react"

interface Service {
  id: string
  name: string
  price_cents: number
  is_active: boolean
}

function parseXofAmount(value: string): number | null {
  if (!value.trim()) return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return null
  const cents = Math.round(amount * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

export default function ServicesPage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, loading, error } = useApi<Service[]>(`/api/v1/services?refresh=${refreshKey}`)
  const services = data ?? []
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState("")
  const [priceXof, setPriceXof] = useState("")
  const [saving, setSaving] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  async function createService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanName = name.trim()
    const priceCents = parseXofAmount(priceXof)
    if (!cleanName || cleanName.length > 100 || priceCents == null) {
      setMutationError("Saisissez un nom (100 caractères maximum) et un prix valide.")
      return
    }
    setSaving(true)
    setMutationError(null)
    try {
      const token = await getClerkToken()
      const response = await apiFetch(
        "/api/v1/services",
        {
          method: "POST",
          body: JSON.stringify({ name: cleanName, price_cents: priceCents, is_active: true }),
        },
        token
      )
      if (!response.ok) throw new Error((await response.text()) || `Erreur ${response.status}`)
      setName("")
      setPriceXof("")
      setFormOpen(false)
      setRefreshKey((key) => key + 1)
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : "Impossible de créer la prestation.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <BaseLayout title="Catalogue des prestations" description="Gérez vos prestations de lavage.">
      <div className="space-y-6 p-4">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Catalogue des prestations</h1>
            <p className="text-muted-foreground">Configurez les prestations et leurs prix de vente.</p>
          </div>
          <Button onClick={() => {
            setMutationError(null)
            setFormOpen((open) => !open)
          }}>
            <Plus className="mr-2 size-4" /> Nouvelle prestation
          </Button>
        </div>

        {formOpen && (
          <form onSubmit={createService} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto_auto] sm:items-end">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Nom de la prestation
              <Input
                autoFocus
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex. Lavage moteur"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Prix (XOF)
              <Input
                type="number"
                min={0}
                step="any"
                value={priceXof}
                onChange={(event) => setPriceXof(event.target.value)}
                placeholder="0"
              />
            </label>
            <Button type="submit" disabled={saving || !name.trim() || parseXofAmount(priceXof) == null}>
              {saving ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
              Créer
            </Button>
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>Annuler</Button>
            {mutationError && <p role="alert" className="text-sm text-destructive sm:col-span-4">{mutationError}</p>}
          </form>
        )}

        {error && <div role="alert" className="text-sm text-destructive">{error}</div>}
        {loading && <div className="text-sm text-muted-foreground">Chargement…</div>}
        {!loading && !error && (
          <div className="overflow-x-auto rounded-lg border bg-card">
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
                    <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                      Aucune prestation enregistrée. Ajoutez-en pour pouvoir créer des lavages.
                    </TableCell>
                  </TableRow>
                )}
                {services.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell className="font-medium">{service.name}</TableCell>
                    <TableCell className="text-right">{(service.price_cents / 100).toLocaleString("fr-CI", { maximumFractionDigits: 2 })}</TableCell>
                    <TableCell>{service.is_active ? "Actif" : "Inactif"}</TableCell>
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
