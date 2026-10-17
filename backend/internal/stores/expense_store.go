package stores

import (
	"context"
	"washpilot-ci-backend/internal/models"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type ExpenseStore struct {
	DB *sqlx.DB
}

func NewExpenseStore(db *sqlx.DB) *ExpenseStore {
	return &ExpenseStore{DB: db}
}

func (s *ExpenseStore) Create(ctx context.Context, e *models.Expense) error {
	query := `INSERT INTO expenses (id, organization_id, site_id, category, amount_cents, expense_date, payment_method, beneficiary, description, author_id, reference, status, cash_session_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()) RETURNING id, created_at, updated_at`
	return s.DB.GetContext(ctx, e, query, e.ID, e.OrganizationID, e.SiteID, e.Category, e.AmountCents, e.ExpenseDate, e.PaymentMethod, e.Beneficiary, e.Description, e.AuthorID, e.Reference, e.Status, e.CashSessionID)
}

func (s *ExpenseStore) ListByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.Expense, error) {
	var items []models.Expense
	query := `SELECT * FROM expenses WHERE organization_id = $1 ORDER BY expense_date DESC`
	err := s.DB.SelectContext(ctx, &items, query, orgID)
	return items, err
}

func (s *ExpenseStore) Cancel(ctx context.Context, id uuid.UUID, orgID uuid.UUID) error {
	query := `UPDATE expenses SET status = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3 RETURNING updated_at`
	_, err := s.DB.ExecContext(ctx, query, models.ExpenseStatusCancelled, id, orgID)
	return err
}
