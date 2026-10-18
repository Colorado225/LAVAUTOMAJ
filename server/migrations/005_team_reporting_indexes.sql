-- Tenant-scoped indexes for the team list and reporting date/status filters.
CREATE INDEX IF NOT EXISTS idx_workers_org_status_name
  ON workers (organization_id, status, first_name, last_name);

CREATE INDEX IF NOT EXISTS idx_payments_org_received_verified
  ON payments (organization_id, received_at DESC)
  WHERE status = 'verified';

CREATE INDEX IF NOT EXISTS idx_expenses_org_date_recorded
  ON expenses (organization_id, expense_date DESC)
  WHERE status = 'recorded';
