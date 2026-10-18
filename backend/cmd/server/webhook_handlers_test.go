package main

import (
	"context"
	"net/http/httptest"
	"testing"
	"washpilot-ci-backend/internal/models"

	"github.com/stretchr/testify/assert"
)

func TestHandleUserCreated(t *testing.T) {
	// This is a database integration test, so it requires the test server
	// to be initialized (which depends on TEST_DATABASE_URL).
	if testServer == nil {
		t.Skip("skipping database integration test: testServer is not initialized (is TEST_DATABASE_URL set?)")
	}

	// The user from the webhook payload
	clerkUserID := "user_2g6d5K1bY8f6Z6E5R5A5j5w5J5L"

	// The request body, as if it came from Clerk (real webhook shape:
	// email_addresses + primary_email_address_id)
	payload := `{
		"data": {
			"id": "` + clerkUserID + `",
			"first_name": "Test",
			"last_name": "User",
			"primary_email_address_id": "idn_2g6d5K1bY8f6Z6E5R5A5j5w5J5L",
			"email_addresses": [
				{
					"id": "idn_2g6d5K1bY8f6Z6E5R5A5j5w5J5L",
					"email_address": "created@test.com"
				}
			],
			"created_at": 1627597665000,
			"updated_at": 1627597665000
		},
		"object": "event",
		"type": "user.created"
	}`

	w := httptest.NewRecorder()
	testServer.handleUserCreated(w, []byte(payload))

	assert.Equal(t, 200, w.Code)

	// The user row must exist in Neon with its "self" organization.
	selfOrg, err := testServer.store.OrganizationStore.GetByClerkID(context.Background(), "self_"+clerkUserID)
	assert.NoError(t, err)
	assert.NotNil(t, selfOrg)

	users, err := testServer.store.UserStore.ListByOrganization(context.Background(), selfOrg.ID)
	assert.NoError(t, err)
	assert.Len(t, users, 1)
	assert.Equal(t, clerkUserID, users[0].ClerkUserID)
	assert.Equal(t, "Test", *users[0].FirstName)
	assert.Equal(t, "User", *users[0].LastName)
	assert.Equal(t, "created@test.com", *users[0].Email)
}

func TestHandleUserUpdated(t *testing.T) {
	// This is a database integration test, so it requires the test server
	// to be initialized (which depends on TEST_DATABASE_URL).
	if testServer == nil {
		t.Skip("skipping database integration test: testServer is not initialized (is TEST_DATABASE_URL set?)")
	}

	// Same identity as TestHandleUserCreated: profile fields must be synced
	// across memberships without touching organization/role/status.
	clerkUserID := "user_2g6d5K1bY8f6Z6E5R5A5j5w5J5L"

	payload := `{
		"data": {
			"id": "` + clerkUserID + `",
			"first_name": "TestUpdated",
			"last_name": "UserUpdated",
			"primary_email_address_id": "idn_2g6d5K1bY8f6Z6E5R5A5j5w5J5L",
			"email_addresses": [
				{
					"id": "idn_2g6d5K1bY8f6Z6E5R5A5j5w5J5L",
					"email_address": "updated@test.com"
				}
			],
			"updated_at": 1627597665000
		},
		"object": "event",
		"type": "user.updated"
	}`

	w := httptest.NewRecorder()
	testServer.handleUserUpdated(w, []byte(payload))

	assert.Equal(t, 200, w.Code)

	selfOrg, err := testServer.store.OrganizationStore.GetByClerkID(context.Background(), "self_"+clerkUserID)
	assert.NoError(t, err)
	assert.NotNil(t, selfOrg)

	users, err := testServer.store.UserStore.ListByOrganization(context.Background(), selfOrg.ID)
	assert.NoError(t, err)
	assert.Len(t, users, 1)
	assert.Equal(t, "TestUpdated", *users[0].FirstName)
	assert.Equal(t, "UserUpdated", *users[0].LastName)
	assert.Equal(t, "updated@test.com", *users[0].Email)
}

func TestHandleOrganizationMembershipCreated(t *testing.T) {
	// This is a database integration test, so it requires the test server
	// to be initialized (which depends on TEST_DATABASE_URL).
	if testServer == nil {
		t.Skip("skipping database integration test: testServer is not initialized (is TEST_DATABASE_URL set?)")
	}

	// Create a mock organization
	clerkOrgID := "org_2g6d5K1bY8f6Z6E5R5A5j5w5J5L"
	org, err := testServer.store.OrganizationStore.GetByClerkID(context.Background(), clerkOrgID)
	assert.NoError(t, err)
	if org == nil {
		// Create the organization if it doesn't exist
		org, err = testServer.store.OrganizationStore.CreateFromClerk(context.Background(), nil, clerkOrgID)
		assert.NoError(t, err)
	}

	clerkUserID := "user_member_2g6d5K1bY8f6Z6E5R5A5j5w5J5L"

	// Precondition: the user registered first (self org + profile in Neon).
	userPayload := `{
		"data": {
			"id": "` + clerkUserID + `",
			"first_name": "Member",
			"last_name": "User",
			"primary_email_address_id": "idn_member",
			"email_addresses": [
				{
					"id": "idn_member",
					"email_address": "member@test.com"
				}
			],
			"created_at": 1627597665000,
			"updated_at": 1627597665000
		},
		"object": "event",
		"type": "user.created"
	}`
	w := httptest.NewRecorder()
	testServer.handleUserCreated(w, []byte(userPayload))
	assert.Equal(t, 200, w.Code)

	payload := `{
		"data": {
			"organization": {
				"id": "` + org.ClerkOrgID + `"
			},
			"public_user_data": {
				"user_id": "` + clerkUserID + `"
			},
			"role": "org:admin"
		},
		"object": "event",
		"type": "organizationMembership.created"
	}`

	w = httptest.NewRecorder()
	testServer.handleOrganizationMembershipCreated(w, []byte(payload))

	assert.Equal(t, 200, w.Code)

	// Check that the user was added to the organization
	users, err := testServer.store.UserStore.ListByOrganization(context.Background(), org.ID)
	assert.NoError(t, err)
	assert.Len(t, users, 1)
	assert.Equal(t, clerkUserID, users[0].ClerkUserID)
	assert.Equal(t, models.RoleOwner, users[0].Role)
}
