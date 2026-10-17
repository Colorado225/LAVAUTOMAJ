-- +migrate Up
-- Complete wash records with worker assignments and explicit cancellation audit.
CREATE TABLE wash_worker_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wash_id UUID NOT NULL REFERENCES washes(id) ON DELETE CASCADE,
    worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT wash_worker_assignments_wash_worker_key UNIQUE (wash_id, worker_id)
);

CREATE INDEX idx_wash_worker_assignments_worker_id ON wash_worker_assignments(worker_id);

-- Give existing organizations a usable starter set without overwriting any
-- categories they have already configured.
INSERT INTO vehicle_categories (organization_id, name)
SELECT org.id, category.name
FROM organizations org
CROSS JOIN (VALUES ('Voiture'), ('Moto'), ('Utilitaire')) AS category(name)
ON CONFLICT (organization_id, name) DO NOTHING;

ALTER TABLE washes
    ADD COLUMN idempotency_fingerprint CHAR(64),
    ADD COLUMN cancelled_at TIMESTAMPTZ,
    ADD COLUMN cancelled_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN cancellation_reason TEXT;
