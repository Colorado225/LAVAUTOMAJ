-- +migrate Down
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM wash_worker_assignments)
       OR EXISTS (SELECT 1 FROM washes WHERE idempotency_fingerprint IS NOT NULL OR cancelled_at IS NOT NULL) THEN
        RAISE EXCEPTION 'cannot roll back wash workflow migration while wash history uses its new fields';
    END IF;
END $$;

DROP INDEX IF EXISTS idx_wash_worker_assignments_worker_id;
DROP TABLE IF EXISTS wash_worker_assignments;

ALTER TABLE washes
    DROP COLUMN IF EXISTS cancellation_reason,
    DROP COLUMN IF EXISTS cancelled_by_id,
    DROP COLUMN IF EXISTS cancelled_at,
    DROP COLUMN IF EXISTS idempotency_fingerprint;
