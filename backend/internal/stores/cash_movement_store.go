package stores

import (
	"context"
	"washpilot-ci-backend/internal/models"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type CashMovementStore struct {
	DB *sqlx.DB
}

func NewCashMovementStore(db *sqlx.DB) *CashMovementStore {
	return &CashMovementStore{DB: db}
}

func (s *CashMovementStore) Create(ctx context.Context, cm *models.CashMovement) error {
	query := `INSERT INTO cash_movements (id, organization_id, cash_session_id, type, amount_cents, source, reference_id, description, author_id, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING id, created_at`
	return s.DB.GetContext(ctx, cm, query, cm.ID, cm.OrganizationID, cm.CashSessionID, cm.Type, cm.AmountCents, cm.Source, cm.ReferenceID, cm.Description, cm.AuthorID)
}

func (s *CashMovementStore) ListBySession(ctx context.Context, sessionID uuid.UUID) ([]models.CashMovement, error) {
	var items []models.CashMovement
	query := `SELECT * FROM cash_movements WHERE cash_session_id = $1 ORDER BY created_at DESC`
	err := s.DB.SelectContext(ctx, &items, query, sessionID)
	return items, err
}
