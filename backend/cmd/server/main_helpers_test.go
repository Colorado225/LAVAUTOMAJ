package main

import (
	"path/filepath"
	"runtime"
)

// mustRepoMigrationsPath retourne le chemin absolu du dossier de migrations,
// quel que soit le répertoire de travail de `go test` (cwd = dossier du package).
func mustRepoMigrationsPath() string {
	_, thisFile, _, _ := runtime.Caller(0)
	// cmd/server/main_helpers_test.go → backend/migrations
	return filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations")
}
