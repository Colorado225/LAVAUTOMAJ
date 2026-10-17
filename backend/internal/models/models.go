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
	ID         uuid.UUID `db:"id" json:"id"`
	ClerkOrgID string    `db:"clerk_org_id" json:"clerk_org_id"`
	Name       string    `db:"name" json:"name"`
	Phone      *string   `db:"phone" json:"phone"`
	Email      *string   `db:"email" json:"email"`
	Address    *string   `db:"address" json:"address"`
	City       *string   `db:"city" json:"city"`
	Description *string  `db:"description" json:"description"`
	LogoURL    *string   `db:"logo_url" json:"logo_url"`
	Slug       *string   `db:"slug" json:"slug"`
	OnboardingCompleted bool `db:"onboarding_completed" json:"onboarding_completed"`
	CreatedAt  time.Time `db:"created_at" json:"created_at"`
	UpdatedAt  time.Time `db:"updated_at" json:"updated_at"`
}

type User struct {
	ID             uuid.UUID  `db:"id" json:"id"`
	ClerkUserID    string     `db:"clerk_user_id" json:"clerk_user_id"`
	OrganizationID uuid.UUID  `db:"organization_id" json:"organization_id"`
	FirstName      *string    `db:"first_name" json:"first_name"`
	LastName       *string    `db:"last_name" json:"last_name"`
	Email          *string    `db:"email" json:"email"`
	Role           UserRole   `db:"role" json:"role"`
	Status         UserStatus `db:"status" json:"status"`
	CreatedAt      time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time  `db:"updated_at" json:"updated_at"`
}

type VehicleCategory struct {
	ID             uuid.UUID `db:"id" json:"id"`
	OrganizationID uuid.UUID `db:"organization_id" json:"organization_id"`
	Name           string    `db:"name" json:"name"`
	IsActive       bool      `db:"is_active" json:"is_active"`
	CreatedAt      time.Time `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time `db:"updated_at" json:"updated_at"`
}

type ServiceCategory struct {
	ID             uuid.UUID `db:"id" json:"id"`
	OrganizationID uuid.UUID `db:"organization_id" json:"organization_id"`
	Name           string    `db:"name" json:"name"`
	IsActive       bool      `db:"is_active" json:"is_active"`
	CreatedAt      time.Time `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time `db:"updated_at" json:"updated_at"`
}

type Service struct {
	ID             uuid.UUID `db:"id" json:"id"`
	OrganizationID uuid.UUID `db:"organization_id" json:"organization_id"`
	CategoryID     *uuid.UUID `db:"category_id" json:"category_id"`
	Name           string    `db:"name" json:"name"`
	PriceCents     int64     `db:"price_cents" json:"price_cents"`
	DurationMinutes *int      `db:"duration_minutes" json:"duration_minutes"`
	IsActive       bool      `db:"is_active" json:"is_active"`
	CreatedAt      time.Time `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time `db:"updated_at" json:"updated_at"`
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
	ID             uuid.UUID `db:"id" json:"id"`
	OrganizationID uuid.UUID `db:"organization_id" json:"organization_id"`
	WashID         *uuid.UUID `db:"wash_id" json:"wash_id"`
	CashSessionID  *uuid.UUID `db:"cash_session_id" json:"cash_session_id"`
	AmountCents    int64     `db:"amount_cents" json:"amount_cents"`
	Method         PaymentMethod `db:"method" json:"method"`
	Status         PaymentStatus   `db:"status" json:"status"`
	Reference      *string    `db:"reference" json:"reference"`
	ReceivedAt     time.Time  `db:"received_at" json:"received_at"`
	AuthorID       uuid.UUID  `db:"author_id" json:"author_id"`
	CreatedAt      time.Time  `db:"created_at" json:"created_at"`
}

type CashSession struct {
	ID                   uuid.UUID      `db:"id" json:"id"`
	OrganizationID       uuid.UUID      `db:"organization_id" json:"organization_id"`
	SiteID               uuid.UUID      `db:"site_id" json:"site_id"`
	UserID               uuid.UUID      `db:"user_id" json:"user_id"`
	OpeningAmountCents   int64          `db:"opening_amount_cents" json:"opening_amount_cents"`
	TheoreticalBalanceCents int64       `db:"theoretical_balance_cents" json:"theoretical_balance_cents"`
	CountedAmountCents   *int64         `db:"counted_amount_cents" json:"counted_amount_cents"`
	DiscrepancyCents     *int64         `db:"discrepancy_cents" json:"discrepancy_cents"`
	DiscrepancyReason    *string        `db:"discrepancy_reason" json:"discrepancy_reason"`
	Status               CashSessionStatus `db:"status" json:"status"`
	OpenedAt             time.Time     `db:"opened_at" json:"opened_at"`
	ClosedAt             *time.Time    `db:"closed_at" json:"closed_at"`
	ClosedByID           *uuid.UUID    `db:"closed_by_id" json:"closed_by_id"`
	CreatedAt            time.Time     `db:"created_at" json:"created_at"`
	UpdatedAt            time.Time     `db:"updated_at" json:"updated_at"`
}

type CashMovement struct {
	ID             uuid.UUID `db:"id" json:"id"`
	OrganizationID uuid.UUID `db:"organization_id" json:"organization_id"`
	CashSessionID  uuid.UUID `db:"cash_session_id" json:"cash_session_id"`
	Type           CashMovementType `db:"type" json:"type"`
	AmountCents    int64     `db:"amount_cents" json:"amount_cents"`
	Source         string    `db:"source" json:"source"`
	ReferenceID    *uuid.UUID `db:"reference_id" json:"reference_id"`
	Description    *string   `db:"description" json:"description"`
	AuthorID       uuid.UUID `db:"author_id" json:"author_id"`
	CreatedAt      time.Time `db:"created_at" json:"created_at"`
}

type ExpenseCategory struct {
	ID             uuid.UUID `db:"id" json:"id"`
	OrganizationID uuid.UUID `db:"organization_id" json:"organization_id"`
	Name           string    `db:"name" json:"name"`
	IsActive       bool      `db:"is_active" json:"is_active"`
	CreatedAt      time.Time `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time `db:"updated_at" json:"updated_at"`
}

