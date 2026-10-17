package stores

import (
	"context"
	"database/sql"
	"washpilot-ci-backend/internal/models"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type ServiceStore struct {
	DB *sqlx.DB
}

func NewServiceStore(db *sqlx.DB) *ServiceStore {
	return &ServiceStore{DB: db}
}

func (s *ServiceStore) Create(ctx context.Context, svc *models.Service) error {
	query := `INSERT INTO services (id, organization_id, category_id, name, price_cents, duration_minutes, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING id, created_at, updated_at`
	return s.DB.GetContext(ctx, svc, query, svc.ID, svc.OrganizationID, svc.CategoryID, svc.Name, svc.PriceCents, svc.DurationMinutes, svc.IsActive)
}

func (s *ServiceStore) ListByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.Service, error) {
	var items []models.Service
	query := `SELECT * FROM services WHERE organization_id = $1 ORDER BY name`
	err := s.DB.SelectContext(ctx, &items, query, orgID)
	return items, err
}

func (s *ServiceStore) GetByID(ctx context.Context, id uuid.UUID) (*models.Service, error) {
	var svc models.Service
	query := `SELECT * FROM services WHERE id = $1`
	err := s.DB.GetContext(ctx, &svc, query, id)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &svc, nil
}

func (s *ServiceStore) Update(ctx context.Context, svc *models.Service) error {
	query := `UPDATE services SET category_id = $1, name = $2, price_cents = $3, duration_minutes = $4, is_active = $5, updated_at = NOW() WHERE id = $6 AND organization_id = $7 RETURNING updated_at`
	return s.DB.GetContext(ctx, &svc.UpdatedAt, query, svc.CategoryID, svc.Name, svc.PriceCents, svc.DurationMinutes, svc.IsActive, svc.ID, svc.OrganizationID)
}

func (s *ServiceStore) Deactivate(ctx context.Context, id uuid.UUID, orgID uuid.UUID) error {
	query := `UPDATE services SET is_active = false, updated_at = NOW() WHERE id = $1 AND organization_id = $2`
	_, err := s.DB.ExecContext(ctx, query, id, orgID)
	return err
}
