package main

import "testing"

func TestSameDatabaseTargetIgnoresCredentialsAndScheme(t *testing.T) {
	appURL := "postgresql://app:secret@db.example.test:5432/washpilot"
	testURL := "postgres://test:secret@db.example.test/washpilot"
	if !sameDatabaseTarget(appURL, testURL) {
		t.Fatal("expected URLs with the same host and database to be treated as the same target")
	}
}

func TestExplicitTestDatabaseNameRequired(t *testing.T) {
	if !isExplicitTestDatabase("postgresql://test:secret@localhost:5432/washpilot_test") {
		t.Fatal("expected a database name containing 'test' to be accepted")
	}
	if isExplicitTestDatabase("postgresql://test:secret@localhost:5432/washpilot") {
		t.Fatal("expected a database name without 'test' to be rejected")
	}
}
