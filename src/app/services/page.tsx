"use client"

import type * as React from "react"
import { useMemo, useState, type FormEvent } from "react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { useAccess } from "@/lib/permissions"
import { actionGate } from "@/lib/action-blocking"
import { BlockedReason } from "@/components/access/blocked-reason"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { useMutation } from "@/lib/use-mutation"
import type { CurrentMember } from "@/lib/team-api"
import { TableSkeleton } from "@/components/ui/table-skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { Pencil, Plus, RefreshCw, Search, Sparkles, ToggleLeft, ToggleRight, Trash2 } from "lucide-react"
import { useCapability } from "@/lib/subscription"
import { ConsumablesDialog } from "@/components/stock/consumables-dialog"
import { Package } from "lucide-react"
import { formatXof } from "@/lib/format"
import { VEHICLE_FAMILIES, familyLabel } from "@/config/vehicle-taxonomy"
import { matchingServiceCategory } from "@/config/service-categories"
import { hasVehiclePricing, isFamilyPriceKey, priceRange } from "@/lib/service-pricing"

interface Service {
  id: string
  name: string
  description: string | null
  price_cents: number
  price_by_vehicle_type: Record<string, number> | null
  category_id: string | null
  duration_minutes: number | null
  is_active: boolean
}

interface ServiceCategory {
  id: string
  name: string
  is_active: boolean
}

interface VehicleCategory {
  id: string
  name: string
  family: string | null
  is_active: boolean
}

/**
 * Un type de service du catalogue général (« Lavage moteur complet »…).
 *
 * C'est le point de départ d'une prestation : choisir un type remplit le nom,
 * la catégorie, la durée, la description et le prix indicatif. Le gérant part
 * d'une base juste au lieu d'une page blanche.
 */
interface ServiceTemplate {
  id: string
  category: string
  name: string
  price_cents: number | null
  duration_minutes: number | null
  description: string | null
}

interface ServiceForm {
  /** Type du catalogue choisi (`id`) ou « custom » pour une saisie libre. */
  template_id: string
  name: string
  description: string
  price_xof: string
  category_id: string | null
  duration_minutes: string
  /**
   * Tarif par **famille** de véhicules, saisi en francs.
   *
   * Un champ vide signifie « pas de tarif propre » : la prestation retombe
   * alors sur son prix de base. C'est le niveau qui suffit dans la plupart des
   * stations — 9 familles tiennent sur un écran, 61 types n'y tiennent pas.
   */
  family_prices: Record<string, string>
  /**
   * Tarif par **catégorie de véhicule précise** (clé UUID), saisi en francs.
   *
   * Le tarif de catégorie l'emporte sur celui de sa famille. Les catégories
   * qui ne sont plus proposées par la station restent dans cette table et sont
   * renvoyées telles quelles : les effacer parce qu'elles ne s'affichent plus
   * supprimerait un tarif en vigueur sans que personne ne l'ait demandé.
   */
  category_prices: Record<string, string>
}

const emptyForm = (): ServiceForm => ({
  template_id: "custom",
  name: "",
  description: "",
  price_xof: "",
  category_id: null,
  duration_minutes: "",
  family_prices: {},
  category_prices: {},
})

