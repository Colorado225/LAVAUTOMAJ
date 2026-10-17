package stores

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"washpilot-ci-backend/internal/models"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type WashStore struct {
	DB *sqlx.DB
}

func NewWashStore(db *sqlx.DB) *WashStore {
	return &WashStore{DB: db}
}

type WashItemInput struct {
	ServiceID uuid.UUID
	Quantity  int
}

type CreateWashInput struct {
	OrganizationID    uuid.UUID
	AuthorID          uuid.UUID
	SiteID            uuid.UUID
	VehicleCategoryID uuid.UUID
	Items             []WashItemInput
	WorkerIDs         []uuid.UUID
	PaymentMethod     models.PaymentMethod
	AmountReceivedCents int64
	CashSessionID     *uuid.UUID
	IdempotencyKey    string
}

// Create stores the wash, service price snapshots, worker assignments and any
// initial payment in one transaction. The boolean reports an idempotent replay.
func (s *WashStore) Create(ctx context.Context, input CreateWashInput) (*models.WashDetail, bool, error) {
	key, err := validateCreateWashInput(input)
	if err != nil {
		return nil, false, err
	}
	fingerprint, err := washRequestFingerprint(input)
	if err != nil {
		return nil, false, err
	}
	scopedKey := input.OrganizationID.String() + ":" + key

	tx, err := s.DB.BeginTxx(ctx, nil)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()

	if detail, found, err := s.findIdempotentWash(ctx, tx, input.OrganizationID, scopedKey, fingerprint); err != nil {
		return nil, false, err
	} else if found {
		return detail, true, nil
	}

	var siteID uuid.UUID
	err = tx.GetContext(ctx, &siteID, `
		SELECT id FROM sites
		WHERE id = $1 AND organization_id = $2 AND is_active = true
		FOR SHARE`, input.SiteID, input.OrganizationID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, ErrWashSiteNotFound
	}
	if err != nil {
		return nil, false, err
	}

	var vehicleCategoryID uuid.UUID
	err = tx.GetContext(ctx, &vehicleCategoryID, `
		SELECT id FROM vehicle_categories
		WHERE id = $1 AND organization_id = $2 AND is_active = true
		FOR SHARE`, input.VehicleCategoryID, input.OrganizationID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, ErrWashVehicleCategoryNotFound
	}
	if err != nil {
		return nil, false, err
	}

	items := make([]models.WashItem, 0, len(input.Items))
	var totalCents int64
	for _, requested := range input.Items {
		var service models.Service
		err := tx.GetContext(ctx, &service, `
			SELECT * FROM services
			WHERE id = $1 AND organization_id = $2 AND is_active = true
			FOR SHARE`, requested.ServiceID, input.OrganizationID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, false, ErrWashServiceUnavailable
		}
		if err != nil {
			return nil, false, err
		}
		if service.PriceCents < 0 {
			return nil, false, fmt.Errorf("%w: service price cannot be negative", ErrWashInvalidInput)
		}
		quantity := int64(requested.Quantity)
		if service.PriceCents > maxCashBalanceCents/quantity {
			return nil, false, fmt.Errorf("%w: total amount is too large", ErrWashInvalidInput)
		}
		lineTotal := service.PriceCents * quantity
		if lineTotal > maxCashBalanceCents-totalCents {
			return nil, false, fmt.Errorf("%w: total amount is too large", ErrWashInvalidInput)
		}
		totalCents += lineTotal
		serviceID := service.ID
		items = append(items, models.WashItem{
			ID:                  uuid.New(),
			ServiceID:           &serviceID,
			ServiceNameSnapshot: service.Name,
			PriceCentsSnapshot:  service.PriceCents,
			Quantity:            requested.Quantity,
		})
	}
	if input.AmountReceivedCents > totalCents {
		return nil, false, ErrWashPaymentExceedsTotal
	}

	for _, workerID := range input.WorkerIDs {
		var activeID uuid.UUID
		err := tx.GetContext(ctx, &activeID, `
			SELECT id FROM workers
			WHERE id = $1 AND organization_id = $2 AND status = 'active'
			FOR SHARE`, workerID, input.OrganizationID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, false, ErrWashWorkerUnavailable
		}
		if err != nil {
			return nil, false, err
		}
	}

	washID := uuid.New()
	reference := "WASH-" + uuid.NewString()
	fingerprintValue := fingerprint
	keyValue := scopedKey
	wash := &models.Wash{
		ID:                     washID,
		OrganizationID:         input.OrganizationID,
		SiteID:                 &siteID,
		VehicleCategoryID:      &vehicleCategoryID,
		Reference:              reference,
		TotalCents:             totalCents,
		Status:                 models.WashStatusCompleted,
		PaymentStatus:          models.WashPaymentStatusUnpaid,
		AuthorID:               input.AuthorID,
		IdempotencyKey:         &keyValue,
		IdempotencyFingerprint: &fingerprintValue,
	}

	var insertedID uuid.UUID
	err = tx.GetContext(ctx, &insertedID, `
		INSERT INTO washes (
			id, organization_id, site_id, vehicle_category_id, reference,
			total_cents, status, payment_status, author_id, idempotency_key,
			idempotency_fingerprint, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id`,
		wash.ID, wash.OrganizationID, wash.SiteID, wash.VehicleCategoryID,
		wash.Reference, wash.TotalCents, wash.Status, wash.PaymentStatus,
		wash.AuthorID, wash.IdempotencyKey, wash.IdempotencyFingerprint)
	if errors.Is(err, sql.ErrNoRows) {
		detail, found, lookupErr := s.findIdempotentWash(ctx, tx, input.OrganizationID, scopedKey, fingerprint)
		if lookupErr != nil {
			return nil, false, lookupErr
		}
		if found {
			return detail, true, nil
		}
		return nil, false, errors.New("wash idempotency conflict could not be resolved")
	}
	if err != nil {
		return nil, false, err
	}

	for _, item := range items {
		item.WashID = washID
		if err := tx.GetContext(ctx, &item, `
			INSERT INTO wash_items (
				id, wash_id, service_id, service_name_snapshot,
				price_cents_snapshot, quantity, created_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, NOW())
			RETURNING *`,
			item.ID, item.WashID, item.ServiceID, item.ServiceNameSnapshot,
			item.PriceCentsSnapshot, item.Quantity); err != nil {
			return nil, false, err
		}
	}

	for _, workerID := range input.WorkerIDs {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO wash_worker_assignments (id, wash_id, worker_id, created_at)
			VALUES ($1, $2, $3, NOW())`, uuid.New(), washID, workerID); err != nil {
			return nil, false, err
		}
	}

	if input.AmountReceivedCents > 0 {
		paymentStatus := models.PaymentStatusPending
		if input.PaymentMethod == models.PaymentMethodCash {
			paymentStatus = models.PaymentStatusVerified
		}
		payment := &models.Payment{
			ID:             uuid.New(),
			OrganizationID: input.OrganizationID,
			WashID:         &washID,
			CashSessionID:  input.CashSessionID,
			AmountCents:    input.AmountReceivedCents,
			Method:         input.PaymentMethod,
			Status:         paymentStatus,
			ReceivedAt:     time.Now(),
			AuthorID:       input.AuthorID,
		}
		if err := createPaymentInTx(ctx, tx, payment); err != nil {
			return nil, false, err
		}
	}

	detail, err := loadWashDetail(ctx, tx, washID, input.OrganizationID)
	if err != nil {
		return nil, false, err
	}
	if err := tx.Commit(); err != nil {
		return nil, false, err
	}
	return detail, false, nil
}

func validateCreateWashInput(input CreateWashInput) (string, error) {
	if input.OrganizationID == uuid.Nil || input.AuthorID == uuid.Nil ||
		input.SiteID == uuid.Nil || input.VehicleCategoryID == uuid.Nil {
		return "", fmt.Errorf("%w: organization, author, site and vehicle category are required", ErrWashInvalidInput)
	}
	key := strings.TrimSpace(input.IdempotencyKey)
	if key == "" || len(key) > 200 {
		return "", fmt.Errorf("%w: Idempotency-Key must contain between 1 and 200 characters", ErrWashInvalidInput)
	}
	if len(input.Items) == 0 || len(input.Items) > 50 {
		return "", fmt.Errorf("%w: select between 1 and 50 services", ErrWashInvalidInput)
	}
	if len(input.WorkerIDs) > 20 {
		return "", fmt.Errorf("%w: at most 20 workers can be assigned", ErrWashInvalidInput)
	}
	if input.AmountReceivedCents < 0 {
		return "", fmt.Errorf("%w: payment amount cannot be negative", ErrWashInvalidInput)
	}
	if input.AmountReceivedCents > 0 {
		if !validPaymentMethod(input.PaymentMethod) {
			return "", fmt.Errorf("%w: a valid payment method is required", ErrWashInvalidInput)
		}
		if input.PaymentMethod == models.PaymentMethodCash && input.CashSessionID == nil {
			return "", ErrCashSessionRequired
		}
		if input.PaymentMethod != models.PaymentMethodCash && input.CashSessionID != nil {
			return "", ErrCashSessionNotApplicable
		}
	} else if input.CashSessionID != nil {
		return "", fmt.Errorf("%w: a cash session requires a positive payment", ErrWashInvalidInput)
	}

	seenServices := make(map[uuid.UUID]struct{}, len(input.Items))
	for _, item := range input.Items {
		if item.ServiceID == uuid.Nil || item.Quantity < 1 || item.Quantity > 100 {
			return "", fmt.Errorf("%w: each service needs a valid ID and quantity between 1 and 100", ErrWashInvalidInput)
		}
		if _, exists := seenServices[item.ServiceID]; exists {
			return "", fmt.Errorf("%w: a service may only appear once", ErrWashInvalidInput)
		}
		seenServices[item.ServiceID] = struct{}{}
	}
	seenWorkers := make(map[uuid.UUID]struct{}, len(input.WorkerIDs))
	for _, workerID := range input.WorkerIDs {
		if workerID == uuid.Nil {
			return "", fmt.Errorf("%w: worker ID is required", ErrWashInvalidInput)
		}
		if _, exists := seenWorkers[workerID]; exists {
			return "", fmt.Errorf("%w: a worker may only be assigned once", ErrWashInvalidInput)
		}
		seenWorkers[workerID] = struct{}{}
	}
	return key, nil
}

func washRequestFingerprint(input CreateWashInput) (string, error) {
	items := append([]WashItemInput(nil), input.Items...)
	sort.Slice(items, func(i, j int) bool {
		return items[i].ServiceID.String() < items[j].ServiceID.String()
	})
	workers := append([]uuid.UUID(nil), input.WorkerIDs...)
	sort.Slice(workers, func(i, j int) bool {
		return workers[i].String() < workers[j].String()
	})

	canonical := struct {
		SiteID            string          `json:"site_id"`
		VehicleCategoryID string          `json:"vehicle_category_id"`
		Items             []WashItemInput `json:"items"`
		WorkerIDs         []string        `json:"worker_ids"`
		PaymentMethod     string          `json:"payment_method"`
		AmountCents       int64           `json:"amount_cents"`
		CashSessionID     string          `json:"cash_session_id"`
	}{
		SiteID:            input.SiteID.String(),
		VehicleCategoryID: input.VehicleCategoryID.String(),
		Items:             items,
		PaymentMethod:     string(input.PaymentMethod),
		AmountCents:       input.AmountReceivedCents,
	}
	if input.CashSessionID != nil {
		canonical.CashSessionID = input.CashSessionID.String()
	}
	for _, workerID := range workers {
		canonical.WorkerIDs = append(canonical.WorkerIDs, workerID.String())
	}
	payload, err := json.Marshal(canonical)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func (s *WashStore) findIdempotentWash(
	ctx context.Context,
	tx *sqlx.Tx,
	orgID uuid.UUID,
	key string,
	fingerprint string,
) (*models.WashDetail, bool, error) {
	var wash models.Wash
	err := tx.GetContext(ctx, &wash, `
		SELECT * FROM washes
		WHERE organization_id = $1 AND idempotency_key = $2`, orgID, key)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if wash.IdempotencyFingerprint == nil || *wash.IdempotencyFingerprint != fingerprint {
		return nil, false, ErrWashIdempotencyConflict
	}
	detail, err := loadWashDetail(ctx, tx, wash.ID, orgID)
	if err != nil {
		return nil, false, err
	}
	return detail, true, nil
}

func (s *WashStore) ListByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.Wash, error) {
	washes := make([]models.Wash, 0)
	err := s.DB.SelectContext(ctx, &washes, `
		SELECT * FROM washes
		WHERE organization_id = $1
		ORDER BY created_at DESC
		LIMIT 200`, orgID)
	return washes, err
}

func (s *WashStore) GetDetailByID(ctx context.Context, id, orgID uuid.UUID) (*models.WashDetail, error) {
	return loadWashDetail(ctx, s.DB, id, orgID)
}

type washQueryer interface {
	GetContext(context.Context, interface{}, string, ...interface{}) error
	SelectContext(context.Context, interface{}, string, ...interface{}) error
}

func loadWashDetail(ctx context.Context, queryer washQueryer, id, orgID uuid.UUID) (*models.WashDetail, error) {
	var wash models.Wash
	if err := queryer.GetContext(ctx, &wash,
		`SELECT * FROM washes WHERE id = $1 AND organization_id = $2`, id, orgID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrWashNotFound
		}
		return nil, err
	}

	detail := &models.WashDetail{
		Wash:     wash,
		Items:    make([]models.WashItem, 0),
		Workers:  make([]models.Worker, 0),
		Payments: make([]models.Payment, 0),
	}
	if err := queryer.SelectContext(ctx, &detail.Items,
		`SELECT * FROM wash_items WHERE wash_id = $1 ORDER BY created_at, id`, id); err != nil {
		return nil, err
	}
	if err := queryer.SelectContext(ctx, &detail.Workers, `
		SELECT w.*
		FROM workers w
		JOIN wash_worker_assignments a ON a.worker_id = w.id
		WHERE a.wash_id = $1 AND w.organization_id = $2
		ORDER BY w.last_name, w.first_name, w.id`, id, orgID); err != nil {
		return nil, err
	}
	if err := queryer.SelectContext(ctx, &detail.Payments, `
		SELECT * FROM payments
		WHERE organization_id = $1 AND wash_id = $2
		ORDER BY received_at, id`, orgID, id); err != nil {
		return nil, err
	}
	return detail, nil
}

func (s *WashStore) Cancel(ctx context.Context, id, orgID, actorID uuid.UUID, reason string) (*models.WashDetail, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, ErrWashCancellationReasonRequired
	}
	if len(reason) > 500 {
		return nil, fmt.Errorf("%w: cancellation reason must be at most 500 characters", ErrWashInvalidInput)
	}

	tx, err := s.DB.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var wash models.Wash
	if err := tx.GetContext(ctx, &wash,
		`SELECT * FROM washes WHERE id = $1 AND organization_id = $2 FOR UPDATE`, id, orgID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrWashNotFound
		}
		return nil, err
	}
	if wash.Status == models.WashStatusCancelled {
		detail, err := loadWashDetail(ctx, tx, id, orgID)
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return detail, nil
	}

	var verifiedPayments int
	if err := tx.GetContext(ctx, &verifiedPayments, `
		SELECT COUNT(*) FROM payments
		WHERE organization_id = $1 AND wash_id = $2 AND status = $3`,
		orgID, id, models.PaymentStatusVerified); err != nil {
		return nil, err
	}
	if verifiedPayments > 0 {
		return nil, ErrWashHasVerifiedPayments
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE payments SET status = $1
		WHERE organization_id = $2 AND wash_id = $3 AND status = $4`,
		models.PaymentStatusFailed, orgID, id, models.PaymentStatusPending); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE washes
		SET status = $1, payment_status = $2, cancelled_at = NOW(),
		    cancelled_by_id = $3, cancellation_reason = $4, updated_at = NOW()
		WHERE id = $5 AND organization_id = $6`,
		models.WashStatusCancelled, models.WashPaymentStatusUnpaid,
		actorID, reason, id, orgID); err != nil {
		return nil, err
	}

	detail, err := loadWashDetail(ctx, tx, id, orgID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return detail, nil
}
