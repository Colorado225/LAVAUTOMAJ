/**
 * Pourquoi une action est indisponible.
 *
 * Un bouton gris qui n'explique rien est un bug d'interface, pas une
 * protection. La question « nouveau lavage grisé, pourquoi ? » venait de là :
 * trois causes sans rapport entre elles — droits pas encore chargés, aucune
 * station, rôle insuffisant — étaient fondues dans un seul `disabled`, et le
 * seul indice était un `title` sur un élément désactivé, que les navigateurs
 * n'affichent le plus souvent pas.
 *
 * Ces fonctions sont **pures** pour être testables sans navigateur : elles
 * reçoivent un état et rendent la cause. L'ordre des causes suit celui dans
 * lequel l'utilisateur les rencontre — on nomme le premier obstacle, pas tous.
 */

export interface BlockedState {
  /** Faut-il désactiver le contrôle ? */
  disabled: boolean
  /** Attente passagère : afficher un indicateur d'activité, jamais un cadenas. */
  preparing: boolean
  /** Refus de droit avéré : le cadenas est alors honnête. */
  denied: boolean
  /** Motif à afficher visiblement. `null` quand il n'y a rien à dire. */
  reason: string | null
}

const READY: BlockedState = { disabled: false, preparing: false, denied: false, reason: null }

export interface WashButtonInput {
  /** La liste des stations est-elle encore en cours de chargement ? */
  sitesLoading: boolean
  /** Les droits (rôle + forfait) sont-ils encore en cours de chargement ? */
  accessLoading: boolean
  /** Nombre de stations actives sur lesquelles enregistrer un lavage. */
  activeSiteCount: number
  /** Le rôle et le forfait autorisent-ils la création ? */
  allowed: boolean
  /** Motif du refus fourni par `useAccess`. */
  reason: string | null
}

/**
 * État du bouton « Nouveau lavage ».
 *
 * Une attente n'est pas un refus : tant que `/me/permissions` n'a pas répondu,
 * on ne sait pas si l'action est permise, et montrer un cadenas revient à
 * affirmer une interdiction qu'on n'a pas vérifiée.
 */
export function washButtonState(input: WashButtonInput): BlockedState {
  if (input.sitesLoading || input.accessLoading) {
    return { disabled: true, preparing: true, denied: false, reason: null }
  }
  if (input.activeSiteCount === 0) {
    return {
      disabled: true,
      preparing: false,
      denied: false,
      reason: "Aucune station active. Créez d'abord une station dans Réglages › Stations.",
    }
  }
  if (!input.allowed) {
    return {
      disabled: true,
      preparing: false,
      denied: true,
      // Un refus sans motif resterait muet : on garantit une phrase.
      reason: input.reason ?? "Vous n'avez pas le droit d'enregistrer un lavage.",
    }
  }
  return READY
}

export interface WashSubmitInput {
  allowed: boolean
  accessReason: string | null
  siteId: string
  vehicleCategoryId: string
  selectedServiceCount: number
  /** Le montant reçu est-il exploitable (nombre, et ≤ total) ? */
  amountIsValid: boolean
  /** Cet encaissement exige-t-il une session de caisse ? */
  cashNeedsSession: boolean
  cashSessionLoading: boolean
  hasCashSession: boolean
}

/**
 * Ce qui empêche d'enregistrer le lavage, ou `null` si rien n'empêche.
 *
 * Six conditions cumulées dans un `disabled` muet laissaient l'utilisateur
 * deviner laquelle manquait.
 */
export function washSubmitBlockedReason(input: WashSubmitInput): string | null {
  if (!input.allowed) {
    return input.accessReason ?? "Vous n'avez pas le droit d'enregistrer un lavage."
  }
  if (!input.siteId) return "Choisissez une station."
  if (!input.vehicleCategoryId) return "Choisissez une catégorie de véhicule."
  if (input.selectedServiceCount === 0) return "Sélectionnez au moins une prestation."
  if (!input.amountIsValid) {
    return "Le montant reçu doit être un nombre, et ne peut pas dépasser le total du lavage."
  }
  if (input.cashNeedsSession && input.cashSessionLoading) {
    return "Vérification de la session de caisse en cours…"
  }
  if (input.cashNeedsSession && !input.hasCashSession) {
    return "Un encaissement en espèces exige une session de caisse ouverte."
  }
  return null
}
