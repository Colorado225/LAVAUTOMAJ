-- +migrate Up
-- PHASE C/D — Onboarding, travailleurs, forfaits (docs/WORKFLOW_PLAN.md)

ALTER TABLE organizations
  ADD COLUMN phone VARCHAR(30),
  ADD COLUMN email VARCHAR(255),
  ADD COLUMN address VARCHAR(255),
  ADD COLUMN city VARCHAR(120),
  ADD COLUMN description TEXT,
  ADD COLUMN logo_url TEXT,
  ADD COLUMN slug VARCHAR(80),
  ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX idx_organizations_slug ON organizations(slug) WHERE slug IS NOT NULL;

CREATE TYPE worker_role AS ENUM ('car_washer','moto_washer','versatile_washer','team_lead','custom');

CREATE TABLE workers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(30),
    district VARCHAR(255),
    role worker_role NOT NULL,
    custom_role VARCHAR(80),
    status user_status NOT NULL DEFAULT 'active',
    joined_at DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_workers_org ON workers(organization_id);

CREATE TYPE billing_cycle AS ENUM ('monthly','yearly');
CREATE TYPE subscription_state AS ENUM ('selected','pending','active','failed','expired','cancelled');

CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(80) NOT NULL,
    description TEXT,
    price_cents BIGINT NOT NULL DEFAULT 0,
    billing_cycle billing_cycle NOT NULL DEFAULT 'monthly',
    max_workers INT,
    max_services INT,
    features JSONB NOT NULL DEFAULT '[]',
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id),
    state subscription_state NOT NULL DEFAULT 'selected',
    started_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_subscriptions_org ON subscriptions(organization_id);

CREATE TYPE onboarding_stage AS ENUM ('station','services','workers','plan','review');

CREATE TABLE onboarding_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    current_stage onboarding_stage NOT NULL DEFAULT 'station',
    station_data JSONB,
    services_data JSONB,
    workers_data JSONB,
    plan_code VARCHAR(20),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Catalogue de forfaits (source de vérité, jamais codée dans le frontend)
INSERT INTO plans (code, name, description, price_cents, max_workers, max_services, features, sort_order) VALUES
 ('free', 'Gratuit', 'Pour démarrer seul ou en petite équipe', 0, 3, 10,
   '["1 station","3 travailleurs","10 services","Tableau de bord","Suivi des lavages"]', 0),
 ('pro', 'Pro', 'Pour les stations en croissance', 1500000, 10, 50,
   '["1 station","10 travailleurs","50 services","Rapports d''activité","Support prioritaire"]', 1),
 ('business', 'Business', 'Pour les réseaux de stations', 4000000, NULL, NULL,
   '["Multi-stations","Travailleurs illimités","Rapports avancés","Export comptable","Support dédié"]', 2);

-- Catalogue standard de prestations (référence, copié par org à la confirmation)
CREATE TABLE service_catalog_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(60) NOT NULL,
    name VARCHAR(160) NOT NULL,
    price_cents BIGINT,
    sort_order INT NOT NULL DEFAULT 0,
    UNIQUE (category, name)
);
INSERT INTO service_catalog_templates (category, name, price_cents, sort_order) VALUES
 ('exterieur', 'Lavage extérieur simple', 100000, 0),
 ('exterieur', 'Lavage extérieur premium', 150000, 1),
 ('interieur', 'Aspiration intérieure', 100000, 2),
 ('interieur', 'Nettoyage des tapis', 75000, 3),
 ('interieur', 'Nettoyage des sièges', 150000, 4),
 ('complet', 'Lavage complet (extérieur + intérieur)', 250000, 5),
 ('detailing', 'Nettoyage approfondi', 300000, 6),
 ('detailing', 'Detailing & finition', 500000, 7),
 ('deux-roues', 'Lavage moto', 50000, 8),
 ('utilitaire', 'Lavage utilitaire', 200000, 9),
 ('utilitaire', 'Forfait flotte (par véhicule)', 180000, 10);

-- +migrate Down
DROP TABLE IF EXISTS service_catalog_templates;
DROP TABLE IF EXISTS onboarding_progress;
DROP TYPE IF EXISTS onboarding_stage;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS plans;
DROP TYPE IF EXISTS subscription_state;
DROP TYPE IF EXISTS billing_cycle;
DROP TABLE IF EXISTS workers;
DROP TYPE IF EXISTS worker_role;
DROP INDEX IF EXISTS idx_organizations_slug;
ALTER TABLE organizations
  DROP COLUMN IF EXISTS onboarding_completed,
  DROP COLUMN IF EXISTS slug,
  DROP COLUMN IF EXISTS logo_url,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS phone;
