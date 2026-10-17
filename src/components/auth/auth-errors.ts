interface ClerkErrorShape {
  errors?: Array<{ code?: string; longMessage?: string; message?: string }>
  message?: string
}

/** Return short French feedback without exposing low-level Clerk/API errors. */
export function getAuthErrorMessage(error: unknown, fallback?: string): string {
  const clerkError = error as ClerkErrorShape | null
  const firstError = clerkError?.errors?.[0]
  const code = firstError?.code?.toLowerCase() ?? ""
  const rawMessage = `${firstError?.longMessage ?? ""} ${firstError?.message ?? ""} ${clerkError?.message ?? ""}`.toLowerCase()

  if (code.includes("identifier_not_found") || /identifier.{0,20}(not found|does not exist)/.test(rawMessage)) {
    return "Aucun compte ne correspond à cette adresse e-mail."
  }
  if (code.includes("password_incorrect") || /password.{0,20}(incorrect|invalid)/.test(rawMessage)) {
    return "Mot de passe incorrect. Réessayez ou demandez sa réinitialisation."
  }
  if (code.includes("identifier_exists") || /email.{0,20}(already exists|already taken)/.test(rawMessage)) {
    return "Un compte existe déjà avec cette adresse e-mail. Connectez-vous plutôt."
  }
  if (code.includes("code_incorrect") || code.includes("code_expired") || /code.{0,20}(incorrect|expired|invalid)/.test(rawMessage)) {
    return "Ce code est invalide ou expiré. Vérifiez-le ou demandez-en un nouveau."
  }
  if (code.includes("password_length") || /password.{0,20}(too short|length)/.test(rawMessage)) {
    return "Choisissez un mot de passe plus long (au moins 8 caractères)."
  }

  return fallback ?? "Une erreur est survenue. Vérifiez les informations puis réessayez."
}
