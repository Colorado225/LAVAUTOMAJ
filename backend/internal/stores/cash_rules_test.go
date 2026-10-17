package stores

import (
	"context"
	"errors"
	"testing"

	"washpilot-ci-backend/internal/models"

	"github.com/google/uuid"
)

func TestExpenseCashSessionRulesAreCheckedBeforeDatabaseAccess(t *testing.T) {
	store := &ExpenseStore{}
	cashExpense := &models.Expense{
		AmountCents:   100,
		PaymentMethod: models.PaymentMethodCash,
	}
	if err := store.Create(context.Background(), cashExpense); !errors.Is(err, ErrCashSessionRequired) {
		t.Fatalf("expected cash expense without a session to be rejected, got %v", err)
	}

	sessionID := uuid.New()
	noncashExpense := &models.Expense{
		AmountCents:   100,
		PaymentMethod: models.PaymentMethodWave,
		CashSessionID: &sessionID,
	}
	if err := store.Create(context.Background(), noncashExpense); err == nil {
		t.Fatal("expected non-cash expense linked to a cash session to be rejected")
	}
}

func TestCashMovementRejectsInvalidAmountsBeforeDatabaseAccess(t *testing.T) {
	store := &CashMovementStore{}
	movement := &models.CashMovement{
		AmountCents: 0,
		Type:        models.CashMovementTypeEntry,
	}
	if err := store.Create(context.Background(), movement); err == nil {
		t.Fatal("expected zero-value cash movement to be rejected")
	}

	movement.AmountCents = 100
	movement.Type = "unknown"
	if err := store.Create(context.Background(), movement); err == nil {
		t.Fatal("expected invalid cash movement type to be rejected")
	}
}
