package main

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"washpilot-ci-backend/internal/models"
	"washpilot-ci-backend/internal/stores"

	"github.com/google/uuid"
)

func TestCreateWashRequiresOrganization(t *testing.T) {
	server := &ApiServer{logger: slog.Default()}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/washes", bytes.NewBufferString(`{"site_id":"`+uuid.NewString()+`"}`))
	request.Header.Set("Idempotency-Key", uuid.NewString())
	recorder := httptest.NewRecorder()
	server.handleCreateWash(recorder, request)
	if recorder.Code != http.StatusUnauthorized && recorder.Code != http.StatusForbidden {
		t.Fatalf("expected unauthenticated wash creation to be rejected, got %d", recorder.Code)
	}
}

func TestWashCreateSnapshotsPriceAndIsIdempotent(t *testing.T) {
	if testDB == nil || testServer == nil {
		t.Skip("database integration test: TEST_DATABASE_URL is not set")
	}

	ctx := context.Background()
	orgID := uuid.New()
	userID := uuid.New()
	siteID := uuid.New()
	categoryID := uuid.New()
	serviceID := uuid.New()
	workerID := uuid.New()
	unique := uuid.NewString()
	clerkOrgID := "org_wash_test_" + unique

	// Cleanup is scoped to the uniquely generated organization fixture.
	t.Cleanup(func() {
		_, _ = testDB.ExecContext(ctx, `DELETE FROM organizations WHERE id = $1`, orgID)
	})

	if _, err := testDB.ExecContext(ctx,
		`INSERT INTO organizations (id, clerk_org_id, name) VALUES ($1, $2, $3)`,
		orgID, clerkOrgID, "Wash Test Organization"); err != nil {
		t.Fatalf("failed to create organization fixture: %v", err)
	}
	if _, err := testDB.ExecContext(ctx, `
		INSERT INTO users (id, organization_id, clerk_user_id, email, role, status)
		VALUES ($1, $2, $3, $4, 'owner', 'active')`,
		userID, orgID, "user_wash_test_"+unique, "wash-test-"+unique+"@example.com"); err != nil {
		t.Fatalf("failed to create user fixture: %v", err)
	}
	if _, err := testDB.ExecContext(ctx,
		`INSERT INTO sites (id, organization_id, name) VALUES ($1, $2, $3)`,
		siteID, orgID, "Wash Test Site"); err != nil {
		t.Fatalf("failed to create site fixture: %v", err)
	}
	if _, err := testDB.ExecContext(ctx,
		`INSERT INTO vehicle_categories (id, organization_id, name) VALUES ($1, $2, $3)`,
		categoryID, orgID, "Voiture"); err != nil {
		t.Fatalf("failed to create vehicle category fixture: %v", err)
	}
	if _, err := testDB.ExecContext(ctx, `
		INSERT INTO services (id, organization_id, name, price_cents, is_active)
		VALUES ($1, $2, 'Lavage complet', 10000, true)`, serviceID, orgID); err != nil {
		t.Fatalf("failed to create service fixture: %v", err)
	}
	if _, err := testDB.ExecContext(ctx, `
		INSERT INTO workers (id, organization_id, first_name, last_name, role, status)
		VALUES ($1, $2, 'Awa', 'Kone', 'versatile_washer', 'active')`, workerID, orgID); err != nil {
		t.Fatalf("failed to create worker fixture: %v", err)
	}

	cashSessionID := uuid.New()
	openingAmount := int64(5000)
	if err := testServer.cashSessionStore.Open(ctx, &models.CashSession{
		ID:                      cashSessionID,
		OrganizationID:          orgID,
		SiteID:                  siteID,
		UserID:                  userID,
		OpeningAmountCents:      openingAmount,
		TheoreticalBalanceCents: openingAmount,
		Status:                  models.CashSessionStatusOpen,
	}); err != nil {
		t.Fatalf("failed to open cash session fixture: %v", err)
	}

	input := stores.CreateWashInput{
		OrganizationID:     orgID,
		AuthorID:           userID,
		SiteID:             siteID,
		VehicleCategoryID:  categoryID,
		Items:              []stores.WashItemInput{{ServiceID: serviceID, Quantity: 2}},
		WorkerIDs:          []uuid.UUID{workerID},
		PaymentMethod:      models.PaymentMethodCash,
		AmountReceivedCents: 10000,
		CashSessionID:      &cashSessionID,
		IdempotencyKey:     uuid.NewString(),
	}
	created, replayed, err := testServer.washStore.Create(ctx, input)
	if err != nil {
		t.Fatalf("failed to create wash: %v", err)
	}
	if replayed {
		t.Fatal("first creation must not be reported as an idempotent replay")
	}
	if created.Wash.TotalCents != 20000 || created.Wash.PaymentStatus != models.WashPaymentStatusPartial {
		t.Fatalf("expected a 20000-cent partially paid wash, got %#v", created.Wash)
	}
	if len(created.Items) != 1 || created.Items[0].ServiceNameSnapshot != "Lavage complet" ||
		created.Items[0].PriceCentsSnapshot != 10000 || created.Items[0].Quantity != 2 {
		t.Fatalf("unexpected service price snapshot: %#v", created.Items)
	}
	if len(created.Workers) != 1 || created.Workers[0].ID != workerID {
		t.Fatalf("expected the assigned worker in wash detail, got %#v", created.Workers)
	}
	if len(created.Payments) != 1 || created.Payments[0].Status != models.PaymentStatusVerified {
		t.Fatalf("expected one verified cash payment, got %#v", created.Payments)
	}

	if _, err := testDB.ExecContext(ctx,
		`UPDATE services SET name = 'Nouveau tarif', price_cents = 30000 WHERE id = $1 AND organization_id = $2`,
		serviceID, orgID); err != nil {
		t.Fatalf("failed to update current service catalog: %v", err)
	}
	storedDetail, err := testServer.washStore.GetDetailByID(ctx, created.Wash.ID, orgID)
	if err != nil {
		t.Fatalf("failed to reload wash detail: %v", err)
	}
	if storedDetail.Items[0].ServiceNameSnapshot != "Lavage complet" ||
		storedDetail.Items[0].PriceCentsSnapshot != 10000 || storedDetail.Wash.TotalCents != 20000 {
		t.Fatalf("catalog updates must not change historical wash snapshots: %#v", storedDetail)
	}

	replayedDetail, replayed, err := testServer.washStore.Create(ctx, input)
	if err != nil {
		t.Fatalf("idempotent retry failed: %v", err)
	}
	if !replayed || replayedDetail.Wash.ID != created.Wash.ID || len(replayedDetail.Payments) != 1 {
		t.Fatalf("expected retry to return the original wash without duplicate payment, got %#v", replayedDetail)
	}
	openSession, err := testServer.cashSessionStore.GetOpenBySite(ctx, orgID, siteID)
	if err != nil {
		t.Fatalf("failed to read cash session after retry: %v", err)
	}
	if openSession == nil || openSession.TheoreticalBalanceCents != openingAmount+input.AmountReceivedCents {
		t.Fatalf("idempotent retry changed the cash balance: %#v", openSession)
	}

	changedInput := input
	changedInput.Items = []stores.WashItemInput{{ServiceID: serviceID, Quantity: 3}}
	if _, _, err := testServer.washStore.Create(ctx, changedInput); !errors.Is(err, stores.ErrWashIdempotencyConflict) {
		t.Fatalf("expected reuse of a key with a different payload to be rejected, got %v", err)
	}
	if _, err := testServer.washStore.GetDetailByID(ctx, created.Wash.ID, uuid.New()); !errors.Is(err, stores.ErrWashNotFound) {
		t.Fatalf("expected wash detail to be tenant-scoped, got %v", err)
	}
	if _, err := testServer.washStore.Cancel(ctx, created.Wash.ID, orgID, userID, "Erreur de saisie"); !errors.Is(err, stores.ErrWashHasVerifiedPayments) {
		t.Fatalf("expected cancellation of a verified payment to be blocked, got %v", err)
	}

	unpaidInput := stores.CreateWashInput{
		OrganizationID:     orgID,
		AuthorID:           userID,
		SiteID:             siteID,
		VehicleCategoryID:  categoryID,
		Items:              []stores.WashItemInput{{ServiceID: serviceID, Quantity: 1}},
		IdempotencyKey:     uuid.NewString(),
	}
	unpaid, _, err := testServer.washStore.Create(ctx, unpaidInput)
	if err != nil {
		t.Fatalf("failed to create unpaid wash fixture: %v", err)
	}
	cancelled, err := testServer.washStore.Cancel(ctx, unpaid.Wash.ID, orgID, userID, "Véhicule non pris en charge")
	if err != nil {
		t.Fatalf("failed to cancel unpaid wash: %v", err)
	}
	if cancelled.Wash.Status != models.WashStatusCancelled || cancelled.Wash.CancelledAt == nil ||
		cancelled.Wash.CancellationReason == nil || *cancelled.Wash.CancellationReason != "Véhicule non pris en charge" {
		t.Fatalf("expected cancellation to be retained in the wash history, got %#v", cancelled.Wash)
	}
	if _, err := testServer.washStore.Cancel(ctx, unpaid.Wash.ID, uuid.New(), userID, "Autre organisation"); !errors.Is(err, stores.ErrWashNotFound) {
		t.Fatalf("expected cross-tenant cancellation to be concealed, got %v", err)
	}

	cancelledPayment := &models.Payment{
		ID:             uuid.New(),
		OrganizationID: orgID,
		WashID:         &unpaid.Wash.ID,
		AmountCents:    100,
		Method:         models.PaymentMethodWave,
		Status:         models.PaymentStatusPending,
		ReceivedAt:     time.Now(),
		AuthorID:       userID,
	}
	if err := testServer.paymentStore.Create(ctx, cancelledPayment); !errors.Is(err, stores.ErrWashCancelled) {
		t.Fatalf("expected a cancelled wash to reject further payments, got %v", err)
	}
}
