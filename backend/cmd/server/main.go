package main

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
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
)

var (
	ErrNoClaims      = errors.New("no claims in context")
	ErrNoCustomClaims = errors.New("no custom claims")
	ErrNoOrg         = errors.New("no org_id in claims")
	ErrOrgNotFound   = errors.New("organization not found")
)

type ApiServer struct {
	listenAddr        string
	db                *sqlx.DB
	userStore         *stores.UserStore
	organizationStore *stores.OrganizationStore
	vehicleCategoryStore *stores.VehicleCategoryStore
	serviceCategoryStore *stores.ServiceCategoryStore
	serviceStore       *stores.ServiceStore
	config             *config.Config
	logger             *slog.Logger
	router             http.Handler
}

func NewApiServer(listenAddr string, db *sqlx.DB, cfg *config.Config, logger *slog.Logger) *ApiServer {
	server := &ApiServer{
		listenAddr:        listenAddr,
		db:                db,
		userStore:         stores.NewUserStore(db),
		organizationStore: stores.NewOrganizationStore(db),
		vehicleCategoryStore: stores.NewVehicleCategoryStore(db),
		serviceCategoryStore: stores.NewServiceCategoryStore(db),
		serviceStore:       stores.NewServiceStore(db),
		config:             cfg,
		logger:             logger,
	}
	server.setupRouter()
	return server
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

		// Vehicle categories
		r.Get("/vehicle-categories", s.handleListVehicleCategories)
		r.Post("/vehicle-categories", s.handleCreateVehicleCategory)
		r.Patch("/vehicle-categories/{categoryID}", s.handleUpdateVehicleCategory)
		r.Post("/vehicle-categories/{categoryID}/deactivate", s.handleDeactivateVehicleCategory)

		// Service categories
		r.Get("/service-categories", s.handleListServiceCategories)
		r.Post("/service-categories", s.handleCreateServiceCategory)
		r.Patch("/service-categories/{categoryID}", s.handleUpdateServiceCategory)
		r.Post("/service-categories/{categoryID}/deactivate", s.handleDeactivateServiceCategory)

		// Services
		r.Get("/services", s.handleListServices)
		r.Post("/services", s.handleCreateService)
		r.Patch("/services/{serviceID}", s.handleUpdateService)
		r.Post("/services/{serviceID}/deactivate", s.handleDeactivateService)

		r.Get("/users", s.handleListUsers)

		// Admin-only routes
		r.Group(func(r chi.Router) {
			// r.Use(middleware.WithRole("admin")) // We'll re-implement this later
			r.Get("/admin/dashboard", func(w http.ResponseWriter, r *http.Request) {
				w.Write([]byte("Welcome to the admin dashboard!"))
			})
		})
	})

	s.router = r
}

func (s *ApiServer) Run() {
	s.logger.Info("Starting server", "address", s.listenAddr)
	if err := http.ListenAndServe(s.listenAddr, s.router); err != nil {
		s.logger.Error("Failed to start server", "error", err)
		os.Exit(1)
	}
}

