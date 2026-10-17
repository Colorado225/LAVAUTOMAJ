-- +migrate Up
CREATE TYPE wash_status AS ENUM ('pending', 'completed', 'cancelled');
CREATE TYPE wash_payment_status AS ENUM ('unpaid', 'paid', 'partial', 'refunded');

CREATE TABLE sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    commune VARCHAR(100),
    phone VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sites_organization_id ON sites(organization_id);
CREATE UNIQUE INDEX idx_sites_organization_name ON sites(organization_id, name);

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customers_organization_id ON customers(organization_id);

CREATE TABLE washes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    vehicle_category_id UUID REFERENCES vehicle_categories(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    reference VARCHAR(50) UNIQUE NOT NULL,
    total_cents BIGINT NOT NULL DEFAULT 0,
    status wash_status NOT NULL DEFAULT 'completed',
    payment_status wash_payment_status NOT NULL DEFAULT 'unpaid',
    author_id UUID NOT NULL REFERENCES users(id),
    idempotency_key VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_washes_organization_id ON washes(organization_id);
CREATE INDEX idx_washes_site_id ON washes(site_id);
CREATE INDEX idx_washes_reference ON washes(reference);
CREATE INDEX idx_washes_status ON washes(status);
CREATE INDEX idx_washes_created_at ON washes(created_at);
CREATE UNIQUE INDEX idx_washes_idempotency_key ON washes(idempotency_key);

CREATE TABLE wash_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wash_id UUID NOT NULL REFERENCES washes(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    service_name_snapshot VARCHAR(100) NOT NULL,
    price_cents_snapshot BIGINT NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wash_items_wash_id ON wash_items(wash_id);
CREATE INDEX idx_wash_items_service_id ON wash_items(service_id);

CREATE TABLE wash_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wash_id UUID NOT NULL REFERENCES washes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wash_assignments_wash_id ON wash_assignments(wash_id);
CREATE INDEX idx_wash_assignments_user_id ON wash_assignments(user_id);
CREATE UNIQUE INDEX idx_wash_assignments_wash_user ON wash_assignments(wash_id, user_id);
