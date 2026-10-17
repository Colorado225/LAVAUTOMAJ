-- +migrate Down
DROP TABLE IF EXISTS service_catalog_templates;
DROP TABLE IF EXISTS onboarding_progress;
DROP TYPE IF EXISTS onboarding_stage;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS plans;
DROP TYPE IF EXISTS subscription_state;
DROP TYPE IF EXISTS billing_cycle;
DROP TABLE IF EXISTS workers;
DROP TYPE IF EXISTS worker_role;
DROP INDEX IF EXISTS idx_organizations_slug;
ALTER TABLE organizations
  DROP COLUMN IF EXISTS onboarding_completed,
  DROP COLUMN IF EXISTS slug,
  DROP COLUMN IF EXISTS logo_url,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS phone;