func (s *ApiServer) handleListUsers(w http.ResponseWriter, r *http.Request) {
	claims, ok := clerk.SessionClaimsFromContext(r.Context())
	if !ok {
		s.logger.Error("could not retrieve claims from context")
		http.Error(w, "could not retrieve claims", http.StatusInternalServerError)
		return
	}

	customClaims, ok := claims.Custom.(map[string]interface{})
	if !ok {
		s.logger.Error("could not assert custom claims")
		http.Error(w, "could not assert custom claims", http.StatusInternalServerError)
		return
	}

	orgID, ok := customClaims["org_id"]
	if !ok {
		s.logger.Warn("user is not part of an organization", "user_id", claims.Subject)
		http.Error(w, "user is not part of an organization", http.StatusForbidden)
		return
	}
	clerkOrgID := orgID.(string)
	if clerkOrgID == "" {
		s.logger.Warn("user is not part of an organization", "user_id", claims.Subject)
		http.Error(w, "user is not part of an organization", http.StatusForbidden)
		return
	}

	// We need a way to get our internal org ID from the clerk org ID.
	org, err := s.organizationStore.GetByClerkID(r.Context(), clerkOrgID)
	if err != nil {
		s.logger.Error("failed to retrieve organization", "error", err, "clerk_org_id", clerkOrgID)
		http.Error(w, "failed to retrieve organization", http.StatusInternalServerError)
		return
	}
	if org == nil {
		s.logger.Warn("organization not found in system", "clerk_org_id", clerkOrgID)
		http.Error(w, "organization not found in system", http.StatusForbidden)
		return
	}

	users, err := s.userStore.ListByOrganization(r.Context(), org.ID)
	if err != nil {
		s.logger.Error("failed to list users", "error", err, "organization_id", org.ID)
		http.Error(w, "failed to list users", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}

// getOrganizationIDFromClaims extrait l'organisation interne à partir des claims Clerk.
func (s *ApiServer) getOrganizationIDFromClaims(r *http.Request) (uuid.UUID, error) {
	claims, ok := clerk.SessionClaimsFromContext(r.Context())
	if !ok {
		return uuid.Nil, ErrNoClaims
	}
	customClaims, ok := claims.Custom.(map[string]interface{})
	if !ok {
		return uuid.Nil, ErrNoCustomClaims
	}
	clerkOrgID, ok := customClaims["org_id"]
	if !ok || clerkOrgID == "" {
		return uuid.Nil, ErrNoOrg
	}
	org, err := s.organizationStore.GetByClerkID(r.Context(), clerkOrgID.(string))
	if err != nil {
		return uuid.Nil, err
	}
	if org == nil {
		return uuid.Nil, ErrOrgNotFound
	}
	return org.ID, nil
}

func (s *ApiServer) requireOrg(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	orgID, err := s.getOrganizationIDFromClaims(r)
	if err != nil {
		s.logger.Warn("organization not resolved from claims", "error", err, "user_id", r.Context().Value(clerk.SessionClaims{}))
		http.Error(w, "organization not found", http.StatusForbidden)
		return uuid.Nil, false
	}
	return orgID, true
}

// ---------- Vehicle categories ----------

func (s *ApiServer) handleListVehicleCategories(w http.ResponseWriter, r *http.Request) {
	orgID, ok := s.requireOrg(w, r)
	if !ok {
		return
	}
	items, err := s.vehicleCategoryStore.ListByOrganization(r.Context(), orgID)
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
	if err := s.vehicleCategoryStore.Create(r.Context(), c); err != nil {
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
	c, err := s.vehicleCategoryStore.GetByID(r.Context(), id)
	if err != nil || c == nil || c.OrganizationID != orgID {
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
	if err := s.vehicleCategoryStore.Update(r.Context(), c); err != nil {
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
	if err := s.vehicleCategoryStore.Deactivate(r.Context(), id, orgID); err != nil {
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
	items, err := s.serviceCategoryStore.ListByOrganization(r.Context(), orgID)
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
	if err := s.serviceCategoryStore.Create(r.Context(), c); err != nil {
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
	c, err := s.serviceCategoryStore.GetByID(r.Context(), id)
	if err != nil || c == nil || c.OrganizationID != orgID {
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
	if err := s.serviceCategoryStore.Update(r.Context(), c); err != nil {
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
	if err := s.serviceCategoryStore.Deactivate(r.Context(), id, orgID); err != nil {
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
	items, err := s.serviceStore.ListByOrganization(r.Context(), orgID)
	if err != nil {
		s.logger.Error("failed to list services", "error", err, "organization_id", orgID)
		http.Error(w, "failed to list services", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

type createServiceRequest struct {
	CategoryID     *string `json:"category_id"`
	Name           string  `json:"name"`
	PriceCents     int64   `json:"price_cents"`
	DurationMinutes *int    `json:"duration_minutes"`
	IsActive       *bool   `json:"is_active"`
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
	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
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
		ID:             uuid.New(),
		OrganizationID: orgID,
		CategoryID:     categoryID,
		Name:           req.Name,
		PriceCents:     req.PriceCents,
		DurationMinutes: req.DurationMinutes,
		IsActive:       isActive,
	}
	if err := s.serviceStore.Create(r.Context(), svc); err != nil {
		s.logger.Error("failed to create service", "error", err, "organization_id", orgID)
		http.Error(w, "failed to create service", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(svc)
}

type updateServiceRequest struct {
	CategoryID     *string `json:"category_id"`
	Name           string  `json:"name"`
	PriceCents     int64   `json:"price_cents"`
	DurationMinutes *int    `json:"duration_minutes"`
	IsActive       *bool   `json:"is_active"`
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
	svc, err := s.serviceStore.GetByID(r.Context(), id)
	if err != nil || svc == nil || svc.OrganizationID != orgID {
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
	if err := s.serviceStore.Update(r.Context(), svc); err != nil {
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
	if err := s.serviceStore.Deactivate(r.Context(), id, orgID); err != nil {
		s.logger.Error("failed to deactivate service", "error", err, "organization_id", orgID)
		http.Error(w, "failed to deactivate service", http.StatusInternalServerError)
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

	server := NewApiServer(":8080", conn, cfg, logger)
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
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Credentials", "true")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
