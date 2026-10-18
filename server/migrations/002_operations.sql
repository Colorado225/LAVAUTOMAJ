-- Tenant-scoped operational and financial tables.
CREATE TABLE IF NOT EXISTS cash_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  opening_amount_cents BIGINT NOT NULL DEFAULT 0 CHECK (opening_amount_cents >= 0),
  theoretical_balance_cents BIGINT NOT NULL DEFAULT 0,
  counted_amount_cents BIGINT,
  discrepancy_cents BIGINT,
  discrepancy_reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS counted_amount_cents BIGINT;
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS discrepancy_cents BIGINT;
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS discrepancy_reason TEXT;
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS closed_by_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_cash_sessions_org_site_status ON cash_sessions(organization_id, site_id, status);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cash_sessions WHERE status = 'open'
    GROUP BY organization_id, site_id HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_sessions_one_open_per_site
      ON cash_sessions(organization_id, site_id) WHERE status = 'open';
  ELSE
    RAISE WARNING 'Duplicate open cash sessions exist; the unique index was not created. Resolve duplicates without deleting financial history.';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cash_session_id UUID NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('entry', 'exit')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  source VARCHAR(50) NOT NULL,
  reference_id UUID,
  description TEXT,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS reference_id UUID;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_cash_movements_organization_id ON cash_movements(organization_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_session_created ON cash_movements(cash_session_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_movements_idempotency ON cash_movements(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS washes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  vehicle_category_id UUID REFERENCES vehicle_categories(id) ON DELETE SET NULL,
  reference VARCHAR(80) NOT NULL,
  total_cents BIGINT NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  status VARCHAR(30) NOT NULL DEFAULT 'completed',
  payment_status VARCHAR(30) NOT NULL DEFAULT 'unpaid',
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(255),
  idempotency_fingerprint CHAR(64),
  cancelled_at TIMESTAMPTZ,
  cancelled_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, reference)
);
ALTER TABLE washes ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
ALTER TABLE washes ADD COLUMN IF NOT EXISTS idempotency_fingerprint CHAR(64);
ALTER TABLE washes ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE washes ADD COLUMN IF NOT EXISTS cancelled_by_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE washes ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE washes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_washes_organization_created ON washes(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_washes_site_created ON washes(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_washes_status ON washes(organization_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_washes_org_idempotency
  ON washes(organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS wash_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wash_id UUID NOT NULL REFERENCES washes(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  service_name_snapshot VARCHAR(160) NOT NULL,
  price_cents_snapshot BIGINT NOT NULL CHECK (price_cents_snapshot >= 0),
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wash_items_wash_id ON wash_items(wash_id);

CREATE TABLE IF NOT EXISTS wash_worker_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wash_id UUID NOT NULL REFERENCES washes(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (wash_id, worker_id)
);
CREATE INDEX IF NOT EXISTS idx_wash_worker_assignments_worker_id ON wash_worker_assignments(worker_id);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  wash_id UUID REFERENCES washes(id) ON DELETE SET NULL,
  cash_session_id UUID REFERENCES cash_sessions(id) ON DELETE SET NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  method VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'verified',
  reference VARCHAR(100),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_org_created ON payments(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_wash_id ON payments(wash_id);
CREATE INDEX IF NOT EXISTS idx_payments_cash_session_id ON payments(cash_session_id);

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  category VARCHAR(100) NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  expense_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payment_method VARCHAR(50) NOT NULL,
  beneficiary VARCHAR(150),
  description TEXT,
  reference VARCHAR(100),
  status VARCHAR(30) NOT NULL DEFAULT 'recorded',
  cash_session_id UUID REFERENCES cash_sessions(id) ON DELETE SET NULL,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_org_date ON expenses(organization_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_site_status ON expenses(site_id, status);
