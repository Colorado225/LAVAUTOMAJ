package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"washpilot-ci-backend/internal/models"
	"washpilot-ci-backend/internal/stores"

	"github.com/google/uuid"
)

func TestCashPaymentRequiresCashSession(t *testing.T) {
	store := &stores.PaymentStore{}
	payment := &models.Payment{Method: models.PaymentMethodCash, AmountCents: 100}
	if err := store.Create(context.Background(), payment); !errors.Is(err, stores.ErrCashSessionRequired) {
		t.Fatalf("expected cash payment without a session to be rejected, got %v", err)
	}

	sessionID := uuid.New()
	payment = &models.Payment{
		Method:        models.PaymentMethodWave,
		AmountCents:   100,
		CashSessionID: &sessionID,
	}
	if err := store.Create(context.Background(), payment); !errors.Is(err, stores.ErrCashSessionNotApplicable) {
		t.Fatalf("expected a non-cash payment with a session to be rejected, got %v", err)
	}
}

func TestCashPaymentCreatesTenantScopedMovement(t *testing.T) {
	if testDB == nil {
		t.Skip("database integration test: TEST_DATABASE_URL is not set")
	}

	ctx := context.Background()
	orgID := uuid.New()
	userID := uuid.New()
	siteID := uuid.New()
	sessionID := uuid.New()
	paymentID := uuid.New()
	unique := uuid.NewString()
	clerkOrgID := "org_cash_test_" + unique
	clerkUserID := "user_cash_test_" + unique
	email := "cash-test-" + unique + "@example.com"

	// Only remove rows created by this test; never truncate shared tables.
	t.Cleanup(func() {
		_, _ = testDB.ExecContext(ctx, `DELETE FROM cash_movements WHERE organization_id = $1`, orgID)
		_, _ = testDB.ExecContext(ctx, `DELETE FROM payments WHERE organization_id = $1`, orgID)
		_, _ = testDB.ExecContext(ctx, `DELETE FROM cash_sessions WHERE organization_id = $1`, orgID)
		_, _ = testDB.ExecContext(ctx, `DELETE FROM sites WHERE organization_id = $1`, orgID)
		_, _ = testDB.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, userID)
		_, _ = testDB.ExecContext(ctx, `DELETE FROM organizations WHERE id = $1`, orgID)
	})

	if _, err := testDB.ExecContext(ctx,
		`INSERT INTO organizations (id, clerk_org_id, name) VALUES ($1, $2, $3)`,
		orgID, clerkOrgID, "Cash Test Organization"); err != nil {
		t.Fatalf("failed to create organization fixture: %v", err)
	}
	if _, err := testDB.ExecContext(ctx, `
		INSERT INTO users (id, organization_id, clerk_user_id, email, role, status)
		VALUES ($1, $2, $3, $4, 'owner', 'active')`,
		userID, orgID, clerkUserID, email); err != nil {
		t.Fatalf("failed to create user fixture: %v", err)
	}
	if _, err := testDB.ExecContext(ctx,
		`INSERT INTO sites (id, organization_id, name) VALUES ($1, $2, $3)`,
		siteID, orgID, "Cash Test Site"); err != nil {
		t.Fatalf("failed to create site fixture: %v", err)
	}

	openingAmount := int64(5000)
	session := &models.CashSession{
		ID:                      sessionID,
		OrganizationID:          orgID,
		SiteID:                  siteID,
		UserID:                  userID,
		OpeningAmountCents:      openingAmount,
		TheoreticalBalanceCents: openingAmount,
		Status:                  models.CashSessionStatusOpen,
	}
	if err := testServer.store.CashSessionStore.Open(ctx, session); err != nil {
		t.Fatalf("failed to open cash session fixture: %v", err)
	}
	duplicateSession := &models.CashSession{
		ID:                      uuid.New(),
		OrganizationID:          orgID,
		SiteID:                  siteID,
		UserID:                  userID,
		OpeningAmountCents:      openingAmount,
		TheoreticalBalanceCents: openingAmount,
		Status:                  models.CashSessionStatusOpen,
	}
	if err := testServer.store.CashSessionStore.Open(ctx, duplicateSession); !errors.Is(err, stores.ErrOpenCashSessionExists) {
		t.Fatalf("expected a second open session for the site to be rejected, got %v", err)
	}

	cashSessionID := sessionID
	payment := &models.Payment{
		ID:            paymentID,
		OrganizationID: orgID,
		CashSessionID: &cashSessionID,
		AmountCents:   2500,
		Method:        models.PaymentMethodCash,
		Status:        models.PaymentStatusVerified,
		ReceivedAt:    time.Now(),
		AuthorID:      userID,
	}
	if err := testServer.store.PaymentStore.Create(ctx, payment); err != nil {
		t.Fatalf("failed to create cash payment: %v", err)
	}

	updated, err := testServer.store.CashSessionStore.GetOpenBySite(ctx, orgID, siteID)
	if err != nil {
		t.Fatalf("failed to reload open cash session: %v", err)
	}
	if updated == nil || updated.TheoreticalBalanceCents != openingAmount+payment.AmountCents {
		t.Fatalf("expected balance %d, got %#v", openingAmount+payment.AmountCents, updated)
	}

	movements, err := testServer.store.CashMovementStore.ListBySession(ctx, sessionID, orgID)
	if err != nil {
		t.Fatalf("failed to list cash movements: %v", err)
	}
	if len(movements) != 1 {
		t.Fatalf("expected one payment movement, got %d", len(movements))
	}
	if movements[0].Type != models.CashMovementTypeEntry ||
		movements[0].Source != "payment" ||
		movements[0].AmountCents != payment.AmountCents ||
		movements[0].ReferenceID == nil || *movements[0].ReferenceID != paymentID {
		t.Fatalf("unexpected cash payment movement: %#v", movements[0])
	}

	foreignPayment := &models.Payment{
		ID:             uuid.New(),
		OrganizationID: uuid.New(),
		CashSessionID:  &cashSessionID,
		AmountCents:    100,
		Method:         models.PaymentMethodCash,
		Status:         models.PaymentStatusVerified,
		ReceivedAt:     time.Now(),
		AuthorID:       userID,
	}
	if err := testServer.store.PaymentStore.Create(ctx, foreignPayment); !errors.Is(err, stores.ErrCashSessionNotOpen) {
		t.Fatalf("expected cross-organization session reuse to be rejected, got %v", err)
	}

	manualExit := &models.CashMovement{
		ID:             uuid.New(),
		OrganizationID: orgID,
		CashSessionID:  sessionID,
		Type:           models.CashMovementTypeExit,
		AmountCents:    1000,
		Source:         "manual",
		AuthorID:       userID,
	}
	if err := testServer.store.CashMovementStore.Create(ctx, manualExit); err != nil {
		t.Fatalf("failed to record manual cash exit: %v", err)
	}
	tooLargeExit := &models.CashMovement{
		ID:             uuid.New(),
		OrganizationID: orgID,
		CashSessionID:  sessionID,
		Type:           models.CashMovementTypeExit,
		AmountCents:    7000,
		Source:         "manual",
		AuthorID:       userID,
	}
	if err := testServer.store.CashMovementStore.Create(ctx, tooLargeExit); !errors.Is(err, stores.ErrInsufficientCash) {
		t.Fatalf("expected an exit larger than the balance to be rejected, got %v", err)
	}

	reason := "Écart constaté au comptage"
	if _, err := testServer.store.CashSessionStore.Close(ctx, sessionID, orgID, userID, 6000, nil); !errors.Is(err, stores.ErrDiscrepancyReasonRequired) {
		t.Fatalf("expected a discrepancy reason to be required, got %v", err)
	}
	closedSession, err := testServer.store.CashSessionStore.Close(ctx, sessionID, orgID, userID, 6000, &reason)
	if err != nil {
		t.Fatalf("failed to close cash session with a reason: %v", err)
	}
	if closedSession.Status != models.CashSessionStatusClosed ||
		closedSession.DiscrepancyCents == nil || *closedSession.DiscrepancyCents != -500 {
		t.Fatalf("expected a closed session with a -500 cent discrepancy, got %#v", closedSession)
	}
	closedPayment := &models.Payment{
		ID:             uuid.New(),
		OrganizationID: orgID,
		CashSessionID:  &cashSessionID,
		AmountCents:    100,
		Method:         models.PaymentMethodCash,
		Status:         models.PaymentStatusVerified,
		ReceivedAt:     time.Now(),
		AuthorID:       userID,
	}
	if err := testServer.store.PaymentStore.Create(ctx, closedPayment); !errors.Is(err, stores.ErrCashSessionNotOpen) {
		t.Fatalf("expected payments into a closed session to be rejected, got %v", err)
	}
}