function parseXofAmount(value: string): number | null {
  if (!value.trim()) return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return null
  const cents = Math.round(amount * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

/** Clé d'occupation du formulaire, distincte des clés de ligne. */
const FORM_KEY = "formulaire"

export default function ServicesPage() {
  const manageCatalog = useAccess("service:manage", "catalog.manage")
  // Ouvrir un formulaire n'écrit rien : on reste cliquable pendant que les
  // droits chargent. Basculer un statut écrit tout de suite : on attend.
  const catalogForm = actionGate({
    loading: manageCatalog.loading,
    allowed: manageCatalog.allowed,
    reason: manageCatalog.reason,
  })
  const catalogWrite = actionGate({
    loading: manageCatalog.loading,
    allowed: manageCatalog.allowed,
    reason: manageCatalog.reason,
    writesImmediately: true,
  })
  const [refreshKey, setRefreshKey] = useState(0)
  const [recettePour, setRecettePour] = useState<Service | null>(null)
  // Sans forfait Pro, il n'y a pas de stock à consommer : le bouton n'a rien
  // à proposer. On le retire plutôt que de griser une icône dans chaque
  // ligne du catalogue — l'écran Stock est la page qui présente l'offre.
  const planStock = useCapability("stock.manage")
  const { data: services, loading, error } = useApi<Service[]>(`/api/v1/services?refresh=${refreshKey}`)
  const { data: categories, loading: categoriesLoading, error: categoriesError } = useApi<ServiceCategory[]>(`/api/v1/service-categories?refresh=${refreshKey}`)
  const { data: vehicleCategories } = useApi<VehicleCategory[]>(`/api/v1/vehicle-categories?refresh=${refreshKey}`)
  const { data: templates } = useApi<ServiceTemplate[]>(`/api/v1/service-catalog`)
  const { data: member } = useApi<CurrentMember>(`/api/v1/auth/me?refresh=${refreshKey}`)
  const servicesList = useMemo(() => services ?? [], [services])
  const categoryById = useMemo(() => new Map((categories ?? []).map((category) => [category.id, category.name])), [categories])
  // Familles réellement utilisées par la station : ce sont elles que le
  // formulaire propose de tarifer. Une station qui n'a que des motos et des
  // berlines n'a rien à faire d'un prix « poids lourds ».
  const stationFamilies = useMemo(
    () =>
      new Set(
        (vehicleCategories ?? [])
          .map((category) => category.family)
          .filter((code): code is string => Boolean(code)),
      ),
    [vehicleCategories],
  )
  const canManage = member?.role === "owner" || member?.role === "manager"

  /**
   * Catégories de véhicules proposées au tarif, groupées par famille et dans
   * l'ordre du référentiel. Une station rangée dans une famille inconnue (ou
   * sans famille) passe en dernier : elle reste tarifable.
   */
  const vehicleGroups = useMemo(() => {
    const groups = VEHICLE_FAMILIES.map((family) => ({
      code: family.code,
      label: family.label,
      categories: (vehicleCategories ?? [])
        .filter((category) => category.family === family.code)
        .sort((a, b) => a.name.localeCompare(b.name, "fr-CI")),
    }))
    const orphans = (vehicleCategories ?? []).filter(
      (category) => !category.family || !VEHICLE_FAMILIES.some((family) => family.code === category.family),
    )
    if (orphans.length > 0) {
      groups.push({
        code: "",
        label: "Sans famille",
        categories: [...orphans].sort((a, b) => a.name.localeCompare(b.name, "fr-CI")),
      })
    }
    return groups.filter((group) => group.categories.length > 0)
  }, [vehicleCategories])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingService, setEditingService] = useState<Service | null>(null)
  // Le panneau des tarifs par catégorie est replié par défaut (la grille peut
  // compter 61 champs). Il s'ouvre d'office sur une prestation qui a déjà des
  // tarifs par catégorie : sinon un tarif en vigueur deviendrait invisible,
  // donc impossible à corriger.
  const [pricesExpanded, setPricesExpanded] = useState(false)
  const [form, setForm] = useState<ServiceForm>(emptyForm)
  const availableCategories = useMemo(
    () => (categories ?? []).filter((category) => category.is_active || category.id === form.category_id),
    [categories, form.category_id],
  )
  const [search, setSearch] = useState("")
  // Un seul contrôleur remplace « saving », « busyServiceId » et les deux
  // messages : c'est la même écriture, elle n'avait pas à vivre en quatre
  // états qu'il fallait penser à synchroniser.
  const mutation = useMutation()
  const saving = mutation.busyKey === FORM_KEY

  const filteredServices = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("fr-CI")
    return servicesList.filter((service) => !query || service.name.toLocaleLowerCase("fr-CI").includes(query))
  }, [servicesList, search])

  function openCreateDialog() {
    setEditingService(null)
    setForm(emptyForm())
    setPricesExpanded(false)
    mutation.reset()
    setDialogOpen(true)
  }

  function openEditDialog(service: Service) {
    setEditingService(service)
    setForm({
      // Retrouver le type du catalogue par le nom évite d'afficher
      // « Personnalisée » sur une prestation qui vient justement du catalogue.
      template_id:
        (templates ?? []).find(
          (template) => template.name.toLocaleLowerCase("fr-CI") === service.name.toLocaleLowerCase("fr-CI"),
        )?.id ?? "custom",
      name: service.name,
      description: service.description ?? "",
      price_xof: String(service.price_cents / 100),
      category_id: service.category_id,
      duration_minutes: service.duration_minutes == null ? "" : String(service.duration_minutes),
      family_prices: Object.fromEntries(
        Object.entries(service.price_by_vehicle_type ?? {})
          .filter(([key]) => isFamilyPriceKey(key))
          .map(([key, value]) => [key, String(value / 100)]),
      ),
      category_prices: Object.fromEntries(
        Object.entries(service.price_by_vehicle_type ?? {})
          .filter(([key]) => !isFamilyPriceKey(key))
          .map(([key, value]) => [key, String(value / 100)]),
      ),
    })
    setPricesExpanded(
      Object.keys(service.price_by_vehicle_type ?? {}).some((key) => !isFamilyPriceKey(key)),
    )
    mutation.reset()
    setDialogOpen(true)
  }

  /**
   * Choisir un type du catalogue pré-remplit le formulaire.
   *
   * Le prix et la durée sont ceux du catalogue, la catégorie est retrouvée par
   * son nom, et la description suit. Tout reste modifiable : un type n'est
   * qu'un point de départ, jamais une contrainte.
   */
  function applyTemplate(value: string | null) {
    const templateId = value ?? "custom"
    if (templateId === "custom") {
      setForm((previous) => ({ ...previous, template_id: "custom" }))
      return
    }
    const template = (templates ?? []).find((item) => item.id === templateId)
    if (!template) return
    const category = matchingServiceCategory(template.category, categories ?? [])
    setForm((previous) => ({
      ...previous,
      template_id: templateId,
      name: template.name,
      description: template.description ?? "",
      price_xof: template.price_cents == null ? "" : String(template.price_cents / 100),
      duration_minutes:
        template.duration_minutes == null ? "" : String(template.duration_minutes),
      category_id: category?.id ?? previous.category_id,
    }))
  }

  function handleDialogChange(open: boolean) {
    if (open) setDialogOpen(true)
    else if (!saving) {
      setDialogOpen(false)
      mutation.reset()
    }
  }

  async function saveService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = form.name.trim()
    const priceCents = parseXofAmount(form.price_xof)
    const durationMinutes = form.duration_minutes.trim() ? Number(form.duration_minutes) : null
    if (!name || name.length > 100 || priceCents == null) {
      mutation.fail("Saisissez un nom (100 caractères maximum) et un prix valide.")
      return
    }
    if (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440)) {
      mutation.fail("La durée doit être comprise entre 1 et 1 440 minutes.")
      return
    }

    // Tarifs par famille : un champ vide n'est pas un zéro, c'est « pas de
    // tarif propre ». On ne l'envoie donc pas du tout, et la prestation
    // retombe sur son prix de base.
    const familyPrices: Record<string, number> = {}
    for (const [code, raw] of Object.entries(form.family_prices)) {
      if (!raw.trim()) continue
      const cents = parseXofAmount(raw)
      if (cents == null) {
        mutation.fail(`Prix invalide pour la famille « ${familyLabel(code) ?? code} ».`)
        return
      }
      familyPrices[code] = cents
    }

    // Tarifs par catégorie de véhicule. Un champ vidé retire le tarif de
    // cette catégorie — elle retombe alors sur sa famille, puis sur le prix
    // de base. Les catégories qui ne sont plus proposées par la station
    // gardent leur tarif : on ne les affiche pas, on ne les efface pas.
    const categoryPrices: Record<string, number> = {}
    for (const [categoryId, raw] of Object.entries(form.category_prices)) {
      if (!raw.trim()) continue
      const cents = parseXofAmount(raw)
      if (cents == null) {
        mutation.fail(`Prix invalide pour la catégorie « ${categoryById.get(categoryId) ?? "archivée"} ».`)
        return
      }
      categoryPrices[categoryId] = cents
    }

    const outcome = await mutation.run({
      url: editingService ? `/api/v1/services/${encodeURIComponent(editingService.id)}` : "/api/v1/services",
      method: editingService ? "PATCH" : "POST",
      body: {
        name,
        description: form.description.trim() || null,
        price_cents: priceCents,
        category_id: form.category_id,
        duration_minutes: durationMinutes,
        is_active: editingService?.is_active ?? true,
        // Le serveur remplace l'objet entier : les tarifs qui ne sont pas
        // renvoyés disparaîtraient. On renvoie donc à la fois les tarifs de
        // famille et ceux des catégories, y compris les catégories archivées
        // que le formulaire n'affiche pas.
        price_by_vehicle_type: { ...categoryPrices, ...familyPrices },
      },
      success: editingService ? "Prestation mise à jour." : "Prestation créée.",
      failure: "Impossible d’enregistrer la prestation.",
      busyKey: FORM_KEY,
    })
    if (!outcome.ok) return
    setDialogOpen(false)
    setRefreshKey((key) => key + 1)
  }

  /**
   * Familles proposées au tarif.
   *
   * Celles que la station utilise réellement, plus celles qui portent déjà un
   * tarif même si la station n'a plus de catégorie dedans : un tarif invisible
   * serait un tarif impossible à corriger.
   */
  const pricingFamilies = useMemo(() => {
    const used = VEHICLE_FAMILIES.filter((item) => stationFamilies.has(item.code))
    const extra = VEHICLE_FAMILIES.filter(
      (item) => !stationFamilies.has(item.code) && Boolean(form.family_prices[item.code]),
    )
    return [...used, ...extra]
  }, [stationFamilies, form.family_prices])

  function setFamilyPrice(code: string, value: string) {
    setForm((previous) => ({
      ...previous,
      family_prices: { ...previous.family_prices, [code]: value },
    }))
  }

  function setCategoryPrice(categoryId: string, value: string) {
    setForm((previous) => ({
      ...previous,
      category_prices: { ...previous.category_prices, [categoryId]: value },
    }))
  }

  /**
   * Texte indicatif d'un champ de prix par catégorie : ce qui s'appliquera si
   * on le laisse vide. Sans cela, un champ vide ne dit pas s'il vaut « prix de
   * base » ou « tarif de la famille ».
   */
  function categoryPlaceholder(familyCode: string): string {
    const familyPrice = familyCode ? form.family_prices[familyCode]?.trim() : ""
    if (familyPrice) return `${familyPrice} (famille)`
    return form.price_xof ? `${form.price_xof} (prix de base)` : "Prix de base"
  }

  /**
   * Suppression définitive, réservée aux prestations jamais vendues.
   *
   * Le serveur répond 409 dès qu'un lavage la référence : l'historique garde
   * son prix, donc on désactive au lieu de supprimer. Le message est repris
   * tel quel par la mutation, il n'y a rien à reformuler ici.
   */
  async function deleteService(service: Service) {
    const outcome = await mutation.run({
      url: `/api/v1/services/${encodeURIComponent(service.id)}`,
      method: "DELETE",
      confirm: `Supprimer définitivement « ${service.name} » ? Si des lavages la référencent, la suppression sera refusée : désactivez-la dans ce cas.`,
      success: "Prestation supprimée.",
      failure: "Impossible de supprimer la prestation.",
      busyKey: service.id,
    })
    if (outcome.ok) setRefreshKey((key) => key + 1)
  }

  async function toggleService(service: Service) {
    const nextStatus = !service.is_active
    const outcome = await mutation.run({
      url: `/api/v1/services/${encodeURIComponent(service.id)}`,
      method: "PATCH",
      body: { is_active: nextStatus },
      confirm: nextStatus
        ? undefined
        : `Désactiver « ${service.name} » ? Les lavages historiques conserveront leurs prix enregistrés.`,
      success: nextStatus ? "Prestation réactivée." : "Prestation désactivée.",
      failure: "Impossible de modifier la prestation.",
      busyKey: service.id,
    })
    if (outcome.ok) setRefreshKey((key) => key + 1)
  }

  return (
    <BaseLayout title="Prestations" description="Gérez les prestations et tarifs utilisés dans les lavages.">
      <div className="space-y-6 p-4">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-sm text-muted-foreground">Les modifications sont enregistrées dans l’organisation active. Les prix historiques restent figés sur chaque lavage.</p>
            <p className="mt-1 text-xs text-muted-foreground">Un tarif peut varier selon la <strong>famille du véhicule</strong> (moto, SUV, poids lourds…). À défaut, le prix de base s’applique.</p>
          </div>
          {canManage && (
            <div className="flex flex-col items-start gap-1.5">
              <Button onClick={openCreateDialog} disabled={catalogForm.disabled} aria-busy={catalogForm.busy} title={catalogForm.reason ?? undefined}><Plus className="mr-2 size-4" />Nouvelle prestation</Button>
              <BlockedReason reason={catalogForm.reason} className="max-w-72" />
            </div>
          )}
        </div>

        {mutation.success && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{mutation.success}</p>}
        {mutation.error && !dialogOpen && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{mutation.error}</p>}
        {!canManage && member && <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">La création et la modification du catalogue sont réservées au propriétaire et aux responsables.</p>}

        <Card>
          <CardHeader>
            <CardTitle>Catalogue des prestations</CardTitle>
            <CardDescription>{servicesList.length} prestation{servicesList.length === 1 ? "" : "s"} enregistrée{servicesList.length === 1 ? "" : "s"}. Les prestations inactives sont conservées pour l’historique.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher une prestation…" aria-label="Rechercher une prestation" />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {canManage && <BlockedReason reason={catalogWrite.reason} />}
            {categoriesError && <p role="alert" className="text-sm text-destructive">Impossible de charger les catégories : {categoriesError}</p>}
            {(loading || categoriesLoading) && <TableSkeleton rows={5} cols={5} label="Synchronisation du catalogue" />}
            {!loading && !error && (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead>Prestation</TableHead><TableHead>Catégorie</TableHead><TableHead>Durée</TableHead><TableHead className="text-right">Prix</TableHead><TableHead>Statut</TableHead>{canManage && <TableHead className="text-right">Actions</TableHead>}</TableRow></TableHeader>
                  <TableBody>
                    {filteredServices.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={canManage ? 6 : 5} className="p-0">
                          <EmptyState
                            icon={Sparkles}
                            title={servicesList.length === 0 ? "Aucune prestation enregistrée" : "Aucun résultat"}
                            description={
                              servicesList.length === 0
                                ? "Ajoutez vos prestations (lavage extérieur, intérieur, complet…) pour pouvoir enregistrer des lavages."
                                : "Aucune prestation ne correspond à la recherche."
                            }
                          />
                        </TableCell>
                      </TableRow>
                    )}
                    {filteredServices.map((service, index) => (
                      <TableRow
                        key={service.id}
                        /* La ligne en cours de modification s'estompe : le
                           retour est immédiat, avant même la réponse serveur. */
                        className={`row-in transition-all duration-200 ${
                          mutation.busyKey === service.id ? "scale-[0.995] opacity-50" : "hover:bg-muted/40"
                        }`}
                        style={{ "--row": Math.min(index, 10) } as React.CSSProperties}
                      >
                        <TableCell className="font-medium">{service.name}</TableCell>
                        <TableCell>{service.category_id ? categoryById.get(service.category_id) ?? "Catégorie archivée" : "—"}</TableCell>
                        <TableCell>{service.duration_minutes ? `${service.duration_minutes} min` : "—"}</TableCell>
                        <TableCell className="text-right">
                          {hasVehiclePricing(service) ? (
                            <span className="inline-flex flex-col items-end">
                              <span className="font-medium">dès {formatXof(priceRange(service).min)}</span>
                              <span className="text-xs text-muted-foreground">jusqu’à {formatXof(priceRange(service).max)}</span>
                            </span>
                          ) : (
                            formatXof(service.price_cents)
                          )}
                        </TableCell>
                        <TableCell><Badge variant={service.is_active ? "secondary" : "outline"}>{service.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                        {canManage && <TableCell><div className="flex justify-end gap-1">{planStock.allowed && <Button variant="ghost" size="icon" disabled={catalogForm.disabled} title={catalogForm.reason ?? "Ce que cette prestation sort du stock"} aria-label={`Consommables de ${service.name}`} onClick={() => setRecettePour(service)}><Package className="size-4" /></Button>}<Button variant="ghost" size="icon" disabled={catalogForm.disabled} title={catalogForm.reason ?? undefined} aria-label={`Modifier ${service.name}`} onClick={() => openEditDialog(service)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" title={catalogWrite.reason ?? undefined} disabled={catalogWrite.disabled || mutation.busyKey === service.id} aria-label={service.is_active ? `Désactiver ${service.name}` : `Réactiver ${service.name}`} onClick={() => void toggleService(service)}>{mutation.busyKey === service.id ? <RefreshCw className="size-4 animate-spin" /> : service.is_active ? <ToggleLeft className="size-4" /> : <ToggleRight className="size-4" />}</Button><Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" title={catalogWrite.reason ?? "Supprimer définitivement cette prestation"} disabled={catalogWrite.disabled || mutation.busyKey === service.id} aria-label={`Supprimer ${service.name}`} onClick={() => void deleteService(service)}><Trash2 className="size-4" /></Button></div></TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingService ? "Modifier la prestation" : "Nouvelle prestation"}</DialogTitle>
            <DialogDescription>Les changements sont enregistrés immédiatement pour la station active.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveService} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">Type de service
                <Select value={form.template_id} onValueChange={applyTemplate}>
                  <SelectTrigger><SelectValue placeholder="Prestation personnalisée" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">Prestation personnalisée</SelectItem>
                    {(templates ?? []).map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                        {template.price_cents != null ? ` — ${formatXof(template.price_cents)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs font-normal text-muted-foreground">
                  Un type du catalogue remplit le nom, la catégorie, la durée, la description et le prix
                  indicatif. Tout reste modifiable ensuite.
                </span>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">Nom de la prestation<Input required maxLength={100} value={form.name} onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))} placeholder="Ex. Lavage moteur" /></label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">Prix (F CFA)<Input required type="number" min={0} step="any" value={form.price_xof} onChange={(event) => setForm((previous) => ({ ...previous, price_xof: event.target.value }))} placeholder="0" /></label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">Durée (minutes)<Input type="number" min={1} max={1440} step={1} value={form.duration_minutes} onChange={(event) => setForm((previous) => ({ ...previous, duration_minutes: event.target.value }))} placeholder="Facultatif" /></label>
              <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">Catégorie
                <Select value={form.category_id ?? "none"} onValueChange={(value) => setForm((previous) => ({ ...previous, category_id: value && value !== "none" ? String(value) : null }))}>
                  <SelectTrigger><SelectValue placeholder="Sans catégorie" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Sans catégorie</SelectItem>{availableCategories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}{category.is_active ? "" : " (inactive)"}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">Description
                <Input maxLength={1000} value={form.description} onChange={(event) => setForm((previous) => ({ ...previous, description: event.target.value }))} placeholder="Une phrase reprise sur la fiche de la prestation" />
              </label>
            </div>

            <fieldset className="rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">Prix par famille de véhicule</legend>
              <p className="mb-3 text-xs text-muted-foreground">
                Facultatif. Laissez vide pour facturer le prix de base. Un SUV ou un camion demande
                plus de temps et de produit qu’une citadine : c’est ici que cela se traduit.
              </p>
              {pricingFamilies.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Aucune famille de véhicules n’est encore configurée. Ajoutez des catégories dans
                  Configuration › Catégories de véhicules pour pouvoir tarifer par gabarit.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {pricingFamilies.map((item) => (
                    <label key={item.code} className="flex flex-col gap-1.5 text-sm">
                      <span className="font-medium">{item.label}</span>
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        value={form.family_prices[item.code] ?? ""}
                        onChange={(event) => setFamilyPrice(item.code, event.target.value)}
                        placeholder={form.price_xof ? `${form.price_xof} (prix de base)` : "Prix de base"}
                        aria-label={`Prix ${item.label}`}
                      />
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <details
              className="rounded-lg border p-3"
              open={pricesExpanded}
              onToggle={(event) => setPricesExpanded(event.currentTarget.open)}
            >
              <summary className="cursor-pointer text-sm font-medium">
                Prix par catégorie de véhicule
                <span className="ml-2 text-xs font-normal text-muted-foreground">facultatif, pour un modèle précis</span>
              </summary>
              <p className="mb-3 mt-2 text-xs text-muted-foreground">
                Le tarif d’une catégorie l’emporte sur celui de sa famille. Laissez vide pour
                appliquer le tarif de la famille, puis le prix de base.
              </p>
              {vehicleGroups.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Aucune catégorie de véhicule configurée. Ajoutez-en dans Configuration ›
                  Catégories de véhicules pour pouvoir affiner un prix par modèle.
                </p>
              ) : (
                <div className="space-y-3">
                  {vehicleGroups.map((group) => (
                    <div key={group.code || "sans-famille"}>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.label}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {group.categories.map((category) => (
                          <label key={category.id} className="flex flex-col gap-1.5 text-sm">
                            <span>{category.name}</span>
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              inputMode="decimal"
                              value={form.category_prices[category.id] ?? ""}
                              onChange={(event) => setCategoryPrice(category.id, event.target.value)}
                              placeholder={categoryPlaceholder(group.code)}
                              aria-label={`Prix ${category.name}`}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </details>

            {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleDialogChange(false)} disabled={saving}>Annuler</Button>
              <Button type="submit" disabled={saving || !form.name.trim() || parseXofAmount(form.price_xof) == null}>{saving && <RefreshCw className="mr-2 size-4 animate-spin" />}{editingService ? "Enregistrer" : "Créer la prestation"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConsumablesDialog
        serviceId={recettePour?.id ?? null}
        serviceName={recettePour?.name ?? ""}
        open={recettePour !== null}
        onOpenChange={(next) => { if (!next) setRecettePour(null) }}
      />
    </BaseLayout>
  )
}
