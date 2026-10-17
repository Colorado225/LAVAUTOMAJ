-- +migrate Up
CREATE TABLE vehicle_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vehicle_categories_organization_id ON vehicle_categories(organization_id);
CREATE UNIQUE INDEX idx_vehicle_categories_organization_name ON vehicle_categories(organization_id, name);

CREATE TABLE service_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_categories_organization_id ON service_categories(organization_id);
CREATE UNIQUE INDEX idx_service_categories_organization_name ON service_categories(organization_id, name);

CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    category_id UUID REFERENCES service_categories(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    price_cents BIGINT NOT NULL DEFAULT 0,
    duration_minutes INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_services_organization_id ON services(organization_id);
CREATE INDEX idx_services_category_id ON services(category_id);
CREATE INDEX idx_services_is_active ON services(is_active);
CREATE UNIQUE INDEX idx_services_organization_name ON services(organization_id, name);
