import { useEffect, useState } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CarFront, DollarSign } from 'lucide-react'

interface DashboardMetricsData {
    total_washes: number
    total_revenue_cents: number
}

const formatXOF = (cents: number) =>
    `${((cents || 0) / 100).toLocaleString('fr-CI', {
        style: 'currency',
        currency: 'XOF',
        maximumFractionDigits: 0,
    })}`

export function DashboardMetrics() {
    const { getToken } = useAuth()
    const [data, setData] = useState<DashboardMetricsData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const fetchMetrics = async () => {
            try {
                const token = await getToken()
                if (!token) {
                    throw new Error('Not authenticated')
                }

                const response = await fetch('/api/v1/dashboard/metrics', {
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                })

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`)
                }

                const result: DashboardMetricsData = await response.json()
                setData(result)
            } catch (err) {
                setError(err instanceof Error ? err.message : 'An unknown error occurred')
            } finally {
                setLoading(false)
            }
        }

        fetchMetrics()
    }, [getToken])

    if (loading) {
        return (
            <div className="grid gap-4 md:grid-cols-2">
                {[0, 1].map((i) => (
                    <Card key={i}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                            <div className="h-4 w-4 animate-pulse rounded bg-muted" />
                        </CardHeader>
                        <CardContent>
                            <div className="h-8 w-24 animate-pulse rounded bg-muted" />
                            <div className="mt-2 h-3 w-40 animate-pulse rounded bg-muted" />
                        </CardContent>
                    </Card>
                ))}
            </div>
        )
    }

    if (error) {
        return <div className="text-destructive">Erreur : {error}</div>
    }

    return (
        <div className="grid gap-4 md:grid-cols-2">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Recettes totales</CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">
                        {formatXOF(data?.total_revenue_cents || 0)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Somme des paiements confirmés
                    </p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Lavages</CardTitle>
                    <CarFront className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{data?.total_washes || 0}</div>
                    <p className="text-xs text-muted-foreground">
                        Nombre total de lavages enregistrés
                    </p>
                </CardContent>
            </Card>
        </div>
    )
}