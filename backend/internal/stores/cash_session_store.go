package stores

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

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

// Open validates the site and serializes concurrent opens by locking the site
// row. A site can have at most one open cash session at a time.
func (s *CashSessionStore) Open(ctx context.Context, cs *models.CashSession) error {
	if cs.OpeningAmountCents < 0 {
		return errors.New("opening amount cannot be negative")
	}
	cs.TheoreticalBalanceCents = cs.OpeningAmountCents

	tx, err := s.DB.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var lockedSiteID uuid.UUID
	err = tx.GetContext(ctx, &lockedSiteID,
		`SELECT id FROM sites WHERE id = $1 AND organization_id = $2 AND is_active = true FOR UPDATE`,
		cs.SiteID, cs.OrganizationID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrSiteNotFound
		}
		return err
	}

	var existingID uuid.UUID
	err = tx.GetContext(ctx, &existingID,
		`SELECT id FROM cash_sessions WHERE site_id = $1 AND organization_id = $2 AND status = $3 LIMIT 1`,
		cs.SiteID, cs.OrganizationID, models.CashSessionStatusOpen)
	if err == nil {
		return ErrOpenCashSessionExists
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	err = tx.GetContext(ctx, cs, `
		INSERT INTO cash_sessions (
			id, organization_id, site_id, user_id, opening_amount_cents,
			theoretical_balance_cents, status, opened_at, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
		RETURNING *`,
		cs.ID, cs.OrganizationID, cs.SiteID, cs.UserID,
		cs.OpeningAmountCents, cs.TheoreticalBalanceCents, cs.Status)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *CashSessionStore) GetByIDForOrganization(ctx context.Context, id, orgID uuid.UUID) (*models.CashSession, error) {
	var cs models.CashSession
	err := s.DB.GetContext(ctx, &cs,
		`SELECT * FROM cash_sessions WHERE id = $1 AND organization_id = $2`, id, orgID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &cs, nil
}

func (s *CashSessionStore) GetOpenBySite(ctx context.Context, orgID, siteID uuid.UUID) (*models.CashSession, error) {
	var cs models.CashSession
	err := s.DB.GetContext(ctx, &cs,
		`SELECT * FROM cash_sessions WHERE organization_id = $1 AND site_id = $2 AND status = $3 ORDER BY opened_at DESC LIMIT 1`,
		orgID, siteID, models.CashSessionStatusOpen)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
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

// Close locks the session, uses the latest ledger balance, and records the
// actor and any discrepancy atomically.
func (s *CashSessionStore) Close(ctx context.Context, id, orgID, actorID uuid.UUID, countedAmount int64, reason *string) (*models.CashSession, error) {
	if countedAmount < 0 {
		return nil, errors.New("counted amount cannot be negative")
	}

	tx, err := s.DB.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var cs models.CashSession
	err = tx.GetContext(ctx, &cs,
		`SELECT * FROM cash_sessions WHERE id = $1 AND organization_id = $2 FOR UPDATE`, id, orgID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrCashSessionNotFound
		}
		return nil, err
	}
	if cs.Status != models.CashSessionStatusOpen {
		return nil, ErrCashSessionNotOpen
	}

	discrepancy := countedAmount - cs.TheoreticalBalanceCents
	if discrepancy != 0 && (reason == nil || strings.TrimSpace(*reason) == "") {
		return nil, ErrDiscrepancyReasonRequired
	}

	now := time.Now()
	cs.CountedAmountCents = &countedAmount
	cs.DiscrepancyCents = &discrepancy
	cs.DiscrepancyReason = nil
	if discrepancy != 0 {
		cs.DiscrepancyReason = reason
	}
	cs.Status = models.CashSessionStatusClosed
	cs.ClosedAt = &now
	cs.ClosedByID = &actorID

	err = tx.GetContext(ctx, &cs, `
		UPDATE cash_sessions
		SET counted_amount_cents = $1,
			discrepancy_cents = $2,
			discrepancy_reason = $3,
			status = $4,
			closed_at = $5,
			closed_by_id = $6,
			updated_at = NOW()
		WHERE id = $7 AND organization_id = $8 AND status = $9
		RETURNING *`,
		cs.CountedAmountCents, cs.DiscrepancyCents, cs.DiscrepancyReason,
		cs.Status, cs.ClosedAt, cs.ClosedByID, cs.ID, cs.OrganizationID,
		models.CashSessionStatusOpen)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &cs, nil
}
