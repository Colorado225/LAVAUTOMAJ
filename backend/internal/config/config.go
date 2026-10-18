package config

import (
	"log"
	"os"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/joho/godotenv"
)

// Config holds all configuration for the application
type Config struct {
	DatabaseURL        string
	ClerkSecretKey     string
	ClerkWebhookSecret string
}

// LoadConfig loads the configuration from a .env file
func LoadConfig() (*Config, error) {
	// Attempt to load .env file
	err := godotenv.Load()
	if err != nil {
		log.Println("No .env file found, using environment variables")
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		// Fallback : certains fichiers .env utilisent NEON_DATABASE_URL
		databaseURL = os.Getenv("NEON_DATABASE_URL")
	}

	secretKey := os.Getenv("CLERK_SECRET_KEY")
	if secretKey == "" {
		log.Println("WARNING: CLERK_SECRET_KEY is empty")
	}
	clerk.SetKey(secretKey)

	cfg := &Config{
		DatabaseURL:        databaseURL,
		ClerkSecretKey:     secretKey,
		ClerkWebhookSecret: os.Getenv("CLERK_WEBHOOK_SECRET"),
	}

	return cfg, nil
}
