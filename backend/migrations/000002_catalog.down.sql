-- +migrate Down
DROP INDEX IF EXISTS idx_services_organization_name;
DROP INDEX IF EXISTS idx_services_is_active;
DROP INDEX IF EXISTS idx_services_category_id;
DROP INDEX IF EXISTS idx_services_organization_id;
DROP TABLE IF EXISTS services;
DROP INDEX IF EXISTS idx_service_categories_organization_name;
DROP INDEX IF EXISTS idx_service_categories_organization_id;
DROP TABLE IF EXISTS service_categories;
DROP INDEX IF EXISTS idx_vehicle_categories_organization_name;
DROP INDEX IF EXISTS idx_vehicle_categories_organization_id;
DROP TABLE IF EXISTS vehicle_categories;
