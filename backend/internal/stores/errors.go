package stores

import "errors"

const maxCashBalanceCents int64 = 1<<63 - 1

var (
	ErrSiteNotFound               = errors.New("site not found in organization")
	ErrOpenCashSessionExists      = errors.New("an open cash session already exists for this site")
	ErrCashSessionNotFound        = errors.New("cash session not found in organization")
	ErrCashSessionNotOpen         = errors.New("cash session is not open in organization")
	ErrInsufficientCash           = errors.New("cash movement would make the theoretical balance negative")
	ErrCashBalanceOverflow        = errors.New("cash balance exceeds the maximum supported amount")
	ErrDiscrepancyReasonRequired  = errors.New("a reason is required when counted cash differs from the theoretical balance")
	ErrCashSessionRequired        = errors.New("cash transactions require an open cash session")
	ErrCashSessionNotApplicable   = errors.New("cash_session_id is only valid for cash transactions")
	ErrCashSessionSiteMismatch    = errors.New("cash session does not belong to the selected site")
	ErrExpenseNotFound            = errors.New("expense not found in organization")
	ErrWashNotFound                = errors.New("wash not found in organization")
	ErrWashInvalidInput            = errors.New("invalid wash input")
	ErrWashSiteNotFound            = errors.New("site not found or inactive in organization")
	ErrWashVehicleCategoryNotFound = errors.New("vehicle category not found or inactive in organization")
	ErrWashServiceUnavailable      = errors.New("service not found or inactive in organization")
	ErrWashWorkerUnavailable       = errors.New("worker not found or inactive in organization")
	ErrWashIdempotencyConflict     = errors.New("idempotency key was already used with a different request")
	ErrWashPaymentExceedsTotal     = errors.New("payment amount cannot exceed the wash total")
	ErrWashHasVerifiedPayments     = errors.New("wash cannot be cancelled while verified payments exist")
	ErrWashCancellationReasonRequired = errors.New("a cancellation reason is required")
	ErrWashCancelled               = errors.New("wash is cancelled and cannot receive payments")
	ErrOnboardingProgressMissing   = errors.New("aucune progression d'onboarding")
	ErrOnboardingIncomplete        = errors.New("onboarding incomplet : les conditions obligatoires ne sont pas satisfaites")
	ErrSelectedPlanUnavailable    = errors.New("forfait sélectionné introuvable ou inactif")
)
