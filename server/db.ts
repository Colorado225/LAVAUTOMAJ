import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { env } from "./env.ts";
import { migrateLegacyPlatformAdmins, syncPlatformOperators } from "./console-auth.ts";
import { hashPassword } from "./auth.ts";

const { Pool } = pg;

export interface DbQueryResult<R = Record<string, unknown>> {
  rows: R[];
  rowCount: number;
  fields: unknown[];
  command: string;
  affectedRows?: number;
}

export interface DbClient {
  query: <R = Record<string, unknown>>(
    sqlOrConfig: string | { text?: string; sql?: string; values?: unknown[] },
    params?: unknown[],
  ) => Promise<DbQueryResult<R>>;
  release: () => void;
}

export interface DbPool {
  query: <R = Record<string, unknown>>(
    sqlOrConfig: string | { text?: string; sql?: string; values?: unknown[] },
    params?: unknown[],
  ) => Promise<DbQueryResult<R>>;
  connect: () => Promise<DbClient>;
  end: () => Promise<void>;
}

let pool: pg.Pool | null = null;
let pgliteInstance: PGlite | null = null;
let ready = false;

export function getPool(): pg.Pool | null {
  return pool;
}
export function isDatabaseReady(): boolean {
  return ready && pool !== null;
}

const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clerk_user_id text UNIQUE,
 organization_id uuid, email text NOT NULL, first_name text, last_name text, phone text,
 avatar_url text, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
 password_hash text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clerk_org_id text UNIQUE,
 name text NOT NULL, slug text, onboarding_completed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_admin boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL,
 max_users integer, max_workers integer, max_sites integer, features jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_cents integer NOT NULL DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_services integer;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
-- Migration du forfait d'entrée : « free » (0 F) devient « starter » (10 000 F),
-- pour coller à la grille publique. Le renommage se fait AVANT le seed, sinon
-- ON CONFLICT(code) insérerait un doublon en laissant « free » orphelin —
-- or les abonnements existants pointent dessus par plan_id. En renommant,
-- les abonnements en cours suivent sans la moindre réécriture.
UPDATE plans SET code='starter' WHERE code='free';
-- Chaque forfait est payant et ouvre un essai de 14 jours (voir
-- server/entitlements.ts). Prix en centimes : 10 000 F = 1 000 000.
INSERT INTO plans(code,name,description,price_cents,billing_cycle,max_users,max_workers,max_sites,max_services,sort_order,features) VALUES
 ('starter','Starter','Pour les petites stations qui veulent abandonner le cahier de caisse.',1000000,'monthly',2,3,1,10,1,'{"reports.advanced":false,"reports.export":false,"reports.consolidated":false,"audit.read":false,"sites.multiple":false}'::jsonb),
 ('pro','Pro','Pour les stations qui ont plusieurs laveurs et veulent mieux contrôler leurs opérations.',2000000,'monthly',10,20,1,NULL,2,'{"reports.advanced":true,"reports.export":true,"reports.consolidated":false,"audit.read":true,"sites.multiple":false}'::jsonb),
 ('business','Business','Pour les stations importantes ou les propriétaires qui gèrent plusieurs sites.',3500000,'monthly',NULL,NULL,NULL,NULL,3,'{"reports.advanced":true,"reports.export":true,"reports.consolidated":true,"audit.read":true,"sites.multiple":true}'::jsonb)
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
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_changed_at timestamptz;
UPDATE subscriptions SET plan_changed_at = created_at WHERE plan_changed_at IS NULL;
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
  ('exterior_wash','Lavage extérieur simple',200000,1),
  ('exterior_wash','Nettoyage jantes et pneus',100000,2),
  ('interior_cleaning','Aspiration habitacle',150000,3),
  ('complete_wash','Lavage intérieur et extérieur',400000,4),
  ('exterior_wash','Lavage haute pression',100000,5),
  ('exterior_wash','Mousse active',100000,6),
  ('exterior_wash','Nettoyage vitres',50000,7),
  ('exterior_wash','Séchage manuel',50000,8),
  ('exterior_wash','Lavage express',150000,9)
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
ALTER TABLE services ADD COLUMN IF NOT EXISTS price_by_vehicle_type jsonb NOT NULL DEFAULT '{}'::jsonb;
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
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS expense_id uuid REFERENCES expenses(id);
CREATE TABLE IF NOT EXISTS idempotency_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 key text NOT NULL, fingerprint text NOT NULL, response_status integer, response_body jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,key)
);
-- Désactivation d'un membre sans suppression du compte : ses requêtes
-- protégées sont refusées dès le middleware d'appartenance.
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id);

