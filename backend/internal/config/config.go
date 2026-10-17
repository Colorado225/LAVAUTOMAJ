package config

import (
	"log"
	"os"

	"github.com/clerk/clerk-sdk-go/v2"
	"github.com/joho/godotenv"
)

// Config holds all configuration for the application
type Config struct {
	DatabaseURL    string
	ClerkSecretKey string
}

// LoadConfig loads the configuration from a .env file
func LoadConfig() (*Config, error) {
	// Attempt to load .env file
	err := godotenv.Load()
	if err != nil {
		log.Println("No .env file found, using environment variables")
	}

	secretKey := os.Getenv("CLERK_SECRET_KEY")
	clerk.SetKey(secretKey)

	cfg := &Config{
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		ClerkSecretKey: secretKey,
	}

	return cfg, nil
}
