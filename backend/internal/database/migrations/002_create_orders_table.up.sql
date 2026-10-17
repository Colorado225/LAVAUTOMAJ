CREATE TYPE order_status AS ENUM ('pending', 'completed', 'cancelled');

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    amount INT NOT NULL, -- in cents to avoid floating point issues
    status order_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create an index on organization_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_organization_id ON orders(organization_id);

-- Create an index on status for filtering
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);