package stores

import (
	"context"
	"database/sql"
	"washpilot-ci-backend/internal/models"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type SiteStore struct {
	DB *sqlx.DB
}

func NewSiteStore(db *sqlx.DB) *SiteStore {
	return &SiteStore{DB: db}
}

func (s *SiteStore) ListByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.Site, error) {
	var sites []models.Site
	err := s.DB.SelectContext(ctx, &sites,
		`SELECT * FROM sites WHERE organization_id = $1 AND is_active = true ORDER BY name`, orgID)
	return sites, err
}

func (s *SiteStore) GetByIDForOrganization(ctx context.Context, id, orgID uuid.UUID) (*models.Site, error) {
	var site models.Site
	err := s.DB.GetContext(ctx, &site,
		`SELECT * FROM sites WHERE id = $1 AND organization_id = $2`, id, orgID)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &site, nil
}
