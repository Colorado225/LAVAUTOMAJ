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

type CashMovementStore struct {
	DB *sqlx.DB
}

func NewCashMovementStore(db *sqlx.DB) *CashMovementStore {
	return &CashMovementStore{DB: db}
}

// Create writes the movement and updates the session's theoretical balance in
// one transaction. It also guarantees that the session is open and belongs to
// the same organization as the movement.
func (s *CashMovementStore) Create(ctx context.Context, cm *models.CashMovement) error {
	if cm.AmountCents <= 0 {
		return errors.New("cash movement amount must be positive")
	}
	if cm.Type != models.CashMovementTypeEntry && cm.Type != models.CashMovementTypeExit {
		return errors.New("invalid cash movement type")
	}
	if strings.TrimSpace(cm.Source) == "" || len(cm.Source) > 50 {
		return errors.New("cash movement source must contain between 1 and 50 characters")
	}

	tx, err := s.DB.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var session models.CashSession
	err = tx.GetContext(ctx, &session, `
		SELECT * FROM cash_sessions
		WHERE id = $1 AND organization_id = $2 AND status = $3
		FOR UPDATE`,
		cm.CashSessionID, cm.OrganizationID, models.CashSessionStatusOpen)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrCashSessionNotOpen
		}
		return err
	}

	newBalance := session.TheoreticalBalanceCents
	if cm.Type == models.CashMovementTypeExit {
		if newBalance < cm.AmountCents {
			return ErrInsufficientCash
		}
		newBalance -= cm.AmountCents
	} else {
		if newBalance > maxCashBalanceCents-cm.AmountCents {
			return ErrCashBalanceOverflow
		}
		newBalance += cm.AmountCents
	}

	err = tx.GetContext(ctx, cm, `
		INSERT INTO cash_movements (
			id, organization_id, cash_session_id, type, amount_cents,
			source, reference_id, description, author_id, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
		RETURNING *`,
		cm.ID, cm.OrganizationID, cm.CashSessionID, cm.Type, cm.AmountCents,
		cm.Source, cm.ReferenceID, cm.Description, cm.AuthorID)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE cash_sessions
		SET theoretical_balance_cents = $1, updated_at = NOW()
		WHERE id = $2 AND organization_id = $3 AND status = $4`,
		newBalance, cm.CashSessionID, cm.OrganizationID, models.CashSessionStatusOpen)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *CashMovementStore) ListBySession(ctx context.Context, sessionID, orgID uuid.UUID) ([]models.CashMovement, error) {
	var items []models.CashMovement
	query := `SELECT * FROM cash_movements WHERE cash_session_id = $1 AND organization_id = $2 ORDER BY created_at DESC`
	err := s.DB.SelectContext(ctx, &items, query, sessionID, orgID)
	return items, err
}
