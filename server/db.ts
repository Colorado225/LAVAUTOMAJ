import pg from "pg"
import { env } from "./env.ts"

const { Pool } = pg
let pool: pg.Pool | null = null
let ready = false

export function getPool(): pg.Pool | null { return pool }
export function isDatabaseReady(): boolean { return ready && pool !== null }

const schemaSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clerk_user_id text NOT NULL UNIQUE,
 organization_id uuid, email text NOT NULL, first_name text, last_name text, phone text,
 avatar_url text, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clerk_org_id text NOT NULL UNIQUE,
 name text NOT NULL, slug text, onboarding_completed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id uuid;
CREATE TABLE IF NOT EXISTS plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL,
 max_users integer, max_workers integer, max_sites integer, features jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_cents integer NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_services integer;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
INSERT INTO plans(code,name,description,price_cents,billing_cycle,max_users,max_workers,max_sites,max_services,sort_order,features) VALUES
 ('free','Gratuit','Pour démarrer : une station, une petite équipe.',0,'monthly',1,3,1,10,1,'{"reports.advanced":false,"reports.export":false,"sites.multiple":false}'::jsonb),
 ('pro','Pro','Pour les stations en croissance : rapports avancés et exports.',1000000,'monthly',10,20,1,NULL,2,'{"reports.advanced":true,"reports.export":true,"sites.multiple":false}'::jsonb),
 ('business','Business','Multi-stations, équipe illimitée, analyses consolidées.',2500000,'monthly',NULL,NULL,NULL,NULL,3,'{"reports.advanced":true,"reports.export":true,"sites.multiple":true}'::jsonb)
ON CONFLICT(code) DO UPDATE SET
 name=EXCLUDED.name, description=EXCLUDED.description, price_cents=EXCLUDED.price_cents,
 billing_cycle=EXCLUDED.billing_cycle, max_users=EXCLUDED.max_users, max_workers=EXCLUDED.max_workers,
 max_sites=EXCLUDED.max_sites, max_services=EXCLUDED.max_services, sort_order=EXCLUDED.sort_order,
 features=EXCLUDED.features;
CREATE TABLE IF NOT EXISTS subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id),
 plan_id uuid NOT NULL REFERENCES plans(id), status text NOT NULL DEFAULT 'trialing',
 current_period_end timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organization_members (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 user_id uuid NOT NULL REFERENCES users(id), role text NOT NULL DEFAULT 'cashier',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id, organization_id)
);
CREATE TABLE IF NOT EXISTS sites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL, city text NOT NULL, address text, phone text, is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS slug text;
CREATE TABLE IF NOT EXISTS onboarding_progress (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id), current_stage text NOT NULL DEFAULT 'station',
  station_data jsonb, services_data jsonb, workers_data jsonb, plan_code text, draft boolean NOT NULL DEFAULT false,
  completed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS service_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), category text NOT NULL, name text NOT NULL,
  price_cents integer, sort_order integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true
);
INSERT INTO service_catalog(category,name,price_cents,sort_order) VALUES
  ('exterieur','Nettoyage extérieur',5000,1),('exterieur','Nettoyage intérieur',7000,2),
  ('complet','Nettoyage complet',10000,3),('detailing','Lustrage',15000,4),
  ('deux-roues','Nettoyage moto',4000,5),('utilitaire','Nettoyage utilitaire',6000,6)
ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS service_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,name)
);
CREATE TABLE IF NOT EXISTS vehicle_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,name)
);
CREATE TABLE IF NOT EXISTS services (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 category_id uuid REFERENCES service_categories(id), name text NOT NULL, description text,
 price_cents integer NOT NULL CHECK(price_cents >= 0), duration_minutes integer CHECK(duration_minutes BETWEEN 1 AND 1440),
 is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 site_id uuid REFERENCES sites(id), first_name text NOT NULL, last_name text NOT NULL, phone text,
 role text NOT NULL DEFAULT 'car_washer', custom_role text, status text NOT NULL DEFAULT 'active',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE workers ADD COLUMN IF NOT EXISTS district text;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS joined_at date;
CREATE TABLE IF NOT EXISTS customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 full_name text NOT NULL, phone text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS washes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 site_id uuid NOT NULL REFERENCES sites(id), vehicle_category_id uuid REFERENCES vehicle_categories(id),
 customer_id uuid REFERENCES customers(id), status text NOT NULL DEFAULT 'completed',
 total_cents integer NOT NULL CHECK(total_cents >= 0), payment_method text NOT NULL DEFAULT 'cash',
 created_by uuid REFERENCES users(id), cancelled_at timestamptz, cancellation_reason text,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE washes ADD COLUMN IF NOT EXISTS reference text;
ALTER TABLE washes ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending';
ALTER TABLE washes ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_washes_org_reference ON washes(organization_id,reference);
CREATE TABLE IF NOT EXISTS wash_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), wash_id uuid NOT NULL REFERENCES washes(id),
 service_id uuid REFERENCES services(id), service_name text NOT NULL, quantity integer NOT NULL CHECK(quantity > 0),
 unit_price_cents integer NOT NULL CHECK(unit_price_cents >= 0), line_total_cents integer NOT NULL CHECK(line_total_cents >= 0)
);
CREATE TABLE IF NOT EXISTS wash_assignments (
 wash_id uuid NOT NULL REFERENCES washes(id), worker_id uuid NOT NULL REFERENCES workers(id), PRIMARY KEY(wash_id,worker_id)
);
CREATE TABLE IF NOT EXISTS payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 wash_id uuid NOT NULL REFERENCES washes(id), method text NOT NULL, amount_cents integer NOT NULL CHECK(amount_cents >= 0),
 status text NOT NULL DEFAULT 'completed', created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS reference text;
