package stores

import (
	"context"
	"database/sql"
	"errors"
	"time"

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

// Create stores a payment and, for cash, its cash-in movement and balance
// update atomically. Wash creation calls the same transaction helper so the
// wash, snapshots, assignments, payment and cash balance commit together.
func (s *PaymentStore) Create(ctx context.Context, p *models.Payment) error {
	if err := validatePaymentInput(p); err != nil {
		return err
	}
	tx, err := s.DB.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := createPaymentInTx(ctx, tx, p); err != nil {
		return err
	}
	return tx.Commit()
}

func validatePaymentInput(p *models.Payment) error {
	if p.AmountCents <= 0 {
		return errors.New("payment amount must be positive")
	}
	if !validPaymentMethod(p.Method) {
		return errors.New("invalid payment method")
	}
	if p.Method == models.PaymentMethodCash {
		if p.CashSessionID == nil {
			return ErrCashSessionRequired
		}
		if p.Status != models.PaymentStatusVerified {
			return errors.New("cash payments must be verified when recorded")
		}
	} else if p.CashSessionID != nil {
		return ErrCashSessionNotApplicable
	}
	if p.Status != models.PaymentStatusPending && p.Status != models.PaymentStatusVerified {
		return errors.New("new payments must be pending or verified")
	}
	return nil
}

func createPaymentInTx(ctx context.Context, tx *sqlx.Tx, p *models.Payment) error {
	if err := validatePaymentInput(p); err != nil {
		return err
	}
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	if p.ReceivedAt.IsZero() {
		p.ReceivedAt = time.Now()
	}

	var washSiteID *uuid.UUID
	if p.WashID != nil {
		var wash struct {
			SiteID     *uuid.UUID         `db:"site_id"`
			TotalCents int64              `db:"total_cents"`
			Status     models.WashStatus   `db:"status"`
		}
		if err := tx.GetContext(ctx, &wash,
			`SELECT site_id, total_cents, status FROM washes WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
			*p.WashID, p.OrganizationID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrWashNotFound
			}
			return err
		}
		if wash.Status == models.WashStatusCancelled {
			return ErrWashCancelled
		}
		var existingAmount int64
		if err := tx.GetContext(ctx, &existingAmount, `
			SELECT COALESCE(SUM(amount_cents), 0)
			FROM payments
			WHERE organization_id = $1 AND wash_id = $2
			  AND status IN ($3, $4)`,
			p.OrganizationID, *p.WashID, models.PaymentStatusPending, models.PaymentStatusVerified); err != nil {
			return err
		}
		if p.AmountCents > wash.TotalCents-existingAmount {
			return ErrWashPaymentExceedsTotal
		}
		washSiteID = wash.SiteID
	}

	var session *models.CashSession
	if p.CashSessionID != nil {
		var cs models.CashSession
		err := tx.GetContext(ctx, &cs, `
			SELECT * FROM cash_sessions
			WHERE id = $1 AND organization_id = $2 AND status = $3
			FOR UPDATE`,
			*p.CashSessionID, p.OrganizationID, models.CashSessionStatusOpen)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrCashSessionNotOpen
			}
			return err
		}
		if washSiteID != nil && *washSiteID != cs.SiteID {
			return ErrCashSessionSiteMismatch
		}
		if cs.TheoreticalBalanceCents > maxCashBalanceCents-p.AmountCents {
			return ErrCashBalanceOverflow
		}
		session = &cs
	}

	if err := tx.GetContext(ctx, p, `
		INSERT INTO payments (
			id, organization_id, wash_id, cash_session_id, amount_cents,
			method, status, reference, received_at, author_id, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
		RETURNING *`,
		p.ID, p.OrganizationID, p.WashID, p.CashSessionID, p.AmountCents,
		p.Method, p.Status, p.Reference, p.ReceivedAt, p.AuthorID); err != nil {
		return err
	}

	if session != nil {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO cash_movements (
				id, organization_id, cash_session_id, type, amount_cents,
				source, reference_id, description, author_id, created_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
			uuid.New(), p.OrganizationID, *p.CashSessionID,
			models.CashMovementTypeEntry, p.AmountCents, "payment", p.ID,
			nil, p.AuthorID); err != nil {
			return err
		}

		result, err := tx.ExecContext(ctx, `
			UPDATE cash_sessions
			SET theoretical_balance_cents = theoretical_balance_cents + $1, updated_at = NOW()
			WHERE id = $2 AND organization_id = $3 AND status = $4`,
			p.AmountCents, *p.CashSessionID, p.OrganizationID, models.CashSessionStatusOpen)
		if err != nil {
			return err
		}
		if n, err := result.RowsAffected(); err != nil {
			return err
		} else if n != 1 {
			return ErrCashSessionNotOpen
		}
	}

	if p.WashID != nil {
		if err := refreshWashPaymentStatus(ctx, tx, p.OrganizationID, *p.WashID); err != nil {
			return err
		}
	}
	return nil
}

func refreshWashPaymentStatus(ctx context.Context, tx *sqlx.Tx, orgID, washID uuid.UUID) error {
	var wash struct {
		TotalCents int64 `db:"total_cents"`
		Status     models.WashStatus `db:"status"`
	}
	if err := tx.GetContext(ctx, &wash,
		`SELECT total_cents, status FROM washes WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
		washID, orgID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrWashNotFound
		}
		return err
	}
	if wash.Status == models.WashStatusCancelled {
		return ErrWashCancelled
	}

	var verifiedAmount int64
	if err := tx.GetContext(ctx, &verifiedAmount, `
		SELECT COALESCE(SUM(amount_cents), 0)
		FROM payments
		WHERE organization_id = $1 AND wash_id = $2 AND status = $3`,
		orgID, washID, models.PaymentStatusVerified); err != nil {
		return err
	}

	paymentStatus := models.WashPaymentStatusUnpaid
	if verifiedAmount > 0 && verifiedAmount >= wash.TotalCents {
		paymentStatus = models.WashPaymentStatusPaid
	} else if verifiedAmount > 0 {
		paymentStatus = models.WashPaymentStatusPartial
	}
	_, err := tx.ExecContext(ctx, `
		UPDATE washes SET payment_status = $1, updated_at = NOW()
		WHERE id = $2 AND organization_id = $3`, paymentStatus, washID, orgID)
	return err
}

func validPaymentMethod(method models.PaymentMethod) bool {
	switch method {
	case models.PaymentMethodCash, models.PaymentMethodOrangeMoney,
		models.PaymentMethodMTNMoMo, models.PaymentMethodMoovMoney,
		models.PaymentMethodWave, models.PaymentMethodOther:
		return true
	default:
		return false
	}
}

func (s *PaymentStore) ListByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.Payment, error) {
	var items []models.Payment
	query := `SELECT * FROM payments WHERE organization_id = $1 ORDER BY received_at DESC`
	err := s.DB.SelectContext(ctx, &items, query, orgID)
	return items, err
}
