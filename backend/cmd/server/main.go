package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
	"washpilot-ci-backend/internal/config"
	"washpilot-ci-backend/internal/database"
	"washpilot-ci-backend/internal/logger"
	"washpilot-ci-backend/internal/models"
	"washpilot-ci-backend/internal/stores"

	"github.com/clerk/clerk-sdk-go/v2"
	clerkhttp "github.com/clerk/clerk-sdk-go/v2/http"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	svix "github.com/svix/svix-webhooks/go"
)

var (
	ErrNoClaims       = errors.New("no claims in context")
	ErrNoCustomClaims = errors.New("no custom claims")
	ErrNoOrg          = errors.New("no org_id in claims")
	ErrOrgNotFound    = errors.New("organization not found")
)

type ApiServer struct {
	listenAddr   string
	db           *sqlx.DB
	store        *stores.Store
	config       *config.Config
	logger       *slog.Logger
	router       http.Handler
	clerkWebhook *svix.Webhook
}

func NewApiServer(listenAddr string, db *sqlx.DB, cfg *config.Config, logger *slog.Logger) *ApiServer {
	var wh *svix.Webhook
	if cfg.ClerkWebhookSecret != "" {
		var err error
		wh, err = svix.NewWebhook(cfg.ClerkWebhookSecret)
		if err != nil {
			logger.Error("failed to create clerk webhook", "error", err)
			os.Exit(1)
		}
	} else {
		logger.Warn("Clerk webhook secret is not set, webhook verification is disabled")
	}

	server := &ApiServer{
		listenAddr:   listenAddr,
		db:           db,
		store:        stores.NewStore(db),
		config:       cfg,
		logger:       logger,
		clerkWebhook: wh,
	}
	server.setupRouter()
	return server
}

func (s *ApiServer) withRole(roles ...models.UserRole) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := clerk.SessionClaimsFromContext(r.Context())
			if !ok {
				http.Error(w, "no claims in context", http.StatusUnauthorized)
				return
			}

			userRole := roleFromClerkClaims(claims)
			allowed := false
			for _, role := range roles {
				if userRole == role {
					allowed = true
					break
				}
			}

			if !allowed {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func (s *ApiServer) setupRouter() {
	r := chi.NewRouter()

	r.Use(s.corsMiddleware)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("OK"))
	})

	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := s.db.Ping(); err != nil {
			s.logger.Error("database not ready", "error", err)
			http.Error(w, "database not ready", http.StatusInternalServerError)
			return
		}
		w.Write([]byte("OK"))
	})

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(clerkhttp.RequireHeaderAuthorization())

		// Routes accessibles à TOUS les utilisateurs authentifiés (minimum RoleWasher)
		r.Get("/vehicle-categories", s.handleListVehicleCategories)
		r.Get("/service-categories", s.handleListServiceCategories)
		r.Get("/services", s.handleListServices)
		r.Get("/sites", s.handleListSites)
		r.Get("/washes", s.handleListWashes)
		r.Get("/washes/{washID}", s.handleGetWash)
		r.Get("/dashboard/metrics", s.handleGetDashboardMetrics)
		r.Get("/onboarding/status", s.handleOnboardingStatus)
		r.Get("/onboarding/progress", s.handleGetOnboardingProgress)
		r.Put("/onboarding/progress", s.handleSaveOnboardingProgress)
		r.Get("/onboarding/summary", s.handleOnboardingSummary)
		r.Post("/onboarding/confirm", s.handleConfirmOnboarding)
		r.Get("/plans", s.handleListPlans)
		r.Get("/service-catalog", s.handleListServiceCatalog)
		r.Get("/workers", s.handleListWorkers)

		// Routes LAVEURS : création de lavages uniquement (tous les rôles)
		r.Group(func(r chi.Router) {
			r.Use(s.withRole(models.RoleOwner, models.RoleManager, models.RoleCashier, models.RoleWasher))
			r.Post("/washes", s.handleCreateWash)
		})

		// Routes CAISSIERS : gestion de caisse et paiements uniquement
		r.Group(func(r chi.Router) {
			r.Use(s.withRole(models.RoleOwner, models.RoleManager, models.RoleCashier))
			// Sessions de caisse
			r.Get("/cash-sessions/current", s.handleGetCurrentCashSession)
			r.Post("/cash-sessions/open", s.handleOpenCashSession)
			r.Get("/cash-sessions/{sessionID}/movements", s.handleListCashMovements)
			r.Post("/cash-sessions/{sessionID}/movements", s.handleAddCashMovement)
			r.Post("/cash-sessions/{sessionID}/close", s.handleCloseCashSession)
			// Paiements
			r.Get("/payments", s.handleListPayments)
			r.Post("/payments", s.handleCreatePayment)
		})

		// Routes GESTIONNAIRES : dépenses, modification des catégories/services
		r.Group(func(r chi.Router) {
			r.Use(s.withRole(models.RoleOwner, models.RoleManager))
			// Dépenses
			r.Get("/expenses", s.handleListExpenses)
			r.Post("/expenses", s.handleCreateExpense)
			r.Get("/expenses/{expenseID}", s.handleGetExpense)
			r.Post("/expenses/{expenseID}/cancel", s.handleCancelExpense)
			// Catégories de véhicules
			r.Post("/vehicle-categories", s.handleCreateVehicleCategory)
			r.Patch("/vehicle-categories/{categoryID}", s.handleUpdateVehicleCategory)
			r.Post("/vehicle-categories/{categoryID}/deactivate", s.handleDeactivateVehicleCategory)
			// Catégories de services
			r.Post("/service-categories", s.handleCreateServiceCategory)
			r.Patch("/service-categories/{categoryID}", s.handleUpdateServiceCategory)
			r.Post("/service-categories/{categoryID}/deactivate", s.handleDeactivateServiceCategory)
			// Services
			r.Post("/services", s.handleCreateService)
			r.Patch("/services/{serviceID}", s.handleUpdateService)
			r.Post("/services/{serviceID}/deactivate", s.handleDeactivateService)
			// Annulation de lavages
			r.Post("/washes/{washID}/cancel", s.handleCancelWash)
			// Liste des utilisateurs
			r.Get("/users", s.handleListUsers)
		})

		// Routes OWNER uniquement
		r.Group(func(r chi.Router) {
			r.Use(s.withRole(models.RoleOwner))
			r.Get("/admin/dashboard", func(w http.ResponseWriter, r *http.Request) {
				w.Write([]byte("Welcome to the admin dashboard!"))
			})
		})
	})

	r.Post("/api/v1/clerk-webhook", s.handleClerkWebhook)

	s.router = r
}


func (s *ApiServer) handleGetDashboardMetrics(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}

	metrics, err := s.store.WashStore.GetDashboardMetrics(r.Context(), orgID)
	if err != nil {
		s.logger.Error("failed to compute metrics", "error", err, "organization_id", orgID)
		http.Error(w, "failed to compute metrics", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metrics)
}

// Handlers du workflow d'onboarding (§3-§9 de docs/WORKFLOW.md).
// Toutes les requêtes exigent un jeton Clerk valide et un claim org_id ;
// l'état de configuration est TOUJOURS déterminé côté serveur.

