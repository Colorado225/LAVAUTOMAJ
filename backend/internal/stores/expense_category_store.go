package stores

import (
	"context"
	"washpilot-ci-backend/internal/models"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type ExpenseCategoryStore struct {
	DB *sqlx.DB
}

func NewExpenseCategoryStore(db *sqlx.DB) *ExpenseCategoryStore {
	return &ExpenseCategoryStore{DB: db}
}

func (s *ExpenseCategoryStore) Create(ctx context.Context, ec *models.ExpenseCategory) error {
	query := `INSERT INTO expense_categories (id, organization_id, name, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id, created_at, updated_at`
	return s.DB.GetContext(ctx, ec, query, ec.ID, ec.OrganizationID, ec.Name, ec.IsActive)
}

func (s *ExpenseCategoryStore) ListByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.ExpenseCategory, error) {
	var items []models.ExpenseCategory
	query := `SELECT * FROM expense_categories WHERE organization_id = $1 ORDER BY name`
	err := s.DB.SelectContext(ctx, &items, query, orgID)
	return items, err
}
