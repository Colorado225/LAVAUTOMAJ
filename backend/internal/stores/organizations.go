package stores

import (
	"context"
	"database/sql"
	"washpilot-ci-backend/internal/models"

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
