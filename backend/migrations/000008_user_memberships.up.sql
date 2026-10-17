-- A Clerk identity can belong to more than one organization. Internal users
-- therefore represent organization memberships, not global Clerk accounts.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_clerk_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_clerk_user_id
  ON users (organization_id, clerk_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_email
  ON users (organization_id, email)
  WHERE email IS NOT NULL;
