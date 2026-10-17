package models

import (
	"time"

	"github.com/google/uuid"
)

type UserRole string

const (
	RolePlatformAdmin UserRole = "platform_admin"
	RoleOwner         UserRole = "owner"
	RoleManager       UserRole = "manager"
	RoleCashier       UserRole = "cashier"
	RoleWasher        UserRole = "washer"
)

type UserStatus string

const (
	StatusActive   UserStatus = "active"
	StatusInvited  UserStatus = "invited"
	StatusInactive UserStatus = "inactive"
)

type Organization struct {
	ID         uuid.UUID `db:"id"`
	ClerkOrgID string    `db:"clerk_org_id"`
	Name       string    `db:"name"`
	CreatedAt  time.Time `db:"created_at"`
	UpdatedAt  time.Time `db:"updated_at"`
}

type User struct {
	ID             uuid.UUID  `db:"id"`
	ClerkUserID    string     `db:"clerk_user_id"`
	OrganizationID uuid.UUID  `db:"organization_id"`
	FirstName      *string    `db:"first_name"`
	LastName       *string    `db:"last_name"`
	Email          string     `db:"email"`
	Role           UserRole   `db:"role"`
	Status         UserStatus `db:"status"`
	CreatedAt      time.Time  `db:"created_at"`
	UpdatedAt      time.Time  `db:"updated_at"`
}

type VehicleCategory struct {
	ID             uuid.UUID `db:"id"`
	OrganizationID uuid.UUID `db:"organization_id"`
	Name           string    `db:"name"`
	IsActive       bool      `db:"is_active"`
	CreatedAt      time.Time `db:"created_at"`
	UpdatedAt      time.Time `db:"updated_at"`
}

type ServiceCategory struct {
	ID             uuid.UUID `db:"id"`
	OrganizationID uuid.UUID `db:"organization_id"`
	Name           string    `db:"name"`
	IsActive       bool      `db:"is_active"`
	CreatedAt      time.Time `db:"created_at"`
	UpdatedAt      time.Time `db:"updated_at"`
}

type Service struct {
	ID             uuid.UUID `db:"id"`
	OrganizationID uuid.UUID `db:"organization_id"`
	CategoryID     *uuid.UUID `db:"category_id"`
	Name           string    `db:"name"`
	PriceCents     int64     `db:"price_cents"`
	DurationMinutes *int      `db:"duration_minutes"`
	IsActive       bool      `db:"is_active"`
	CreatedAt      time.Time `db:"created_at"`
	UpdatedAt      time.Time `db:"updated_at"`
}
