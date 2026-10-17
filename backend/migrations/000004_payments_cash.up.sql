-- +migrate Up
CREATE TYPE payment_method AS ENUM ('cash', 'orange_money', 'mtn_momo', 'moov_money', 'wave', 'other');
CREATE TYPE payment_status AS ENUM ('pending', 'verified', 'failed', 'refunded');
CREATE TYPE cash_session_status AS ENUM ('open', 'closed');
CREATE TYPE cash_movement_type AS ENUM ('entry', 'exit');
CREATE TYPE expense_status AS ENUM ('recorded', 'cancelled');

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    wash_id UUID REFERENCES washes(id) ON DELETE SET NULL,
    amount_cents BIGINT NOT NULL DEFAULT 0,
    method payment_method NOT NULL DEFAULT 'cash',
    status payment_status NOT NULL DEFAULT 'pending',
    reference VARCHAR(100),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    author_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_organization_id ON payments(organization_id);
CREATE INDEX idx_payments_wash_id ON payments(wash_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_method ON payments(method);
CREATE INDEX idx_payments_received_at ON payments(received_at);

CREATE TABLE cash_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    opening_amount_cents BIGINT NOT NULL DEFAULT 0,
    theoretical_balance_cents BIGINT NOT NULL DEFAULT 0,
    counted_amount_cents BIGINT,
    discrepancy_cents BIGINT,
    discrepancy_reason TEXT,
    status cash_session_status NOT NULL DEFAULT 'open',
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    closed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cash_sessions_organization_id ON cash_sessions(organization_id);
CREATE INDEX idx_cash_sessions_site_id ON cash_sessions(site_id);
CREATE INDEX idx_cash_sessions_status ON cash_sessions(status);
CREATE INDEX idx_cash_sessions_opened_at ON cash_sessions(opened_at);

CREATE TABLE cash_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    cash_session_id UUID NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
    type cash_movement_type NOT NULL,
    amount_cents BIGINT NOT NULL DEFAULT 0,
    source VARCHAR(50) NOT NULL,
    reference_id UUID,
    description TEXT,
    author_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cash_movements_organization_id ON cash_movements(organization_id);
CREATE INDEX idx_cash_movements_cash_session_id ON cash_movements(cash_session_id);
CREATE INDEX idx_cash_movements_type ON cash_movements(type);
CREATE INDEX idx_cash_movements_created_at ON cash_movements(created_at);

CREATE TABLE expense_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expense_categories_organization_id ON expense_categories(organization_id);
CREATE UNIQUE INDEX idx_expense_categories_organization_name ON expense_categories(organization_id, name);

CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
    category VARCHAR(100) NOT NULL,
    amount_cents BIGINT NOT NULL DEFAULT 0,
    expense_date DATE NOT NULL,
    payment_method payment_method NOT NULL DEFAULT 'cash',
    beneficiary VARCHAR(100),
    description TEXT,
    author_id UUID NOT NULL REFERENCES users(id),
    reference VARCHAR(100),
    status expense_status NOT NULL DEFAULT 'recorded',
    cash_session_id UUID REFERENCES cash_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expenses_organization_id ON expenses(organization_id);
CREATE INDEX idx_expenses_site_id ON expenses(site_id);
CREATE INDEX idx_expenses_category ON expenses(category);
CREATE INDEX idx_expenses_expense_date ON expenses(expense_date);
CREATE INDEX idx_expenses_status ON expenses(status);
CREATE INDEX idx_expenses_cash_session_id ON expenses(cash_session_id);
