import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  CalendarDays,
  CarFront,
  ChartNoAxesCombined,
  Plus,
  Receipt,
  RefreshCw,
  Settings2,
  Wallet,
  Banknote,
  Clock3,
  Download,
  ArrowUpRight,
} from 'lucide-react'

import { BaseLayout } from '@/components/layouts/base-layout'
import { DashboardMetrics } from '@/components/dashboard-metrics'
import { useOnboardingStatus } from '@/lib/onboarding-api'
import { useApi } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import type { Plan } from '@/lib/onboarding-api'

type Period = 'today' | '7days' | '30days'

type DashboardSummary = {
  plan: Plan | null
}

const PERIOD_LABELS: Record<Period, string> = {
  today: "Aujourd'hui",
  '7days': '7 derniers jours',
  '30days': '30 derniers jours',
}

function formatFCFA(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 0,
  }).format(value) + ' FCFA'
}

function SummaryCard({
  title,
  value,
  description,
  icon: Icon,
  loading = false,
}: {
  title: string
  value: string
  description: string
  icon: React.ElementType
  loading?: boolean
}) {
  return (
    <div className="group rounded-2xl border bg-card p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          {loading ? (
            <Skeleton className="mt-3 h-8 w-36" />
          ) : (
            <p className="mt-3 break-words text-2xl font-bold tracking-tight">
              {value}
            </p>
          )}
        </div>
        <div className="rounded-xl border bg-muted/50 p-3 transition-colors group-hover:bg-muted">
          <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  )
}

function QuickAction({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: React.ElementType
  title: string
  description: string
  href: string
}) {
  return (
    <a
      href={href}
      className="group flex items-center gap-3 rounded-xl border p-4 transition-all hover:border-primary/40 hover:bg-muted/40"
    >
      <span className="rounded-xl bg-primary/10 p-3 text-primary">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <Plus className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </a>
  )
}

/**
 * Dashboard dynamique (§10 du WORKFLOW) : personnalisé selon la station
 * active — nom réel, ville, coordonnées — avec les métriques calculées à
 * partir des données opérationnelles réelles (aucun chiffre inventé).
 */
