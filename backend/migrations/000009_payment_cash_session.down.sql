DROP INDEX IF EXISTS idx_payments_cash_session_id;
ALTER TABLE payments DROP COLUMN IF EXISTS cash_session_id;
