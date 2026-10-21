"use client"

import { useEffect, useState, useMemo } from 'react'
import { apiFetch, apiErrorMessage } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DollarSign, CarFront, TrendingUp, Clock, CheckCircle, XCircle, Activity, BarChart3 } from 'lucide-react'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { motion, type Variants } from 'framer-motion'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface DashboardMetricsData {
  total_washes: number
  total_revenue_cents: number
  completed_washes?: number
  cancelled_washes?: number
  pending_payments_cents?: number
  pending_payments_count?: number
  monthly_revenue?: { month: string; revenue: number }[]
  recent_washes?: Array<{
    id: string
    vehicle_plate: string
    service: string
    amount_cents: number
    status: string
    created_at: string
  }>
}

const formatXOF = (cents: number) =>
  `${((cents || 0) / 100).toLocaleString('fr-CI', {
    style: 'currency',
    currency: 'XOF',
    maximumFractionDigits: 0,
  })}`

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('fr-CI', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06
    }
  }
}

const itemVariants: Variants = {
  hidden: { y: 10, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      type: "spring" as const,
      stiffness: 220,
      damping: 26,
      mass: 0.6
    }
  }
}

const pieVariants: Variants = {
  hidden: { scale: 0.96, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: {
      type: "spring" as const,
      stiffness: 200,
      damping: 28,
      delay: 0.1
    }
  }
}

const COLORS = ['#10b981', '#3b82f6', '#ef4444']

export function DashboardMetrics() {
  const [data, setData] = useState<DashboardMetricsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const response = await apiFetch('/api/v1/dashboard/metrics')

        if (!response.ok) {
          throw new Error(await apiErrorMessage(response))
        }

        const result: DashboardMetricsData = await response.json()
        setData({
          ...result,
          completed_washes: result.completed_washes || 0,
          cancelled_washes: result.cancelled_washes || 0,
          pending_payments_cents: result.pending_payments_cents || 0,
          pending_payments_count: result.pending_payments_count || 0,
          monthly_revenue: result.monthly_revenue || [],
          recent_washes: result.recent_washes || []
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchMetrics()
  }, [])

  const pieData = useMemo(() => {
    if (!data) return []
    return [
      { name: 'Terminés', value: data.completed_washes || 0, color: COLORS[0] },
      { name: 'Annulés', value: data.cancelled_washes || 0, color: COLORS[2] },
    ].filter(item => item.value > 0)
  }, [data])

  const barData = useMemo(() => {
    return (data?.monthly_revenue || []).map(item => ({
      ...item,
      revenue: item.revenue / 100
    }))
  }, [data])

  if (loading) {
    return (
      <div className="flex flex-col gap-6" role="status" aria-busy="true" aria-label="Chargement des indicateurs">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card
              key={i}
              className="row-in elev-2 border"
              style={{ '--row': i } as React.CSSProperties}
            >
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
      </div>
    )
  }

  if (error) {
    return <div className="text-destructive">Erreur : {error}</div>
  }

  return (
    <motion.div
      className="flex flex-col gap-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4" variants={containerVariants}>
        <motion.div variants={itemVariants}>
          <Card interactive
            className="group relative rounded-xl border bg-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Recettes totales</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                <AnimatedNumber value={data?.total_revenue_cents || 0} format={formatXOF} />
              </div>
              <p className="text-xs text-muted-foreground">Somme des paiements confirmés</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card interactive
            className="group relative rounded-xl border bg-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Lavages totaux</CardTitle>
              <CarFront className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                <AnimatedNumber value={data?.total_washes || 0} />
              </div>
              <p className="text-xs text-muted-foreground">Nombre total de lavages</p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card interactive
            className="group relative rounded-xl border bg-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">À confirmer</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                <AnimatedNumber value={data?.pending_payments_cents || 0} format={formatXOF} />
              </div>
              <p className="text-xs text-muted-foreground">
                {(data?.pending_payments_count || 0) === 1
                  ? '1 encaissement en attente de confirmation'
                  : `${data?.pending_payments_count || 0} encaissements en attente de confirmation`}
              </p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card interactive
            className="group relative rounded-xl border bg-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Taux de complétion</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-violet-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                <AnimatedNumber
                  value={data?.total_washes ? Math.round(((data.completed_washes || 0) / data.total_washes) * 100) : 0}
                  format={(value) => `${value}%`}
                />
              </div>
              <p className="text-xs text-muted-foreground">Taux de réussite</p>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {(pieData.length > 0 || barData.length > 0) && (
        <motion.div className="grid gap-6 lg:grid-cols-2" variants={itemVariants}>
          {pieData.length > 0 && (
            <motion.div variants={pieVariants}>
              <Card interactive
                className="relative rounded-xl border bg-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Répartition des lavages
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                          animationDuration={600}
                          animationEasing="ease-out"
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {barData.length > 0 && (
            <motion.div variants={itemVariants}>
              <Card interactive
                className="relative rounded-xl border bg-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Revenus mensuels (FCFA)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" />
                        <YAxis />
                        <Tooltip formatter={(value) => [`${(value || 0).toLocaleString()} FCFA`, 'Revenu']} />
                        <Bar
                          dataKey="revenue"
                          fill="#3b82f6"
                          radius={[4, 4, 0, 0]}
                          animationDuration={600}
                          animationEasing="ease-out"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </motion.div>
      )}

      {data?.recent_washes && data.recent_washes.length > 0 && (
        <motion.div variants={itemVariants}>
          <Card interactive
                className="relative rounded-xl border bg-card">
            <CardHeader>
              <CardTitle>Derniers lavages enregistrés</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border border-border/30">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Plaque</TableHead>
                      <TableHead className="font-semibold">Service</TableHead>
                      <TableHead className="font-semibold">Montant</TableHead>
                      <TableHead className="font-semibold">Statut</TableHead>
                      <TableHead className="font-semibold">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recent_washes.map((wash, index) => (
                      <motion.tr
                        key={wash.id}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1], delay: Math.min(index, 8) * 0.035 }}
                        className="border-b border-border/20 transition-colors hover:bg-muted/30"
                      >
                        <TableCell className="font-mono font-medium">{wash.vehicle_plate}</TableCell>
                        <TableCell>{wash.service}</TableCell>
                        <TableCell>{formatXOF(wash.amount_cents)}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${
                            wash.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                            wash.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {wash.status === 'completed' ? <CheckCircle className="h-3 w-3" /> :
                             wash.status === 'in_progress' ? <Clock className="h-3 w-3" /> :
                             <XCircle className="h-3 w-3" />}
                            {wash.status === 'completed' ? 'Terminé' :
                             wash.status === 'in_progress' ? 'En cours' : 'Annulé'}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(wash.created_at)}</TableCell>
                      </motion.tr>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </motion.div>
  )
}
