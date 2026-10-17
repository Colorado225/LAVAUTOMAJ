package main

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"washpilot-ci-backend/internal/config"
	"washpilot-ci-backend/internal/database"
	"washpilot-ci-backend/internal/logger"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jmoiron/sqlx"
	"github.com/joho/godotenv"
)

var testServer *ApiServer
var testDB *sqlx.DB

func databaseTarget(raw string) (string, string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", "", false
	}
	parsed, err := url.Parse(raw)
	if err == nil && (parsed.Scheme == "postgres" || parsed.Scheme == "postgresql") && parsed.Hostname() != "" {
		name, err := url.PathUnescape(strings.TrimPrefix(parsed.EscapedPath(), "/"))
		if err != nil || name == "" {
			return "", "", false
		}
		port := parsed.Port()
		if port == "" {
			port = "5432"
		}
		return strings.ToLower(parsed.Hostname()) + ":" + port, name, true
	}

	// Also support the libpq-style DSN accepted by pgx (host=... dbname=...).
	values := make(map[string]string)
	for _, field := range strings.Fields(raw) {
		parts := strings.SplitN(field, "=", 2)
		if len(parts) == 2 {
			values[strings.ToLower(parts[0])] = strings.Trim(parts[1], "'\"")
		}
	}
	name := values["dbname"]
	if name == "" {
		return "", "", false
	}
	host := strings.ToLower(values["host"])
	if host == "" {
		host = "unix-socket-default"
	}
	port := values["port"]
	if port == "" {
		port = "5432"
	}
	return host + ":" + port, name, true
}

func sameDatabaseTarget(first, second string) bool {
	if strings.TrimSpace(first) == strings.TrimSpace(second) {
		return first != ""
	}
	firstHost, firstName, firstOK := databaseTarget(first)
	secondHost, secondName, secondOK := databaseTarget(second)
	return firstOK && secondOK && firstHost == secondHost && firstName == secondName
}

func isExplicitTestDatabase(raw string) bool {
	_, name, ok := databaseTarget(raw)
	return ok && strings.Contains(strings.ToLower(name), "test")
}

func TestMain(m *testing.M) {
	// Database integration tests are opt-in and may only use a separately
	// provisioned database whose name explicitly marks it as a test database.
	// Never fall back to DATABASE_URL or execute destructive teardown SQL.
	testDatabaseURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if testDatabaseURL == "" {
		fmt.Fprintln(os.Stderr, "Skipping database integration setup: set TEST_DATABASE_URL to a disposable PostgreSQL database (its name must contain 'test')")
		os.Exit(m.Run())
	}
	if !isExplicitTestDatabase(testDatabaseURL) {
		fmt.Fprintln(os.Stderr, "Refusing to run database tests: TEST_DATABASE_URL must target a database whose name contains 'test'")
		os.Exit(2)
	}

	log := logger.New("debug")
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Error("Failed to load test configuration", "error", err)
		os.Exit(1)
	}

	applicationDatabaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if applicationDatabaseURL == "" {
		rootEnvPath := filepath.Join(mustRepoMigrationsPath(), "..", "..", ".env")
		if rootEnv, readErr := godotenv.Read(rootEnvPath); readErr == nil {
			applicationDatabaseURL = strings.TrimSpace(rootEnv["DATABASE_URL"])
		}
	}
	if applicationDatabaseURL == "" {
		applicationDatabaseURL = strings.TrimSpace(cfg.DatabaseURL)
	}
	if sameDatabaseTarget(applicationDatabaseURL, testDatabaseURL) {
		fmt.Fprintln(os.Stderr, "Refusing to run database tests: TEST_DATABASE_URL resolves to the same database as DATABASE_URL")
		os.Exit(2)
	}

	// Explicitly override any development URL the config loader may have read.
	cfg.DatabaseURL = testDatabaseURL
	testDB, err = database.Connect(testDatabaseURL)
	if err != nil {
		log.Error("Failed to connect to TEST_DATABASE_URL", "error", err)
		os.Exit(1)
	}

	migPath := "file://" + mustRepoMigrationsPath()
	mig, err := migrate.New(migPath, testDatabaseURL)
	if err != nil {
		log.Error("Could not create migration instance", "error", err)
		_ = testDB.Close()
		os.Exit(1)
	}
	if err := mig.Up(); err != nil && err != migrate.ErrNoChange {
		log.Error("Could not apply migrations to TEST_DATABASE_URL", "error", err)
		_, _ = mig.Close()
		_ = testDB.Close()
		os.Exit(1)
	}
	if _, err := mig.Close(); err != nil {
		log.Error("Could not close migration connection", "error", err)
		_ = testDB.Close()
		os.Exit(1)
	}

	testServer = NewApiServer(":8081", testDB, cfg, log)
	code := m.Run()

	// Do not run Down() or truncate shared tables. The caller owns the
	// disposable database and any reset operation must be explicit and manual.
	if err := testDB.Close(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to close test database: %v\n", err)
	}
	os.Exit(code)
}
