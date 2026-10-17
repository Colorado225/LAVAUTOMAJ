# PHASE B — Architecture cible, schéma des données et plan de migration

## 1. Architecture cible (inchangée structurellement, conformément à l'audit)

```
React (Vite, react-router 7, Clerk, shadcn/ui)
   │  fetch + Bearer token Clerk (src/lib/api.ts)
   ▼
Go API (chi) ── vérification Clerk + org_id claim
   │                │
   │                ├─ /api/v1/onboarding/status      → état de configuration (source de vérité)
   │                ├─ /api/v1/onboarding/progress    → GET/PUT progression par étape
   │                ├─ /api/v1/onboarding/confirm     → transaction finale idempotente
   │                ├─ /api/v1/onboarding/summary     → récapitulatif
   │                └─ (existant) services, vehicle-categories, dashboard/metrics…
   ▼
Neon PostgreSQL (migrations golang-migrate)
```

### Flux d'authentification et redirections (§3 du WORKFLOW)

- `App.tsx` : `<SignedIn>` / `<SignedOut>` enveloppent le routeur — un visiteur non connecté est renvoyé vers sign-in (composants Clerk), jamais sur le dashboard.
- Après connexion : composant `OnboardingGate` (dans le layout racine authentifié) interroge `GET /api/v1/onboarding/status` :
  - `not_started` ou `in_progress` → `<Navigate to="/onboarding" />` (le wizard reprend à l'étape sauvegardée).
  - `completed` → contenu demandé (dashboard, etc.).
- La décision est **côté serveur** (table `onboarding_progress`), jamais depuis le localStorage ou l'URL.
- Multi-stations : hors périmètre immédiat (modèle Clerk actuel = 1 org par session). L'endpoint de statut renverra la station de l'org claim ; l'extension multi-stations est documentée comme évolution.

## 2. Schéma des données — migration `000005_onboarding_plans`

```sql
-- Extension d'organizations (station de lavage)
ALTER TABLE organizations
  ADD COLUMN phone VARCHAR(30),
  ADD COLUMN email VARCHAR(255),
  ADD COLUMN address VARCHAR(255),        -- quartier
  ADD COLUMN city VARCHAR(120),           -- ville/commune
  ADD COLUMN description TEXT,
  ADD COLUMN logo_url TEXT,
  ADD COLUMN slug VARCHAR(80) UNIQUE,     -- identifiant public unique généré
  ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT false;

-- Travailleurs (§6) — rattachés à l'org, sans compte utilisateur
CREATE TYPE worker_role AS ENUM ('car_washer','moto_washer','versatile_washer','team_lead','custom');
CREATE TABLE workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(30),
  district VARCHAR(255),                  -- quartier d'habitation
  role worker_role NOT NULL,
  custom_role VARCHAR(80),                -- si role='custom'
  status user_status NOT NULL DEFAULT 'active',
  joined_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_workers_org ON workers(organization_id);
-- unicité douce : même nom+téléphone dans une même org = doublon refusé applicativement

-- Forfaits (§7) — catalogue en base, prix/droits jamais codés dans le frontend
CREATE TYPE billing_cycle AS ENUM ('monthly','yearly');
CREATE TYPE subscription_state AS ENUM ('selected','pending','active','failed','expired','cancelled');
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) UNIQUE NOT NULL,       -- 'free' | 'pro' | 'business'
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

-- Progression d'onboarding (§8)
CREATE TYPE onboarding_stage AS ENUM ('station','services','workers','plan','review');
CREATE TABLE onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  current_stage onboarding_stage NOT NULL DEFAULT 'station',
  station_data JSONB,
  services_data JSONB,        -- ids de services choisis + custom créés
  workers_data JSONB,         -- liste des travailleurs (repris dans workers à la confirmation)
  plan_code VARCHAR(20),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed forfaits Free/Pro/Business (prix XOF en centimes… XOF sans centime : cents utilisés comme unité)
INSERT INTO plans (code, name, price_cents, max_workers, max_services, features, sort_order) VALUES
 ('free','Gratuit',0,3,10,'["1 station","3 travailleurs","10 services","Tableau de bord"]',0),
 ('pro','Pro',1500000,10,50,'["1 station","10 travailleurs","50 services","Rapports","Support prioritaire"]',1),
 ('business','Business',4000000,NULL,NULL,'["Multi-stations","Travailleurs illimités","Rapports avancés","Export comptable","Support dédié"]',2);
```

### Seed du catalogue standard (dans la même migration, table de référence)

```sql
CREATE TABLE service_catalog_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(60) NOT NULL,   -- exterieur, interieur, complet, detail, deux-roues, utilitaire
  name VARCHAR(160) NOT NULL,
  price_cents BIGINT,              -- prix indicatif XOF
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE (category, name)
);
INSERT INTO service_catalog_templates (category, name, price_cents, sort_order) VALUES
 ('exterieur','Lavage extérieur simple',100000,0),
 ('exterieur','Lavage extérieur premium',150000,1),
 ('interieur','Aspiration intérieure',100000,2),
 ('interieur','Nettoyage des tapis',75000,3),
 ('interieur','Nettoyage des sièges',150000,4),
 ('complet','Lavage complet (extérieur + intérieur)',250000,5),
 ('detailing','Nettoyage approfondi',300000,6),
 ('detailing','Detailing & finition',500000,7),
 ('deux-roues','Lavage moto',50000,8),
 ('utilitaire','Lavage utilitaire',200000,9),
 ('utilitaire','Forfait flotte (par véhicule)',180000,10);
```

**Convention multi-tenant conservée** : le catalogue global (`service_catalog_templates`) est une table de référence sans `organization_id`. À la confirmation, les services choisis/devinés sont **copiés** dans `services` (table par org existante, migration 000002). Un service personnalisé « Autre service » est créé directement dans `services` de l'org — jamais dans le catalogue global (§5 du WORKFLOW).

## 3. Plan de migration

| Ordre | Action                                                                  | Fichiers                                                                   |
| ----- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1     | Corriger le setup de tests (`go get golang-migrate/migrate/v4`)         | `backend/go.mod`                                                           |
| 2     | Créer migration `000005_onboarding_plans` (up/down) + seed              | `backend/migrations/000005_onboarding_plans.{up,down}.sql`                 |
| 3     | Appliquer sur Neon, vérifier `\dt` et le seed                           | `psql`                                                                     |
| 4     | Modèles Go : `Worker`, `Plan`, `Subscription`, `OnboardingProgress`     | `backend/internal/models/onboarding.go`                                    |
| 5     | Stores : `worker_store`, `plan_store`, `onboarding_store`               | `backend/internal/stores/`                                                 |
| 6     | Handlers + routes `/api/v1/onboarding/*` (fichier dédié)                | `backend/cmd/server/onboarding_handlers.go`, `main.go` (routage seulement) |
| 7     | Frontend : `OnboardingGate` + routes gardées + pages auth Clerk         | `src/components/router/`, `src/app/auth/*`, `src/App.tsx`                  |
| 8     | Frontend : wizard `/onboarding` (4 étapes + récap + succès)             | `src/app/onboarding/`                                                      |
| 9     | Dashboard dynamique : nom station réelle, forfait, métriques existantes | `src/pages/dashboard/`, `src/components/dashboard-metrics.tsx`, sidebar    |
| 10    | Tests backend (Go) + build + lint frontend                              | `backend/cmd/server/`, `docs/PROGRESS.md`                                  |

## 4. API d'onboarding (contrats)

- `GET /api/v1/onboarding/status` → `{ state: "not_started"|"in_progress"|"completed", current_stage }` — auto-provisionne l'org si le claim `org_id` est connu de Clerk mais absent en base (création minimale + `onboarding_progress`).
- `GET /api/v1/onboarding/progress` → données de l'étape en cours.
- `PUT /api/v1/onboarding/progress` body `{ stage, data }` → valide le format de l'étape, sauvegarde, avance `current_stage`. Idempotent (réécriture d'une même étape).
- `GET /api/v1/onboarding/summary` → récap complet (station, services choisis, travailleurs, plan).
- `POST /api/v1/onboarding/confirm` → vérifie complétude (nom station + ville obligatoires ; ≥1 service ; plan choisi), puis **une transaction** :
  1. update `organizations` (coordonnées, slug unique, `onboarding_completed=true`),
  2. upsert `services` depuis la sélection,
  3. insert `workers`,
  4. upsert `subscriptions` (état `active` pour `free`, `pending` sinon — **jamais de paiement simulé**),
  5. `onboarding_progress.completed_at = NOW()`.
     Idempotence : si `completed_at` est déjà renseigné, renvoie le résumé existant sans re-créer (HTTP 200 au lieu de 201).