export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>('today')
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const { data: status, loading: statusLoading } = useOnboardingStatus()
  const { data: summary, loading: summaryLoading } = useApi<DashboardSummary>(
    `/api/v1/onboarding/summary?refresh=${refreshKey}`
  )

  const station = status?.station
  const plan = summary?.plan

  const stationName =
    station?.name ?? status?.org_name ?? 'Votre station de lavage'

  const stationAddress = [
    station?.address,
    station?.city,
  ].filter(Boolean).join(', ')

  // Actualise toutes les données du dashboard : ré-instances les métriques
  // (DashboardMetrics est remonté via key) et re-télécharge le résumé API.
  function handleRefresh() {
    setRefreshing(true)
    setRefreshKey((key) => key + 1)
  }

  // Le spinner s'arrête dès que le rechargement est terminé.
  useEffect(() => {
    if (!summaryLoading) setRefreshing(false)
  }, [summaryLoading])

  return (
    <BaseLayout
      title="Tableau de bord"
      description="Pilotez votre station de lavage en un coup d'œil."
    >
      <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6 xl:p-8">
        {/* Header */}
        <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Vue d'ensemble</Badge>
              {plan && (
                <Badge variant="secondary">Forfait {plan.name}</Badge>
              )}
            </div>

            {statusLoading ? (
              <>
                <Skeleton className="h-9 w-64" />
                <Skeleton className="h-4 w-72" />
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  Bonjour, bienvenue chez {stationName}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {stationAddress ||
                    "Complétez les informations de votre station pour personnaliser votre espace."}
                  {station?.phone ? ` · ${station.phone}` : ''}
                </p>
              </>
            )}

            <p className="text-sm text-muted-foreground">
              Voici le suivi de votre activité. Les chiffres affichés dépendent
              des opérations réellement enregistrées.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw
                className={`size-4 ${refreshing ? 'animate-spin' : ''}`}
              />
              Actualiser
            </Button>

            {/* Pointe vers l'élément « Nouveau lavage » du sidebar (/washes) */}
            <Link
              to="/washes"
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all hover:bg-muted hover:text-primary"
            >
              <Plus className="size-4" />
              Nouveau lavage
            </Link>
          </div>
        </section>

        {/* Period selector */}
        <section className="flex flex-col justify-between gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-muted p-2.5">
              <CalendarDays className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Période d'analyse</p>
              <p className="text-xs text-muted-foreground">
                Sélectionnez la période à examiner
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(Object.keys(PERIOD_LABELS) as Period[]).map((key) => (
              <Button
                key={key}
                variant={period === key ? 'default' : 'outline'}
                size="sm"
                onClick={() => setPeriod(key)}
                aria-pressed={period === key}
              >
                {PERIOD_LABELS[key]}
              </Button>
            ))}
          </div>
        </section>

        {/* Primary metrics */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Indicateurs clés
              </h2>
              <p className="text-sm text-muted-foreground">
                {PERIOD_LABELS[period]} · Synthèse de votre station
              </p>
            </div>
            <Badge variant="outline">Données opérationnelles</Badge>
          </div>

          {/* key force le re-chargement des métriques lors de l'actualisation */}
          <DashboardMetrics key={refreshKey} />
        </section>

        {/* Finance and operations overview */}
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Finances et activité
            </h2>
            <p className="text-sm text-muted-foreground">
              Connectez ces indicateurs au résumé API pour afficher les valeurs
              calculées sur la période sélectionnée.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title="Recettes encaissées"
              value={formatFCFA(null)}
              description="Paiements confirmés, hors opérations annulées."
              icon={Wallet}
              loading={summaryLoading}
            />
            <SummaryCard
              title="Lavages réalisés"
              value="—"
              description="Nombre de lavages terminés sur la période."
              icon={CarFront}
              loading={summaryLoading}
            />
            <SummaryCard
              title="Dépenses enregistrées"
              value={formatFCFA(null)}
              description="Sorties enregistrées dans le module des dépenses."
              icon={Receipt}
              loading={summaryLoading}
            />
            <SummaryCard
              title="Solde opérationnel estimé"
              value={formatFCFA(null)}
              description="Recettes moins dépenses enregistrées. Ce n'est pas un bénéfice comptable."
              icon={ChartNoAxesCombined}
              loading={summaryLoading}
            />
          </div>
        </section>

        {/* Activity panels */}
        <section className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border bg-card p-5 xl:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">Évolution des recettes</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Visualisez les tendances de votre station.
                </p>
              </div>
              <Button variant="outline" size="sm" className="gap-2" disabled>
                <Download className="size-4" />
                Exporter
              </Button>
            </div>

            <div className="mt-6 flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6 text-center">
              <ChartNoAxesCombined className="size-9 text-muted-foreground" />
              <p className="mt-3 font-medium">Votre graphique de recettes</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Le graphique apparaîtra lorsque l'API fournira les recettes
                agrégées par jour. Aucun montant fictif n'est affiché.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-5">
            <div className="flex items-center gap-2">
              <Activity className="size-5 text-muted-foreground" />
              <h2 className="font-semibold">État de la station</h2>
            </div>

            <div className="mt-5 space-y-4">
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-muted p-2">
                  <Banknote className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Session de caisse</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Vérifiez si une caisse est ouverte avant les encaissements.
                  </p>
                </div>
                <Badge variant="outline">À vérifier</Badge>
              </div>

              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-muted p-2">
                  <Clock3 className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Activité récente</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    L'historique sera affiché à partir des lavages enregistrés.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-muted p-2">
                  <Settings2 className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Configuration</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Vérifiez les prestations, les tarifs et les informations de la station.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Quick actions */}
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Raccourcis opérationnels
            </h2>
            <p className="text-sm text-muted-foreground">
              Accédez rapidement aux opérations quotidiennes.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {/* Chaque raccourci pointe vers l'élément correspondant du sidebar */}
            <QuickAction
              icon={CarFront}
              title="Enregistrer un lavage"
              description="Ajouter une prestation réalisée"
              href="/washes"
            />
            <QuickAction
              icon={Banknote}
              title="Gérer la caisse"
              description="Ouvrir, suivre ou clôturer"
              href="/cash-drawer"
            />
            <QuickAction
              icon={Receipt}
              title="Ajouter une dépense"
              description="Enregistrer une sortie d'argent"
              href="/expenses"
            />
            <QuickAction
              icon={ArrowUpRight}
              title="Consulter les rapports"
              description="Analyser les résultats"
              href="/reports"
            />
          </div>
        </section>

        {/* Subscription */}
        {plan && (
          <section className="flex flex-col justify-between gap-4 rounded-2xl border bg-muted/20 p-5 sm:flex-row sm:items-center">
            <div>
              <p className="font-semibold">Votre abonnement WashPilot CI</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Forfait {plan.name}
                {plan.price_cents > 0
                  ? ' · Validation du paiement à vérifier'
                  : ' · Consultez les fonctionnalités de votre forfait'}
              </p>
            </div>
            <Link
              to="/settings/billing"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background hover:bg-muted text-sm font-medium transition-all"
            >
              Gérer mon forfait
            </Link>
          </section>
        )}
      </main>
    </BaseLayout>
  )
}
