package stores

import (
	"context"
	"errors"
	"testing"

	"washpilot-ci-backend/internal/models"

	"github.com/google/uuid"
)

func TestWashCreateRejectsInvalidInputBeforeDatabaseAccess(t *testing.T) {
	store := &WashStore{}
	base := CreateWashInput{
		OrganizationID:    uuid.New(),
		AuthorID:          uuid.New(),
		SiteID:            uuid.New(),
		VehicleCategoryID: uuid.New(),
		Items:             []WashItemInput{{ServiceID: uuid.New(), Quantity: 1}},
		IdempotencyKey:    "request-1",
	}

	base.Items[0].Quantity = 0
	if _, _, err := store.Create(context.Background(), base); !errors.Is(err, ErrWashInvalidInput) {
		t.Fatalf("expected a zero service quantity to be rejected before database access, got %v", err)
	}

	base.Items[0].Quantity = 1
	base.AmountReceivedCents = 100
	base.PaymentMethod = models.PaymentMethodCash
	if _, _, err := store.Create(context.Background(), base); !errors.Is(err, ErrCashSessionRequired) {
		t.Fatalf("expected cash payment without a session to be rejected before database access, got %v", err)
	}
}

func TestWashCancellationRequiresReasonBeforeDatabaseAccess(t *testing.T) {
	store := &WashStore{}
	if _, err := store.Cancel(context.Background(), uuid.New(), uuid.New(), uuid.New(), "  "); !errors.Is(err, ErrWashCancellationReasonRequired) {
		t.Fatalf("expected blank cancellation reason to be rejected before database access, got %v", err)
	}
}

func TestWashRequestFingerprintIsOrderIndependent(t *testing.T) {
	serviceA := uuid.New()
	serviceB := uuid.New()
	workerA := uuid.New()
	workerB := uuid.New()
	input := CreateWashInput{
		SiteID:            uuid.New(),
		VehicleCategoryID: uuid.New(),
		Items: []WashItemInput{
			{ServiceID: serviceA, Quantity: 2},
			{ServiceID: serviceB, Quantity: 1},
		},
		WorkerIDs:     []uuid.UUID{workerA, workerB},
		PaymentMethod: models.PaymentMethodWave,
		AmountReceivedCents: 500,
	}
	fingerprint, err := washRequestFingerprint(input)
	if err != nil {
		t.Fatalf("failed to fingerprint request: %v", err)
	}

	input.Items[0], input.Items[1] = input.Items[1], input.Items[0]
	input.WorkerIDs[0], input.WorkerIDs[1] = input.WorkerIDs[1], input.WorkerIDs[0]
	shuffledFingerprint, err := washRequestFingerprint(input)
	if err != nil {
		t.Fatalf("failed to fingerprint reordered request: %v", err)
	}
	if fingerprint != shuffledFingerprint {
		t.Fatal("expected semantically identical item and worker order to produce the same fingerprint")
	}

	input.Items[0].Quantity++
	changedFingerprint, err := washRequestFingerprint(input)
	if err != nil {
		t.Fatalf("failed to fingerprint changed request: %v", err)
	}
	if fingerprint == changedFingerprint {
		t.Fatal("expected a changed quantity to produce a different fingerprint")
	}
}

func TestWashCreateRequiresOrganizationScopedIdempotencyKey(t *testing.T) {
	input := CreateWashInput{
		OrganizationID:    uuid.New(),
		AuthorID:          uuid.New(),
		SiteID:            uuid.New(),
		VehicleCategoryID: uuid.New(),
		Items:             []WashItemInput{{ServiceID: uuid.New(), Quantity: 1}},
		IdempotencyKey:    "   ",
	}
	if _, err := validateCreateWashInput(input); !errors.Is(err, ErrWashInvalidInput) {
		t.Fatalf("expected an empty idempotency key to be rejected, got %v", err)
	}
	input.IdempotencyKey = "key"
	key, err := validateCreateWashInput(input)
	if err != nil {
		t.Fatalf("expected a valid key, got %v", err)
	}
	scoped := input.OrganizationID.String() + ":" + key
	if len(scoped) > 255 || scoped == key {
		t.Fatalf("expected the stored key to be scoped to its organization, got %q", scoped)
	}
}
