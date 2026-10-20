"use client"

import { useMemo, useState } from "react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { TableSkeleton } from "@/components/ui/table-skeleton"
import { AnimatedNumber } from "@/components/ui/animated-number"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApi } from "@/lib/api"
import type { ChartConfig } from "@/components/ui/chart"
import type { ReportResponse } from "@/lib/reporting-api"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts"
import { BarChart3, Download, Wallet, CarFront, Receipt, TrendingUp } from "lucide-react"

const chartConfig = {
  revenue: { label: "Encaissements", color: "#2563eb" },
  expenses: { label: "Dépenses", color: "#f97316" },
  washes: { label: "Lavages", color: "#0f766e" },
} satisfies ChartConfig

const paymentLabels: Record<string, string> = {
  cash: "Espèces",
  orange_money: "Orange Money",
  mtn_momo: "MTN MoMo",
  moov_money: "Moov Money",
  wave: "Wave",
  other: "Autre",
}

const expenseLabels: Record<string, string> = {
  supply: "Approvisionnement",
  salary: "Salaire",
  maintenance: "Maintenance",
  utilities: "Factures",
  rent: "Loyer",
  tax: "Impôts et taxes",
  marketing: "Marketing",
  other: "Autre",
}

function dateInAbidjan(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Abidjan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function shiftDate(date: string, days: number) {
  const shifted = new Date(`${date}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

function formatXof(cents: number) {
  return `${(cents / 100).toLocaleString("fr-CI", { maximumFractionDigits: 2 })} F CFA`
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("fr-CI", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
  })
}

function formatChartXof(value: number) {
  return new Intl.NumberFormat("fr-CI", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function csvAmount(cents: number) {
  return (cents / 100).toLocaleString("fr-CI", { maximumFractionDigits: 2 })
}

function downloadReport(report: ReportResponse) {
  const rows: Array<Array<string | number>> = [
    ["WashPilot CI — Rapport d’activité"],
    ["Période", report.period.from, report.period.to],
    [],
    ["Synthèse", "Valeur", "Montant (XOF)"],
    ["Lavages enregistrés", report.summary.total_washes, ""],
    ["Lavages terminés", report.summary.completed_washes, ""],
    ["Encaissements vérifiés", "", csvAmount(report.summary.revenue_cents)],
    ["Dépenses enregistrées", "", csvAmount(report.summary.expenses_cents)],
    ["Solde opérationnel", "", csvAmount(report.summary.net_cents)],
    [],
    ["Évolution journalière", "Date", "Lavages", "Encaissements (XOF)", "Dépenses (XOF)"],
    ...report.daily.map((row) => ["Jour", row.date, row.wash_count, csvAmount(row.revenue_cents), csvAmount(row.expenses_cents)]),
    [],
    ["Prestations", "Lavages", "Quantités", "Montant des prestations (XOF)"],
    ...report.top_services.map((row) => [row.name, row.wash_count, row.quantity, csvAmount(row.amount_cents)]),
    [],
    ["Moyens de paiement", "Nombre", "Montant (XOF)"],
    ...report.payment_methods.map((row) => [paymentLabels[row.method] ?? row.method, row.payment_count, csvAmount(row.amount_cents)]),
    [],
    ["Dépenses par catégorie", "Nombre", "Montant (XOF)"],
    ...report.expense_categories.map((row) => [expenseLabels[row.category] ?? row.category, row.expense_count, csvAmount(row.amount_cents)]),
  ]
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = `washpilot-rapport-${report.period.from}-${report.period.to}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export default function ReportsPage() {
  const today = useMemo(() => dateInAbidjan(), [])
  const [from, setFrom] = useState(() => shiftDate(dateInAbidjan(), -29))
  const [to, setTo] = useState(today)
  const hasValidRange = Boolean(from && to && from <= to)
  const reportPath = hasValidRange
    ? `/api/v1/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    : ""
  const { data, loading, error } = useApi<ReportResponse>(reportPath)

  const chartData = useMemo(
    () => (data?.daily ?? []).map((row) => ({
      date: row.date,
      wash_count: row.wash_count,
      revenue: row.revenue_cents / 100,
      expenses: row.expenses_cents / 100,
    })),
    [data],
  )

  function choosePeriod(days: number) {
    const end = dateInAbidjan()
    setTo(end)
    setFrom(shiftDate(end, -(days - 1)))
  }

  return (
    <BaseLayout title="Rapports" description="Suivez les lavages, les encaissements et les dépenses enregistrés par votre station.">
      <div className="space-y-6 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Période du rapport</h2>
            <p className="text-sm text-muted-foreground">Les journées sont calculées selon le fuseau Africa/Abidjan.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => choosePeriod(7)}>7 jours</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => choosePeriod(30)}>30 jours</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => choosePeriod(90)}>90 jours</Button>
            </div>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Du
              <Input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className="w-full sm:w-40" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Au
              <Input type="date" value={to} min={from || undefined} max={today} onChange={(event) => setTo(event.target.value)} className="w-full sm:w-40" />
            </label>
            <Button type="button" variant="outline" disabled={!data || loading} onClick={() => data && downloadReport(data)}>
              <Download className="mr-2 size-4" /> Exporter CSV
            </Button>
          </div>
        </div>

        {!hasValidRange && <p role="alert" className="text-sm text-destructive">La date de début doit être antérieure ou égale à la date de fin.</p>}
        {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard index={0} title="Lavages enregistrés" icon={<CarFront className="size-4 text-muted-foreground" />} value={data?.summary.total_washes} loading={loading} detail={data ? `${data.summary.completed_washes} terminé${data.summary.completed_washes === 1 ? "" : "s"}` : undefined} />
          <MetricCard index={1} title="Encaissements vérifiés" icon={<Wallet className="size-4 text-muted-foreground" />} value={data?.summary.revenue_cents} loading={loading} money detail={data ? `${data.summary.paid_washes} lavage${data.summary.paid_washes === 1 ? "" : "s"} réglé${data.summary.paid_washes === 1 ? "" : "s"}` : undefined} />
          <MetricCard index={2} title="Dépenses enregistrées" icon={<Receipt className="size-4 text-muted-foreground" />} value={data?.summary.expenses_cents} loading={loading} money />
          <MetricCard index={3} title="Solde opérationnel" icon={<TrendingUp className="size-4 text-muted-foreground" />} value={data?.summary.net_cents} loading={loading} money />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Encaissements et dépenses</CardTitle>
              <CardDescription>Montants enregistrés chaque jour, en XOF.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-[280px] w-full" /> : data ? (
                <ChartContainer config={chartConfig} className="h-[280px] w-full">
                  <AreaChart data={chartData} margin={{ left: 8, right: 12, top: 8 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={formatDate} />
                    <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={formatChartXof} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(_, payload) => payload?.[0]?.payload?.date ? formatDate(String(payload[0].payload.date)) : ""} formatter={(value, name) => [formatXof(Number(value) * 100), name === "revenue" ? "Encaissements" : name === "expenses" ? "Dépenses" : String(name)]} />} />
                    <Area dataKey="revenue" type="monotone" stroke="var(--color-revenue)" fill="var(--color-revenue)" fillOpacity={0.13} strokeWidth={2} animationDuration={600} animationEasing="ease-out" />
                    <Area dataKey="expenses" type="monotone" stroke="var(--color-expenses)" fill="var(--color-expenses)" fillOpacity={0.08} strokeWidth={2} animationDuration={600} animationEasing="ease-out" />
                    <ChartLegend content={<ChartLegendContent />} />
                  </AreaChart>
                </ChartContainer>
              ) : <EmptyReportState />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lavages par jour</CardTitle>
              <CardDescription>Nombre d’opérations non annulées enregistrées.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-[280px] w-full" /> : data ? (
                <ChartContainer config={chartConfig} className="h-[280px] w-full">
                  <BarChart data={chartData} margin={{ left: 0, right: 12, top: 8 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={formatDate} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(_, payload) => payload?.[0]?.payload?.date ? formatDate(String(payload[0].payload.date)) : ""} />} />
                    <Bar dataKey="wash_count" name="Lavages" fill="var(--color-washes)" radius={[4, 4, 0, 0]} animationDuration={600} animationEasing="ease-out" />
                  </BarChart>
                </ChartContainer>
              ) : <EmptyReportState />}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <BreakdownTable
            title="Prestations les plus réalisées"
            description="Montant calculé à partir des prix figés au moment du lavage."
            loading={loading}
            columns={["Prestation", "Lavages", "Quantité", "Montant"]}
            empty="Aucune prestation réalisée sur cette période."
            rows={(data?.top_services ?? []).map((row) => [row.name, row.wash_count, row.quantity, formatXof(row.amount_cents)])}
          />
          <BreakdownTable
            title="Dépenses par catégorie"
            description="Dépenses enregistrées et non annulées."
            loading={loading}
            columns={["Catégorie", "Opérations", "Montant"]}
            empty="Aucune dépense enregistrée sur cette période."
            rows={(data?.expense_categories ?? []).map((row) => [expenseLabels[row.category] ?? row.category, row.expense_count, formatXof(row.amount_cents)])}
          />
        </div>

        <BreakdownTable
          title="Encaissements par moyen de paiement"
          description="Seuls les paiements avec le statut vérifié sont comptabilisés."
          loading={loading}
          columns={["Moyen de paiement", "Paiements", "Montant"]}
          empty="Aucun paiement vérifié sur cette période."
          rows={(data?.payment_methods ?? []).map((row) => [paymentLabels[row.method] ?? row.method, row.payment_count, formatXof(row.amount_cents)])}
        />

        {data && data.summary.total_washes === 0 && data.summary.revenue_cents === 0 && data.summary.expenses_cents === 0 && (
          <p className="rounded-md border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
            Aucune opération n’a été enregistrée entre le {data.period.from} et le {data.period.to}.
          </p>
        )}
      </div>
    </BaseLayout>
  )
}

function MetricCard({
  title,
  icon,
  value,
  loading,
  money = false,
  detail,
  index = 0,
}: {
  title: string
  icon: React.ReactNode
  value: number | null | undefined
  loading: boolean
  money?: boolean
  detail?: string
  index?: number
}) {
  return (
    <Card
      className="row-in transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
      style={{ "--row": index } as React.CSSProperties}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription>{title}</CardDescription>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-8 w-32" /> : (
          <>
            <p className="text-2xl font-bold">
              <AnimatedNumber
                value={value}
                format={(amount) => (money ? formatXof(amount) : amount.toLocaleString("fr-CI"))}
              />
            </p>
            {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function EmptyReportState() {
  return (
    <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed">
      <EmptyState
        icon={BarChart3}
        title="Aucune donnée sur cette période"
        description="Changez les dates ou enregistrez des opérations : les graphiques se construisent automatiquement."
      />
    </div>
  )
}

function BreakdownTable({
  title,
  description,
  columns,
  rows,
  empty,
  loading,
}: {
  title: string
  description: string
  columns: string[]
  rows: Array<Array<string | number>>
  empty: string
  loading: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BarChart3 className="size-4" />{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? <TableSkeleton rows={4} cols={columns.length} label={`Chargement : ${title}`} /> : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader><TableRow>{columns.map((column) => <TableHead key={column}>{column}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={columns.length} className="h-20 text-center text-muted-foreground">{empty}</TableCell></TableRow>
                ) : rows.map((row, index) => (
                  <TableRow
                    key={`${title}-${index}`}
                    className="row-in"
                    style={{ "--row": Math.min(index, 10) } as React.CSSProperties}
                  >
                    {row.map((value, cellIndex) => <TableCell key={cellIndex} className={cellIndex > 0 ? "text-right" : undefined}>{value}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
