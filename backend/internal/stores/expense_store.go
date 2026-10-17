package stores

import (
	"context"
	"database/sql"
	"errors"

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

// Create records an expense and, for a cash payment, its corresponding cash
// outflow and balance update atomically.
func (s *ExpenseStore) Create(ctx context.Context, e *models.Expense) error {
	if e.AmountCents <= 0 {
		return errors.New("expense amount must be positive")
	}
	if e.PaymentMethod == models.PaymentMethodCash && e.CashSessionID == nil {
		return ErrCashSessionRequired
	}
	if e.PaymentMethod != models.PaymentMethodCash && e.CashSessionID != nil {
		return errors.New("only cash expenses can be linked to a cash session")
	}

	tx, err := s.DB.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if e.SiteID != nil {
		var siteID uuid.UUID
		err = tx.GetContext(ctx, &siteID,
			`SELECT id FROM sites WHERE id = $1 AND organization_id = $2 AND is_active = true FOR SHARE`,
			*e.SiteID, e.OrganizationID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrSiteNotFound
			}
			return err
		}
	}

	var session *models.CashSession
	if e.CashSessionID != nil {
		var cs models.CashSession
		err = tx.GetContext(ctx, &cs, `
			SELECT * FROM cash_sessions
			WHERE id = $1 AND organization_id = $2 AND status = $3
			FOR UPDATE`,
			*e.CashSessionID, e.OrganizationID, models.CashSessionStatusOpen)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrCashSessionNotOpen
			}
			return err
		}

		var sessionSiteOrgID uuid.UUID
		err = tx.GetContext(ctx, &sessionSiteOrgID,
			`SELECT organization_id FROM sites WHERE id = $1`, cs.SiteID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrSiteNotFound
			}
			return err
		}
		if sessionSiteOrgID != e.OrganizationID {
			return ErrSiteNotFound
		}
		if e.SiteID != nil && *e.SiteID != cs.SiteID {
			return ErrCashSessionSiteMismatch
		}
		if e.SiteID == nil {
			siteID := cs.SiteID
			e.SiteID = &siteID
		}
		if cs.TheoreticalBalanceCents < e.AmountCents {
			return ErrInsufficientCash
		}
		session = &cs
	}

	err = tx.GetContext(ctx, e, `
		INSERT INTO expenses (
			id, organization_id, site_id, category, amount_cents, expense_date,
			payment_method, beneficiary, description, author_id, reference,
			status, cash_session_id, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
		RETURNING *`,
		e.ID, e.OrganizationID, e.SiteID, e.Category, e.AmountCents,
		e.ExpenseDate, e.PaymentMethod, e.Beneficiary, e.Description,
		e.AuthorID, e.Reference, e.Status, e.CashSessionID)
	if err != nil {
		return err
	}

	if session != nil {
		movement := &models.CashMovement{
			ID:             uuid.New(),
			OrganizationID: e.OrganizationID,
			CashSessionID:  *e.CashSessionID,
			Type:           models.CashMovementTypeExit,
			AmountCents:    e.AmountCents,
			Source:         "expense",
			ReferenceID:    &e.ID,
			Description:    e.Description,
			AuthorID:       e.AuthorID,
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO cash_movements (
				id, organization_id, cash_session_id, type, amount_cents,
				source, reference_id, description, author_id, created_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
			movement.ID, movement.OrganizationID, movement.CashSessionID,
			movement.Type, movement.AmountCents, movement.Source,
			movement.ReferenceID, movement.Description, movement.AuthorID)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE cash_sessions
			SET theoretical_balance_cents = theoretical_balance_cents - $1, updated_at = NOW()
			WHERE id = $2 AND organization_id = $3 AND status = $4`,
			e.AmountCents, *e.CashSessionID, e.OrganizationID, models.CashSessionStatusOpen)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *ExpenseStore) ListByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.Expense, error) {
	var items []models.Expense
	query := `SELECT * FROM expenses WHERE organization_id = $1 ORDER BY expense_date DESC, created_at DESC`
	err := s.DB.SelectContext(ctx, &items, query, orgID)
	return items, err
}

// Cancel is idempotent. A cash expense can only be cancelled while its source
// session remains open; the reversal and cancellation are recorded together.
func (s *ExpenseStore) Cancel(ctx context.Context, id, orgID, actorID uuid.UUID) error {
	tx, err := s.DB.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var expense models.Expense
	err = tx.GetContext(ctx, &expense,
		`SELECT * FROM expenses WHERE id = $1 AND organization_id = $2 FOR UPDATE`, id, orgID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrExpenseNotFound
		}
		return err
	}
	if expense.Status == models.ExpenseStatusCancelled {
		return tx.Commit()
	}

	if expense.PaymentMethod == models.PaymentMethodCash && expense.CashSessionID != nil {
		var session models.CashSession
		err = tx.GetContext(ctx, &session, `
			SELECT * FROM cash_sessions
			WHERE id = $1 AND organization_id = $2 AND status = $3
			FOR UPDATE`,
			*expense.CashSessionID, orgID, models.CashSessionStatusOpen)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrCashSessionNotOpen
			}
			return err
		}
		if session.TheoreticalBalanceCents > maxCashBalanceCents-expense.AmountCents {
			return ErrCashBalanceOverflow
		}

		_, err = tx.ExecContext(ctx, `
			INSERT INTO cash_movements (
				id, organization_id, cash_session_id, type, amount_cents,
				source, reference_id, description, author_id, created_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
			uuid.New(), orgID, session.ID, models.CashMovementTypeEntry,
			expense.AmountCents, "expense_cancellation", expense.ID,
			expense.Description, actorID)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE cash_sessions
			SET theoretical_balance_cents = theoretical_balance_cents + $1, updated_at = NOW()
			WHERE id = $2 AND organization_id = $3 AND status = $4`,
			expense.AmountCents, session.ID, orgID, models.CashSessionStatusOpen)
		if err != nil {
			return err
		}
	}

	_, err = tx.ExecContext(ctx,
		`UPDATE expenses SET status = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3`,
		models.ExpenseStatusCancelled, id, orgID)
	if err != nil {
		return err
	}
	return tx.Commit()
}
