package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"washpilot-ci-backend/internal/models"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMultiTenantIsolation(t *testing.T) {
	// 1. Setup test data
	org1ClerkID := "org_1"
	org2ClerkID := "org_2"

	org1 := models.Organization{ID: uuid.New(), ClerkOrgID: org1ClerkID, Name: "Org 1"}
	org2 := models.Organization{ID: uuid.New(), ClerkOrgID: org2ClerkID, Name: "Org 2"}

	_, err := testDB.Exec("INSERT INTO organizations (id, clerk_org_id, name) VALUES ($1, $2, $3), ($4, $5, $6)",
		org1.ID, org1.ClerkOrgID, org1.Name, org2.ID, org2.ClerkOrgID, org2.Name)
	require.NoError(t, err)

	user1 := models.User{ID: uuid.New(), ClerkUserID: "user_1", OrganizationID: org1.ID, Email: "user1@test.com"}
	user2 := models.User{ID: uuid.New(), ClerkUserID: "user_2", OrganizationID: org2.ID, Email: "user2@test.com"}

	_, err = testDB.Exec("INSERT INTO users (id, clerk_user_id, organization_id, email) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)",
		user1.ID, user1.ClerkUserID, user1.OrganizationID, user1.Email, user2.ID, user2.ClerkUserID, user2.OrganizationID, user2.Email)
	require.NoError(t, err)

	// 2. Create a request as a user from Org 1
	req := httptest.NewRequest("GET", "/api/v1/users", nil)
	rec := httptest.NewRecorder()

	// 3. Inject a fake session for a user in Org 1
	fakeClaims := clerk.SessionClaims{
		Custom: map[string]interface{}{
			"org_id": org1ClerkID,
		},
		Subject: "user_1",
	}
	ctx := clerk.ContextWithSessionClaims(req.Context(), &fakeClaims)
	req = req.WithContext(ctx)

	// 4. Call the handler by serving the request through the router
	testServer.router.ServeHTTP(rec, req)

	// 5. Assert the response
	assert.Equal(t, http.StatusOK, rec.Code)

	var responseUsers []models.User
	err = json.Unmarshal(rec.Body.Bytes(), &responseUsers)
	require.NoError(t, err)

	// The core assertion: we should only get the user from Org 1
	assert.Len(t, responseUsers, 1)
	assert.Equal(t, user1.ID, responseUsers[0].ID)

	// Cleanup
	_, err = testDB.Exec("DELETE FROM users")
	require.NoError(t, err)
	_, err = testDB.Exec("DELETE FROM organizations")
	require.NoError(t, err)
}
