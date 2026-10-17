package stores

import (
	"context"
	"washpilot-ci-backend/internal/models"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type PaymentStore struct {
	DB *sqlx.DB
}

func NewPaymentStore(db *sqlx.DB) *PaymentStore {
	return &PaymentStore{DB: db}
}

func (s *PaymentStore) Create(ctx context.Context, p *models.Payment) error {
	query := `INSERT INTO payments (id, organization_id, wash_id, amount_cents, method, status, reference, received_at, author_id, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING id, created_at`
	return s.DB.GetContext(ctx, p, query, p.ID, p.OrganizationID, p.WashID, p.AmountCents, p.Method, p.Status, p.Reference, p.ReceivedAt, p.AuthorID)
}

func (s *PaymentStore) ListByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.Payment, error) {
	var items []models.Payment
	query := `SELECT * FROM payments WHERE organization_id = $1 ORDER BY received_at DESC`
	err := s.DB.SelectContext(ctx, &items, query, orgID)
	return items, err
}
