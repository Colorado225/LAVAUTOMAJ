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
// organization. A Clerk identity can belong to several organizations, so each
// (organization_id, clerk_user_id) pair maps to its own membership row.
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

// EnsureDefaultMembership creates (or refreshes) the "self" membership of a
// Clerk profile in Neon (user.created) and syncs profile fields across every
// existing membership of that identity (user.updated). Chaque membership garde
// son organization_id/role/status : une sync de profil ne déplace ni ne
// rétrograde jamais un membre.
func (s *UserStore) EnsureDefaultMembership(ctx context.Context, u *models.User) (*models.User, error) {
	if u.ClerkUserID == "" {
		return nil, errors.New("clerk_user_id is required")
	}

	// Default organization for new users (unique per Clerk user id).
	var orgID uuid.UUID
	err := s.DB.GetContext(ctx, &orgID, `
		INSERT INTO organizations (clerk_org_id, name, created_at, updated_at)
		VALUES ('self_' || $1, 'Mon espace personnel', NOW(), NOW())
		ON CONFLICT (clerk_org_id) DO UPDATE SET updated_at = NOW()
		RETURNING id`, u.ClerkUserID)
	if err != nil {
		return nil, err
	}

	var selfMembership models.User
	err = s.DB.GetContext(ctx, &selfMembership, `
		INSERT INTO users (id, organization_id, clerk_user_id, first_name, last_name, email, role, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (organization_id, clerk_user_id)
		DO UPDATE SET first_name = EXCLUDED.first_name,
			last_name = EXCLUDED.last_name,
			email = EXCLUDED.email,
			updated_at = NOW()
		RETURNING *`,
		uuid.New(), orgID, u.ClerkUserID, u.FirstName, u.LastName, u.Email,
		models.RoleWasher, models.StatusActive)
	if err != nil {
		return nil, err
	}

	// Propagate profile fields to the other memberships of the same identity
	// (e.g. stations joined later), sans toucher à leur org/role/status.
	_, err = s.DB.ExecContext(ctx, `
		UPDATE users SET first_name = $2, last_name = $3, email = $4, updated_at = NOW()
		WHERE clerk_user_id = $1 AND id <> $5`,
		u.ClerkUserID, u.FirstName, u.LastName, u.Email, selfMembership.ID)
	if err != nil {
		return nil, err
	}

	return &selfMembership, nil
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