-- Exceptions de permissions accordées (ou retirées) par le propriétaire à un
-- membre précis : granted = false retire une permission venant du rôle.
CREATE TABLE IF NOT EXISTS member_permissions (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 user_id uuid NOT NULL REFERENCES users(id),
 permission text NOT NULL,
 granted boolean NOT NULL DEFAULT true,
 granted_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (organization_id, user_id, permission)
);
CREATE INDEX IF NOT EXISTS idx_member_permissions_user ON member_permissions(organization_id,user_id);

-- Relances d'échéance d'abonnement : une ligne par relance réellement envoyée,
-- ce qui garantit qu'une même station n'est jamais relancée deux fois.
CREATE TABLE IF NOT EXISTS subscription_reminders (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 kind text NOT NULL,
 sent_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (organization_id, kind)
);
-- Intentions de paiement d'abonnement.
--
-- Une ligne est creee des que le client declare vouloir payer, AVANT tout
-- encaissement. Elle sert de point de rendez-vous entre trois acteurs qui ne
-- se parlent pas : le client qui paie sur son telephone, l'agregateur qui
-- confirme par webhook, et l'editeur qui valide a la main quand il n'y a pas
-- d'agregateur.
--
-- La colonne reference est UNIQUE : c'est elle qui rend l'encaissement
-- idempotent. Un
-- webhook rejoue deux fois (retransmission reseau, chose courante ici) ne
-- doit jamais activer deux mois au lieu d'un.
CREATE TABLE IF NOT EXISTS payment_intents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 reference text NOT NULL UNIQUE,
 plan_code text NOT NULL,
 months integer NOT NULL DEFAULT 1,
 amount_cents integer NOT NULL,
 provider text NOT NULL DEFAULT 'manual',
 status text NOT NULL DEFAULT 'pending',
 provider_transaction_id text,
 declared_reference text,
 declared_at timestamptz,
 created_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS payment_intents_org_idx ON payment_intents(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_intents_status_idx ON payment_intents(status, created_at DESC);

-- Registre des encaissements d'abonnement : la seule source de verite du
-- chiffre d'affaires. Toute activation y ecrit une ligne, quel que soit son
-- chemin -- parcours client, saisie console, futur webhook -- parce que
-- 'activateSubscription()' est le point de passage unique.
--
-- Pourquoi une table a part plutot que 'payment_intents' : une intention est
-- une *demande de payer*, qui peut echouer ou rester en attente. Le registre
-- n'accueille que de l'argent recu. Les compter ensemble ferait apparaitre
-- dans le chiffre d'affaires des paiements jamais arrives.
--
-- 'organization_id' est volontairement sans cle etrangere et nullable :
-- l'ecriture comptable doit survivre a la suppression de la station, sinon
-- purger un client ferait disparaitre le chiffre d'affaires deja encaisse.
-- 'organization_name' en conserve une copie lisible.
CREATE TABLE IF NOT EXISTS subscription_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid,
 organization_name text NOT NULL,
 plan_code text NOT NULL,
 plan_name text NOT NULL,
 -- Negatif pour une annulation : on contrepasse, on ne supprime pas.
 amount_cents bigint NOT NULL,
 months integer NOT NULL,
 -- Periode couverte par l'encaissement : c'est elle qui permet d'etaler le
 -- revenu reconnu mois par mois, independamment de la date d'encaissement.
 period_start timestamptz NOT NULL,
 period_end timestamptz NOT NULL,
 channel text NOT NULL DEFAULT 'other',
 payment_reference text,
 payment_intent_id uuid,
 source text NOT NULL,
 operator_email text,
 actor_user_id uuid,
 note text,
 -- Contrepassation : 'reverses_id' pointe la ligne annulee.
 reverses_id uuid REFERENCES subscription_payments(id) ON DELETE SET NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_payments_when_idx ON subscription_payments(occurred_at DESC);
CREATE INDEX IF NOT EXISTS subscription_payments_org_idx ON subscription_payments(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS subscription_payments_period_idx ON subscription_payments(period_start, period_end);
-- Une ligne ne peut etre contrepassee qu'une fois.
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payments_reverses_idx
 ON subscription_payments(reverses_id) WHERE reverses_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Console de l'éditeur
--
-- Les comptes d'administration ne sont PAS des lignes de 'users'. C'était le
-- cas avant : un drapeau 'platform_admin' posé sur un compte de station. Ce
-- modèle liait l'administration du parc à l'exploitation d'un lavage — une
-- session de station ouvrait le back-office, et le compte de l'éditeur
-- traînait dans la liste des membres d'une organisation.
--
-- Deux tables séparées, donc, avec leurs propres sessions : aucune session de
-- station ne peut ouvrir la console, et aucune session de console ne peut
-- écrire dans une station par les routes ordinaires.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_operators (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL UNIQUE, password_hash text, full_name text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'active',
 last_login_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform_operator_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operator_id uuid NOT NULL REFERENCES platform_operators(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 last_used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_operator_sessions_op_idx ON platform_operator_sessions(operator_id);

-- Journal de la console. Distinct de 'audit_logs', qui appartient au client.
--
-- Les deux sont alimentés : le client doit voir chez lui qu'on a touché à son
-- forfait (pas de porte dérobée), et l'éditeur doit pouvoir relire ses propres
-- actions sans parcourir les journaux de trois cents stations. Celui-ci
-- survit à la purge d'une organisation : c'est la trace qu'elle a existé.
CREATE TABLE IF NOT EXISTS platform_audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operator_id uuid REFERENCES platform_operators(id) ON DELETE SET NULL,
 operator_email text NOT NULL, action text NOT NULL,
 organization_id uuid, organization_name text,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_audit_logs_created_idx ON platform_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS platform_audit_logs_org_idx ON platform_audit_logs(organization_id, created_at DESC);

-- Suppression en deux temps.
--
-- 'deletion_requested_at' coupe l'accès immédiatement ; l'effacement physique
-- n'a lieu qu'à 'deletion_scheduled_for'. Entre les deux, le client est
-- restaurable d'un clic. Une suppression décidée sur un malentendu — un
-- paiement cru perdu, un homonyme — reste rattrapable.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deletion_scheduled_for timestamptz;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deletion_reason text;
CREATE INDEX IF NOT EXISTS organizations_deletion_idx ON organizations(deletion_scheduled_for)
 WHERE deletion_scheduled_for IS NOT NULL;
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
CREATE INDEX IF NOT EXISTS idx_payments_org_status ON payments(organization_id,status);
CREATE INDEX IF NOT EXISTS idx_payments_wash ON payments(wash_id);
CREATE INDEX IF NOT EXISTS idx_wash_assignments_worker ON wash_assignments(worker_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON audit_logs(organization_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(cash_session_id);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_org_site ON cash_sessions(organization_id,site_id,status);
CREATE INDEX IF NOT EXISTS idx_wash_items_wash ON wash_items(wash_id);
-- Authentification maison (e-mail + mot de passe, sessions en base) ---------
DO $do$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'idx_users_email_lower non créé (e-mails en double existants)';
END $do$;
CREATE TABLE IF NOT EXISTS auth_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
-- Réinitialisation de mot de passe : seul le SHA-256 du jeton est stocké, ------
-- le jeton en clair ne vit que dans le lien envoyé par e-mail. ----------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 requested_ip text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON password_reset_tokens(expires_at);
`;

async function seedDemoData(
  queryFn: (sql: string, params?: unknown[]) => Promise<DbQueryResult<Record<string, unknown>>>,
) {
  const existingUser = await queryFn("SELECT id FROM users WHERE lower(email) = $1", ["demo@washpilot.ci"]);
  if (existingUser.rows && existingUser.rows.length > 0) return;

  const demoPasswordHash = await hashPassword("WashPilot2026!");

  const orgRes = await queryFn(
    `INSERT INTO organizations (name, slug, onboarding_completed)
     VALUES ('Station Cocody Riviera', 'station-cocody-riviera', true)
     RETURNING id`
  );
  const orgId = orgRes.rows[0].id;

  const userRes = await queryFn(
    `INSERT INTO users (email, first_name, last_name, phone, password_hash, status, organization_id)
     VALUES ('demo@washpilot.ci', 'Awa', 'Kouassi', '+225 07 01 02 03 04', $1, 'active', $2)
     RETURNING id`,
    [demoPasswordHash, orgId]
  );
  const userId = userRes.rows[0].id;

  await queryFn(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [orgId, userId]
  );

  // Trois comptes de démonstration supplémentaires, un par rôle, pour que la
  // gestion des accès soit testable immédiatement (même mot de passe).
  const demoTeam = [
    { email: "gerant@washpilot.ci", first: "Serge", last: "N'Guessan", phone: "+225 07 11 22 33 44", role: "manager" },
    { email: "caisse@washpilot.ci", first: "Fatou", last: "Diarra", phone: "+225 07 55 66 77 88", role: "cashier" },
    { email: "laveur@washpilot.ci", first: "Koffi", last: "Yao", phone: "+225 07 99 00 11 22", role: "washer" },
  ];
  for (const member of demoTeam) {
    const memberRes = await queryFn(
      `INSERT INTO users (email, first_name, last_name, phone, password_hash, status, organization_id)
       VALUES ($1, $2, $3, $4, $5, 'active', $6) RETURNING id`,
      [member.email, member.first, member.last, member.phone, demoPasswordHash, orgId]
    );
    await queryFn(
      `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)`,
      [orgId, memberRes.rows[0].id, member.role]
    );
  }

  // Démonstration : la station est sur le forfait Starter, en cours d'essai.
  // L'essai de 14 jours a démarré il y a 3 jours → il reste 11 jours, ce qui
  // rend le compte à rebours visible dès la première connexion.
  const freePlanRes = await queryFn("SELECT id FROM plans WHERE code = 'starter'");
  if (freePlanRes.rows.length > 0) {
    await queryFn(
      `INSERT INTO subscriptions (organization_id, plan_id, status, current_period_end)
       VALUES ($1, $2, 'trialing', NOW() + interval '11 days')`,
      [orgId, freePlanRes.rows[0].id]
    );
  }

  const siteRes = await queryFn(
    `INSERT INTO sites (organization_id, name, city, address, phone, is_active)
     VALUES ($1, 'Station Cocody Riviera', 'Abidjan', 'Boulevard de France, Cocody', '+225 27 22 44 55 66', true)
     RETURNING id`,
    [orgId]
  );
  const siteId = siteRes.rows[0].id;

  const berlineRes = await queryFn(
    `INSERT INTO vehicle_categories (organization_id, name, is_active) VALUES ($1, 'Berline', true) RETURNING id`,
    [orgId]
  );
  const suvRes = await queryFn(
    `INSERT INTO vehicle_categories (organization_id, name, is_active) VALUES ($1, 'SUV / 4x4', true) RETURNING id`,
    [orgId]
  );
  await queryFn(
    `INSERT INTO vehicle_categories (organization_id, name, is_active) VALUES ($1, 'Moto', true) RETURNING id`,
    [orgId]
  );

  const catLavage = await queryFn(
    `INSERT INTO service_categories (organization_id, name, is_active) VALUES ($1, 'Lavage classique', true) RETURNING id`,
    [orgId]
  );
  const catDetailing = await queryFn(
    `INSERT INTO service_categories (organization_id, name, is_active) VALUES ($1, 'Detailing & Soins', true) RETURNING id`,
    [orgId]
  );

  await queryFn(
    `INSERT INTO services (organization_id, category_id, name, description, price_cents, duration_minutes, is_active)
     VALUES ($1, $2, 'Lavage Extérieur Rapide', 'Lavage haute pression, mousse active et séchage microfibre.', 300000, 20, true)
     RETURNING id`,
    [orgId, catLavage.rows[0].id]
  );
  const s2 = await queryFn(
    `INSERT INTO services (organization_id, category_id, name, description, price_cents, duration_minutes, is_active)
     VALUES ($1, $2, 'Lavage Complet Intérieur + Extérieur', 'Aspiration intégrale, plastiques, vitres et carrosserie éclatante.', 600000, 45, true)
     RETURNING id`,
    [orgId, catLavage.rows[0].id]
  );
  const s3 = await queryFn(
    `INSERT INTO services (organization_id, category_id, name, description, price_cents, duration_minutes, is_active)
     VALUES ($1, $2, 'Formule VIP Prestige', 'Lavage minutieux, cire protectrice, shampoing sièges et parfum habitacle.', 1200000, 75, true)
     RETURNING id`,
    [orgId, catDetailing.rows[0].id]
  );
  await queryFn(
    `INSERT INTO services (organization_id, category_id, name, description, price_cents, duration_minutes, is_active)
     VALUES ($1, $2, 'Lustrage & Brillance Carrosserie', 'Décontamination et lustrage haute brillance.', 2500000, 120, true)
     RETURNING id`,
    [orgId, catDetailing.rows[0].id]
  );
  await queryFn(
    `INSERT INTO services (organization_id, category_id, name, description, price_cents, duration_minutes, is_active)
     VALUES ($1, $2, 'Lavage Deux-Roues', 'Nettoyage complet moto / scooter avec dégraissage jantes.', 200000, 20, true)
     RETURNING id`,
    [orgId, catLavage.rows[0].id]
  );

  const w1 = await queryFn(
    `INSERT INTO workers (organization_id, site_id, first_name, last_name, phone, role, status, district)
     VALUES ($1, $2, 'Jean-Marc', 'Koffi', '+225 07 10 20 30 40', 'car_washer', 'active', 'Cocody')
     RETURNING id`,
    [orgId, siteId]
  );
  const w2 = await queryFn(
    `INSERT INTO workers (organization_id, site_id, first_name, last_name, phone, role, status, district)
     VALUES ($1, $2, 'Ibrahim', 'Touré', '+225 05 20 30 40 50', 'versatile_washer', 'active', 'Plateau Dokui')
     RETURNING id`,
    [orgId, siteId]
  );
  await queryFn(
    `INSERT INTO workers (organization_id, site_id, first_name, last_name, phone, role, status, district)
     VALUES ($1, $2, 'Fatou', 'Cissé', '+225 01 30 40 50 60', 'team_lead', 'active', 'Riviera Palmeraie')
     RETURNING id`,
    [orgId, siteId]
  );

  const cashSessionRes = await queryFn(
    `INSERT INTO cash_sessions (organization_id, site_id, opened_by, opening_amount_cents, status)
     VALUES ($1, $2, $3, 2500000, 'open')
     RETURNING id`,
    [orgId, siteId, userId]
  );
  const cashSessionId = cashSessionRes.rows[0].id;

  const wash1 = await queryFn(
    `INSERT INTO washes (organization_id, site_id, vehicle_category_id, reference, status, total_cents, payment_status, payment_method, created_by)
     VALUES ($1, $2, $3, 'LAV-2026-0001', 'completed', 600000, 'paid', 'cash', $4)
     RETURNING id`,
    [orgId, siteId, berlineRes.rows[0].id, userId]
  );
  await queryFn(
    `INSERT INTO wash_items (wash_id, service_id, service_name, quantity, unit_price_cents, line_total_cents)
     VALUES ($1, $2, 'Lavage Complet Intérieur + Extérieur', 1, 600000, 600000)`,
    [wash1.rows[0].id, s2.rows[0].id]
  );
  await queryFn(
    `INSERT INTO wash_assignments (wash_id, worker_id) VALUES ($1, $2)`,
    [wash1.rows[0].id, w1.rows[0].id]
  );
  await queryFn(
    `INSERT INTO payments (organization_id, wash_id, method, amount_cents, status)
     VALUES ($1, $2, 'cash', 600000, 'verified')`,
    [orgId, wash1.rows[0].id]
  );
  await queryFn(
    `INSERT INTO cash_movements (organization_id, cash_session_id, type, amount_cents, source, description, wash_id, created_by)
     VALUES ($1, $2, 'entry', 600000, 'wash_payment', 'Encaissement lavage LAV-2026-0001', $3, $4)`,
    [orgId, cashSessionId, wash1.rows[0].id, userId]
  );

  const wash2 = await queryFn(
    `INSERT INTO washes (organization_id, site_id, vehicle_category_id, reference, status, total_cents, payment_status, payment_method, created_by)
     VALUES ($1, $2, $3, 'LAV-2026-0002', 'completed', 1200000, 'paid', 'wave', $4)
     RETURNING id`,
    [orgId, siteId, suvRes.rows[0].id, userId]
  );
  await queryFn(
    `INSERT INTO wash_items (wash_id, service_id, service_name, quantity, unit_price_cents, line_total_cents)
     VALUES ($1, $2, 'Formule VIP Prestige', 1, 1200000, 1200000)`,
    [wash2.rows[0].id, s3.rows[0].id]
  );
  await queryFn(
    `INSERT INTO wash_assignments (wash_id, worker_id) VALUES ($1, $2), ($1, $3)`,
    [wash2.rows[0].id, w1.rows[0].id, w2.rows[0].id]
  );
  await queryFn(
    `INSERT INTO payments (organization_id, wash_id, method, amount_cents, status)
     VALUES ($1, $2, 'wave', 1200000, 'verified')`,
    [orgId, wash2.rows[0].id]
  );

  await queryFn(
    `INSERT INTO onboarding_progress (organization_id, current_stage, completed_at, plan_code)
     VALUES ($1, 'completed', NOW(), 'starter')
     ON CONFLICT (organization_id) DO UPDATE SET current_stage = 'completed', completed_at = NOW()`,
    [orgId]
  );
}

function createPglitePool(pglite: PGlite): pg.Pool {
  let transactionLock: Promise<void> = Promise.resolve();

  const runQuery = async <R = Record<string, unknown>>(
    sqlOrConfig: string | { text?: string; sql?: string; values?: unknown[] },
    params?: unknown[],
  ): Promise<DbQueryResult<R>> => {
    let sql: string;
    let values: unknown[] | undefined = params;
    if (typeof sqlOrConfig === "string") {
      sql = sqlOrConfig;
    } else if (sqlOrConfig && typeof sqlOrConfig === "object") {
      sql = sqlOrConfig.text || sqlOrConfig.sql || "";
      values = sqlOrConfig.values || params;
    } else {
      sql = String(sqlOrConfig);
    }

    if (!values || values.length === 0) {
      const trimmed = sql.trim();
      const statements = trimmed.split(";").map((s) => s.trim()).filter(Boolean);
      if (statements.length > 1) {
        await pglite.exec(sql);
        return { rows: [] as R[], rowCount: 0, fields: [], command: "EXEC" };
      }
    }

    const res = await pglite.query(sql, values);
    return {
      rows: (res.rows || []) as R[],
      rowCount: res.rowCount ?? (res.rows ? res.rows.length : 0),
      fields: res.fields || [],
      command: res.command || "SELECT",
      affectedRows: res.affectedRows,
    };
  };

  return {
    async query<R = Record<string, unknown>>(
      sqlOrConfig: string | { text?: string; sql?: string; values?: unknown[] },
      params?: unknown[],
    ) {
      return runQuery<R>(sqlOrConfig, params);
    },
    async connect() {
      let releaseLock: () => void = () => {};
      const prevLock = transactionLock;
      transactionLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      await prevLock;

      let released = false;
      const client: DbClient = {
        async query<R = Record<string, unknown>>(
          sqlOrConfig: string | { text?: string; sql?: string; values?: unknown[] },
          params?: unknown[],
        ) {
          return runQuery<R>(sqlOrConfig, params);
        },
        release() {
          if (!released) {
            released = true;
            releaseLock();
          }
        },
      };
      return client;
    },
    async end() {
      await pglite.close();
    },
  } as unknown as pg.Pool;
}



// ---------------------------------------------------------------------------
// Verse au registre les activations anterieures a son existence.
//
// Avant la table subscription_payments, une activation ne laissait qu'une
// ligne d'audit chez le client, le montant enfoui dans du JSON. Sans ce
// rattrapage la courbe de revenu demarrerait a zero le jour de la mise a
// jour, et tout l'historique deja encaisse serait invisible.
//
// Idempotent : la cle est le couple (station, instant). Relancer au
// demarrage est sans effet.
// ---------------------------------------------------------------------------
async function backfillRevenueLedger(
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>,
): Promise<void> {
  const inserted = await query(
    `INSERT INTO subscription_payments(
       organization_id, organization_name, plan_code, plan_name, amount_cents, months,
       period_start, period_end, channel, payment_reference, source, note, occurred_at)
     SELECT a.organization_id,
            COALESCE(o.name, 'Station supprimee'),
            COALESCE(a.metadata->>'plan_code', 'inconnu'),
            COALESCE(a.metadata->>'plan_name', 'Forfait'),
            COALESCE((a.metadata->>'price_cents')::bigint, 0)
              * COALESCE((a.metadata->>'months')::int, 1),
            COALESCE((a.metadata->>'months')::int, 1),
            COALESCE((a.metadata->>'period_end')::timestamptz, a.created_at)
              - (COALESCE((a.metadata->>'months')::int, 1) || ' months')::interval,
            COALESCE((a.metadata->>'period_end')::timestamptz, a.created_at),
            'other',
            a.metadata->>'payment_reference',
            'backfill',
            'Reprise automatique depuis le journal d audit',
            a.created_at
       FROM audit_logs a
       LEFT JOIN organizations o ON o.id = a.organization_id
      WHERE a.action = 'subscription.activated'
        AND a.organization_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM subscription_payments sp
           WHERE sp.organization_id = a.organization_id
             AND sp.occurred_at = a.created_at)
     RETURNING id`,
  )
  const n = inserted.rowCount ?? 0
  if (n) console.log(`[revenu] ${n} encaissement(s) repris depuis le journal d'audit.`)
}

export async function initDatabaseSchema(): Promise<boolean> {
  if (env.DATABASE_URL) {
    try {
      const externalPool = new Pool({
        connectionString: env.DATABASE_URL,
        max: env.PG_POOL_MAX,
        ssl: /localhost|127\.0\.0\.1/.test(env.DATABASE_URL)
          ? false
          : { rejectUnauthorized: true },
        connectionTimeoutMillis: 8000,
        idleTimeoutMillis: 30000,
      });
      await externalPool.query("SELECT 1");
      await externalPool.query(schemaSql);
      await migrateLegacyPlatformAdmins(externalPool.query.bind(externalPool));
      await syncPlatformOperators(externalPool.query.bind(externalPool));
      await backfillRevenueLedger(externalPool.query.bind(externalPool));
      pool = externalPool;
      ready = true;
      console.info("[db] Connecté à PostgreSQL via DATABASE_URL");
      return true;
    } catch (error) {
      console.warn(
        "[db] Connexion DATABASE_URL échouée, basculement sur PostgreSQL embarqué (PGlite):",
        error instanceof Error ? error.message : "unknown",
      );
    }
  }

  try {
    pgliteInstance = new PGlite();
    pool = createPglitePool(pgliteInstance);
    await pool.query(schemaSql);
    await seedDemoData(pool.query.bind(pool));
    await migrateLegacyPlatformAdmins(pool.query.bind(pool));
    await syncPlatformOperators(pool.query.bind(pool));
    await backfillRevenueLedger(pool.query.bind(pool));
    ready = true;
    console.info("[db] PostgreSQL embarqué (PGlite) initialisé avec les données de démonstration");
    return true;
  } catch (error) {
    ready = false;
    console.error(
      "[db] Initialisation de la base de données échouée:",
      error instanceof Error ? error.message : "unknown",
    );
    if (env.NODE_ENV === "production" && env.DATABASE_URL) throw error;
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  ready = false;
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}
