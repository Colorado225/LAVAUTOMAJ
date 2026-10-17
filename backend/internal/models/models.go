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
	Phone      *string   `db:"phone"`
	Email      *string   `db:"email"`
	Address    *string   `db:"address"`
	City       *string   `db:"city"`
	Description *string  `db:"description"`
	LogoURL    *string   `db:"logo_url"`
	Slug       *string   `db:"slug"`
	OnboardingCompleted bool `db:"onboarding_completed"`
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

type PaymentMethod string

const (
	PaymentMethodCash      PaymentMethod = "cash"
	PaymentMethodOrangeMoney PaymentMethod = "orange_money"
	PaymentMethodMTNMoMo   PaymentMethod = "mtn_momo"
	PaymentMethodMoovMoney PaymentMethod = "moov_money"
	PaymentMethodWave      PaymentMethod = "wave"
	PaymentMethodOther     PaymentMethod = "other"
)

type PaymentStatus string

const (
	PaymentStatusPending  PaymentStatus = "pending"
	PaymentStatusVerified PaymentStatus = "verified"
	PaymentStatusFailed   PaymentStatus = "failed"
	PaymentStatusRefunded PaymentStatus = "refunded"
)

type CashSessionStatus string

const (
	CashSessionStatusOpen  CashSessionStatus = "open"
	CashSessionStatusClosed CashSessionStatus = "closed"
)

type CashMovementType string

const (
	CashMovementTypeEntry CashMovementType = "entry"
	CashMovementTypeExit  CashMovementType = "exit"
)

type ExpenseStatus string

const (
	ExpenseStatusRecorded ExpenseStatus = "recorded"
	ExpenseStatusCancelled ExpenseStatus = "cancelled"
)

type WashStatus string

const (
	WashStatusPending    WashStatus = "pending"
	WashStatusCompleted  WashStatus = "completed"
	WashStatusCancelled  WashStatus = "cancelled"
)

type WashPaymentStatus string

const (
	WashPaymentStatusUnpaid   WashPaymentStatus = "unpaid"
	WashPaymentStatusPaid     WashPaymentStatus = "paid"
	WashPaymentStatusPartial  WashPaymentStatus = "partial"
	WashPaymentStatusRefunded WashPaymentStatus = "refunded"
)

type Payment struct {
	ID             uuid.UUID `db:"id"`
	OrganizationID uuid.UUID `db:"organization_id"`
	WashID         *uuid.UUID `db:"wash_id"`
	AmountCents    int64     `db:"amount_cents"`
	Method         PaymentMethod `db:"method"`
	Status         PaymentStatus   `db:"status"`
	Reference      *string    `db:"reference"`
	ReceivedAt     time.Time  `db:"received_at"`
	AuthorID       uuid.UUID  `db:"author_id"`
	CreatedAt      time.Time  `db:"created_at"`
}

type CashSession struct {
	ID                   uuid.UUID      `db:"id"`
	OrganizationID       uuid.UUID      `db:"organization_id"`
	SiteID               uuid.UUID      `db:"site_id"`
	UserID               uuid.UUID      `db:"user_id"`
	OpeningAmountCents   int64          `db:"opening_amount_cents"`
	TheoreticalBalanceCents int64       `db:"theoretical_balance_cents"`
	CountedAmountCents   *int64         `db:"counted_amount_cents"`
	DiscrepancyCents     *int64         `db:"discrepancy_cents"`
	DiscrepancyReason    *string        `db:"discrepancy_reason"`
	Status               CashSessionStatus `db:"status"`
	OpenedAt             time.Time     `db:"opened_at"`
	ClosedAt             *time.Time    `db:"closed_at"`
	ClosedByID           *uuid.UUID    `db:"closed_by_id"`
	CreatedAt            time.Time     `db:"created_at"`
	UpdatedAt            time.Time     `db:"updated_at"`
}