CREATE TABLE IF NOT EXISTS cash_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 site_id uuid NOT NULL REFERENCES sites(id), opened_by uuid REFERENCES users(id), closed_by uuid REFERENCES users(id),
 opening_amount_cents integer NOT NULL CHECK(opening_amount_cents >= 0), closing_amount_cents integer,
 expected_amount_cents integer, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz
);
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS discrepancy_reason text;
CREATE TABLE IF NOT EXISTS cash_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 cash_session_id uuid NOT NULL REFERENCES cash_sessions(id), type text NOT NULL CHECK(type IN ('entry','exit')),
 amount_cents integer NOT NULL CHECK(amount_cents > 0), source text NOT NULL, description text,
 wash_id uuid REFERENCES washes(id), created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS expense_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL, is_active boolean NOT NULL DEFAULT true, UNIQUE(organization_id,name)
);
CREATE TABLE IF NOT EXISTS expenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 site_id uuid NOT NULL REFERENCES sites(id), category text NOT NULL, amount_cents integer NOT NULL CHECK(amount_cents > 0),
 payment_method text NOT NULL, cash_session_id uuid REFERENCES cash_sessions(id), description text,
 status text NOT NULL DEFAULT 'completed', created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE expenses ALTER COLUMN site_id DROP NOT NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS beneficiary text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS reference text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_date date NOT NULL DEFAULT CURRENT_DATE;
CREATE TABLE IF NOT EXISTS idempotency_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 key text NOT NULL, fingerprint text NOT NULL, response_status integer, response_body jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,key)
);
CREATE TABLE IF NOT EXISTS clerk_webhook_events (
 id text PRIMARY KEY, event_type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id),
 actor_user_id uuid REFERENCES users(id), action text NOT NULL, entity_type text NOT NULL, entity_id text,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sites_org ON sites(organization_id);
CREATE INDEX IF NOT EXISTS idx_services_org ON services(organization_id);
CREATE INDEX IF NOT EXISTS idx_washes_org_created ON washes(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_org_created ON expenses(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workers_org_status ON workers(organization_id,status);
CREATE INDEX IF NOT EXISTS idx_payments_org_created ON payments(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(cash_session_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_org_site ON cash_sessions(organization_id,site_id,status);
CREATE INDEX IF NOT EXISTS idx_wash_items_wash ON wash_items(wash_id);
`

export async function initDatabaseSchema(): Promise<boolean> {
  if (!env.DATABASE_URL) { ready = false; return false }
  if (!pool) pool = new Pool({ connectionString: env.DATABASE_URL, max: env.PG_POOL_MAX, ssl: /localhost|127\.0\.0\.1/.test(env.DATABASE_URL) ? false : { rejectUnauthorized: true }, connectionTimeoutMillis: 8000, idleTimeoutMillis: 30000 })
  try { await pool.query("SELECT 1"); await pool.query(schemaSql); ready = true; return true }
  catch (error) { ready = false; console.error("[db] Database initialization failed:", error instanceof Error ? error.message : "unknown"); if (env.NODE_ENV === "production") throw error; return false }
}
export async function closeDatabase(): Promise<void> { ready = false; if (pool) { const current = pool; pool = null; await current.end() } }
