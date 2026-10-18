-- Tenant-specific authorization belongs to organization_members, not users.role.
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';
