package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// WorkerRole — fonctions des travailleurs d'une station (§6 du WORKFLOW).
type WorkerRole string

const (
	WorkerRoleCarWasher       WorkerRole = "car_washer"
	WorkerRoleMotoWasher      WorkerRole = "moto_washer"
	WorkerRoleVersatileWasher WorkerRole = "versatile_washer"
	WorkerRoleTeamLead        WorkerRole = "team_lead"
	WorkerRoleCustom          WorkerRole = "custom"
)

type Worker struct {
	ID             uuid.UUID  `db:"id" json:"id"`
	OrganizationID uuid.UUID  `db:"organization_id" json:"organization_id"`
	FirstName      string     `db:"first_name" json:"first_name"`
	LastName       string     `db:"last_name" json:"last_name"`
	Phone          *string    `db:"phone" json:"phone"`
	District       *string    `db:"district" json:"district"`
	Role           WorkerRole `db:"role" json:"role"`
	CustomRole     *string    `db:"custom_role" json:"custom_role"`
	Status         UserStatus `db:"status" json:"status"`
	JoinedAt       *time.Time `db:"joined_at" json:"joined_at"`
	CreatedAt      time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time  `db:"updated_at" json:"updated_at"`
}

// Plan — forfait d'abonnement (catalogue en base, §7 du WORKFLOW).
type Plan struct {
	ID           uuid.UUID       `db:"id" json:"id"`
	Code         string          `db:"code" json:"code"`
	Name         string          `db:"name" json:"name"`
	Description  *string         `db:"description" json:"description"`
	PriceCents   int64           `db:"price_cents" json:"price_cents"`
	BillingCycle string          `db:"billing_cycle" json:"billing_cycle"`
	MaxWorkers   *int            `db:"max_workers" json:"max_workers"`
	MaxServices  *int            `db:"max_services" json:"max_services"`
	MaxSites     *int            `db:"max_sites" json:"max_sites"`
	MaxUsers     *int            `db:"max_users" json:"max_users"`
	Features     json.RawMessage `db:"features" json:"features"`
	SortOrder    int             `db:"sort_order" json:"sort_order"`
	IsActive     bool            `db:"is_active" json:"is_active"`
}

type SubscriptionState string

const (
	SubStateSelected  SubscriptionState = "selected"
	SubStatePending   SubscriptionState = "pending"
	SubStateActive    SubscriptionState = "active"
	SubStateTrialing  SubscriptionState = "trialing"
	SubStatePastDue   SubscriptionState = "past_due"
	SubStateFailed    SubscriptionState = "failed"
	SubStateExpired   SubscriptionState = "expired"
	SubStateCancelled SubscriptionState = "cancelled"
)

type Subscription struct {
	ID             uuid.UUID         `db:"id" json:"id"`
	OrganizationID uuid.UUID         `db:"organization_id" json:"organization_id"`
	PlanID         uuid.UUID         `db:"plan_id" json:"plan_id"`
	State          SubscriptionState `db:"state" json:"state"`
	StartedAt      *time.Time        `db:"started_at" json:"started_at"`
	ExpiresAt      *time.Time        `db:"expires_at" json:"expires_at"`
	CreatedAt      time.Time         `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time         `db:"updated_at" json:"updated_at"`
}

// OnboardingStage — étapes ordonnées du parcours (§4-§9 du WORKFLOW).
type OnboardingStage string

const (
	StageStation  OnboardingStage = "station"
	StageServices OnboardingStage = "services"
	StageWorkers  OnboardingStage = "workers"
	StagePlan     OnboardingStage = "plan"
	StageReview   OnboardingStage = "review"
)

var StageOrder = map[OnboardingStage]int{
	StageStation:  0,
	StageServices: 1,
	StageWorkers:  2,
	StagePlan:     3,
	StageReview:   4,
}

func (s OnboardingStage) IsValid() bool {
	_, ok := StageOrder[s]
	return ok
}

// OnboardingProgress — progression persistée côté serveur (§8 du WORKFLOW).
type OnboardingProgress struct {
	ID             uuid.UUID        `db:"id" json:"id"`
	OrganizationID uuid.UUID        `db:"organization_id" json:"organization_id"`
	CurrentStage   OnboardingStage  `db:"current_stage" json:"current_stage"`
	StationData    *json.RawMessage `db:"station_data" json:"station_data"`
	ServicesData   *json.RawMessage `db:"services_data" json:"services_data"`
	WorkersData    *json.RawMessage `db:"workers_data" json:"workers_data"`
	PlanCode       *string          `db:"plan_code" json:"plan_code"`
	CompletedAt    *time.Time       `db:"completed_at" json:"completed_at"`
	CreatedAt      time.Time        `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time        `db:"updated_at" json:"updated_at"`
}

// ServiceCatalogTemplate — prestation standard de référence (§5 du WORKFLOW).
type ServiceCatalogTemplate struct {
	ID         uuid.UUID `db:"id" json:"id"`
	Category   string    `db:"category" json:"category"`
	Name       string    `db:"name" json:"name"`
	PriceCents *int64    `db:"price_cents" json:"price_cents"`
	SortOrder  int       `db:"sort_order" json:"sort_order"`
}
