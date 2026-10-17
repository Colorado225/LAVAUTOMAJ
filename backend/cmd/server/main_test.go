package main

import (
	"os"
	"testing"
	"washpilot-ci-backend/internal/config"
	"washpilot-ci-backend/internal/database"
	"washpilot-ci-backend/internal/logger"

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

	// Here, you would typically connect to a separate test database.
	// For now, we'll use the same one, but this should be changed.
	testDB, err = database.Connect(cfg.DatabaseURL)
	if err != nil {
		logger.Error("Failed to connect to test database", "error", err)
		os.Exit(1)
	}

	testServer = NewApiServer(":8081", testDB, cfg, logger)

	// Run tests
	code := m.Run()

	// Teardown
	testDB.Close()
	os.Exit(code)
}
