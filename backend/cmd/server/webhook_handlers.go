package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"washpilot-ci-backend/internal/models"
)

type organizationMembershipCreatedPayload struct {
	Data struct {
		Organization struct {
			ID string `json:"id"`
		} `json:"organization"`
		PublicUserData struct {
			UserID string `json:"user_id"`
		} `json:"public_user_data"`
		Role string `json:"role"`
	} `json:"data"`
}

// clerkUserPayload reflète le format réel des webhooks Clerk : l'email arrive
// dans email_addresses[] avec primary_email_address_id, et le nom dans
// first_name / last_name.
type clerkUserPayload struct {
	Data struct {
		ID             string `json:"id"`
		FirstName      string `json:"first_name"`
		LastName       string `json:"last_name"`
		PrimaryEmailID string `json:"primary_email_address_id"`
		EmailAddresses []struct {
			ID           string `json:"id"`
			EmailAddress string `json:"email_address"`
		} `json:"email_addresses"`
	} `json:"data"`
	ObjectType string `json:"object"`
	Type       string `json:"type"`
}

func primaryEmail(p *clerkUserPayload) string {
	for _, e := range p.Data.EmailAddresses {
		if e.ID != "" && e.ID == p.Data.PrimaryEmailID && e.EmailAddress != "" {
			return e.EmailAddress
		}
	}
	if len(p.Data.EmailAddresses) > 0 {
		return p.Data.EmailAddresses[0].EmailAddress
	}
	return ""
}

// clerkRoleToInternal mappe les rôles Clerk (org:admin, org:member, …) vers les
// rôles internes. Les admins d'org deviennent owner, les membres washer.
func clerkRoleToInternal(role string) models.UserRole {
	switch role {
	case "org:admin", "admin", "owner":
		return models.RoleOwner
	case "org:member", "member", "basic_member":
		return models.RoleWasher
	default:
		return models.RoleWasher
	}
}

// syncUserProfileToNeon upsert le profil Clerk (prénom, nom, email) dans Neon
// et propage les champs aux autres memberships de la même identité. Ne touche
// jamais à organization_id/role/status : une sync de profil ne doit pas
// déplacer un membre ni le rétrograder.
func (s *ApiServer) syncUserProfileToNeon(p *clerkUserPayload) error {
	if p.Data.ID == "" {
		return nil
	}
	email := primaryEmail(p)
	u := &models.User{
		ClerkUserID: p.Data.ID,
		FirstName:   &p.Data.FirstName,
		LastName:    &p.Data.LastName,
	}
	if email != "" {
		u.Email = &email
	}
	_, err := s.store.UserStore.EnsureDefaultMembership(context.Background(), u)
	return err
}

func (s *ApiServer) handleOrganizationMembershipCreated(w http.ResponseWriter, payload []byte) {
	var orgMembershipPayload organizationMembershipCreatedPayload
	if err := json.Unmarshal(payload, &orgMembershipPayload); err != nil {
		s.logger.Error("webhook: failed to unmarshal organizationMembership.created payload", "error", err)
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}

	org, err := s.store.OrganizationStore.GetByClerkID(context.Background(), orgMembershipPayload.Data.Organization.ID)
	if err != nil {
		s.logger.Error("webhook: failed to get organization by clerk id", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if org == nil {
		// L'org Clerk n'existe pas encore côté Neon (membre ajouté avant que
		// l'org ne soit provisionnée) : on acknowledge pour laisser Clerk
		// retry, sans créer de ligne orpheline ni planter la livraison.
		s.logger.Warn("webhook: organization not found for membership, skipping",
			"clerk_org_id", orgMembershipPayload.Data.Organization.ID,
			"user_id", orgMembershipPayload.Data.PublicUserData.UserID)
		http.Error(w, "organization not found", http.StatusBadRequest)
		return
	}

	_, err = s.store.UserStore.GetOrCreateMembership(context.Background(), org.ID, orgMembershipPayload.Data.PublicUserData.UserID, clerkRoleToInternal(orgMembershipPayload.Data.Role))
	if err != nil {
		s.logger.Error("webhook: failed to create or get membership", "error", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	s.logger.Info("webhook: organization membership created", "organization_id", org.ID, "user_id", orgMembershipPayload.Data.PublicUserData.UserID)
	w.WriteHeader(http.StatusOK)
}

func (s *ApiServer) handleUserCreated(w http.ResponseWriter, payload []byte) {
	var userPayload clerkUserPayload
	if err := json.Unmarshal(payload, &userPayload); err != nil {
		s.logger.Error("webhook: failed to unmarshal user.created payload", "error", err)
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}

	if err := s.syncUserProfileToNeon(&userPayload); err != nil {
		s.logger.Error("webhook: failed to sync user.created to Neon", "error", err, "user_id", userPayload.Data.ID)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	s.logger.Info("webhook: user.created synced to Neon", "user_id", userPayload.Data.ID)
	w.WriteHeader(http.StatusOK)
}

func (s *ApiServer) handleUserUpdated(w http.ResponseWriter, payload []byte) {
	var userPayload clerkUserPayload
	if err := json.Unmarshal(payload, &userPayload); err != nil {
		s.logger.Error("webhook: failed to unmarshal user.updated payload", "error", err)
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}

	if err := s.syncUserProfileToNeon(&userPayload); err != nil {
		s.logger.Error("webhook: failed to sync user.updated to Neon", "error", err, "user_id", userPayload.Data.ID)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	s.logger.Info("webhook: user.updated synced to Neon", "user_id", userPayload.Data.ID)
	w.WriteHeader(http.StatusOK)
}

func (s *ApiServer) handleClerkWebhook(w http.ResponseWriter, r *http.Request) {
	headers := r.Header
	payload, err := io.ReadAll(r.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	if err := s.clerkWebhook.Verify(payload, headers); err != nil {
		s.logger.Error("webhook: failed to verify webhook", "error", err)
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	evt := struct{ Type string }{}
	if err := json.Unmarshal(payload, &evt); err != nil {
		s.logger.Error("webhook: failed to unmarshal event type", "error", err)
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}

	type organizationCreatedPayload struct {
		Data struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			Slug     string `json:"slug"`
			ImageURL string `json:"image_url"`
		} `json:"data"`
	}

	switch evt.Type {
	case "user.created":
		s.handleUserCreated(w, payload)
		return
	case "user.updated":
		s.handleUserUpdated(w, payload)
		return
	case "organization.created":
		var orgPayload organizationCreatedPayload
		if err := json.Unmarshal(payload, &orgPayload); err != nil {
			s.logger.Error("webhook: failed to unmarshal organization.created payload", "error", err)
			http.Error(w, "invalid payload", http.StatusBadRequest)
			return
		}
		if _, err := s.store.OrganizationStore.CreateFromWebhook(context.Background(), orgPayload.Data.ID, orgPayload.Data.Name); err != nil {
			s.logger.Error("webhook: failed to create organization from clerk", "error", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		s.logger.Info("webhook: organization created", "clerk_org_id", orgPayload.Data.ID)
		w.WriteHeader(http.StatusOK)
	case "organizationMembership.created":
		s.handleOrganizationMembershipCreated(w, payload)
		return
	default:
		s.logger.Info("webhook: received unhandled event type", "type", evt.Type)
	}

	w.WriteHeader(http.StatusOK)
}
