-- Drop the index first
DROP INDEX IF EXISTS idx_workers_organization_id;

-- Drop the workers table
DROP TABLE IF EXISTS workers;

-- Remove columns from organizations table
ALTER TABLE organizations
DROP COLUMN IF EXISTS address,
DROP COLUMN IF EXISTS phone,
DROP COLUMN IF EXISTS currency;