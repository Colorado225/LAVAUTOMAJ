DROP INDEX IF EXISTS idx_users_org_email;
DROP INDEX IF EXISTS idx_users_org_clerk_user_id;

-- The legacy global constraints can only be restored when the data still
-- satisfies them (for example, no null emails or cross-org memberships).
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE users ADD CONSTRAINT users_clerk_user_id_key UNIQUE (clerk_user_id);
