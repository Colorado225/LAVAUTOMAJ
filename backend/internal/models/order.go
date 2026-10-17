package models

import (
	"time"

	"github.com/google/uuid"
)

type OrderStatus string

const (
	OrderStatusPending   OrderStatus = "pending"
	OrderStatusCompleted OrderStatus = "completed"
	OrderStatusCancelled OrderStatus = "cancelled"
)

type Order struct {
	ID             uuid.UUID   `db:"id" json:"id"`
	OrganizationID uuid.UUID   `db:"organization_id" json:"organization_id"`
	Amount         int         `db:"amount" json:"amount"`
	Status         OrderStatus `db:"status" json:"status"`
	CreatedAt      time.Time   `db:"created_at" json:"created_at"`
	UpdatedAt      time.Time   `db:"updated_at" json:"updated_at"`
}
