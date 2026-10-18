package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/google/uuid"
)

// TestConfirmOnboardingRequiresCompleteStages exercises the real handler with
// an isolated tenant fixture and verifies that an empty onboarding cannot be
// confirmed or provisioned as a dashboard-ready organization.
func TestConfirmOnboardingRequiresCompleteStages(t *testing.T) {
	if testDB == nil || testServer == nil {
		t.Skip("database integration test: TEST_DATABASE_URL is not set")
	}

	ctx := context.Background()
	clerkOrgID := "org_onboarding_test_" + uuid.NewString()
	orgID := uuid.New()
	if _, err := testDB.ExecContext(ctx,
		`INSERT INTO organizations (id, clerk_org_id, name) VALUES ($1, $2, $3)`,
		orgID, clerkOrgID, "Onboarding Test"); err != nil {
		t.Fatalf("failed to create organization fixture: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testDB.ExecContext(ctx, `DELETE FROM organizations WHERE id = $1`, orgID)
	})

	claims := &clerk.SessionClaims{
		Subject: "user_onboarding_test_" + uuid.NewString(),
		Custom:  map[string]interface{}{"org_id": clerkOrgID, "org_role": "org:admin"},
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/onboarding/confirm", nil)
	req = req.WithContext(clerk.ContextWithSessionClaims(req.Context(), claims))
	recorder := httptest.NewRecorder()
	testServer.handleConfirmOnboarding(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected incomplete onboarding to return 400, got %d: %s", recorder.Code, recorder.Body.String())
	}
}
