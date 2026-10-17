package stores

import (
	"context"
	"errors"
	"washpilot-ci-backend/internal/models"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

// UserStore provides methods for interacting with organization memberships.
type UserStore struct {
	DB *sqlx.DB
}

// NewUserStore creates a new UserStore.
func NewUserStore(db *sqlx.DB) *UserStore {
	return &UserStore{DB: db}
}

// GetOrCreateMembership provisions the authenticated Clerk user within one
// organization. The same Clerk identity may have a separate internal user row
// in every organization it belongs to.
func (s *UserStore) GetOrCreateMembership(ctx context.Context, orgID uuid.UUID, clerkUserID string, role models.UserRole) (*models.User, error) {
	if orgID == uuid.Nil || clerkUserID == "" {
		return nil, errors.New("organization and Clerk user IDs are required")
	}
	if role == "" {
		role = models.RoleWasher
	}

	var user models.User
	err := s.DB.GetContext(ctx, &user, `
		INSERT INTO users (id, organization_id, clerk_user_id, role, status)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (organization_id, clerk_user_id)
		DO UPDATE SET updated_at = users.updated_at
		RETURNING *`,
		uuid.New(), orgID, clerkUserID, role, models.StatusActive)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// ListByOrganization retrieves memberships for one organization only.
func (s *UserStore) ListByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.User, error) {
	var users []models.User
	query := `SELECT * FROM users WHERE organization_id = $1 ORDER BY created_at, id`
	if err := s.DB.SelectContext(ctx, &users, query, orgID); err != nil {
		return nil, err
	}
	return users, nil
}
