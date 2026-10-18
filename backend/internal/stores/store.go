package stores

import "github.com/jmoiron/sqlx"

// Store is a central store that holds all the other stores.
type Store struct {
	UserStore            *UserStore
	OrganizationStore    *OrganizationStore
	SiteStore            *SiteStore
	WashStore            *WashStore
	VehicleCategoryStore *VehicleCategoryStore
	ServiceCategoryStore *ServiceCategoryStore
	ServiceStore         *ServiceStore
	PaymentStore         *PaymentStore
	CashSessionStore     *CashSessionStore
	CashMovementStore    *CashMovementStore
	ExpenseCategoryStore *ExpenseCategoryStore
	ExpenseStore         *ExpenseStore
	OnboardingStore      *OnboardingStore
}

func NewStore(db *sqlx.DB) *Store {
	return &Store{
		UserStore:            NewUserStore(db),
		OrganizationStore:    NewOrganizationStore(db),
		SiteStore:            NewSiteStore(db),
		WashStore:            NewWashStore(db),
		VehicleCategoryStore: NewVehicleCategoryStore(db),
		ServiceCategoryStore: NewServiceCategoryStore(db),
		ServiceStore:         NewServiceStore(db),
		PaymentStore:         NewPaymentStore(db),
		CashSessionStore:     NewCashSessionStore(db),
		CashMovementStore:    NewCashMovementStore(db),
		ExpenseCategoryStore: NewExpenseCategoryStore(db),
		ExpenseStore:         NewExpenseStore(db),
		OnboardingStore:      NewOnboardingStore(db),
	}
}
