/**
 * Back-office de l'éditeur — types partagés avec `server/admin.ts`.
 *
 * Surface distincte du reste de l'application : elle ne parle pas d'une
 * station mais du parc entier. Elle n'est accessible qu'aux comptes portant
 * `platform_admin`, et le serveur répond 404 — et non 403 — à tous les autres,
 * pour que son existence même ne se devine pas.
 */

import { apiFetch, apiErrorMessage } from "@/lib/api"

export type AdminSubscriptionStatus =
  | "trialing"
  | "active"
  | "expired"
  | "pending"
  | "cancelled"
  | "none"

export interface AdminOrganization {
  id: string
  name: string
  created_at: string
  owner_email: string | null
  owner_phone: string | null
  member_count: number
  site_count: number
  plan_code: string | null
  plan_name: string | null
  plan_price_cents: number
  /** Statut **effectif**, celui qu'applique l'API (un essai échu vaut `expired`). */
  status: AdminSubscriptionStatus
  stored_status: string | null
  read_only: boolean
  current_period_end: string | null
  plan_changed_at: string | null
  days_remaining: number
  /** Forfait payant dont l'échéance est passée : à relancer, jamais coupé d'office. */
  past_due: boolean
  days_past_due: number
}

export interface AdminMetrics {
  total: number
  trialing: number
  active: number
  expired: number
  cancelled: number
  past_due: number
  pending_requests: number
  /** Revenu mensuel récurrent des forfaits actifs, en centimes. */
  mrr_cents: number
  server_time: string
}

export interface AdminPlan {
  code: string
  name: string
  price_cents: number
  billing_cycle: string
  max_users: number | null
  max_workers: number | null
  max_sites: number | null
}

export interface UpgradeRequest {
  id: string
  organization_id: string
  organization_name: string
  created_at: string
  requester_email: string | null
  requester_phone: string | null
  metadata: { plan_code?: string; note?: string | null } | null
  pending: boolean
}

export const STATUS_LABELS: Record<AdminSubscriptionStatus, string> = {
  trialing: "Essai",
  active: "Actif",
  expired: "Expiré",
  pending: "En attente",
  cancelled: "Suspendu",
  none: "Aucun",
}

/** Montant en centimes de franc vers un libellé lisible. */
export function formatFcfa(cents: number): string {
  return `${Math.round(cents / 100).toLocaleString("fr-CI")} F`
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await apiErrorMessage(response))
  return (await response.json()) as T
}

export async function activatePlan(
  organizationId: string,
  input: { plan_code: string; months: number; payment_reference?: string; note?: string },
): Promise<void> {
  await readJson(
    await apiFetch(`/api/v1/admin/organizations/${organizationId}/activate`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  )
}

export async function suspendOrganization(
  organizationId: string,
  reason: string,
): Promise<void> {
  await readJson(
    await apiFetch(`/api/v1/admin/organizations/${organizationId}/suspend`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  )
}

export async function extendTrial(
  organizationId: string,
  input: { days: number; reason: string },
): Promise<void> {
  await readJson(
    await apiFetch(`/api/v1/admin/organizations/${organizationId}/extend-trial`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  )
}

/**
 * Décliner une demande d'activation.
 *
 * Contrepartie de l'activation : répondre non. L'abonnement de la station
 * n'est pas touché — on clôt une demande, on ne sanctionne personne.
 */
export async function declineUpgradeRequest(
  requestId: string,
  reason: string,
): Promise<void> {
  await readJson(
    await apiFetch(`/api/v1/admin/upgrade-requests/${requestId}/decline`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  )
}

/** Une demande de paiement déclarée par un client, en attente de vérification. */
export interface AdminPaymentIntent {
  id: string
  reference: string
  organization_id: string
  organization_name: string
  plan_code: string
  months: number
  amount_cents: number
  provider: string
  status: string
  declared_reference: string | null
  declared_at: string | null
  created_at: string
  requester_email: string | null
  requester_phone: string | null
}

/**
 * Confirmer un paiement déclaré.
 *
 * Rien n'est ressaisi : l'intention porte déjà le forfait, la durée et le
 * montant, donc rien ne peut être saisi de travers. Le serveur refuse un
 * second appel sur la même référence.
 */
export async function confirmPaymentIntent(reference: string, note?: string): Promise<void> {
  await readJson(
    await apiFetch(`/api/v1/admin/payment-intents/${reference}/confirm`, {
      method: "POST",
      body: JSON.stringify({ note: note || undefined }),
    }),
  )
}
