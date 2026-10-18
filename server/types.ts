export interface AuthenticatedPrincipal {
  clerkUserId: string
  clerkOrgId: string | null
  clerkOrgRole: string | null
  clerkOrgSlug: string | null
  sessionId: string | null
  email: string | null
  firstName: string | null
  lastName: string | null
}

export interface TenantContext {
  organizationId: string
  clerkOrgId: string
  clerkUserId: string
  userId: string
  role: string
  organizationName: string
  onboardingCompleted: boolean
  currentStage: string | null
}