type CashMovement struct {
	ID             uuid.UUID `db:"id"`
	OrganizationID uuid.UUID `db:"organization_id"`
	CashSessionID  uuid.UUID `db:"cash_session_id"`
	Type           CashMovementType `db:"type"`
	AmountCents    int64     `db:"amount_cents"`
	Source         string    `db:"source"`
	ReferenceID    *uuid.UUID `db:"reference_id"`
	Description    *string   `db:"description"`
	AuthorID       uuid.UUID `db:"author_id"`
	CreatedAt      time.Time `db:"created_at"`
}

type ExpenseCategory struct {
	ID             uuid.UUID `db:"id"`
	OrganizationID uuid.UUID `db:"organization_id"`
	Name           string    `db:"name"`
	IsActive       bool      `db:"is_active"`
	CreatedAt      time.Time `db:"created_at"`
	UpdatedAt      time.Time `db:"updated_at"`
}

type Expense struct {
	ID             uuid.UUID `db:"id"`
	OrganizationID uuid.UUID `db:"organization_id"`
	SiteID         *uuid.UUID `db:"site_id"`
	Category       string    `db:"category"`
	AmountCents    int64     `db:"amount_cents"`
	ExpenseDate    time.Time `db:"expense_date"`
	PaymentMethod  PaymentMethod `db:"payment_method"`
	Beneficiary    *string   `db:"beneficiary"`
	Description    *string   `db:"description"`
	AuthorID       uuid.UUID `db:"author_id"`
	Reference      *string   `db:"reference"`
	Status         ExpenseStatus `db:"status"`
	CashSessionID  *uuid.UUID `db:"cash_session_id"`
	CreatedAt      time.Time `db:"created_at"`
	UpdatedAt      time.Time `db:"updated_at"`
}

type Site struct {
	ID             uuid.UUID `db:"id"`
	OrganizationID uuid.UUID `db:"organization_id"`
	Name           string    `db:"name"`
	Address        *string   `db:"address"`
	City           *string   `db:"city"`
	Commune        *string   `db:"commune"`
	Phone          *string   `db:"phone"`
	IsActive       bool      `db:"is_active"`
	CreatedAt      time.Time `db:"created_at"`
	UpdatedAt      time.Time `db:"updated_at"`
}

type Wash struct {
	ID              uuid.UUID `db:"id"`
	OrganizationID  uuid.UUID `db:"organization_id"`
	SiteID          *uuid.UUID `db:"site_id"`
	VehicleCategoryID *uuid.UUID `db:"vehicle_category_id"`
	CustomerID      *uuid.UUID `db:"customer_id"`
	Reference       string    `db:"reference"`
	TotalCents      int64     `db:"total_cents"`
	Status          WashStatus   `db:"status"`
	PaymentStatus   WashPaymentStatus `db:"payment_status"`
	AuthorID        uuid.UUID  `db:"author_id"`
	IdempotencyKey  *string    `db:"idempotency_key"`
	CreatedAt       time.Time  `db:"created_at"`
	UpdatedAt       time.Time  `db:"updated_at"`
}

type WashItem struct {
	ID                   uuid.UUID `db:"id"`
	WashID               uuid.UUID `db:"wash_id"`
	ServiceID            *uuid.UUID `db:"service_id"`
	ServiceNameSnapshot  string    `db:"service_name_snapshot"`
	PriceCentsSnapshot   int64     `db:"price_cents_snapshot"`
	Quantity             int       `db:"quantity"`
	CreatedAt            time.Time `db:"created_at"`
}

type WashAssignment struct {
	ID        uuid.UUID `db:"id"`
	WashID    uuid.UUID `db:"wash_id"`
	UserID    uuid.UUID `db:"user_id"`
	CreatedAt time.Time `db:"created_at"`
}

type Customer struct {
	ID             uuid.UUID `db:"id"`
	OrganizationID uuid.UUID `db:"organization_id"`
	Name           string    `db:"name"`
	Phone          *string   `db:"phone"`
	SiteID         *uuid.UUID `db:"site_id"`
	CreatedAt      time.Time `db:"created_at"`
}