type onboardingStatusResponse struct {
	State        string               `json:"state"` // not_started | in_progress | completed
	CurrentStage string               `json:"current_stage"`
	OrgName      string               `json:"org_name"`
	Station      *models.Organization `json:"station,omitempty"`
}

// resolveOrg — authentifie, auto-provisionne l'organisation si le claim
// org_id de Clerk est connu mais absent en base, et renvoie l'org.
func (s *ApiServer) resolveOrg(w http.ResponseWriter, r *http.Request) (*models.Organization, bool) {
	org, ok := s.getOrgFromContext(w, r)
	if !ok {
		return nil, false
	}
	// Auto-provisionnement : première connexion avec une org Clerk existante
	// mais pas encore enregistrée en base.
	if org == nil {
		return nil, false
	}
	return org, true
}

// handleOnboardingStatus — détection de l'état de configuration (§3, §4).
func (s *ApiServer) handleOnboardingStatus(w http.ResponseWriter, r *http.Request) {
	org, ok := s.getOrgFromContext(w, r)
	if !ok {
		return
	}

	progress, err := s.store.OnboardingStore.GetProgress(r.Context(), org.ID)
	if err != nil {
		s.logger.Error("onboarding: failed to load progress", "error", err, "org_id", org.ID)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	resp := onboardingStatusResponse{OrgName: org.Name}
	switch {
	case org.OnboardingCompleted:
		resp.State = "completed"
		resp.CurrentStage = string(models.StageReview)
		resp.Station = org
	case progress == nil:
		resp.State = "not_started"
		resp.CurrentStage = string(models.StageStation)
	default:
		resp.State = "in_progress"
		resp.CurrentStage = string(progress.CurrentStage)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handleGetOnboardingProgress — reprise du parcours à l'étape sauvegardée (§8).
func (s *ApiServer) handleGetOnboardingProgress(w http.ResponseWriter, r *http.Request) {
	org, ok := s.getOrgFromContext(w, r)
	if !ok {
		return
	}
	if org.OnboardingCompleted {
		http.Error(w, "onboarding already completed", http.StatusConflict)
		return
	}
	progress, err := s.store.OnboardingStore.GetOrCreateProgress(r.Context(), org.ID)
	if err != nil {
		s.logger.Error("onboarding: failed to load progress", "error", err, "org_id", org.ID)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(progress)
}

// handleSaveOnboardingProgress — sauvegarde d'une étape avec validation serveur.
func (s *ApiServer) handleSaveOnboardingProgress(w http.ResponseWriter, r *http.Request) {
	org, ok := s.getOrgFromContext(w, r)
	if !ok {
		return
	}
	if org.OnboardingCompleted {
		http.Error(w, "onboarding already completed", http.StatusConflict)
		return
	}

	var pl stores.StagePayload
	if err := json.NewDecoder(r.Body).Decode(&pl); err != nil {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}
	stage := models.OnboardingStage(pl.Stage)
	if !stage.IsValid() {
		http.Error(w, "étape invalide", http.StatusBadRequest)
		return
	}
	if err := validateStagePayload(stage, pl.Data); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	progress, err := s.store.OnboardingStore.SaveStage(r.Context(), org.ID, pl)
	if err != nil {
		s.logger.Error("onboarding: failed to save stage", "error", err, "org_id", org.ID, "stage", pl.Stage)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(progress)
}

// validateStagePayload — validation de format stricte par étape (§13).
func validateStagePayload(stage models.OnboardingStage, data json.RawMessage) error {
	if stage == models.StageReview || data == nil {
		return nil
	}
	switch stage {
	case models.StageStation:
		var st struct {
			Name  string  `json:"name"`
			Phone *string `json:"phone"`
			City  string  `json:"city"`
		}
		if err := json.Unmarshal(data, &st); err != nil {
			return errors.New("données de station invalides")
		}
		if len(st.Name) < 2 || len(st.Name) > 255 {
			return errors.New("le nom de la station doit contenir entre 2 et 255 caractères")
		}
		if len(st.City) == 0 || len(st.City) > 120 {
			return errors.New("la ville ou commune est obligatoire")
		}
		if st.Phone != nil && *st.Phone != "" && (len(*st.Phone) < 8 || len(*st.Phone) > 30) {
			return errors.New("numéro de téléphone invalide")
		}
	case models.StageServices:
		var sel struct {
			Selected []struct {
				TemplateID *string `json:"template_id"`
				Name       string  `json:"name"`
				PriceCents *int64  `json:"price_cents"`
			} `json:"selected"`
			Custom []struct {
				Name       string `json:"name"`
				Category   string `json:"category"`
				PriceCents *int64 `json:"price_cents"`
			} `json:"custom"`
		}
		if err := json.Unmarshal(data, &sel); err != nil {
			return errors.New("données de services invalides")
		}
		if len(sel.Selected) == 0 && len(sel.Custom) == 0 {
			return errors.New("sélectionnez au moins un service")
		}
		if len(sel.Custom) > 30 {
			return errors.New("trop de services personnalisés")
		}
		for _, c := range sel.Custom {
			if len(c.Name) < 2 || len(c.Name) > 100 {
				return errors.New("nom de service personnalisé invalide (2 à 100 caractères)")
			}
		}
	case models.StageWorkers:
		var wk struct {
			Workers []struct {
				FirstName  string  `json:"first_name"`
				LastName   string  `json:"last_name"`
				Phone      *string `json:"phone"`
				Role       string  `json:"role"`
				CustomRole *string `json:"custom_role"`
			} `json:"workers"`
		}
		if err := json.Unmarshal(data, &wk); err != nil {
			return errors.New("données des travailleurs invalides")
		}
		if len(wk.Workers) > 100 {
			return errors.New("trop de travailleurs")
		}
		for _, wkItem := range wk.Workers {
			if len(wkItem.FirstName) < 1 || len(wkItem.LastName) < 1 {
				return errors.New("nom et prénom du travailleur obligatoires")
			}
			switch models.WorkerRole(wkItem.Role) {
			case models.WorkerRoleCarWasher, models.WorkerRoleMotoWasher,
				models.WorkerRoleVersatileWasher, models.WorkerRoleTeamLead, models.WorkerRoleCustom:
			default:
				return errors.New("fonction de travailleur invalide")
			}
			if models.WorkerRole(wkItem.Role) == models.WorkerRoleCustom &&
				(wkItem.CustomRole == nil || len(*wkItem.CustomRole) < 2) {
				return errors.New("précisez la fonction personnalisée")
			}
		}
	case models.StagePlan:
		// validé via plan_code dans StagePayload
	}
	return nil
}

// handleOnboardingSummary — récapitulatif final (§9).
func (s *ApiServer) handleOnboardingSummary(w http.ResponseWriter, r *http.Request) {
	org, ok := s.getOrgFromContext(w, r)
	if !ok {
		return
	}
	progress, err := s.store.OnboardingStore.GetProgress(r.Context(), org.ID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if progress == nil {
		http.Error(w, "aucune progression d'onboarding", http.StatusNotFound)
		return
	}

	var plan *models.Plan
	if progress.PlanCode != nil {
		plan, err = s.store.OnboardingStore.PlanByCode(r.Context(), *progress.PlanCode)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
	}

	summary := map[string]interface{}{
		"station":   progress.StationData,
		"services":  progress.ServicesData,
		"workers":   progress.WorkersData,
		"plan":      plan,
		"completed": progress.CompletedAt != nil,
		"org_name":  org.Name,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(summary)
}

// handleConfirmOnboarding — enregistrement transactionnel idempotent (§9).
func (s *ApiServer) handleConfirmOnboarding(w http.ResponseWriter, r *http.Request) {
	org, ok := s.getOrgFromContext(w, r)
	if !ok {
		return
	}

	updatedOrg, alreadyCompleted, err := s.store.OnboardingStore.ConfirmOnboarding(r.Context(), org.ID)
	if err != nil {
		s.logger.Error("onboarding: confirmation failed", "error", err, "org_id", org.ID)
		status := http.StatusInternalServerError
		if errors.Is(err, stores.ErrOnboardingIncomplete) ||
			errors.Is(err, stores.ErrSelectedPlanUnavailable) ||
			errors.Is(err, stores.ErrOnboardingProgressMissing) {
			status = http.StatusBadRequest
		}
		http.Error(w, err.Error(), status)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if alreadyCompleted {
		// Idempotence : double soumission → même résultat, pas de re-création.
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"organization":      updatedOrg,
			"already_completed": true,
		})
		return
	}
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"organization":      updatedOrg,
		"already_completed": false,
	})
}

// handleListPlans — catalogue de forfaits depuis la base (§7).
func (s *ApiServer) handleListPlans(w http.ResponseWriter, r *http.Request) {
	plans, err := s.store.OnboardingStore.ListPlans(r.Context())
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(plans)
}

// handleListServiceCatalog — prestations standard de référence (§5).
func (s *ApiServer) handleListServiceCatalog(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.OnboardingStore.ListCatalogTemplates(r.Context())
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

// handleListWorkers — travailleurs de l'organisation (§6, réutilisé par /team).
func (s *ApiServer) handleListWorkers(w http.ResponseWriter, r *http.Request) {
	org, ok := s.getOrgFromContext(w, r)
	if !ok {
		return
	}
	items, err := s.store.OnboardingStore.ListWorkersByOrganization(r.Context(), org.ID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

func (s *ApiServer) Run() {
	s.logger.Info("Starting server", "address", s.listenAddr)
	if err := http.ListenAndServe(s.listenAddr, s.router); err != nil {
		s.logger.Error("Failed to start server", "error", err)
		os.Exit(1)
	}
}

func (s *ApiServer) handleListUsers(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	users, err := s.store.UserStore.ListByOrganization(r.Context(), orgID)
	if err != nil {
		s.logger.Error("failed to list users", "error", err, "organization_id", orgID)
		http.Error(w, "failed to list users", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}

// clerkOrganizationFromRequest extracts the signed Clerk session and active
// organization claim without trusting client-provided identifiers.
func clerkOrganizationFromRequest(r *http.Request) (*clerk.SessionClaims, string, error) {
	claims, ok := clerk.SessionClaimsFromContext(r.Context())
	if !ok {
		return nil, "", ErrNoClaims
	}
	customClaims, ok := claims.Custom.(map[string]interface{})
	if !ok {
		return nil, "", ErrNoCustomClaims
	}
	clerkOrgID, ok := customClaims["org_id"].(string)
	if !ok || clerkOrgID == "" {
		return nil, "", ErrNoOrg
	}
	return claims, clerkOrgID, nil
}

func roleFromClerkClaims(claims *clerk.SessionClaims) models.UserRole {
	if claims != nil {
		if customClaims, ok := claims.Custom.(map[string]interface{}); ok {
			if role, ok := customClaims["org_role"].(string); ok && role == "org:admin" {
				return models.RoleOwner
			}
		}
	}
	// Least privilege for ordinary members; applications can promote them
	// through a separately authorized role-management flow.
	return models.RoleWasher
}

func (s *ApiServer) ensureInternalUser(r *http.Request, orgID uuid.UUID, claims *clerk.SessionClaims) (*models.User, error) {
	if claims == nil || claims.Subject == "" {
		return nil, errors.New("missing Clerk user subject")
	}
	return s.store.UserStore.GetOrCreateMembership(r.Context(), orgID, claims.Subject, roleFromClerkClaims(claims))
}

// getOrganizationIDFromClaims maps the active Clerk organization to the
// tenant's internal UUID.
func (s *ApiServer) getOrganizationIDFromClaims(r *http.Request) (uuid.UUID, error) {
	_, clerkOrgID, err := clerkOrganizationFromRequest(r)
	if err != nil {
		return uuid.Nil, err
	}
	org, err := s.store.OrganizationStore.GetByClerkID(r.Context(), clerkOrgID)
	if err != nil {
		return uuid.Nil, err
	}
	if org == nil {
		return uuid.Nil, ErrOrgNotFound
	}
	return org.ID, nil
}

// getOrgFromContext resolves the tenant for onboarding. A Clerk organization
// may not yet have an internal row; provision it once, then provision the
// authenticated user's membership before any foreign-key-backed writes.
func (s *ApiServer) getOrgFromContext(w http.ResponseWriter, r *http.Request) (*models.Organization, bool) {
	claims, clerkOrgID, err := clerkOrganizationFromRequest(r)
	if err != nil {
		status := http.StatusForbidden
		if errors.Is(err, ErrNoClaims) {
			status = http.StatusUnauthorized
		}
		http.Error(w, "active organization is required", status)
		return nil, false
	}

	org, err := s.store.OrganizationStore.GetByClerkID(r.Context(), clerkOrgID)
	if err != nil {
		s.logger.Error("failed to retrieve organization", "error", err, "clerk_org_id", clerkOrgID)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return nil, false
	}
	if org == nil {
		org, err = s.store.OrganizationStore.CreateFromClerk(r.Context(), claims, clerkOrgID)
		if err != nil {
			s.logger.Error("failed to auto-provision organization", "error", err, "clerk_org_id", clerkOrgID)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return nil, false
		}
	}
	if _, err := s.ensureInternalUser(r, org.ID, claims); err != nil {
		s.logger.Error("failed to provision organization membership", "error", err, "organization_id", org.ID)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return nil, false
	}
	return org, true
}

// hasEntitlement vérifie si l'organisation possède la fonctionnalité donnée
// selon son abonnement actif.
func (s *ApiServer) hasEntitlement(ctx context.Context, orgID uuid.UUID, key string) bool {
	sub, plan, err := s.store.OnboardingStore.GetActiveSubscription(ctx, orgID)
	if err != nil || sub == nil || plan == nil {
		return false
	}
	switch sub.State {
	case models.SubStateActive, models.SubStateTrialing:
	default:
		return false
	}
	var features map[string]bool
	if err := json.Unmarshal(plan.Features, &features); err != nil {
		return false
	}
	return features[key]
}

func (s *ApiServer) requireActor(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	orgID, err := s.getOrganizationIDFromClaims(r)
	if err != nil {
		status := http.StatusForbidden
		if errors.Is(err, ErrNoClaims) {
			status = http.StatusUnauthorized
		}
		s.logger.Warn("organization not resolved from claims", "error", err)
		http.Error(w, "active organization is required", status)
		return uuid.Nil, uuid.Nil, false
	}
	claims, _, err := clerkOrganizationFromRequest(r)
	if err != nil {
		http.Error(w, "active organization is required", http.StatusForbidden)
		return uuid.Nil, uuid.Nil, false
	}
	user, err := s.ensureInternalUser(r, orgID, claims)
	if err != nil {
		s.logger.Error("failed to provision organization membership", "error", err, "organization_id", orgID)
		http.Error(w, "could not provision organization membership", http.StatusInternalServerError)
		return uuid.Nil, uuid.Nil, false
	}
	return orgID, user.ID, true
}

func (s *ApiServer) requireOrg(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	orgID, _, ok := s.requireActor(w, r)
	return orgID, ok
}

// ---------- Sites and washes ----------

func (s *ApiServer) handleListSites(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	sites, err := s.store.SiteStore.ListByOrganization(r.Context(), orgID)
	if err != nil {
		s.logger.Error("failed to list sites", "error", err, "organization_id", orgID)
		http.Error(w, "failed to list sites", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sites)
}

func (s *ApiServer) handleListWashes(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	washes, err := s.store.WashStore.ListByOrganization(r.Context(), orgID)
	if err != nil {
		s.logger.Error("failed to list washes", "error", err, "organization_id", orgID)
		http.Error(w, "failed to list washes", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(washes)
}

type createWashItemRequest struct {
	ServiceID string `json:"service_id"`
	Quantity  int    `json:"quantity"`
}

type createWashRequest struct {
	SiteID            string                  `json:"site_id"`
	VehicleCategoryID string                  `json:"vehicle_category_id"`
	Items             []createWashItemRequest `json:"items"`
	WorkerIDs         []string                `json:"worker_ids"`
	PaymentMethod     string                  `json:"payment_method"`
	AmountReceived    int64                   `json:"amount_received_cents"`
	CashSessionID     *string                 `json:"cash_session_id"`
}

func (s *ApiServer) handleCreateWash(w http.ResponseWriter, r *http.Request) {
	orgID, actorID, ok := s.requireActor(w, r)
	if !ok {
		return
	}
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idempotencyKey == "" {
		http.Error(w, "Idempotency-Key header is required", http.StatusBadRequest)
		return
	}

	var req createWashRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	siteID, err := uuid.Parse(req.SiteID)
	if err != nil {
		http.Error(w, "invalid site_id", http.StatusBadRequest)
		return
	}
	vehicleCategoryID, err := uuid.Parse(req.VehicleCategoryID)
	if err != nil {
		http.Error(w, "invalid vehicle_category_id", http.StatusBadRequest)
		return
	}
	items := make([]stores.WashItemInput, 0, len(req.Items))
	for _, item := range req.Items {
		serviceID, err := uuid.Parse(item.ServiceID)
		if err != nil {
			http.Error(w, "invalid service_id", http.StatusBadRequest)
			return
		}
		items = append(items, stores.WashItemInput{ServiceID: serviceID, Quantity: item.Quantity})
	}
	workerIDs := make([]uuid.UUID, 0, len(req.WorkerIDs))
	for _, rawID := range req.WorkerIDs {
		workerID, err := uuid.Parse(rawID)
		if err != nil {
			http.Error(w, "invalid worker_id", http.StatusBadRequest)
			return
		}
		workerIDs = append(workerIDs, workerID)
	}
	var cashSessionID *uuid.UUID
	if req.CashSessionID != nil && strings.TrimSpace(*req.CashSessionID) != "" {
		parsedID, err := uuid.Parse(strings.TrimSpace(*req.CashSessionID))
		if err != nil {
			http.Error(w, "invalid cash_session_id", http.StatusBadRequest)
			return
		}
		cashSessionID = &parsedID
	}

	input := stores.CreateWashInput{
		OrganizationID:      orgID,
		AuthorID:            actorID,
		SiteID:              siteID,
		VehicleCategoryID:   vehicleCategoryID,
		Items:               items,
		WorkerIDs:           workerIDs,
		PaymentMethod:       models.PaymentMethod(strings.TrimSpace(req.PaymentMethod)),
		AmountReceivedCents: req.AmountReceived,
		CashSessionID:       cashSessionID,
		IdempotencyKey:      idempotencyKey,
	}
	detail, replayed, err := s.store.WashStore.Create(r.Context(), input)
	if err != nil {
		switch {
		case errors.Is(err, stores.ErrWashInvalidInput),
			errors.Is(err, stores.ErrWashPaymentExceedsTotal),
			errors.Is(err, stores.ErrCashSessionRequired),
			errors.Is(err, stores.ErrCashSessionNotApplicable):
			http.Error(w, err.Error(), http.StatusBadRequest)
		case errors.Is(err, stores.ErrWashIdempotencyConflict),
			errors.Is(err, stores.ErrCashSessionNotOpen),
			errors.Is(err, stores.ErrCashBalanceOverflow):
			http.Error(w, err.Error(), http.StatusConflict)
		case errors.Is(err, stores.ErrCashSessionSiteMismatch):
			http.Error(w, err.Error(), http.StatusBadRequest)
		case errors.Is(err, stores.ErrWashSiteNotFound),
			errors.Is(err, stores.ErrWashVehicleCategoryNotFound),
			errors.Is(err, stores.ErrWashServiceUnavailable),
			errors.Is(err, stores.ErrWashWorkerUnavailable):
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		default:
			s.logger.Error("failed to create wash", "error", err, "organization_id", orgID)
			http.Error(w, "failed to create wash", http.StatusInternalServerError)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if replayed {
		w.Header().Set("Idempotency-Replayed", "true")
		w.WriteHeader(http.StatusOK)
	} else {
		w.Header().Set("Idempotency-Replayed", "false")
		w.WriteHeader(http.StatusCreated)
	}
	json.NewEncoder(w).Encode(detail)
}

func (s *ApiServer) handleGetWash(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "washID"))
	if err != nil {
		http.Error(w, "invalid wash ID", http.StatusBadRequest)
		return
	}
	detail, err := s.store.WashStore.GetDetailByID(r.Context(), id, orgID)
	if err != nil {
		if errors.Is(err, stores.ErrWashNotFound) {
			http.Error(w, "wash not found", http.StatusNotFound)
			return
		}
		s.logger.Error("failed to load wash detail", "error", err, "wash_id", id, "organization_id", orgID)
		http.Error(w, "failed to load wash detail", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(detail)
}

type cancelWashRequest struct {
	Reason string `json:"reason"`
}

func (s *ApiServer) handleCancelWash(w http.ResponseWriter, r *http.Request) {
	orgID, actorID, ok := s.requireActor(w, r)
	if !ok {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "washID"))
	if err != nil {
		http.Error(w, "invalid wash ID", http.StatusBadRequest)
		return
	}
	var req cancelWashRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	detail, err := s.store.WashStore.Cancel(r.Context(), id, orgID, actorID, req.Reason)
	if err != nil {
		switch {
		case errors.Is(err, stores.ErrWashNotFound):
			http.Error(w, "wash not found", http.StatusNotFound)
		case errors.Is(err, stores.ErrWashCancellationReasonRequired), errors.Is(err, stores.ErrWashInvalidInput):
			http.Error(w, err.Error(), http.StatusBadRequest)
		case errors.Is(err, stores.ErrWashHasVerifiedPayments):
			http.Error(w, "wash has verified payments; record a refund before cancelling it", http.StatusConflict)
		default:
			s.logger.Error("failed to cancel wash", "error", err, "wash_id", id, "organization_id", orgID)
			http.Error(w, "failed to cancel wash", http.StatusInternalServerError)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(detail)
}

// ---------- Vehicle categories ----------

func (s *ApiServer) handleListVehicleCategories(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	items, err := s.store.VehicleCategoryStore.ListByOrganization(r.Context(), orgID)
	if err != nil {
		s.logger.Error("failed to list vehicle categories", "error", err, "organization_id", orgID)
		http.Error(w, "failed to list vehicle categories", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

type createVehicleCategoryRequest struct {
	Name     string `json:"name"`
	IsActive *bool  `json:"is_active"`
}

func (s *ApiServer) handleCreateVehicleCategory(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	var req createVehicleCategoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	isActive := true
	if req.IsActive != nil {
		isActive = *req.IsActive
	}
	c := &models.VehicleCategory{
		ID:             uuid.New(),
		OrganizationID: orgID,
		Name:           req.Name,
		IsActive:       isActive,
	}
	if err := s.store.VehicleCategoryStore.Create(r.Context(), c); err != nil {
		s.logger.Error("failed to create vehicle category", "error", err, "organization_id", orgID)
		http.Error(w, "failed to create vehicle category", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(c)
}

type updateVehicleCategoryRequest struct {
	Name     string `json:"name"`
	IsActive *bool  `json:"is_active"`
}

func (s *ApiServer) handleUpdateVehicleCategory(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	categoryID := chi.URLParam(r, "categoryID")
	id, err := uuid.Parse(categoryID)
	if err != nil {
		http.Error(w, "invalid category ID", http.StatusBadRequest)
		return
	}
	c, err := s.store.VehicleCategoryStore.GetByID(r.Context(), id, orgID)
	if err != nil || c == nil {
		http.Error(w, "vehicle category not found", http.StatusNotFound)
		return
	}
	var req updateVehicleCategoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name != "" {
		c.Name = req.Name
	}
	if req.IsActive != nil {
		c.IsActive = *req.IsActive
	}
	if err := s.store.VehicleCategoryStore.Update(r.Context(), c); err != nil {
		s.logger.Error("failed to update vehicle category", "error", err, "organization_id", orgID)
		http.Error(w, "failed to update vehicle category", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(c)
}

func (s *ApiServer) handleDeactivateVehicleCategory(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	categoryID := chi.URLParam(r, "categoryID")
	id, err := uuid.Parse(categoryID)
	if err != nil {
		http.Error(w, "invalid category ID", http.StatusBadRequest)
		return
	}
	if err := s.store.VehicleCategoryStore.Deactivate(r.Context(), id, orgID); err != nil {
		s.logger.Error("failed to deactivate vehicle category", "error", err, "organization_id", orgID)
		http.Error(w, "failed to deactivate vehicle category", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- Service categories ----------

func (s *ApiServer) handleListServiceCategories(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	items, err := s.store.ServiceCategoryStore.ListByOrganization(r.Context(), orgID)
	if err != nil {
		s.logger.Error("failed to list service categories", "error", err, "organization_id", orgID)
		http.Error(w, "failed to list service categories", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

type createServiceCategoryRequest struct {
	Name     string `json:"name"`
	IsActive *bool  `json:"is_active"`
}

func (s *ApiServer) handleCreateServiceCategory(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	var req createServiceCategoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	isActive := true
	if req.IsActive != nil {
		isActive = *req.IsActive
	}
	c := &models.ServiceCategory{
		ID:             uuid.New(),
		OrganizationID: orgID,
		Name:           req.Name,
		IsActive:       isActive,
	}
	if err := s.store.ServiceCategoryStore.Create(r.Context(), c); err != nil {
		s.logger.Error("failed to create service category", "error", err, "organization_id", orgID)
		http.Error(w, "failed to create service category", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(c)
}

type updateServiceCategoryRequest struct {
	Name     string `json:"name"`
	IsActive *bool  `json:"is_active"`
}

func (s *ApiServer) handleUpdateServiceCategory(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	categoryID := chi.URLParam(r, "categoryID")
	id, err := uuid.Parse(categoryID)
	if err != nil {
		http.Error(w, "invalid category ID", http.StatusBadRequest)
		return
	}
	c, err := s.store.ServiceCategoryStore.GetByID(r.Context(), id, orgID)
	if err != nil || c == nil {
		http.Error(w, "service category not found", http.StatusNotFound)
		return
	}
	var req updateServiceCategoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name != "" {
		c.Name = req.Name
	}
	if req.IsActive != nil {
		c.IsActive = *req.IsActive
	}
	if err := s.store.ServiceCategoryStore.Update(r.Context(), c); err != nil {
		s.logger.Error("failed to update service category", "error", err, "organization_id", orgID)
		http.Error(w, "failed to update service category", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(c)
}

func (s *ApiServer) handleDeactivateServiceCategory(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	categoryID := chi.URLParam(r, "categoryID")
	id, err := uuid.Parse(categoryID)
	if err != nil {
		http.Error(w, "invalid category ID", http.StatusBadRequest)
		return
	}
	if err := s.store.ServiceCategoryStore.Deactivate(r.Context(), id, orgID); err != nil {
		s.logger.Error("failed to deactivate service category", "error", err, "organization_id", orgID)
		http.Error(w, "failed to deactivate service category", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- Services ----------

func (s *ApiServer) handleListServices(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	items, err := s.store.ServiceStore.ListByOrganization(r.Context(), orgID)
	if err != nil {
		s.logger.Error("failed to list services", "error", err, "organization_id", orgID)
		http.Error(w, "failed to list services", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

type createServiceRequest struct {
	CategoryID      *string `json:"category_id"`
	Name            string  `json:"name"`
	PriceCents      int64   `json:"price_cents"`
	DurationMinutes *int    `json:"duration_minutes"`
	IsActive        *bool   `json:"is_active"`
}

func (s *ApiServer) handleCreateService(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	var req createServiceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 100 || req.PriceCents < 0 {
		http.Error(w, "name must contain 1 to 100 characters and price_cents cannot be negative", http.StatusBadRequest)
		return
	}
	var categoryID *uuid.UUID
	if req.CategoryID != nil && *req.CategoryID != "" {
		cid, err := uuid.Parse(*req.CategoryID)
		if err != nil {
			http.Error(w, "invalid category ID", http.StatusBadRequest)
			return
		}
		categoryID = &cid
	}
	isActive := true
	if req.IsActive != nil {
		isActive = *req.IsActive
	}
	svc := &models.Service{
		ID:              uuid.New(),
		OrganizationID:  orgID,
		CategoryID:      categoryID,
		Name:            req.Name,
		PriceCents:      req.PriceCents,
		DurationMinutes: req.DurationMinutes,
		IsActive:        isActive,
	}
	if err := s.store.ServiceStore.Create(r.Context(), svc); err != nil {
		s.logger.Error("failed to create service", "error", err, "organization_id", orgID)
		http.Error(w, "failed to create service", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(svc)
}

type updateServiceRequest struct {
	CategoryID      *string `json:"category_id"`
	Name            string  `json:"name"`
	PriceCents      int64   `json:"price_cents"`
	DurationMinutes *int    `json:"duration_minutes"`
	IsActive        *bool   `json:"is_active"`
}

func (s *ApiServer) handleUpdateService(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	serviceID := chi.URLParam(r, "serviceID")
	id, err := uuid.Parse(serviceID)
	if err != nil {
		http.Error(w, "invalid service ID", http.StatusBadRequest)
		return
	}
	svc, err := s.store.ServiceStore.GetByID(r.Context(), id, orgID)
	if err != nil || svc == nil {
		http.Error(w, "service not found", http.StatusNotFound)
		return
	}
	var req updateServiceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name != "" {
		svc.Name = req.Name
	}
	if req.CategoryID != nil {
		if *req.CategoryID == "" {
			svc.CategoryID = nil
		} else {
			cid, err := uuid.Parse(*req.CategoryID)
			if err != nil {
				http.Error(w, "invalid category ID", http.StatusBadRequest)
				return
			}
			svc.CategoryID = &cid
		}
	}
	svc.PriceCents = req.PriceCents
	if req.DurationMinutes != nil {
		svc.DurationMinutes = req.DurationMinutes
	}
	if req.IsActive != nil {
		svc.IsActive = *req.IsActive
	}
	if err := s.store.ServiceStore.Update(r.Context(), svc); err != nil {
		s.logger.Error("failed to update service", "error", err, "organization_id", orgID)
		http.Error(w, "failed to update service", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(svc)
}

func (s *ApiServer) handleDeactivateService(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	serviceID := chi.URLParam(r, "serviceID")
	id, err := uuid.Parse(serviceID)
	if err != nil {
		http.Error(w, "invalid service ID", http.StatusBadRequest)
		return
	}
	if err := s.store.ServiceStore.Deactivate(r.Context(), id, orgID); err != nil {
		s.logger.Error("failed to deactivate service", "error", err, "organization_id", orgID)
		http.Error(w, "failed to deactivate service", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- Payments ----------

type createPaymentRequest struct {
	WashID        *string `json:"wash_id"`
	CashSessionID *string `json:"cash_session_id"`
	AmountCents   int64   `json:"amount_cents"`
	Method        string  `json:"method"`
	Reference     *string `json:"reference"`
	ReceivedAt    *string `json:"received_at"`
}

func (s *ApiServer) handleListPayments(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	items, err := s.store.PaymentStore.ListByOrganization(r.Context(), orgID)
	if err != nil {
		s.logger.Error("failed to list payments", "error", err, "organization_id", orgID)
		http.Error(w, "failed to list payments", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

func (s *ApiServer) handleCreatePayment(w http.ResponseWriter, r *http.Request) {
	orgID, actorID, ok := s.requireActor(w, r)
	if !ok {
		return
	}
	var req createPaymentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.AmountCents <= 0 {
		http.Error(w, "amount_cents must be positive", http.StatusBadRequest)
		return
	}
	method := models.PaymentMethod(req.Method)
	switch method {
	case models.PaymentMethodCash, models.PaymentMethodOrangeMoney, models.PaymentMethodMTNMoMo, models.PaymentMethodMoovMoney, models.PaymentMethodWave, models.PaymentMethodOther:
	default:
		http.Error(w, "invalid payment method", http.StatusBadRequest)
		return
	}
	var washID *uuid.UUID
	if req.WashID != nil && *req.WashID != "" {
		wid, err := uuid.Parse(*req.WashID)
		if err != nil {
			http.Error(w, "invalid wash ID", http.StatusBadRequest)
			return
		}
		washID = &wid
	}
	var cashSessionID *uuid.UUID
	if req.CashSessionID != nil && *req.CashSessionID != "" {
		csid, err := uuid.Parse(*req.CashSessionID)
		if err != nil {
			http.Error(w, "invalid cash_session_id", http.StatusBadRequest)
			return
		}
		cashSessionID = &csid
	}
	if method == models.PaymentMethodCash && cashSessionID == nil {
		http.Error(w, stores.ErrCashSessionRequired.Error(), http.StatusBadRequest)
		return
	}
	if method != models.PaymentMethodCash && cashSessionID != nil {
		http.Error(w, stores.ErrCashSessionNotApplicable.Error(), http.StatusBadRequest)
		return
	}
	receivedAt := time.Now()
	if req.ReceivedAt != nil && *req.ReceivedAt != "" {
		parsed, err := time.Parse(time.RFC3339, *req.ReceivedAt)
		if err != nil {
			http.Error(w, "received_at must be an RFC3339 timestamp", http.StatusBadRequest)
			return
		}
		receivedAt = parsed
	}
	status := models.PaymentStatusPending
	if method == models.PaymentMethodCash {
		// Cash is physically received at the point this transaction is recorded.
		status = models.PaymentStatusVerified
	}
	p := &models.Payment{
		ID:             uuid.New(),
		OrganizationID: orgID,
		WashID:         washID,
		CashSessionID:  cashSessionID,
		AmountCents:    req.AmountCents,
		Method:         method,
		Status:         status,
		Reference:      req.Reference,
		ReceivedAt:     receivedAt,
		AuthorID:       actorID,
	}
	if err := s.store.PaymentStore.Create(r.Context(), p); err != nil {
		switch {
		case errors.Is(err, stores.ErrWashNotFound):
			http.Error(w, "wash not found", http.StatusNotFound)
		case errors.Is(err, stores.ErrCashSessionNotOpen):
			http.Error(w, "cash session not found or not open", http.StatusNotFound)
		case errors.Is(err, stores.ErrCashSessionSiteMismatch):
			http.Error(w, err.Error(), http.StatusBadRequest)
		case errors.Is(err, stores.ErrCashBalanceOverflow),
			errors.Is(err, stores.ErrWashPaymentExceedsTotal),
			errors.Is(err, stores.ErrWashCancelled):
			http.Error(w, err.Error(), http.StatusConflict)
		case errors.Is(err, stores.ErrCashSessionRequired), errors.Is(err, stores.ErrCashSessionNotApplicable):
			http.Error(w, err.Error(), http.StatusBadRequest)
		default:
			s.logger.Error("failed to create payment", "error", err, "organization_id", orgID)
			http.Error(w, "failed to create payment", http.StatusInternalServerError)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(p)
}

// ---------- Cash sessions ----------

type openCashSessionRequest struct {
	SiteID             string `json:"site_id"`
	OpeningAmountCents int64  `json:"opening_amount_cents"`
}

func (s *ApiServer) handleOpenCashSession(w http.ResponseWriter, r *http.Request) {
	orgID, actorID, ok := s.requireActor(w, r)
	if !ok {
		return
	}
	var req openCashSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	siteID, err := uuid.Parse(req.SiteID)
	if err != nil {
		http.Error(w, "invalid site ID", http.StatusBadRequest)
		return
	}
	if req.OpeningAmountCents < 0 {
		http.Error(w, "opening_amount_cents cannot be negative", http.StatusBadRequest)
		return
	}
	cs := &models.CashSession{
		ID:                      uuid.New(),
		OrganizationID:          orgID,
		SiteID:                  siteID,
		UserID:                  actorID,
		OpeningAmountCents:      req.OpeningAmountCents,
		TheoreticalBalanceCents: req.OpeningAmountCents,
		Status:                  models.CashSessionStatusOpen,
	}
	if err := s.store.CashSessionStore.Open(r.Context(), cs); err != nil {
		switch {
		case errors.Is(err, stores.ErrSiteNotFound):
			http.Error(w, "site not found", http.StatusNotFound)
		case errors.Is(err, stores.ErrOpenCashSessionExists):
			http.Error(w, err.Error(), http.StatusConflict)
		default:
			s.logger.Error("failed to open cash session", "error", err, "organization_id", orgID)
			http.Error(w, "failed to open cash session", http.StatusInternalServerError)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(cs)
}

func (s *ApiServer) handleGetCurrentCashSession(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	siteID := r.URL.Query().Get("site_id")
	if siteID == "" {
		http.Error(w, "site_id query parameter is required", http.StatusBadRequest)
		return
	}
	sid, err := uuid.Parse(siteID)
	if err != nil {
		http.Error(w, "invalid site ID", http.StatusBadRequest)
		return
	}
	site, err := s.store.SiteStore.GetByIDForOrganization(r.Context(), sid, orgID)
	if err != nil {
		s.logger.Error("failed to resolve cash session site", "error", err, "site_id", sid, "organization_id", orgID)
		http.Error(w, "failed to get current cash session", http.StatusInternalServerError)
		return
	}
	if site == nil {
		http.Error(w, "site not found", http.StatusNotFound)
		return
	}
	cs, err := s.store.CashSessionStore.GetOpenBySite(r.Context(), orgID, sid)
	if err != nil {
		s.logger.Error("failed to get current cash session", "error", err, "site_id", sid)
		http.Error(w, "failed to get current cash session", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cs) // null means no open session for this site.
}

type addCashMovementRequest struct {
	Type        string  `json:"type"`
	AmountCents int64   `json:"amount_cents"`
	Source      string  `json:"source"`
	ReferenceID *string `json:"reference_id"`
	Description *string `json:"description"`
}

func (s *ApiServer) handleAddCashMovement(w http.ResponseWriter, r *http.Request) {
	orgID, actorID, ok := s.requireActor(w, r)
	if !ok {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "sessionID"))
	if err != nil {
		http.Error(w, "invalid session ID", http.StatusBadRequest)
		return
	}
	var req addCashMovementRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	movType := models.CashMovementType(req.Type)
	if movType != models.CashMovementTypeEntry && movType != models.CashMovementTypeExit {
		http.Error(w, "invalid movement type", http.StatusBadRequest)
		return
	}
	if req.AmountCents <= 0 {
		http.Error(w, "amount_cents must be positive", http.StatusBadRequest)
		return
	}
	if req.Source == "" || len(req.Source) > 50 {
		http.Error(w, "source must contain between 1 and 50 characters", http.StatusBadRequest)
		return
	}
	var refID *uuid.UUID
	if req.ReferenceID != nil && *req.ReferenceID != "" {
		rid, err := uuid.Parse(*req.ReferenceID)
		if err != nil {
			http.Error(w, "invalid reference ID", http.StatusBadRequest)
			return
		}
		refID = &rid
	}
	cm := &models.CashMovement{
		ID:             uuid.New(),
		OrganizationID: orgID,
		CashSessionID:  id,
		Type:           movType,
		AmountCents:    req.AmountCents,
		Source:         req.Source,
		ReferenceID:    refID,
		Description:    req.Description,
		AuthorID:       actorID,
	}
	if err := s.store.CashMovementStore.Create(r.Context(), cm); err != nil {
		switch {
		case errors.Is(err, stores.ErrCashSessionNotOpen):
			http.Error(w, "cash session not found or not open", http.StatusNotFound)
		case errors.Is(err, stores.ErrInsufficientCash), errors.Is(err, stores.ErrCashBalanceOverflow):
			http.Error(w, err.Error(), http.StatusConflict)
		default:
			s.logger.Error("failed to add cash movement", "error", err, "organization_id", orgID)
			http.Error(w, "failed to add cash movement", http.StatusInternalServerError)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(cm)
}

type closeCashSessionRequest struct {
	CountedAmountCents int64   `json:"counted_amount_cents"`
	DiscrepancyReason  *string `json:"discrepancy_reason"`
}

func (s *ApiServer) handleCloseCashSession(w http.ResponseWriter, r *http.Request) {
	orgID, actorID, ok := s.requireActor(w, r)
	if !ok {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "sessionID"))
	if err != nil {
		http.Error(w, "invalid session ID", http.StatusBadRequest)
		return
	}
	var req closeCashSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.CountedAmountCents < 0 {
		http.Error(w, "counted_amount_cents cannot be negative", http.StatusBadRequest)
		return
	}
	cs, err := s.store.CashSessionStore.Close(r.Context(), id, orgID, actorID, req.CountedAmountCents, req.DiscrepancyReason)
	if err != nil {
		switch {
		case errors.Is(err, stores.ErrCashSessionNotFound):
			http.Error(w, "cash session not found", http.StatusNotFound)
		case errors.Is(err, stores.ErrCashSessionNotOpen):
			http.Error(w, "cash session is already closed", http.StatusConflict)
		case errors.Is(err, stores.ErrDiscrepancyReasonRequired):
			http.Error(w, err.Error(), http.StatusBadRequest)
		default:
			s.logger.Error("failed to close cash session", "error", err, "cash_session_id", id)
			http.Error(w, "failed to close cash session", http.StatusInternalServerError)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cs)
}

func (s *ApiServer) handleListCashMovements(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "sessionID"))
	if err != nil {
		http.Error(w, "invalid session ID", http.StatusBadRequest)
		return
	}
	session, err := s.store.CashSessionStore.GetByIDForOrganization(r.Context(), id, orgID)
	if err != nil {
		s.logger.Error("failed to resolve cash session", "error", err, "cash_session_id", id)
		http.Error(w, "failed to list cash movements", http.StatusInternalServerError)
		return
	}
	if session == nil {
		http.Error(w, "cash session not found", http.StatusNotFound)
		return
	}
	items, err := s.store.CashMovementStore.ListBySession(r.Context(), id, orgID)
	if err != nil {
		s.logger.Error("failed to list cash movements", "error", err, "cash_session_id", id)
		http.Error(w, "failed to list cash movements", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

// ---------- Expenses ----------

type createExpenseRequest struct {
	SiteID        *string `json:"site_id"`
	Category      string  `json:"category"`
	AmountCents   int64   `json:"amount_cents"`
	ExpenseDate   *string `json:"expense_date"`
	PaymentMethod string  `json:"payment_method"`
	Beneficiary   *string `json:"beneficiary"`
	Description   *string `json:"description"`
	Reference     *string `json:"reference"`
	CashSessionID *string `json:"cash_session_id"`
}

func (s *ApiServer) handleListExpenses(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	items, err := s.store.ExpenseStore.ListByOrganization(r.Context(), orgID)
	if err != nil {
		s.logger.Error("failed to list expenses", "error", err, "organization_id", orgID)
		http.Error(w, "failed to list expenses", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

func (s *ApiServer) handleCreateExpense(w http.ResponseWriter, r *http.Request) {
	orgID, actorID, ok := s.requireActor(w, r)
	if !ok {
		return
	}
	var req createExpenseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Category == "" {
		http.Error(w, "category is required", http.StatusBadRequest)
		return
	}
	if req.AmountCents <= 0 {
		http.Error(w, "amount_cents must be positive", http.StatusBadRequest)
		return
	}
	method := models.PaymentMethod(req.PaymentMethod)
	switch method {
	case models.PaymentMethodCash, models.PaymentMethodOrangeMoney, models.PaymentMethodMTNMoMo, models.PaymentMethodMoovMoney, models.PaymentMethodWave, models.PaymentMethodOther:
	default:
		http.Error(w, "invalid payment method", http.StatusBadRequest)
		return
	}
	var siteID *uuid.UUID
	if req.SiteID != nil && *req.SiteID != "" {
		sid, err := uuid.Parse(*req.SiteID)
		if err != nil {
			http.Error(w, "invalid site ID", http.StatusBadRequest)
			return
		}
		siteID = &sid
	}
	var expenseDate time.Time
	if req.ExpenseDate != nil && *req.ExpenseDate != "" {
		ed, err := time.Parse("2006-01-02", *req.ExpenseDate)
		if err != nil {
			http.Error(w, "invalid expense_date (YYYY-MM-DD)", http.StatusBadRequest)
			return
		}
		expenseDate = ed
	} else {
		expenseDate = time.Now()
	}
	var cashSessionID *uuid.UUID
	if req.CashSessionID != nil && *req.CashSessionID != "" {
		csid, err := uuid.Parse(*req.CashSessionID)
		if err != nil {
			http.Error(w, "invalid cash_session_id", http.StatusBadRequest)
			return
		}
		cashSessionID = &csid
	}
	if method == models.PaymentMethodCash && cashSessionID == nil {
		http.Error(w, stores.ErrCashSessionRequired.Error(), http.StatusBadRequest)
		return
	}
	if method != models.PaymentMethodCash && cashSessionID != nil {
		http.Error(w, "cash_session_id is only valid for cash expenses", http.StatusBadRequest)
		return
	}
	e := &models.Expense{
		ID:             uuid.New(),
		OrganizationID: orgID,
		SiteID:         siteID,
		Category:       req.Category,
		AmountCents:    req.AmountCents,
		ExpenseDate:    expenseDate,
		PaymentMethod:  method,
		Beneficiary:    req.Beneficiary,
		Description:    req.Description,
		AuthorID:       actorID,
		Reference:      req.Reference,
		Status:         models.ExpenseStatusRecorded,
		CashSessionID:  cashSessionID,
	}
	if err := s.store.ExpenseStore.Create(r.Context(), e); err != nil {
		switch {
		case errors.Is(err, stores.ErrCashSessionRequired):
			http.Error(w, err.Error(), http.StatusBadRequest)
		case errors.Is(err, stores.ErrSiteNotFound):
			http.Error(w, "site not found", http.StatusNotFound)
		case errors.Is(err, stores.ErrCashSessionNotOpen):
			http.Error(w, "cash session not found or not open", http.StatusNotFound)
		case errors.Is(err, stores.ErrCashSessionSiteMismatch):
			http.Error(w, err.Error(), http.StatusBadRequest)
		case errors.Is(err, stores.ErrInsufficientCash):
			http.Error(w, err.Error(), http.StatusConflict)
		default:
			s.logger.Error("failed to create expense", "error", err, "organization_id", orgID)
			http.Error(w, "failed to create expense", http.StatusInternalServerError)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(e)
}

func (s *ApiServer) handleGetExpense(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	expenseID := chi.URLParam(r, "expenseID")
	id, err := uuid.Parse(expenseID)
	if err != nil {
		http.Error(w, "invalid expense ID", http.StatusBadRequest)
		return
	}
	items, err := s.store.ExpenseStore.ListByOrganization(r.Context(), orgID)
	if err != nil {
		s.logger.Error("failed to list expenses for get", "error", err, "organization_id", orgID)
		http.Error(w, "failed to get expense", http.StatusInternalServerError)
		return
	}
	var found *models.Expense
	for i := range items {
		if items[i].ID == id {
			found = &items[i]
			break
		}
	}
	if found == nil {
		http.Error(w, "expense not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(found)
}

func (s *ApiServer) handleCancelExpense(w http.ResponseWriter, r *http.Request) {
	orgID, actorID, ok := s.requireActor(w, r)
	if !ok {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "expenseID"))
	if err != nil {
		http.Error(w, "invalid expense ID", http.StatusBadRequest)
		return
	}
	if err := s.store.ExpenseStore.Cancel(r.Context(), id, orgID, actorID); err != nil {
		switch {
		case errors.Is(err, stores.ErrExpenseNotFound):
			http.Error(w, "expense not found", http.StatusNotFound)
		case errors.Is(err, stores.ErrCashSessionNotOpen):
			http.Error(w, "cash expense cannot be cancelled after its session is closed", http.StatusConflict)
		case errors.Is(err, stores.ErrCashBalanceOverflow):
			http.Error(w, err.Error(), http.StatusConflict)
		default:
			s.logger.Error("failed to cancel expense", "error", err, "organization_id", orgID)
			http.Error(w, "failed to cancel expense", http.StatusInternalServerError)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func main() {
	logger := logger.New("info")

	cfg, err := config.LoadConfig()
	if err != nil {
		logger.Error("Failed to load configuration", "error", err)
		os.Exit(1)
	}

	conn, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		logger.Error("Failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer conn.Close()

	listenAddr := os.Getenv("PORT")
	if listenAddr == "" {
		listenAddr = ":8080"
	}
	if listenAddr[0] != ':' {
		listenAddr = ":" + listenAddr
	}
	server := NewApiServer(listenAddr, conn, cfg, logger)
	server.Run()
}

// corsMiddleware autorise les requêtes cross-origin depuis le frontend.
// L'origine autorisée est configurable via CORS_ORIGIN (défaut: localhost:5174 en dev).
func (s *ApiServer) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := os.Getenv("CORS_ORIGIN")
		if origin == "" {
			origin = "http://localhost:5174"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key")
		w.Header().Set("Access-Control-Expose-Headers", "Idempotency-Replayed")
		w.Header().Set("Access-Control-Allow-Credentials", "true")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
