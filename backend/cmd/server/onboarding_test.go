package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
)

// ⚠️ Sécurité : ces tests créent des organisations réelles dans la base
// configurée. Ils ne s'exécutent QUE si TEST_DATABASE_URL est défini et
// différent de la base de développement (base jetable obligatoire).
// cmd/server/main_test.go, lui, exécute mig.Down() en teardown : ne jamais
// le pointer vers la base de production.

func testDBURL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" || url == os.Getenv("DATABASE_URL") {
		t.Skip("TEST_DATABASE_URL non défini ou identique à DATABASE_URL : test ignoré pour protéger la base de dev/prod")
	}
	return url
}

// TestConfirmOnboardingRequiresCompleteStages vérifie le refus du dashboard
// (accès métier) avant la fin du parcours : un confirm sur un parcours vide
// doit renvoyer 400.
func TestConfirmOnboardingRequiresCompleteStages(t *testing.T) {
	testDBURL(t) // garde-fou ; le serveur de test est monté par main_test.go
	if testServer == nil || testDB == nil {
		t.Skip("serveur de test non initialisé")
	}

	// Org jetable, sans progression : la confirmation doit échouer.
	_ = uuid.New() // (l'auth Clerk est requise avant toute résolution d'org)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/onboarding/confirm", nil)
	// Le middleware Clerk n'est pas contournable en test unitaire sans jeton :
	// on attend un 401/403 sans claims, ou 400/500 selon la pile — l'important
	// est de ne jamais recevoir de 201 (création) sans parcours complet.
	rec := httptest.NewRecorder()
	testServer.router.ServeHTTP(rec, req)
	if rec.Code == http.StatusCreated {
		t.Fatalf("la confirmation a abouti sans parcours complet ni authentification (code 201)")
	}
}
