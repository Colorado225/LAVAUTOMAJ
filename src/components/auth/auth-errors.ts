interface ClerkErrorShape {
  errors?: Array<{ code?: string; longMessage?: string; message?: string }>
  message?: string
}

export function isSessionExistsError(error: unknown): boolean {
  // Clerk renvoie ce cas avec le code `session_exists`, mais le message brut
  // affiché à l'utilisateur est : "Une session est déjà active. Veuillez
  // actualiser la page ou vous déconnecter puis réessayer." — on matche donc
  // aussi le français et l'anglais pour afficher le bouton de déconnexion.
  if (typeof error === "string") {
    const text = error.toLowerCase()
    return (
      text.includes("session_exists") ||
      text.includes("session est déjà active") ||
      text.includes("déjà connecté") ||
      /active session|already signed in|refresh the page|sign out/.test(text)
    )
  }
  const clerkError = error as ClerkErrorShape | null
  const firstError = clerkError?.errors?.[0]
  const code = firstError?.code?.toLowerCase() ?? ""
  const rawMessage = `${firstError?.longMessage ?? ""} ${firstError?.message ?? ""} ${clerkError?.message ?? ""}`.toLowerCase()
  return (
    code.includes("session_exists") ||
    code.includes("form_session_exists") ||
    rawMessage.includes("session est déjà active") ||
    rawMessage.includes("déjà connecté") ||
    /session_exists|active session|already signed in|refresh the page|sign out/.test(rawMessage)
  )
}

/** Return short French feedback without exposing low-level Clerk/API errors. */
export function getAuthErrorMessage(error: unknown, fallback?: string): string {
  const clerkError = error as ClerkErrorShape | null
  const firstError = clerkError?.errors?.[0]
  const code = firstError?.code?.toLowerCase() ?? ""
  const rawMessage = `${firstError?.longMessage ?? ""} ${firstError?.message ?? ""} ${clerkError?.message ?? ""}`.toLowerCase()

  if (
    code.includes("identifier_not_found") ||
    code.includes("form_identifier_not_found") ||
    /identifier.{0,20}(not found|does not exist)/.test(rawMessage)
  ) {
    return "Aucun compte ne correspond à cette adresse e-mail."
  }
  if (
    code.includes("password_incorrect") ||
    code.includes("form_password_incorrect") ||
    /password.{0,20}(incorrect|invalid)/.test(rawMessage)
  ) {
    return "Mot de passe incorrect. Réessayez ou demandez sa réinitialisation."
  }
  if (
    code.includes("identifier_exists") ||
    code.includes("form_identifier_exists") ||
    /email.{0,20}(already exists|already taken)/.test(rawMessage)
  ) {
    return "Un compte existe déjà avec cette adresse e-mail. Connectez-vous plutôt."
  }
  if (
    code.includes("code_incorrect") ||
    code.includes("code_expired") ||
    code.includes("form_code_incorrect") ||
    code.includes("verification_code") ||
    /code.{0,20}(incorrect|expired|invalid)/.test(rawMessage)
  ) {
    return "Ce code est invalide ou expiré. Vérifiez-le ou demandez-en un nouveau."
  }
  if (
    code.includes("password_length") ||
    code.includes("form_password_length_too_short") ||
    /password.{0,30}(too short|length|longer|characters|at least)/.test(rawMessage)
  ) {
    return "Votre mot de passe est trop court pour les exigences de sécurité. Choisissez-en un plus long (15 caractères minimum)."
  }
  if (
    code.includes("password_pattern") ||
    code.includes("form_password_pattern") ||
    code.includes("form_password_validation") ||
    /password.{0,20}(pattern|special|uppercase|lowercase|number|digit)/.test(rawMessage)
  ) {
    return "Votre mot de passe ne respecte pas les exigences de sécurité requises."
  }
  if (/pwned|breach|hibp|compromised|data breach|exposed password/.test(rawMessage)) {
    return "Ce mot de passe a été compromis dans une fuite de données connue. Choisissez-en un autre."
  }
  if (
    code.includes("session_exists") ||
    code.includes("form_session_exists") ||
    rawMessage.includes("session est déjà active") ||
    rawMessage.includes("déjà connecté") ||
    /session_exists|active session|already signed in|refresh the page|sign out/.test(rawMessage)
  ) {
    return "Une session est déjà active sur cet appareil. Déconnectez-vous ci-dessous puis reconnectez-vous avec le bon compte."
  }
  if (code.includes("too_many_requests") || /too many requests|rate limit/.test(rawMessage)) {
    return "Trop de tentatives en peu de temps. Patientez quelques instants puis réessayez."
  }
  if (/network|fetch failed|failed to fetch|load failed/.test(rawMessage)) {
    return "Problème de connexion au service d'authentification. Vérifiez votre connexion internet puis réessayez."
  }

  // In development, surface the real Clerk error to make debugging possible.
  if (import.meta.env.DEV && firstError) {
    return `${firstError.message ?? "Erreur Clerk"} (code: ${firstError.code ?? "inconnu"})`
  }

  return fallback ?? "Une erreur est survenue. Vérifiez les informations puis réessayez."
}
