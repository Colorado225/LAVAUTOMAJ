package database

import (
	"fmt"
	"log"

	_ "github.com/jackc/pgx/v5/stdlib" // PostgreSQL driver
	"github.com/jmoiron/sqlx"
)

// Connect establishes a connection to the database using sqlx
func Connect(databaseURL string) (*sqlx.DB, error) {
	db, err := sqlx.Connect("pgx", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("unable to connect to database: %w", err)
	}

	if err = db.Ping(); err != nil {
		return nil, fmt.Errorf("database ping failed: %w", err)
	}

	log.Println("Successfully connected to the database")
	return db, nil
}
