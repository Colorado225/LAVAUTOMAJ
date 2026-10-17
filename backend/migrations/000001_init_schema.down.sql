-- +migrate Down
DROP INDEX IF EXISTS idx_users_organization_id;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS organizations;
DROP TYPE IF EXISTS user_status;
DROP TYPE IF EXISTS user_role;