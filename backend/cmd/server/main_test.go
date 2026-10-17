package main

import (
	"log"
	"os"
	"testing"
	"washpilot-ci-backend/internal/config"
	"washpilot-ci-backend/internal/database"
	"washpilot-ci-backend/internal/logger"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jmoiron/sqlx"
)

var testServer *ApiServer
var testDB *sqlx.DB

func TestMain(m *testing.M) {
	// Setup
	logger := logger.New("debug")

	cfg, err := config.LoadConfig()
	if err != nil {
		logger.Error("Failed to load test configuration", "error", err)
		os.Exit(1)
	}

	testDB, err = database.Connect(cfg.DatabaseURL)
	if err != nil {
		logger.Error("Failed to connect to test database", "error", err)
		os.Exit(1)
	}

	migPath := "file://" + mustRepoMigrationsPath()
	mig, err := migrate.New(
		migPath,
		cfg.DatabaseURL,
	)
	if err != nil {
		log.Fatalf("could not create migrate instance: %v", err)
	}
	if err := mig.Up(); err != nil && err != migrate.ErrNoChange {
		log.Fatalf("could not run up migrations: %v", err)
	}

	testServer = NewApiServer(":8081", testDB, cfg, logger)

	// Run tests
	code := m.Run()

	// Teardown
	// ⚠️ SÉCURITÉ : pas de mig.Down() ici. Le teardown destructeur a déjà
	// supprimé toutes les tables de la base configurée lors d'un précédent
	// run. Les tests s'exécutent contre la base de l'environnement : ne
	// jamais y exécuter de migration descendante. Le nettoyage éventuel se
	// fait par un TEST_DATABASE_URL dédié et un outil de reset explicite.
	if os.Getenv("ALLOW_MIGRATION_DOWN") == "1" {
		if err := mig.Down(); err != nil && err != migrate.ErrNoChange {
			log.Fatalf("could not run down migrations: %v", err)
		}
	}

	testDB.Close()
	os.Exit(code)
}
