package stores

import (
	"context"
	"database/sql"
	"washpilot-ci-backend/internal/models"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type ServiceCategoryStore struct {
	DB *sqlx.DB
}

func NewServiceCategoryStore(db *sqlx.DB) *ServiceCategoryStore {
	return &ServiceCategoryStore{DB: db}
}

func (s *ServiceCategoryStore) Create(ctx context.Context, c *models.ServiceCategory) error {
	query := `INSERT INTO service_categories (id, organization_id, name, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id, created_at, updated_at`
	return s.DB.GetContext(ctx, c, query, c.ID, c.OrganizationID, c.Name, c.IsActive)
}

func (s *ServiceCategoryStore) ListByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.ServiceCategory, error) {
	var items []models.ServiceCategory
	query := `SELECT * FROM service_categories WHERE organization_id = $1 ORDER BY name`
	err := s.DB.SelectContext(ctx, &items, query, orgID)
	return items, err
}

func (s *ServiceCategoryStore) GetByID(ctx context.Context, id, orgID uuid.UUID) (*models.ServiceCategory, error) {
	var c models.ServiceCategory
	query := `SELECT * FROM service_categories WHERE id = $1 AND organization_id = $2`
	err := s.DB.GetContext(ctx, &c, query, id, orgID)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}

func (s *ServiceCategoryStore) Update(ctx context.Context, c *models.ServiceCategory) error {
	query := `UPDATE service_categories SET name = $1, is_active = $2, updated_at = NOW() WHERE id = $3 AND organization_id = $4 RETURNING updated_at`
	return s.DB.GetContext(ctx, &c.UpdatedAt, query, c.Name, c.IsActive, c.ID, c.OrganizationID)
}

func (s *ServiceCategoryStore) Deactivate(ctx context.Context, id uuid.UUID, orgID uuid.UUID) error {
	query := `UPDATE service_categories SET is_active = false, updated_at = NOW() WHERE id = $1 AND organization_id = $2`
	_, err := s.DB.ExecContext(ctx, query, id, orgID)
	return err
}
