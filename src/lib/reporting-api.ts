export interface ReportSummary {
  total_washes: number
  completed_washes: number
  revenue_cents: number
  expenses_cents: number
  net_cents: number
  paid_washes: number
}

export interface DailyReportRow {
  date: string
  wash_count: number
  revenue_cents: number
  expenses_cents: number
}

export interface ServiceReportRow {
  name: string
  wash_count: number
  quantity: number
  amount_cents: number
}

export interface PaymentMethodReportRow {
  method: string
  payment_count: number
  amount_cents: number
}

export interface ExpenseCategoryReportRow {
  category: string
  expense_count: number
  amount_cents: number
}

/** Période tronquée par le serveur (essai gratuit terminé). */
export interface ReportRestriction {
  reason: string
  requested_from: string
  window_days: number
  message: string
}

export interface ReportResponse {
  period: { from: string; to: string }
  restriction?: ReportRestriction | null
  summary: ReportSummary
  daily: DailyReportRow[]
  top_services: ServiceReportRow[]
  payment_methods: PaymentMethodReportRow[]
  expense_categories: ExpenseCategoryReportRow[]
}
