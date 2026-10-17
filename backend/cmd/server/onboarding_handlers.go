package main

import (
	"encoding/json"
	"errors"
	"net/http"

	"washpilot-ci-backend/internal/models"
	"washpilot-ci-backend/internal/stores"

	"github.com/google/uuid"
)

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

	progress, err := s.onboardingStore.GetProgress(r.Context(), org.ID)
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
	progress, err := s.onboardingStore.GetOrCreateProgress(r.Context(), org.ID)
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

	progress, err := s.onboardingStore.SaveStage(r.Context(), org.ID, pl)
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
	progress, err := s.onboardingStore.GetProgress(r.Context(), org.ID)
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
		plan, err = s.onboardingStore.PlanByCode(r.Context(), *progress.PlanCode)
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

	updatedOrg, alreadyCompleted, err := s.onboardingStore.ConfirmOnboarding(r.Context(), org.ID)
	if err != nil {
		s.logger.Error("onboarding: confirmation failed", "error", err, "org_id", org.ID)
		status := http.StatusInternalServerError
		if errors.Is(err, errors.New("onboarding incomplet : les conditions obligatoires ne sont pas satisfaites")) ||
			errors.Is(err, errors.New("forfait sélectionné introuvable ou inactif")) ||
			errors.Is(err, errors.New("aucune progression d'onboarding")) {
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
	plans, err := s.onboardingStore.ListPlans(r.Context())
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(plans)
}

// handleListServiceCatalog — prestations standard de référence (§5).
func (s *ApiServer) handleListServiceCatalog(w http.ResponseWriter, r *http.Request) {
	items, err := s.onboardingStore.ListCatalogTemplates(r.Context())
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
	items, err := s.onboardingStore.ListWorkersByOrganization(r.Context(), org.ID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

var _ = uuid.Nil // retention de l'import si refactor futur
