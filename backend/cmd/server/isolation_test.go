package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"washpilot-ci-backend/internal/models"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/google/uuid"
)

func TestMultiTenantIsolation(t *testing.T) {
	if testDB == nil || testServer == nil {
		t.Skip("database integration test: TEST_DATABASE_URL is not set")
	}

	ctx := context.Background()
	org1ID := uuid.New()
	org2ID := uuid.New()
	clerkOrg1ID := "org_test_" + uuid.NewString()
	clerkOrg2ID := "org_test_" + uuid.NewString()
	planID := uuid.New()
	user1ID := uuid.New()
	user2ID := uuid.New()
	site1ID := uuid.New()
	site2ID := uuid.New()

	// Every fixture is uniquely identified and cleanup is scoped to those IDs.
	// In particular, this test must never clear shared users/organizations.
	t.Cleanup(func() {
		_, _ = testDB.ExecContext(ctx, `DELETE FROM cash_movements WHERE organization_id IN ($1, $2)`, org1ID, org2ID)
		_, _ = testDB.ExecContext(ctx, `DELETE FROM cash_sessions WHERE organization_id IN ($1, $2)`, org1ID, org2ID)
		_, _ = testDB.ExecContext(ctx, `DELETE FROM payments WHERE organization_id IN ($1, $2)`, org1ID, org2ID)
		_, _ = testDB.ExecContext(ctx, `DELETE FROM washes WHERE organization_id IN ($1, $2)`, org1ID, org2ID)
		_, _ = testDB.ExecContext(ctx, `DELETE FROM sites WHERE organization_id IN ($1, $2)`, org1ID, org2ID)
		_, _ = testDB.ExecContext(ctx, `DELETE FROM users WHERE id IN ($1, $2)`, user1ID, user2ID)
		_, _ = testDB.ExecContext(ctx, `DELETE FROM organizations WHERE id IN ($1, $2)`, org1ID, org2ID)
		_, _ = testDB.ExecContext(ctx, `DELETE FROM plans WHERE id = $1`, planID)
	})

	planCode := "iso-" + uuid.NewString()[:8]
	_, err := testDB.ExecContext(ctx, `INSERT INTO plans (id, code, name, price_cents) VALUES ($1, $2, 'Isolation Test Plan', 0)`, planID, planCode)
	if err != nil {
		t.Fatalf("failed to create plan fixture: %v", err)
	}

	_, err = testDB.ExecContext(ctx, `INSERT INTO organizations (id, clerk_org_id, name) VALUES ($1, $2, 'Org 1'), ($3, $4, 'Org 2')`, org1ID, clerkOrg1ID, org2ID, clerkOrg2ID)
	if err != nil {
		t.Fatalf("failed to create organization fixtures: %v", err)
	}

	_, err = testDB.ExecContext(ctx, `INSERT INTO users (id, organization_id, clerk_user_id, email, first_name, last_name, role) VALUES ($1, $2, 'user_1', 'user1@example.com', 'User', 'One', 'owner'), ($3, $4, 'user_2', 'user2@example.com', 'User', 'Two', 'owner')`, user1ID, org1ID, user2ID, org2ID)
	if err != nil {
		t.Fatalf("failed to create user fixtures: %v", err)
	}

	_, err = testDB.ExecContext(ctx, `INSERT INTO sites (id, organization_id, name, address, city, phone) VALUES ($1, $2, 'Site 1', 'Address 1', 'City', '+22500000001'), ($3, $4, 'Site 2', 'Address 2', 'City', '+22500000002')`, site1ID, org1ID, site2ID, org2ID)
	if err != nil {
		t.Fatalf("failed to create site fixtures: %v", err)
	}

	wash1ID := uuid.New()
	wash2ID := uuid.New()
	_, err = testDB.ExecContext(ctx, `INSERT INTO washes (id, organization_id, site_id, reference, total_cents, author_id) VALUES ($1, $2, $3, $4, 5000, $5), ($6, $7, $8, $9, 10000, $10)`, wash1ID, org1ID, site1ID, "iso-wash-"+uuid.NewString()[:8], user1ID, wash2ID, org2ID, site2ID, "iso-wash-"+uuid.NewString()[:8], user2ID)
	if err != nil {
		t.Fatalf("failed to create wash fixtures: %v", err)
	}

	// A request authenticated as org 1 must not be able to read org 2's data.
	claims := &clerk.SessionClaims{
		Subject: "user_1",
		Custom:  map[string]interface{}{"org_id": clerkOrg1ID},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/washes", nil)
	req = req.WithContext(clerk.ContextWithSessionClaims(req.Context(), claims))
	recorder := httptest.NewRecorder()
	testServer.handleListWashes(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var washes []models.Wash
	if err := json.Unmarshal(recorder.Body.Bytes(), &washes); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(washes) != 1 {
		t.Fatalf("expected 1 wash, got %d", len(washes))
	}
	if washes[0].OrganizationID != org1ID {
		t.Fatalf("expected wash for org1, got org %s", washes[0].OrganizationID)
	}
}

func TestCreatePaymentRequiresOrganization(t *testing.T) {
	// This guard test is deliberately independent of PostgreSQL.
	server := &ApiServer{logger: slog.Default()}
	body := []byte(`{"wash_id":"` + uuid.NewString() + `","amount_cents":5000,"method":"cash"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	server.handleCreatePayment(recorder, req)
	if recorder.Code != http.StatusUnauthorized && recorder.Code != http.StatusForbidden {
		t.Fatalf("expected unauthenticated payment request to be rejected, got %d", recorder.Code)
	}
}