- Validation serveur systématique (nom, ville, téléphone format CI tolérant, rôles workers dans l'enum, plan existant et actif).

## 5. Frontend — arborescence nouvelle

```
src/app/onboarding/
  page.tsx                    # OnboardingGate + wizard (étape depuis /onboarding/status)
  components/
    onboarding-wizard.tsx     # Stepper (Progress shadcn), Précédent/Continuer/Enregistrer et quitter
    station-step.tsx          # Étape 1 — identité station
    services-step.tsx         # Étape 2 — catalogue standard + « Autre service »
    workers-step.tsx          # Étape 3 — travailleurs (0 autorisé)
    plan-step.tsx             # Étape 4 — forfaits depuis /api/v1/plans
    review-step.tsx           # Récapitulatif + « Confirmer et créer ma station »
    success-animation.tsx     # Animation après 201 serveur, puis redirect /dashboard
src/components/router/
  auth-layout.tsx             # <SignedIn><OnboardingGate>{children}</OnboardingGate></SignedIn>
```

Routes protégées : toutes les routes métier (dashboard, washes, caisse, etc.) passent par `auth-layout`. `/auth/sign-in` et `/sign-up` utilisent les composants Clerk (`SignIn`/`SignUp` avec `fallbackRedirectUrl="/dashboard"`), habillés du design existant.

## 6. Tests (Phase F)

- **Go** : réparation `go test ./...` ; tests des handlers onboarding : validation par étape, reprise, double `confirm` idempotent, refus d'accès avant complétion, isolation inter-org.
- **Frontend** : `tsc -b`, `eslint`, build ; vérification manuelle automatisée du parcours via navigateur headless (status → wizard → confirm → dashboard).