type Expense struct {
	ID             uuid.UUID `db:"id" json:"id"`
	OrganizationID uuid.UUID `db:"organization_id" json:"organization_id"`
	SiteID         *uuid.UUID `db:"site_id" json:"site_id"`
	Category       string    `db:"category" json:"category"`
	AmountCents    int64     `db:"amount_cents" json:"amount_cents"`
	ExpenseDate    time.Time `db:"expense_date" json:"expense_date"`
	PaymentMethod  PaymentMethod `db:"payment_method" json:"payment_method"`
	Beneficiary    *string   `db:"beneficiary" json:"beneficiary"`
	Description    *string   `db:"description" json:"description"`
	AuthorID       uuid.UUID `db:"author_id" json:"author_id"`
	Reference      *string   `db:"reference" json:"reference"`
	Status         ExpenseStatus `db:"status" json:"status"`
	CashSessionID  *uuid.UUID `db:"cash_session_id" json:"cash_session_id"`
	CreatedAt      time.Time `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time `db:"updated_at" json:"updated_at"`
}

type Site struct {
	ID             uuid.UUID `db:"id" json:"id"`
	OrganizationID uuid.UUID `db:"organization_id" json:"organization_id"`
	Name           string    `db:"name" json:"name"`
	Address        *string   `db:"address" json:"address"`
	City           *string   `db:"city" json:"city"`
	Commune        *string   `db:"commune" json:"commune"`
	Phone          *string   `db:"phone" json:"phone"`
	IsActive       bool      `db:"is_active" json:"is_active"`
	CreatedAt      time.Time `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time `db:"updated_at" json:"updated_at"`
}

type Wash struct {
	ID                    uuid.UUID          `db:"id" json:"id"`
	OrganizationID        uuid.UUID          `db:"organization_id" json:"organization_id"`
	SiteID                *uuid.UUID         `db:"site_id" json:"site_id"`
	VehicleCategoryID     *uuid.UUID         `db:"vehicle_category_id" json:"vehicle_category_id"`
	CustomerID            *uuid.UUID         `db:"customer_id" json:"customer_id"`
	Reference             string             `db:"reference" json:"reference"`
	TotalCents            int64              `db:"total_cents" json:"total_cents"`
	Status                WashStatus         `db:"status" json:"status"`
	PaymentStatus         WashPaymentStatus  `db:"payment_status" json:"payment_status"`
	AuthorID              uuid.UUID          `db:"author_id" json:"author_id"`
	IdempotencyKey        *string            `db:"idempotency_key" json:"-"`
	IdempotencyFingerprint *string           `db:"idempotency_fingerprint" json:"-"`
	CancelledAt           *time.Time         `db:"cancelled_at" json:"cancelled_at"`
	CancelledByID         *uuid.UUID         `db:"cancelled_by_id" json:"cancelled_by_id"`
	CancellationReason    *string            `db:"cancellation_reason" json:"cancellation_reason"`
	CreatedAt             time.Time          `db:"created_at" json:"created_at"`
	UpdatedAt             time.Time          `db:"updated_at" json:"updated_at"`
}

type WashItem struct {
	ID                   uuid.UUID `db:"id" json:"id"`
	WashID               uuid.UUID `db:"wash_id" json:"wash_id"`
	ServiceID            *uuid.UUID `db:"service_id" json:"service_id"`
	ServiceNameSnapshot  string    `db:"service_name_snapshot" json:"service_name_snapshot"`
	PriceCentsSnapshot   int64     `db:"price_cents_snapshot" json:"price_cents_snapshot"`
	Quantity             int       `db:"quantity" json:"quantity"`
	CreatedAt            time.Time `db:"created_at" json:"created_at"`
}

type WashAssignment struct {
	ID        uuid.UUID `db:"id" json:"id"`
	WashID    uuid.UUID `db:"wash_id" json:"wash_id"`
	UserID    uuid.UUID `db:"user_id" json:"user_id"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}

type WashDetail struct {
	Wash     Wash      `json:"wash"`
	Items    []WashItem `json:"items"`
	Workers  []Worker   `json:"workers"`
	Payments []Payment  `json:"payments"`
}

type Customer struct {
	ID             uuid.UUID `db:"id" json:"id"`
	OrganizationID uuid.UUID `db:"organization_id" json:"organization_id"`
	Name           string    `db:"name" json:"name"`
	Phone          *string   `db:"phone" json:"phone"`
	SiteID         *uuid.UUID `db:"site_id" json:"site_id"`
	CreatedAt      time.Time `db:"created_at" json:"created_at"`
}
