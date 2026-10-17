package stores

import (
	"context"
	"washpilot-ci-backend/internal/models"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

// UserStore provides methods for interacting with the user data
type UserStore struct {
	DB *sqlx.DB
}

// NewUserStore creates a new UserStore
func NewUserStore(db *sqlx.DB) *UserStore {
	return &UserStore{DB: db}
}

// ListByOrganization retrieves all users for a given organization
func (s *UserStore) ListByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.User, error) {
	var users []models.User
	query := `SELECT * FROM users WHERE organization_id = $1`
	err := s.DB.SelectContext(ctx, &users, query, orgID)
	if err != nil {
		return nil, err
	}
	return users, nil
}
