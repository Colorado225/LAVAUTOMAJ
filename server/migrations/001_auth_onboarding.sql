-- Initial Clerk identity, multi-tenant and onboarding schema.
-- All changes are additive or widen existing data; no business records are dropped.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_org_id VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(120),
  phone VARCHAR(50),
  email VARCHAR(255),
  address VARCHAR(255),
  city VARCHAR(120),
  description TEXT,
  logo_url TEXT,
  plan VARCHAR(50) NOT NULL DEFAULT 'free',
  subscription_status VARCHAR(50) NOT NULL DEFAULT 'trialing',
  timezone VARCHAR(50) NOT NULL DEFAULT 'Africa/Abidjan',
  default_currency VARCHAR(3) NOT NULL DEFAULT 'XOF',
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS clerk_org_id VARCHAR(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT 'Organisation';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slug VARCHAR(120);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS address VARCHAR(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS city VARCHAR(120);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan VARCHAR(50) NOT NULL DEFAULT 'free';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) NOT NULL DEFAULT 'trialing';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'Africa/Abidjan';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS default_currency VARCHAR(3) NOT NULL DEFAULT 'XOF';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_clerk_org_id_unique ON organizations(clerk_org_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug_unique ON organizations(slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id VARCHAR(255) NOT NULL UNIQUE,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(50),
  avatar_url TEXT,
  role VARCHAR(50) NOT NULL DEFAULT 'user',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  last_sign_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_user_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE users ALTER COLUMN organization_id DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clerk_user_id_unique ON users(clerk_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id);

CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  city VARCHAR(100),
  commune VARCHAR(100),
  phone VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_sites_organization_id ON sites(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_organization_name_unique ON sites(organization_id, name);

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'cashier',
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_organization_id ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON organization_members(user_id);

CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  price_cents BIGINT NOT NULL DEFAULT 0,
  billing_cycle VARCHAR(30) NOT NULL DEFAULT 'monthly',
  max_workers INT,
  max_services INT,
  max_sites INT DEFAULT 1,
  max_users INT DEFAULT 2,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS code VARCHAR(50);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(30) NOT NULL DEFAULT 'monthly';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_workers INT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_services INT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_sites INT DEFAULT 1;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_users INT DEFAULT 2;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
UPDATE plans SET code = LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g')) WHERE code IS NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'plans' AND column_name = 'price_cents_month'
  ) THEN
    EXECUTE 'ALTER TABLE plans ALTER COLUMN price_cents_month SET DEFAULT 0';
    EXECUTE 'UPDATE plans SET price_cents = price_cents_month WHERE price_cents = 0';
  END IF;
END
$$;
UPDATE plans SET code = 'free' WHERE code = 'gratuit';
CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_code_unique ON plans(code);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id),
  state VARCHAR(50) NOT NULL DEFAULT 'selected',
  status VARCHAR(50) NOT NULL DEFAULT 'trialing',
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS state VARCHAR(50) NOT NULL DEFAULT 'selected';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'trialing';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_subscriptions_organization_id ON subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

CREATE TABLE IF NOT EXISTS onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  current_stage VARCHAR(50) NOT NULL DEFAULT 'station',
  station_data JSONB,
  services_data JSONB,
  workers_data JSONB,
  plan_code VARCHAR(50),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_catalog_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(60) NOT NULL,
  name VARCHAR(160) NOT NULL,
  price_cents BIGINT,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE (category, name)
);

CREATE TABLE IF NOT EXISTS service_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);
ALTER TABLE service_categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_service_categories_organization_id ON service_categories(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_categories_org_name_unique ON service_categories(organization_id, name);

CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id UUID REFERENCES service_categories(id) ON DELETE SET NULL,
  name VARCHAR(160) NOT NULL,
  price_cents BIGINT NOT NULL DEFAULT 0,
  duration_minutes INT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);
ALTER TABLE services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_services_organization_id ON services(organization_id);
CREATE INDEX IF NOT EXISTS idx_services_category_id ON services(category_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_services_org_name_unique ON services(organization_id, name);

CREATE TABLE IF NOT EXISTS vehicle_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);
ALTER TABLE vehicle_categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_vehicle_categories_organization_id ON vehicle_categories(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_categories_org_name_unique ON vehicle_categories(organization_id, name);

CREATE TABLE IF NOT EXISTS workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(50),
  district VARCHAR(255),
  role VARCHAR(50) NOT NULL DEFAULT 'car_washer',
  custom_role VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  joined_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE workers ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE workers ADD COLUMN IF NOT EXISTS district VARCHAR(255);
ALTER TABLE workers ADD COLUMN IF NOT EXISTS custom_role VARCHAR(100);
ALTER TABLE workers ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active';
ALTER TABLE workers ADD COLUMN IF NOT EXISTS joined_at DATE;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_workers_organization_id ON workers(organization_id);

CREATE TABLE IF NOT EXISTS clerk_webhook_events (
  id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(120) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seeded catalog and plans are global reference data, never tenant-specific.
INSERT INTO plans (code, name, description, price_cents, max_workers, max_services, max_sites, max_users, features, sort_order)
VALUES
  ('free', 'Gratuit', 'Pour démarrer seul ou en petite équipe', 0, 3, 10, 1, 2, '["1 station", "3 travailleurs", "10 services", "Tableau de bord", "Suivi des lavages"]'::jsonb, 0),
  ('pro', 'Pro', 'Pour les stations en croissance', 1500000, 10, 50, 2, 5, '["Jusqu\u0027à 2 stations", "10 travailleurs", "50 services", "Rapports d\u0027activité", "Support prioritaire"]'::jsonb, 1),
  ('business', 'Business', 'Pour les réseaux de stations', 4000000, NULL, NULL, NULL, NULL, '["Multi-stations", "Travailleurs illimités", "Services illimités", "Rapports avancés & export"]'::jsonb, 2)
ON CONFLICT (code) DO NOTHING;

INSERT INTO service_catalog_templates (category, name, price_cents, sort_order)
VALUES
  ('exterieur', 'Lavage extérieur simple', 100000, 0),
  ('exterieur', 'Lavage extérieur premium', 150000, 1),
  ('interieur', 'Aspiration intérieure', 100000, 2),
  ('interieur', 'Nettoyage des tapis', 75000, 3),
  ('interieur', 'Nettoyage des sièges', 150000, 4),
  ('complet', 'Lavage complet (intérieur + extérieur)', 250000, 5),
  ('detailing', 'Nettoyage approfondi', 300000, 6),
  ('detailing', 'Lustrage carrosserie & cire', 300000, 7),
  ('detailing', 'Lavage moteur', 150000, 8),
  ('deux-roues', 'Lavage moto / tricycle', 50000, 9),
  ('utilitaire', 'Lavage utilitaire / minibus', 200000, 10),
  ('utilitaire', 'Forfait flotte (par véhicule)', 180000, 11)
ON CONFLICT (category, name) DO NOTHING;
