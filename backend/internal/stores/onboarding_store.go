package stores

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"washpilot-ci-backend/internal/models"

	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

// OnboardingStore gère la progression d'onboarding, les travailleurs,
// les forfaits et la confirmation transactionnelle (§5-§9 du WORKFLOW).
type OnboardingStore struct {
	DB *sqlx.DB
}

func NewOnboardingStore(db *sqlx.DB) *OnboardingStore {
	return &OnboardingStore{DB: db}
}

// GetOrCreateProgress crée la ligne de progression si absente (idempotent).
func (s *OnboardingStore) GetOrCreateProgress(ctx context.Context, orgID uuid.UUID) (*models.OnboardingProgress, error) {
	var p models.OnboardingProgress
	err := s.DB.GetContext(ctx, &p, `
		INSERT INTO onboarding_progress (organization_id, current_stage)
		VALUES ($1, $2)
		ON CONFLICT (organization_id) DO NOTHING
		RETURNING *`,
		orgID, models.StageStation)
	if errors.Is(err, sql.ErrNoRows) {
		err = s.DB.GetContext(ctx, &p, `SELECT * FROM onboarding_progress WHERE organization_id = $1`, orgID)
	}
	return &p, err
}

// GetProgress récupère la progression existante (nil si absente).
func (s *OnboardingStore) GetProgress(ctx context.Context, orgID uuid.UUID) (*models.OnboardingProgress, error) {
	var p models.OnboardingProgress
	err := s.DB.GetContext(ctx, &p, `SELECT * FROM onboarding_progress WHERE organization_id = $1`, orgID)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

// StagePayload — données d'une étape envoyées par le frontend.
type StagePayload struct {
	Stage    string          `json:"stage"`
	Data     json.RawMessage `json:"data"`
	PlanCode *string         `json:"plan_code,omitempty"`
}

// SaveStage sauvegarde une étape et avance current_stage. Idempotent :
// réécrire une étape déjà validée est autorisé sans perdre les suivantes.
func (s *OnboardingStore) SaveStage(ctx context.Context, orgID uuid.UUID, pl StagePayload) (*models.OnboardingProgress, error) {
	stage := models.OnboardingStage(pl.Stage)
	if !stage.IsValid() {
		return nil, errors.New("étape invalide")
	}

	var p models.OnboardingProgress
	var err error

	switch stage {
	case models.StageStation:
		err = s.DB.GetContext(ctx, &p, `
			UPDATE onboarding_progress SET station_data = $2, updated_at = NOW()
			WHERE organization_id = $1 RETURNING *`, orgID, pl.Data)
	case models.StageServices:
		err = s.DB.GetContext(ctx, &p, `
			UPDATE onboarding_progress SET services_data = $2, updated_at = NOW()
			WHERE organization_id = $1 RETURNING *`, orgID, pl.Data)
	case models.StageWorkers:
		err = s.DB.GetContext(ctx, &p, `
			UPDATE onboarding_progress SET workers_data = $2, updated_at = NOW()
			WHERE organization_id = $1 RETURNING *`, orgID, pl.Data)
	case models.StagePlan:
		if pl.PlanCode == nil || *pl.PlanCode == "" {
			return nil, errors.New("forfait manquant")
		}
		err = s.DB.GetContext(ctx, &p, `
			UPDATE onboarding_progress SET plan_code = $2, updated_at = NOW()
			WHERE organization_id = $1 RETURNING *`, orgID, *pl.PlanCode)
	case models.StageReview:
		// rien à persister pour le récapitulatif
		return s.GetOrCreateProgress(ctx, orgID)
	}

	if err != nil {
		return nil, err
	}

	// Avancer l'étape courante si on va vers l'avant (jamais en arrière).
	next := nextStage(stage)
	if next != "" {
		_, err = s.DB.ExecContext(ctx, `
			UPDATE onboarding_progress
			SET current_stage = $2
			WHERE organization_id = $1
			  AND current_stage = $3
			  AND completed_at IS NULL`,
			orgID, next, stage)
		if err != nil {
			return nil, err
		}
	}
	return s.GetProgress(ctx, orgID)
}

func nextStage(stage models.OnboardingStage) models.OnboardingStage {
	switch stage {
	case models.StageStation:
		return models.StageServices
	case models.StageServices:
		return models.StageWorkers
	case models.StageWorkers:
		return models.StagePlan
	case models.StagePlan:
		return models.StageReview
	}
	return ""
}

// IsStageComplete — validation serveur minimale par étape (§4-§7).
func IsStageComplete(stage models.OnboardingStage, p *models.OnboardingProgress) bool {
	switch stage {
	case models.StageStation:
		if p.StationData == nil {
			return false
		}
		var st struct {
			Name *string `json:"name"`
			City *string `json:"city"`
		}
		if err := json.Unmarshal(*p.StationData, &st); err != nil {
			return false
		}
		return st.Name != nil && strings.TrimSpace(*st.Name) != "" &&
			st.City != nil && strings.TrimSpace(*st.City) != ""
	case models.StageServices:
		if p.ServicesData == nil {
			return false
		}
		var sel struct {
			Selected []json.RawMessage `json:"selected"`
			Custom   []json.RawMessage `json:"custom"`
		}
		if err := json.Unmarshal(*p.ServicesData, &sel); err != nil {
			return false
		}
		return len(sel.Selected) > 0 || len(sel.Custom) > 0
	case models.StageWorkers:
		return true // 0 travailleur autorisé (propriétaire seul)
	case models.StagePlan:
		return p.PlanCode != nil && *p.PlanCode != ""
	case models.StageReview:
		return IsStageComplete(models.StageStation, p) &&
			IsStageComplete(models.StageServices, p) &&
			IsStageComplete(models.StagePlan, p)
	}
	return false
}

// PlanByCode récupère un forfait actif par code.
func (s *OnboardingStore) PlanByCode(ctx context.Context, code string) (*models.Plan, error) {
	var plan models.Plan
	err := s.DB.GetContext(ctx, &plan, `SELECT * FROM plans WHERE code = $1 AND is_active = true`, code)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &plan, nil
}

// ListPlans retourne le catalogue de forfaits actifs.
func (s *OnboardingStore) ListPlans(ctx context.Context) ([]models.Plan, error) {
	var plans []models.Plan
	err := s.DB.SelectContext(ctx, &plans, `SELECT * FROM plans WHERE is_active = true ORDER BY sort_order`)
	return plans, err
}

// ListCatalogTemplates retourne les prestations standard de référence.
func (s *OnboardingStore) ListCatalogTemplates(ctx context.Context) ([]models.ServiceCatalogTemplate, error) {
	var items []models.ServiceCatalogTemplate
	err := s.DB.SelectContext(ctx, &items,
		`SELECT * FROM service_catalog_templates ORDER BY sort_order`)
	return items, err
}

// parseDate accepte YYYY-MM-DD (champ date du formulaire travailleur).
func parseDate(s string) (time.Time, error) {
	return time.Parse("2006-01-02", s)
}

// slugify produit un identifiant public lisible depuis le nom de la station.
func slugify(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '_' || r == '\'':
			b.WriteRune('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "station"
	}
	return out
}

// GenerateUniqueSlug garantit l'unicité du slug de station (§4 du WORKFLOW).
func (s *OnboardingStore) GenerateUniqueSlug(ctx context.Context, name string) (string, error) {
	base := slugify(name)
	for i := 0; i < 50; i++ {
		candidate := base
		if i > 0 {
			candidate = base + "-" + strings.Repeat("x", 1) + uuid.NewString()[:4]
		}
		var exists bool
		err := s.DB.GetContext(ctx, &exists,
			`SELECT EXISTS(SELECT 1 FROM organizations WHERE slug = $1)`, candidate)
		if err != nil {
			return "", err
		}
		if !exists {
			return candidate, nil
		}
	}
	return base + "-" + uuid.NewString()[:8], nil
}

// ConfirmOnboarding — enregistrement transactionnel final (§9 du WORKFLOW).
// Idempotent : si l'onboarding est déjà terminé, renvoie l'org sans recréer.
// Retourne (org, alreadyCompleted, err).
func (s *OnboardingStore) ConfirmOnboarding(ctx context.Context, orgID uuid.UUID) (*models.Organization, bool, error) {
	tx, err := s.DB.BeginTxx(ctx, nil)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()

	// Lock the progress row before validation and provisioning. Simultaneous
	// confirmation requests then observe the first commit and remain idempotent.
	var progress models.OnboardingProgress
	err = tx.GetContext(ctx, &progress,
		`SELECT * FROM onboarding_progress WHERE organization_id = $1 FOR UPDATE`, orgID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, false, ErrOnboardingProgressMissing
		}
		return nil, false, err
	}
	if progress.CompletedAt != nil {
		var org models.Organization
		if err := tx.GetContext(ctx, &org, `SELECT * FROM organizations WHERE id = $1`, orgID); err != nil {
			return nil, false, err
		}
		if err := tx.Commit(); err != nil {
			return nil, false, err
		}
		return &org, true, nil
	}

	// Conditions obligatoires (§9.3-9.6) : station complète, ≥1 service, plan.
	if !IsStageComplete(models.StageReview, &progress) {
		return nil, false, ErrOnboardingIncomplete
	}

	var plan models.Plan
	err = tx.GetContext(ctx, &plan,
		`SELECT * FROM plans WHERE code = $1 AND is_active = true`, *progress.PlanCode)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, false, ErrSelectedPlanUnavailable
		}
		return nil, false, err
	}

	var stationData struct {
		Name        string  `json:"name"`
		Phone       *string `json:"phone"`
		Email       *string `json:"email"`
		Address     *string `json:"address"`
		City        string  `json:"city"`
		Description *string `json:"description"`
		LogoURL     *string `json:"logo_url"`
	}
	if err := json.Unmarshal(*progress.StationData, &stationData); err != nil {
		return nil, false, err
	}

	slug, err := s.GenerateUniqueSlug(ctx, stationData.Name)
	if err != nil {
		return nil, false, err
	}

	// 1. Coordonnées de la station + onboarding_completed.
	var org models.Organization
	err = tx.GetContext(ctx, &org, `
		UPDATE organizations SET
			name = $2, phone = $3, email = $4, address = $5, city = $6,
			description = $7, logo_url = $8, slug = $9,
			onboarding_completed = true, updated_at = NOW()
		WHERE id = $1 RETURNING *`,
		orgID, stationData.Name, stationData.Phone, stationData.Email,
		stationData.Address, stationData.City, stationData.Description,
		stationData.LogoURL, slug)
	if err != nil {
		return nil, false, err
	}

	// 2. Provisionner la première station opérationnelle pour le parcours de
	// caisse. L'unicité (organization_id, name) rend la reprise idempotente.
	_, err = tx.ExecContext(ctx, `
		INSERT INTO sites (organization_id, name, address, city, phone, is_active)
		VALUES ($1, $2, $3, $4, $5, true)
		ON CONFLICT (organization_id, name) DO UPDATE SET
			address = EXCLUDED.address,
			city = EXCLUDED.city,
			phone = EXCLUDED.phone,
			is_active = true,
			updated_at = NOW()`,
		orgID, stationData.Name, stationData.Address, stationData.City, stationData.Phone)
	if err != nil {
		return nil, false, err
	}
	// Catégories de véhicule de départ, nécessaires à l'enregistrement d'un
	// lavage dès la première connexion. Les catégories personnalisées sont
	// conservées grâce à la contrainte unique tenant + nom.
	_, err = tx.ExecContext(ctx, `
		INSERT INTO vehicle_categories (organization_id, name)
		VALUES ($1, 'Voiture'), ($1, 'Moto'), ($1, 'Utilitaire')
		ON CONFLICT (organization_id, name) DO NOTHING`, orgID)
	if err != nil {
		return nil, false, err
	}

	// 3. Services choisis + personnalisés copiés dans la table services de l'org.
	if progress.ServicesData != nil {
		var sel struct {
			Selected []struct {
				TemplateID string `json:"template_id"`
				Name       string `json:"name"`
				PriceCents *int64 `json:"price_cents"`
			} `json:"selected"`
			Custom []struct {
				Name       string `json:"name"`
				Category   string `json:"category"`
				PriceCents *int64 `json:"price_cents"`
			} `json:"custom"`
		}
		if err := json.Unmarshal(*progress.ServicesData, &sel); err != nil {
			return nil, false, err
		}
		for _, it := range sel.Selected {
			if it.Name == "" {
				continue
			}
			price := int64(0)
			if it.PriceCents != nil {
				price = *it.PriceCents
			}
			_, err = tx.ExecContext(ctx, `
				INSERT INTO services (organization_id, name, price_cents, is_active)
				SELECT $1, $2, $3, true
				WHERE NOT EXISTS (SELECT 1 FROM services WHERE organization_id = $1 AND name = $2)`,
				orgID, it.Name, price)
			if err != nil {
				return nil, false, err
			}
		}
		for _, it := range sel.Custom {
			if strings.TrimSpace(it.Name) == "" {
				continue
			}
			price := int64(0)
			if it.PriceCents != nil {
				price = *it.PriceCents
			}
			// Service personnalisé : exclusivement rattaché à cette station (§5).
			_, err = tx.ExecContext(ctx, `
				INSERT INTO services (organization_id, name, price_cents, is_active)
				VALUES ($1, $2, $3, true)
				ON CONFLICT DO NOTHING`,
				orgID, it.Name, price)
			if err != nil {
				return nil, false, err
			}
		}
	}

	// 4. Travailleurs (0 autorisé si le propriétaire exerce seul).
	if progress.WorkersData != nil {
		var wk struct {
			Workers []struct {
				FirstName  string  `json:"first_name"`
				LastName   string  `json:"last_name"`
				Phone      *string `json:"phone"`
				District   *string `json:"district"`
				Role       string  `json:"role"`
				CustomRole *string `json:"custom_role"`
				JoinedAt   *string `json:"joined_at"`
			} `json:"workers"`
		}
		if err := json.Unmarshal(*progress.WorkersData, &wk); err != nil {
			return nil, false, err
		}
		for _, w := range wk.Workers {
			if strings.TrimSpace(w.FirstName) == "" || strings.TrimSpace(w.LastName) == "" {
				continue
			}
			role := models.WorkerRole(w.Role)
			switch role {
			case models.WorkerRoleCarWasher, models.WorkerRoleMotoWasher,
				models.WorkerRoleVersatileWasher, models.WorkerRoleTeamLead, models.WorkerRoleCustom:
			default:
				role = models.WorkerRoleVersatileWasher
			}
			var joinedAt *time.Time
			if w.JoinedAt != nil && *w.JoinedAt != "" {
				t, err := parseDate(*w.JoinedAt)
				if err == nil {
					joinedAt = &t
				}
			}
			_, err = tx.ExecContext(ctx, `
				INSERT INTO workers (organization_id, first_name, last_name, phone, district, role, custom_role, joined_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
				orgID, w.FirstName, w.LastName, w.Phone, w.District, role, w.CustomRole, joinedAt)
			if err != nil {
				return nil, false, err
			}
		}
	}

	// 5. Abonnement — Free actif, payant en attente (jamais de paiement simulé, §7).
	state := models.SubStateActive
	var startedAt *time.Time
	if plan.PriceCents > 0 {
		state = models.SubStatePending
	} else {
		now := time.Now()
		startedAt = &now
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO subscriptions (organization_id, plan_id, state, started_at)
		SELECT $1, $2, $3, $4
		WHERE NOT EXISTS (SELECT 1 FROM subscriptions WHERE organization_id = $1)`,
		orgID, plan.ID, state, startedAt)
	if err != nil {
		return nil, false, err
	}

	// 6. Marquer l'onboarding terminé (dernière opération de la transaction).
	if _, err := tx.ExecContext(ctx, `
		UPDATE onboarding_progress SET completed_at = NOW(), updated_at = NOW()
		WHERE organization_id = $1 AND completed_at IS NULL`, orgID); err != nil {
		return nil, false, err
	}

	if err := tx.Commit(); err != nil {
		return nil, false, err
	}
	return &org, false, nil
}

// GetOrganization récupère une organisation par id.
func (s *OnboardingStore) GetOrganization(ctx context.Context, orgID uuid.UUID) (*models.Organization, error) {
	var org models.Organization
	err := s.DB.GetContext(ctx, &org, `SELECT * FROM organizations WHERE id = $1`, orgID)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &org, nil
}

// CountWorkersByOrganization — contrôle des limites du forfait.
func (s *OnboardingStore) CountWorkersByOrganization(ctx context.Context, orgID uuid.UUID) (int, error) {
	var n int
	err := s.DB.GetContext(ctx, &n, `SELECT COUNT(*) FROM workers WHERE organization_id = $1`, orgID)
	return n, err
}

// ListWorkersByOrganization.
func (s *OnboardingStore) ListWorkersByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.Worker, error) {
	var items []models.Worker
	err := s.DB.SelectContext(ctx, &items,
		`SELECT * FROM workers WHERE organization_id = $1 ORDER BY created_at`, orgID)
	return items, err
}

// ListSubscriptionsByOrganization.
func (s *OnboardingStore) ListSubscriptionsByOrganization(ctx context.Context, orgID uuid.UUID) ([]models.Subscription, error) {
	var items []models.Subscription
	err := s.DB.SelectContext(ctx, &items,
		`SELECT * FROM subscriptions WHERE organization_id = $1 ORDER BY created_at DESC`, orgID)
	return items, err
}

// GetActiveSubscription returns the most recent subscription and its plan for an org.
func (s *OnboardingStore) GetActiveSubscription(ctx context.Context, orgID uuid.UUID) (*models.Subscription, *models.Plan, error) {
	var sub models.Subscription
	err := s.DB.GetContext(ctx, &sub, `
		SELECT * FROM subscriptions WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`, orgID)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil, nil
		}
		return nil, nil, err
	}
	var plan models.Plan
	err = s.DB.GetContext(ctx, &plan, `SELECT * FROM plans WHERE id = $1`, sub.PlanID)
	if err != nil {
		return &sub, nil, err
	}
	return &sub, &plan, nil
}
