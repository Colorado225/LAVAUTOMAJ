import { BaseLayout } from '@/components/layouts/base-layout'
import { DashboardMetrics } from '@/components/dashboard-metrics'
import { useOnboardingStatus } from '@/lib/onboarding-api'
import { useApi } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { Plan } from '@/lib/onboarding-api'

/**
 * Dashboard dynamique (§10 du WORKFLOW) : personnalisé selon la station
 * active — nom réel, ville, coordonnées — avec les métriques calculées à
 * partir des données opérationnelles réelles (aucun chiffre inventé).
 */
export default function DashboardPage() {
  const { data: status, loading: statusLoading } = useOnboardingStatus()
  const station = status?.station

  const { data: summary } = useApi<{ plan: Plan | null }>(
    '/api/v1/onboarding/summary'
  )
  const plan = summary?.plan

  return (
    <BaseLayout title="Tableau de bord" description="Vue d'ensemble de votre station de lavage.">
      <div className="flex flex-col flex-1 gap-6 p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-2">
            {statusLoading ? (
              <>
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-48" />
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold tracking-tight">
                  {station?.name ?? status?.org_name ?? 'Tableau de bord'}
                </h1>
                <p className="text-muted-foreground">
                  {[station?.address, station?.city, station?.phone]
                    .filter(Boolean)
                    .join(' — ') || "Configurez vos coordonnées dans l'onboarding."}
                </p>
              </>
            )}
          </div>
          {plan && (
            <Badge variant="outline" className="w-fit">
              Forfait {plan.name}
              {plan.price_cents > 0 && ' — en attente de validation'}
            </Badge>
          )}
        </div>
        <DashboardMetrics />
      </div>
    </BaseLayout>
  )
}
