package stores

import (
	"context"
	"washpilot-ci-backend/internal/models"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type OrderStore interface {
	ListByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.Order, error)
}

type DBOrderStore struct {
	db *sqlx.DB
}

func NewDBOrderStore(db *sqlx.DB) *DBOrderStore {
	return &DBOrderStore{db: db}
}

func (s *DBOrderStore) ListByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.Order, error) {
	var orders []models.Order
	err := s.db.SelectContext(ctx, &orders, "SELECT * FROM orders WHERE organization_id = $1 ORDER BY created_at DESC", orgID)
	if err != nil {
		return nil, err
	}
	return orders, nil
}
