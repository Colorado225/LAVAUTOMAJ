-- Link cash payments to the open drawer session that received the money.
ALTER TABLE payments
  ADD COLUMN cash_session_id UUID REFERENCES cash_sessions(id) ON DELETE SET NULL;

CREATE INDEX idx_payments_cash_session_id ON payments(cash_session_id);
