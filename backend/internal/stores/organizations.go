package stores

import (
	"context"
	"database/sql"
	"washpilot-ci-backend/internal/models"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/jmoiron/sqlx"
)

// OrganizationStore provides methods for interacting with organization data
type OrganizationStore struct {
	DB *sqlx.DB
}

// NewOrganizationStore creates a new OrganizationStore
func NewOrganizationStore(db *sqlx.DB) *OrganizationStore {
	return &OrganizationStore{DB: db}
}

// GetByClerkID retrieves an organization by its Clerk ID
func (s *OrganizationStore) GetByClerkID(ctx context.Context, clerkOrgID string) (*models.Organization, error) {
	var org models.Organization
	query := `SELECT * FROM organizations WHERE clerk_org_id = $1`
	err := s.DB.GetContext(ctx, &org, query, clerkOrgID)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil // No organization found is not a fatal error
		}
		return nil, err
	}
	return &org, nil
}

// CreateFromClerk creates a new organization from Clerk data
func (s *OrganizationStore) CreateFromClerk(ctx context.Context, claims *clerk.SessionClaims, clerkOrgID string) (*models.Organization, error) {
	orgName := "Nouvelle station"
	if claims != nil {
		if customClaims, ok := claims.Custom.(map[string]interface{}); ok {
			if orgSlug, ok := customClaims["org_slug"].(string); ok {
				orgName = orgSlug
			}
		}
	}

	return s.CreateFromWebhook(ctx, clerkOrgID, orgName)
}

// CreateFromWebhook creates a new organization from a Clerk webhook payload.
func (s *OrganizationStore) CreateFromWebhook(ctx context.Context, clerkOrgID, name string) (*models.Organization, error) {
	var org models.Organization
	if name == "" {
		name = "Nouvelle station" // Fallback name
	}
	query := `
		INSERT INTO organizations (clerk_org_id, name)
		VALUES ($1, $2)
		ON CONFLICT (clerk_org_id) DO UPDATE SET name = EXCLUDED.name
		RETURNING *`
	err := s.DB.GetContext(ctx, &org, query, clerkOrgID, name)
	if err != nil {
		return nil, err
	}
	return &org, nil
}
