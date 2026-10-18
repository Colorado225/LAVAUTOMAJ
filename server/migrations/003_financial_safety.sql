-- Financial mutation idempotency and scalable wash reference allocation.
-- Existing financial rows remain untouched; only nullable keys and indexes are added.

ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
ALTER TABLE cash_sessions ADD COLUMN IF NOT EXISTS idempotency_fingerprint CHAR(64);
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS idempotency_fingerprint CHAR(64);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS idempotency_fingerprint CHAR(64);

-- Previous versions used a globally unique movement key. Tenant-scope the new
-- uniqueness rule so keys are isolated by organization, like wash keys.
DROP INDEX IF EXISTS idx_cash_movements_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_movements_org_idempotency
  ON cash_movements (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_sessions_org_idempotency
  ON cash_sessions (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_org_idempotency
  ON expenses (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cash_sessions_org_opened
  ON cash_sessions (organization_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_org_received
  ON payments (organization_id, received_at DESC);

-- Replaces per-wash COUNT(*) reference allocation with an atomic tenant/year
-- counter. The counter is initialized lazily from existing references.
CREATE TABLE IF NOT EXISTS wash_reference_counters (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference_year INT NOT NULL CHECK (reference_year BETWEEN 2000 AND 9999),
  next_number BIGINT NOT NULL CHECK (next_number > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, reference_year)
);
