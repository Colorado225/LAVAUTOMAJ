package routes

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"washpilot-ci/backend/internal/auth"
	"washpilot-ci/backend/internal/cash"
	"washpilot-ci/backend/internal/catalog"
	"washpilot-ci/backend/internal/clerkwebhook"
	"washpilot-ci/backend/internal/config"
	"washpilot-ci/backend/internal/database"
	"washpilot-ci/backend/internal/expenses"
	"washpilot-ci/backend/internal/http/handlers"
	"washpilot-ci/backend/internal/http/middleware"
	"washpilot-ci/backend/internal/onboarding"
	"washpilot-ci/backend/internal/reports"
	"washpilot-ci/backend/internal/team"
	"washpilot-ci/backend/internal/tenancy"
	"washpilot-ci/backend/internal/wash"
)

func New(cfg config.Config, db *database.Pool, verifier *auth.Verifier) http.Handler {
	r := chi.NewRouter()
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(30 * time.Second))
	r.Use(middleware.SecurityHeaders)
	r.Use(middleware.CORS(cfg.CORSOrigins, cfg.Env != "production"))
	r.Use(chimw.WithValue("started_at", time.Now))

	health := handlers.Health{DB: db}
	r.Get("/healthz", health.Live)
	r.Get("/readyz", health.Ready(verifier != nil && verifier.Configured()))

	authHandler := handlers.NewAuthHandler(tenancy.NewResolver(db))
	catalogHandler := handlers.NewCatalogHandler(catalog.NewRepository(db.Inner()))
	washHandler := handlers.NewWashHandler(wash.NewRepository(db.Inner()))
	cashHandler := handlers.NewCashHandler(cash.NewRepository(db.Inner()))
	expenseHandler := handlers.NewExpenseHandler(expenses.NewRepository(db.Inner()))
	reportsHandler := handlers.NewReportsHandler(reports.NewRepository(db.Inner()))
	onboardingHandler := handlers.NewOnboardingHandler(onboarding.NewRepository(db.Inner()))
	teamHandler := handlers.NewTeamHandler(team.NewRepository(db.Inner()))

	var webhookProcessor *clerkwebhook.Processor
	if cfg.ClerkWebhookSecret != "" {
		webhookProcessor = clerkwebhook.NewProcessor(db.Inner(), nil)
	}
	webhookHandler := handlers.NewWebhook(cfg.ClerkWebhookSecret, webhookProcessor)
	r.Post("/api/webhooks/clerk", webhookHandler.ClerkWebhook)

	r.Route("/api/v1", func(v1 chi.Router) {
		v1.Use(middleware.NoStore)
		v1.Use(middleware.RequireAuth(verifier))

		// Sync/me doivent rester accessibles sans organisation : un compte
		// fraîchement inscrit n'a pas encore d'org active et RequireTenant
		// répondrait 409 avant même que Sync puisse signaler
		// requires_organization. Les routes métier restent sous tenant.
		v1.Post("/auth/sync", authHandler.Sync)
		v1.Get("/auth/me", authHandler.Me)
		v1.Get("/plans", catalogHandler.GetPlans)
		v1.Get("/service-catalog", catalogHandler.GetServiceCatalog)

		v1.Group(func(tenant chi.Router) {
			tenant.Use(middleware.RequireTenant(tenancy.NewResolver(db)))

			tenant.Get("/sites", catalogHandler.GetSites)
			tenant.Get("/service-categories", catalogHandler.GetServiceCategories)
			tenant.Post("/service-categories", catalogHandler.PostServiceCategory)
			tenant.Patch("/service-categories/{id}", catalogHandler.PatchServiceCategory)
			tenant.Post("/service-categories/{id}/deactivate", catalogHandler.DeactivateServiceCategory)
			tenant.Get("/vehicle-categories", catalogHandler.GetVehicleCategories)
			tenant.Post("/vehicle-categories", catalogHandler.PostVehicleCategory)
			tenant.Patch("/vehicle-categories/{id}", catalogHandler.PatchVehicleCategory)
			tenant.Post("/vehicle-categories/{id}/deactivate", catalogHandler.DeactivateVehicleCategory)
			tenant.Get("/services", catalogHandler.GetServices)
			tenant.Post("/services", catalogHandler.PostService)
			tenant.Patch("/services/{id}", catalogHandler.PatchService)
			tenant.Post("/services/{id}/deactivate", catalogHandler.DeactivateService)

			tenant.Get("/washes", washHandler.List)
			tenant.Post("/washes", washHandler.Create)
			tenant.Get("/washes/{washID}", washHandler.Detail)
			tenant.Post("/washes/{washID}/cancel", washHandler.Cancel)

			tenant.Get("/cash-sessions/current", cashHandler.Current)
			tenant.Get("/cash-sessions", cashHandler.List)
			tenant.Post("/cash-sessions/open", cashHandler.Open)
			tenant.Get("/cash-sessions/{sessionID}/movements", cashHandler.ListMovements)
			tenant.Post("/cash-sessions/{sessionID}/movements", cashHandler.AddMovement)
			tenant.Post("/cash-sessions/{sessionID}/close", cashHandler.Close)

			tenant.Get("/expenses", expenseHandler.List)
			tenant.Post("/expenses", expenseHandler.Create)
			tenant.Get("/expenses/{expenseID}", expenseHandler.Detail)
			tenant.Post("/expenses/{expenseID}/cancel", expenseHandler.Cancel)

			tenant.Get("/reports/summary", reportsHandler.Summary)
			tenant.Get("/dashboard/metrics", reportsHandler.Metrics)

			tenant.Get("/onboarding/status", onboardingHandler.Status)
			tenant.Get("/onboarding/progress", onboardingHandler.Progress)
			tenant.Put("/onboarding/progress", onboardingHandler.UpdateProgress)
			tenant.Get("/onboarding/summary", onboardingHandler.Summary)
			tenant.Post("/onboarding/confirm", onboardingHandler.Confirm)

			tenant.Get("/workers", teamHandler.ListWorkers)
			tenant.Post("/workers", teamHandler.CreateWorker)
			tenant.Patch("/workers/{workerID}", teamHandler.UpdateWorker)
		})

		v1.NotFound(func(w http.ResponseWriter, req *http.Request) {
			handlers.WriteError(w, req, http.StatusNotFound, "not_found", "Cette route API n'existe pas.")
		})
	})
	return r
}
