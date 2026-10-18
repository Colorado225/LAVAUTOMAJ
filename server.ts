import express from "express"
import type { Request, Response } from "express"
import cors from "cors"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const port = 3000

app.use(cors())
app.use(express.json())

// In-Memory Data Store (WashPilot CI)
const orgId = "org_washpilot_cocody"
const organization = {
  id: orgId,
  clerk_org_id: orgId,
  name: "Station Cocody Riviera",
  phone: "+225 07 01 02 03 04",
  email: "contact@washpilot.ci",
  address: "Boulevard François Mitterrand, Riviera 2",
  city: "Abidjan (Cocody)",
  description: "Station de lavage haute pression et esthétique automobile.",
  logo_url: null,
  slug: "station-cocody-riviera",
  onboarding_completed: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

const sites = [
  {
    id: "site_cocody",
    organization_id: orgId,
    name: "Site Principal Cocody",
    city: "Abidjan",
    commune: "Cocody",
    address: "Riviera 2",
    phone: "+225 07 01 02 03 04",
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "site_marcory",
    organization_id: orgId,
    name: "Site Annexe Marcory",
    city: "Abidjan",
    commune: "Marcory",
    address: "Zone 4C, Rue du Canal",
    phone: "+225 05 06 07 08 09",
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
]

const vehicleCategories = [
  { id: "vc_citadine", organization_id: orgId, name: "Berline / Citadine", is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: "vc_suv", organization_id: orgId, name: "4x4 / SUV / Pick-up", is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: "vc_moto", organization_id: orgId, name: "Moto / Tricycle", is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: "vc_utilitaire", organization_id: orgId, name: "Utilitaire / Minibus", is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
]

const serviceCategories = [
  { id: "sc_ext", organization_id: orgId, name: "Extérieur", is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: "sc_int", organization_id: orgId, name: "Intérieur", is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: "sc_complet", organization_id: orgId, name: "Complet & Soins", is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
]

interface ServiceItem {
  id: string
  organization_id: string
  category_id: string | null
  name: string
  price_cents: number
  duration_minutes: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

const services: ServiceItem[] = [
  { id: "s_ext_simple", organization_id: orgId, category_id: "sc_ext", name: "Lavage extérieur simple", price_cents: 100000, duration_minutes: 20, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: "s_complet", organization_id: orgId, category_id: "sc_complet", name: "Lavage complet (Intérieur + Extérieur)", price_cents: 200000, duration_minutes: 45, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: "s_moteur", organization_id: orgId, category_id: "sc_complet", name: "Lavage moteur", price_cents: 150000, duration_minutes: 30, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: "s_lustrage", organization_id: orgId, category_id: "sc_complet", name: "Lustrage carrosserie & cire", price_cents: 300000, duration_minutes: 60, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
]

const workers = [
  { id: "w_1", organization_id: orgId, first_name: "Kouamé", last_name: "Yao", phone: "+225 01 23 45 67", role: "team_lead", status: "active", custom_role: null, joined_at: "2024-01-15T08:00:00Z", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: "w_2", organization_id: orgId, first_name: "Bakary", last_name: "Traoré", phone: "+225 05 67 89 01", role: "car_washer", status: "active", custom_role: null, joined_at: "2024-02-01T08:00:00Z", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: "w_3", organization_id: orgId, first_name: "Jean-Eudes", last_name: "Bamba", phone: "+225 07 89 12 34", role: "versatile_washer", status: "active", custom_role: null, joined_at: "2024-03-10T08:00:00Z", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
]

const plans = [
  { id: "plan_free", code: "free", name: "Gratuit", description: "Pour démarrer seul ou en petite équipe", price_cents: 0, billing_cycle: "monthly", max_workers: 3, max_services: 10, max_sites: 1, max_users: 2, features: ["1 station", "3 travailleurs", "10 services", "Tableau de bord", "Suivi des lavages"], sort_order: 0, is_active: true },
  { id: "plan_pro", code: "pro", name: "Pro", description: "Pour les stations en croissance", price_cents: 1500000, billing_cycle: "monthly", max_workers: 10, max_services: 50, max_sites: 2, max_users: 5, features: ["1 station", "10 travailleurs", "50 services", "Rapports d'activité", "Support prioritaire"], sort_order: 1, is_active: true },
  { id: "plan_business", code: "business", name: "Business", description: "Pour les réseaux de stations", price_cents: 4000000, billing_cycle: "monthly", max_workers: null, max_services: null, max_sites: null, max_users: null, features: ["Multi-stations", "Travailleurs illimités", "Services illimités", "Export comptable"], sort_order: 2, is_active: true },
]

const catalogTemplates = [
  { id: "tmpl_1", category: "exterieur", name: "Lavage extérieur simple", price_cents: 100000, sort_order: 0 },
  { id: "tmpl_2", category: "exterieur", name: "Lavage extérieur premium", price_cents: 150000, sort_order: 1 },
  { id: "tmpl_3", category: "interieur", name: "Aspiration intérieure", price_cents: 100000, sort_order: 2 },
  { id: "tmpl_4", category: "interieur", name: "Nettoyage des tapis", price_cents: 75000, sort_order: 3 },
  { id: "tmpl_5", category: "interieur", name: "Nettoyage des sièges", price_cents: 150000, sort_order: 4 },
  { id: "tmpl_6", category: "complet", name: "Lavage complet (intérieur + extérieur)", price_cents: 200000, sort_order: 5 },
  { id: "tmpl_7", category: "special", name: "Lavage moteur", price_cents: 150000, sort_order: 6 },
  { id: "tmpl_8", category: "special", name: "Lustrage carrosserie", price_cents: 300000, sort_order: 7 },
]

const onboardingProgress = {
  id: "progress_cocody",
  organization_id: orgId,
  current_stage: "review",
  station_data: {
    name: "Station Cocody Riviera",
    phone: "+225 07 01 02 03 04",
    city: "Abidjan",
    address: "Boulevard François Mitterrand, Riviera 2",
  },
  services_data: {
    selected: [
      { template_id: "tmpl_1", name: "Lavage extérieur simple", price_cents: 100000 },
      { template_id: "tmpl_6", name: "Lavage complet", price_cents: 200000 },
    ],
    custom: [],
  },
  workers_data: {
    workers: [
      { first_name: "Kouamé", last_name: "Yao", role: "team_lead" },
      { first_name: "Bakary", last_name: "Traoré", role: "car_washer" },
    ],
  },
  plan_code: "pro",
  completed_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

interface CashSessionItem {
  id: string
  organization_id: string
  site_id: string
  user_id: string
  opening_amount_cents: number
  theoretical_balance_cents: number
  counted_amount_cents: number | null
  discrepancy_cents: number | null
  discrepancy_reason: string | null
  status: string
  opened_at: string
  closed_at: string | null
  closed_by_id: string | null
  created_at: string
  updated_at: string
}

const cashSessions: CashSessionItem[] = [
  {
    id: "sess_open_1",
    organization_id: orgId,
    site_id: "site_cocody",
    user_id: "user_demo_washpilot",
    opening_amount_cents: 2000000, // 20 000 XOF
    theoretical_balance_cents: 2700000, // 27 000 XOF
    counted_amount_cents: null,
    discrepancy_cents: null,
    discrepancy_reason: null,
    status: "open",
    opened_at: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
    closed_at: null,
    closed_by_id: null,
    created_at: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  },
]

interface CashMovementItem {
  id: string
  organization_id: string
  cash_session_id: string
  type: "entry" | "exit"
  amount_cents: number
  source: string
  description: string | null
  author_id: string
  created_at: string
}

const cashMovements: CashMovementItem[] = [
  {
    id: "mov_1",
    organization_id: orgId,
    cash_session_id: "sess_open_1",
    type: "entry",
    amount_cents: 2000000,
    source: "opening_balance",
    description: "Fond de caisse initial ouverture",
    author_id: "user_demo_washpilot",
    created_at: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
  },
  {
    id: "mov_2",
    organization_id: orgId,
    cash_session_id: "sess_open_1",
    type: "entry",
    amount_cents: 700000,
    source: "wash_payment",
    description: "Encaissement lavage LAV-2024-001 (espèces)",
    author_id: "user_demo_washpilot",
    created_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
  },
]

interface WashItemRecord {
  id: string
  wash_id: string
  service_id: string
  service_name_snapshot: string
  price_cents_snapshot: number
  quantity: number
}

interface WashRecord {
  id: string
  organization_id: string
  site_id: string | null
  vehicle_category_id: string | null
  total_cents: number
  status: string
  payment_status: string
  reference: string
  author_id: string
  cancelled_at?: string | null
  cancelled_by_id?: string | null
  cancellation_reason?: string | null
  created_at: string
}

const washes: WashRecord[] = [
  {
    id: "wash_001",
    organization_id: orgId,
    site_id: "site_cocody",
    vehicle_category_id: "vc_citadine",
    total_cents: 300000,
    status: "completed",
    payment_status: "paid",
    reference: "LAV-2024-001",
    author_id: "user_demo_washpilot",
    created_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
  },
  {
    id: "wash_002",
    organization_id: orgId,
    site_id: "site_cocody",
    vehicle_category_id: "vc_suv",
    total_cents: 450000,
    status: "completed",
    payment_status: "paid",
    reference: "LAV-2024-002",
    author_id: "user_demo_washpilot",
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  },
]

const washItems: WashItemRecord[] = [
  { id: "wi_1", wash_id: "wash_001", service_id: "s_ext_simple", service_name_snapshot: "Lavage extérieur simple", price_cents_snapshot: 100000, quantity: 1 },
  { id: "wi_2", wash_id: "wash_001", service_id: "s_complet", service_name_snapshot: "Lavage complet (Intérieur + Extérieur)", price_cents_snapshot: 200000, quantity: 1 },
  { id: "wi_3", wash_id: "wash_002", service_id: "s_lustrage", service_name_snapshot: "Lustrage carrosserie & cire", price_cents_snapshot: 300000, quantity: 1 },
  { id: "wi_4", wash_id: "wash_002", service_id: "s_moteur", service_name_snapshot: "Lavage moteur", price_cents_snapshot: 150000, quantity: 1 },
]

const washWorkers: { wash_id: string; worker_id: string }[] = [
  { wash_id: "wash_001", worker_id: "w_2" },
  { wash_id: "wash_002", worker_id: "w_1" },
  { wash_id: "wash_002", worker_id: "w_3" },
]

interface PaymentRecord {
  id: string
  organization_id: string
  wash_id: string | null
  cash_session_id: string | null
  amount_cents: number
  method: string
  status: string
  reference: string | null
  received_at: string
  author_id: string
  created_at: string
}

const payments: PaymentRecord[] = [
  {
    id: "pay_1",
    organization_id: orgId,
    wash_id: "wash_001",
    cash_session_id: "sess_open_1",
    amount_cents: 300000,
    method: "cash",
    status: "verified",
    reference: "REC-001",
    received_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    author_id: "user_demo_washpilot",
    created_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
  },
  {
    id: "pay_2",
    organization_id: orgId,
    wash_id: "wash_002",
    cash_session_id: null,
    amount_cents: 450000,
    method: "wave",
    status: "verified",
    reference: "WAVE-CI-7890",
    received_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    author_id: "user_demo_washpilot",
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  },
]

interface ExpenseRecord {
  id: string
  organization_id: string
  site_id: string | null
  category: string
  amount_cents: number
  expense_date: string
  payment_method: string
  beneficiary: string | null
  description: string | null
  reference: string | null
  status: string
  cash_session_id: string | null
  author_id: string
  created_at: string
  updated_at: string
}

const expenses: ExpenseRecord[] = [
  {
    id: "exp_1",
    organization_id: orgId,
    site_id: "site_cocody",
    category: "supply",
    amount_cents: 2500000, // 25 000 XOF
    expense_date: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    payment_method: "orange_money",
    beneficiary: "Fournisseur Shampoing Auto Abidjan",
    description: "Achat de 2 bidons de shampoing moussant professionnel et cire",
    reference: "FACT-OM-1234",
    status: "recorded",
    cash_session_id: null,
    author_id: "user_demo_washpilot",
    created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  },
]

const users = [
  {
    id: "u_1",
    clerk_user_id: "user_demo_washpilot",
    organization_id: orgId,
    first_name: "Amadou",
    last_name: "Koné",
    email: "amadou.kone@washpilot.ci",
    role: "owner",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
]

// API Endpoints
app.get("/healthz", (_req: Request, res: Response) => {
  res.send("OK")
})

app.get("/readyz", (_req: Request, res: Response) => {
  res.send("OK")
})

// Vehicle Categories
app.get("/api/v1/vehicle-categories", (_req: Request, res: Response) => {
  res.json(vehicleCategories)
})

app.post("/api/v1/vehicle-categories", (req: Request, res: Response) => {
  const { name, is_active } = req.body
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).send("name is required")
  }
  const newCat = {
    id: `vc_${Date.now()}`,
    organization_id: orgId,
    name: name.trim(),
    is_active: is_active ?? true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  vehicleCategories.push(newCat)
  res.status(201).json(newCat)
})

app.patch("/api/v1/vehicle-categories/:id", (req: Request, res: Response) => {
  const cat = vehicleCategories.find((c) => c.id === req.params.id)
  if (!cat) return res.status(404).send("Category not found")
  if (req.body.name) cat.name = req.body.name.trim()
  if (req.body.is_active !== undefined) cat.is_active = req.body.is_active
  cat.updated_at = new Date().toISOString()
  res.json(cat)
})

app.post("/api/v1/vehicle-categories/:id/deactivate", (req: Request, res: Response) => {
  const cat = vehicleCategories.find((c) => c.id === req.params.id)
  if (cat) cat.is_active = false
  res.status(204).send()
})

// Service Categories
app.get("/api/v1/service-categories", (_req: Request, res: Response) => {
  res.json(serviceCategories)
})

app.post("/api/v1/service-categories", (req: Request, res: Response) => {
  const { name, is_active } = req.body
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).send("name is required")
  }
  const newCat = {
    id: `sc_${Date.now()}`,
    organization_id: orgId,
    name: name.trim(),
    is_active: is_active ?? true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  serviceCategories.push(newCat)
  res.status(201).json(newCat)
})

app.patch("/api/v1/service-categories/:id", (req: Request, res: Response) => {
  const cat = serviceCategories.find((c) => c.id === req.params.id)
  if (!cat) return res.status(404).send("Category not found")
  if (req.body.name) cat.name = req.body.name.trim()
  if (req.body.is_active !== undefined) cat.is_active = req.body.is_active
  cat.updated_at = new Date().toISOString()
  res.json(cat)
})

app.post("/api/v1/service-categories/:id/deactivate", (req: Request, res: Response) => {
  const cat = serviceCategories.find((c) => c.id === req.params.id)
  if (cat) cat.is_active = false
  res.status(204).send()
})

// Services
app.get("/api/v1/services", (_req: Request, res: Response) => {
  res.json(services)
})

app.post("/api/v1/services", (req: Request, res: Response) => {
  const { name, price_cents, category_id, duration_minutes, is_active } = req.body
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).send("name is required")
  }
  const newSvc: ServiceItem = {
    id: `s_${Date.now()}`,
    organization_id: orgId,
    category_id: category_id || null,
    name: name.trim(),
    price_cents: Number(price_cents) || 0,
    duration_minutes: duration_minutes ? Number(duration_minutes) : null,
    is_active: is_active ?? true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  services.push(newSvc)
  res.status(201).json(newSvc)
})

app.patch("/api/v1/services/:id", (req: Request, res: Response) => {
  const svc = services.find((s) => s.id === req.params.id)
  if (!svc) return res.status(404).send("Service not found")
  if (req.body.name) svc.name = req.body.name.trim()
  if (req.body.price_cents !== undefined) svc.price_cents = Number(req.body.price_cents)
  if (req.body.category_id !== undefined) svc.category_id = req.body.category_id
  if (req.body.duration_minutes !== undefined) svc.duration_minutes = req.body.duration_minutes
  if (req.body.is_active !== undefined) svc.is_active = req.body.is_active
  svc.updated_at = new Date().toISOString()
  res.json(svc)
})

app.post("/api/v1/services/:id/deactivate", (req: Request, res: Response) => {
  const svc = services.find((s) => s.id === req.params.id)
  if (svc) svc.is_active = false
  res.status(204).send()
})

// Sites
app.get("/api/v1/sites", (_req: Request, res: Response) => {
  res.json(sites)
})

// Workers
app.get("/api/v1/workers", (_req: Request, res: Response) => {
  res.json(workers)
})

// Plans
app.get("/api/v1/plans", (_req: Request, res: Response) => {
  res.json(plans)
})

// Service Catalog
app.get("/api/v1/service-catalog", (_req: Request, res: Response) => {
  res.json(catalogTemplates)
})

// Dashboard Metrics
app.get("/api/v1/dashboard/metrics", (_req: Request, res: Response) => {
  const validWashes = washes.filter((w) => w.status !== "cancelled")
  const totalRevenueCents = payments
    .filter((p) => p.status === "verified")
    .reduce((acc, p) => acc + p.amount_cents, 0)

  res.json({
    total_washes: validWashes.length,
    total_revenue_cents: totalRevenueCents,
    washes_today: validWashes.length,
    revenue_today_cents: totalRevenueCents,
    active_washers: workers.filter((w) => w.status === "active").length,
  })
})

// Onboarding
app.get("/api/v1/onboarding/status", (_req: Request, res: Response) => {
  res.json({
    state: organization.onboarding_completed ? "completed" : "in_progress",
    current_stage: onboardingProgress.current_stage || "review",
    org_name: organization.name,
    station: organization,
  })
})

app.get("/api/v1/onboarding/progress", (_req: Request, res: Response) => {
  res.json(onboardingProgress)
})

app.put("/api/v1/onboarding/progress", (req: Request, res: Response) => {
  const { stage, data } = req.body
  if (stage) onboardingProgress.current_stage = stage
  if (stage === "station" && data) onboardingProgress.station_data = data
  if (stage === "services" && data) onboardingProgress.services_data = data
  if (stage === "workers" && data) onboardingProgress.workers_data = data
  if (stage === "plan" && data) onboardingProgress.plan_code = data.plan_code || "pro"
  onboardingProgress.updated_at = new Date().toISOString()
  res.json(onboardingProgress)
})

app.get("/api/v1/onboarding/summary", (_req: Request, res: Response) => {
  const plan = plans.find((p) => p.code === onboardingProgress.plan_code) || plans[1]
  res.json({
    station: onboardingProgress.station_data || organization,
    services: onboardingProgress.services_data || { selected: [], custom: [] },
    workers: onboardingProgress.workers_data || { workers: [] },
    plan,
    completed: organization.onboarding_completed,
    org_name: organization.name,
  })
})

app.post("/api/v1/onboarding/confirm", (_req: Request, res: Response) => {
  organization.onboarding_completed = true
  onboardingProgress.completed_at = new Date().toISOString()
  res.status(201).json({
    organization,
    already_completed: false,
  })
})

// Washes
app.get("/api/v1/washes", (_req: Request, res: Response) => {
  res.json(washes)
})

app.get("/api/v1/washes/:washID", (req: Request, res: Response) => {
  const wash = washes.find((w) => w.id === req.params.washID)
  if (!wash) return res.status(404).send("Lavage introuvable")

  const items = washItems.filter((item) => item.wash_id === wash.id)
  const assignedWorkerIds = washWorkers
    .filter((ww) => ww.wash_id === wash.id)
    .map((ww) => ww.worker_id)
  const assignedWorkers = workers.filter((w) => assignedWorkerIds.includes(w.id))
  const washPayments = payments.filter((p) => p.wash_id === wash.id)

  res.json({
    wash,
    items,
    workers: assignedWorkers,
    payments: washPayments,
  })
})

app.post("/api/v1/washes", (req: Request, res: Response) => {
  const { site_id, vehicle_category_id, items, worker_ids, payment_method, amount_received_cents, cash_session_id } = req.body

  if (!items || !items.length) {
    return res.status(400).send("Au moins une prestation est requise")
  }

  const washId = `wash_${Date.now()}`
  let calculatedTotal = 0

  const createdItems: WashItemRecord[] = items.map((item: { service_id: string; quantity: number }, idx: number) => {
    const service = services.find((s) => s.id === item.service_id)
    const price = service ? service.price_cents : 100000
    const name = service ? service.name : "Prestation"
    calculatedTotal += price * (item.quantity || 1)
    return {
      id: `wi_${Date.now()}_${idx}`,
      wash_id: washId,
      service_id: item.service_id,
      service_name_snapshot: name,
      price_cents_snapshot: price,
      quantity: item.quantity || 1,
    }
  })

  const washNum = washes.length + 1
  const ref = `LAV-${new Date().getFullYear()}-${String(washNum).padStart(3, "0")}`

  const newWash: WashRecord = {
    id: washId,
    organization_id: orgId,
    site_id: site_id || sites[0]?.id || null,
    vehicle_category_id: vehicle_category_id || vehicleCategories[0]?.id || null,
    total_cents: calculatedTotal,
    status: "completed",
    payment_status: amount_received_cents >= calculatedTotal ? "paid" : amount_received_cents > 0 ? "partial" : "unpaid",
    reference: ref,
    author_id: "user_demo_washpilot",
    created_at: new Date().toISOString(),
  }

  washes.unshift(newWash)
  createdItems.forEach((it) => washItems.push(it))

  if (Array.isArray(worker_ids)) {
    worker_ids.forEach((wid: string) => {
      washWorkers.push({ wash_id: washId, worker_id: wid })
    })
  }

  let createdPayment: PaymentRecord | null = null
  if (amount_received_cents > 0) {
    createdPayment = {
      id: `pay_${Date.now()}`,
      organization_id: orgId,
      wash_id: washId,
      cash_session_id: payment_method === "cash" ? cash_session_id || cashSessions[0]?.id || null : null,
      amount_cents: amount_received_cents,
      method: payment_method || "cash",
      status: "verified",
      reference: `REC-${Date.now().toString().slice(-4)}`,
      received_at: new Date().toISOString(),
      author_id: "user_demo_washpilot",
      created_at: new Date().toISOString(),
    }
    payments.push(createdPayment)

    // Update cash session balance if cash
    if (payment_method === "cash" && cashSessions[0] && cashSessions[0].status === "open") {
      cashSessions[0].theoretical_balance_cents += amount_received_cents
      cashMovements.push({
        id: `mov_${Date.now()}`,
        organization_id: orgId,
        cash_session_id: cashSessions[0].id,
        type: "entry",
        amount_cents: amount_received_cents,
        source: "wash_payment",
        description: `Paiement lavage ${ref}`,
        author_id: "user_demo_washpilot",
        created_at: new Date().toISOString(),
      })
    }
  }

  const assignedWorkers = workers.filter((w) => (worker_ids || []).includes(w.id))

  res.status(201).json({
    wash: newWash,
    items: createdItems,
    workers: assignedWorkers,
    payments: createdPayment ? [createdPayment] : [],
  })
})

app.post("/api/v1/washes/:washID/cancel", (req: Request, res: Response) => {
  const wash = washes.find((w) => w.id === req.params.washID)
  if (!wash) return res.status(404).send("Lavage introuvable")
  const { reason } = req.body
  if (!reason || !reason.trim()) {
    return res.status(400).send("Motif de l'annulation requis")
  }
  wash.status = "cancelled"
  wash.cancellation_reason = reason.trim()
  wash.cancelled_at = new Date().toISOString()
  wash.cancelled_by_id = "user_demo_washpilot"
  res.json({ wash })
})

// Cash Sessions & Movements
app.get("/api/v1/cash-sessions/current", (req: Request, res: Response) => {
  const siteId = req.query.site_id as string
  const session = cashSessions.find((s) => s.status === "open" && (!siteId || s.site_id === siteId))
  res.json(session || null)
})

app.get("/api/v1/cash-sessions", (req: Request, res: Response) => {
  const status = req.query.status as string
  let list = cashSessions
  if (status) list = list.filter((s) => s.status === status)
  res.json(list)
})

app.post("/api/v1/cash-sessions/open", (req: Request, res: Response) => {
  const { site_id, opening_amount_cents } = req.body
  const newSession: CashSessionItem = {
    id: `sess_${Date.now()}`,
    organization_id: orgId,
    site_id: site_id || sites[0]?.id,
    user_id: "user_demo_washpilot",
    opening_amount_cents: Number(opening_amount_cents) || 0,
    theoretical_balance_cents: Number(opening_amount_cents) || 0,
    counted_amount_cents: null,
    discrepancy_cents: null,
    discrepancy_reason: null,
    status: "open",
    opened_at: new Date().toISOString(),
    closed_at: null,
    closed_by_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  cashSessions.unshift(newSession)
  cashMovements.push({
    id: `mov_${Date.now()}`,
    organization_id: orgId,
    cash_session_id: newSession.id,
    type: "entry",
    amount_cents: newSession.opening_amount_cents,
    source: "opening_balance",
    description: "Fond de caisse initial ouverture",
    author_id: "user_demo_washpilot",
    created_at: new Date().toISOString(),
  })
  res.status(201).json(newSession)
})

app.get("/api/v1/cash-sessions/:sessionID/movements", (req: Request, res: Response) => {
  const list = cashMovements.filter((m) => m.cash_session_id === req.params.sessionID)
  res.json(list)
})

app.post("/api/v1/cash-sessions/:sessionID/movements", (req: Request, res: Response) => {
  const session = cashSessions.find((s) => s.id === req.params.sessionID)
  if (!session) return res.status(404).send("Session introuvable")
  const { type, amount_cents, source, description } = req.body
  const amount = Number(amount_cents)
  if (!amount || amount <= 0) return res.status(400).send("Montant positif requis")

  if (type === "entry") {
    session.theoretical_balance_cents += amount
  } else if (type === "exit") {
    session.theoretical_balance_cents -= amount
  }

  const mov: CashMovementItem = {
    id: `mov_${Date.now()}`,
    organization_id: orgId,
    cash_session_id: session.id,
    type: type as "entry" | "exit",
    amount_cents: amount,
    source: source || "manual",
    description: description || null,
    author_id: "user_demo_washpilot",
    created_at: new Date().toISOString(),
  }
  cashMovements.push(mov)
  res.status(201).json(mov)
})

app.post("/api/v1/cash-sessions/:sessionID/close", (req: Request, res: Response) => {
  const session = cashSessions.find((s) => s.id === req.params.sessionID)
  if (!session) return res.status(404).send("Session introuvable")
  const { counted_amount_cents, discrepancy_reason } = req.body
  const counted = Number(counted_amount_cents)

  session.status = "closed"
  session.counted_amount_cents = counted
  session.discrepancy_cents = counted - session.theoretical_balance_cents
  session.discrepancy_reason = discrepancy_reason || null
  session.closed_at = new Date().toISOString()
  session.closed_by_id = "user_demo_washpilot"

  res.json(session)
})

// Expenses
app.get("/api/v1/expenses", (_req: Request, res: Response) => {
  res.json(expenses)
})

app.post("/api/v1/expenses", (req: Request, res: Response) => {
  const { category, amount_cents, payment_method, site_id, beneficiary, description, reference, cash_session_id } = req.body
  const amount = Number(amount_cents)
  if (!amount || amount <= 0) return res.status(400).send("Montant invalide")

  const exp: ExpenseRecord = {
    id: `exp_${Date.now()}`,
    organization_id: orgId,
    site_id: site_id || sites[0]?.id || null,
    category: category || "other",
    amount_cents: amount,
    expense_date: new Date().toISOString(),
    payment_method: payment_method || "cash",
    beneficiary: beneficiary || null,
    description: description || null,
    reference: reference || null,
    status: "recorded",
    cash_session_id: cash_session_id || null,
    author_id: "user_demo_washpilot",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  expenses.unshift(exp)

  // Deduct from cash session if cash
  if (payment_method === "cash" && cash_session_id) {
    const session = cashSessions.find((s) => s.id === cash_session_id)
    if (session) {
      session.theoretical_balance_cents -= amount
      cashMovements.push({
        id: `mov_${Date.now()}`,
        organization_id: orgId,
        cash_session_id: session.id,
        type: "exit",
        amount_cents: amount,
        source: "expense",
        description: `Dépense: ${description || category}`,
        author_id: "user_demo_washpilot",
        created_at: new Date().toISOString(),
      })
    }
  }

  res.status(201).json(exp)
})

app.get("/api/v1/expenses/:expenseID", (req: Request, res: Response) => {
  const exp = expenses.find((e) => e.id === req.params.expenseID)
  if (!exp) return res.status(404).send("Dépense introuvable")
  res.json(exp)
})

app.post("/api/v1/expenses/:expenseID/cancel", (req: Request, res: Response) => {
  const exp = expenses.find((e) => e.id === req.params.expenseID)
  if (!exp) return res.status(404).send("Dépense introuvable")
  exp.status = "cancelled"
  exp.updated_at = new Date().toISOString()
  res.json(exp)
})

// Payments
app.get("/api/v1/payments", (_req: Request, res: Response) => {
  res.json(payments)
})

// Users
app.get("/api/v1/users", (_req: Request, res: Response) => {
  res.json(users)
})

// Serve Frontend
async function startServer() {
  const isProd = process.env.NODE_ENV === "production"
  const distPath = path.resolve(__dirname, "dist")

  if (!isProd && !fs.existsSync(distPath)) {
    // Development mode: Mount Vite dev server as middleware
    const { createServer: createViteServer } = await import("vite")
    const vite = await createViteServer({
      server: { middlewareMode: true, host: "0.0.0.0", port },
      appType: "spa",
    })
    app.use(vite.middlewares)
  } else {
    // Production mode: Serve built static files
    app.use(express.static(distPath))
    app.use((_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"))
    })
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(`WashPilot CI server listening on http://0.0.0.0:${port}`)
  })
}

startServer().catch((err) => {
  console.error("Failed to start server:", err)
  process.exit(1)
})
