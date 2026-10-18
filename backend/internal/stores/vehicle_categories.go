package stores

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"washpilot-ci-backend/internal/models"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type VehicleCategoryStore struct {
	DB *sqlx.DB
}

func NewVehicleCategoryStore(db *sqlx.DB) *VehicleCategoryStore {
	return &VehicleCategoryStore{DB: db}
}

func (s *VehicleCategoryStore) Create(ctx context.Context, c *models.VehicleCategory) error {
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" || len(c.Name) > 100 {
		return errors.New("vehicle category name must contain 1 to 100 characters")
	}
	query := `INSERT INTO vehicle_categories (id, organization_id, name, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id, created_at, updated_at`
	return s.DB.GetContext(ctx, c, query, c.ID, c.OrganizationID, c.Name, c.IsActive)
}

func (s *VehicleCategoryStore) ListByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.VehicleCategory, error) {
	var items []models.VehicleCategory
	query := `SELECT * FROM vehicle_categories WHERE organization_id = $1 ORDER BY name`
	err := s.DB.SelectContext(ctx, &items, query, orgID)
	return items, err
}

func (s *VehicleCategoryStore) GetByID(ctx context.Context, id, orgID uuid.UUID) (*models.VehicleCategory, error) {
	var c models.VehicleCategory
	query := `SELECT * FROM vehicle_categories WHERE id = $1 AND organization_id = $2`
	err := s.DB.GetContext(ctx, &c, query, id, orgID)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}

func (s *VehicleCategoryStore) Update(ctx context.Context, c *models.VehicleCategory) error {
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" || len(c.Name) > 100 {
		return errors.New("vehicle category name must contain 1 to 100 characters")
	}
	query := `UPDATE vehicle_categories SET name = $1, is_active = $2, updated_at = NOW() WHERE id = $3 AND organization_id = $4 RETURNING updated_at`
	return s.DB.GetContext(ctx, &c.UpdatedAt, query, c.Name, c.IsActive, c.ID, c.OrganizationID)
}

func (s *VehicleCategoryStore) Deactivate(ctx context.Context, id uuid.UUID, orgID uuid.UUID) error {
	query := `UPDATE vehicle_categories SET is_active = false, updated_at = NOW() WHERE id = $1 AND organization_id = $2`
	_, err := s.DB.ExecContext(ctx, query, id, orgID)
	return err
}
