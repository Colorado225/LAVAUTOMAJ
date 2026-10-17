package stores

import (
	"context"
	"database/sql"
	"washpilot-ci-backend/internal/models"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type CashSessionStore struct {
	DB *sqlx.DB
}

func NewCashSessionStore(db *sqlx.DB) *CashSessionStore {
	return &CashSessionStore{DB: db}
}

func (s *CashSessionStore) Create(ctx context.Context, cs *models.CashSession) error {
	query := `INSERT INTO cash_sessions (id, organization_id, site_id, user_id, opening_amount_cents, theoretical_balance_cents, status, opened_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW()) RETURNING id, opened_at, created_at, updated_at`
	return s.DB.GetContext(ctx, cs, query, cs.ID, cs.OrganizationID, cs.SiteID, cs.UserID, cs.OpeningAmountCents, cs.TheoreticalBalanceCents, cs.Status)
}

func (s *CashSessionStore) GetByID(ctx context.Context, id uuid.UUID) (*models.CashSession, error) {
	var cs models.CashSession
	query := `SELECT * FROM cash_sessions WHERE id = $1`
	err := s.DB.GetContext(ctx, &cs, query, id)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &cs, nil
}

func (s *CashSessionStore) GetOpenBySite(ctx context.Context, siteID uuid.UUID) (*models.CashSession, error) {
	var cs models.CashSession
	query := `SELECT * FROM cash_sessions WHERE site_id = $1 AND status = $2 ORDER BY opened_at DESC LIMIT 1`
	err := s.DB.GetContext(ctx, &cs, query, siteID, models.CashSessionStatusOpen)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &cs, nil
}

func (s *CashSessionStore) ListByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.CashSession, error) {
	var items []models.CashSession
	query := `SELECT * FROM cash_sessions WHERE organization_id = $1 ORDER BY opened_at DESC`
	err := s.DB.SelectContext(ctx, &items, query, orgID)
	return items, err
}

func (s *CashSessionStore) Update(ctx context.Context, cs *models.CashSession) error {
	query := `UPDATE cash_sessions SET theoretical_balance_cents = $1, counted_amount_cents = $2, discrepancy_cents = $3, discrepancy_reason = $4, status = $5, closed_at = $6, closed_by_id = $7, updated_at = NOW() WHERE id = $8 AND organization_id = $9 RETURNING updated_at`
	args := []interface{}{cs.TheoreticalBalanceCents, cs.CountedAmountCents, cs.DiscrepancyCents, cs.DiscrepancyReason, cs.Status, cs.ClosedAt, cs.ClosedByID, cs.ID, cs.OrganizationID}
	return s.DB.GetContext(ctx, &cs.UpdatedAt, query, args...)
}
