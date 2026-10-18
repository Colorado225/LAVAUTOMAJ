import { createClerkClient, verifyToken } from "@clerk/backend"
import type { ClerkClient, Organization, User } from "@clerk/backend"
import type { NextFunction, Request, Response } from "express"
import { env } from "./env.ts"
import type { AuthenticatedPrincipal } from "./types.ts"

export class HttpError extends Error {
  public readonly status: number
  public readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "HttpError"
    this.status = status
    this.code = code
  }
}

let clerkClient: ClerkClient | null = null

export function getClerkClient(): ClerkClient {
  if (!env.CLERK_SECRET_KEY) {
    throw new HttpError(503, "clerk_not_configured", "Le serveur Clerk n'est pas configuré.")
  }
  clerkClient ??= createClerkClient({ secretKey: env.CLERK_SECRET_KEY })
  return clerkClient
}

export function requireClerkSession(req: Request, res: Response, next: NextFunction) {
  void (async () => {
    const authorization = req.header("authorization") || ""
    const match = authorization.match(/^Bearer\s+(.+)$/i)
    if (!match) {
      res.status(401).json({ error: { code: "unauthenticated", message: "Authentification requise." } })
      return
    }

    if (!env.CLERK_SECRET_KEY && !env.CLERK_JWT_KEY) {
      res.status(503).json({ error: { code: "clerk_not_configured", message: "L'authentification Clerk n'est pas configurée sur le serveur." } })
      return
    }

    try {
      const claims = await verifyToken(match[1], {
        ...(env.CLERK_SECRET_KEY ? { secretKey: env.CLERK_SECRET_KEY } : {}),
        ...(env.CLERK_JWT_KEY ? { jwtKey: env.CLERK_JWT_KEY } : {}),
        ...(env.CLERK_AUTHORIZED_PARTIES.length
          ? { authorizedParties: env.CLERK_AUTHORIZED_PARTIES }
          : {}),
      })

      const clerkUserId = typeof claims.sub === "string" ? claims.sub : ""
      if (!clerkUserId.startsWith("user_")) {
        res.status(401).json({ error: { code: "invalid_session", message: "La session Clerk n'est pas valide." } })
        return
      }

      const organizationClaim = claims.o && typeof claims.o === "object"
        ? claims.o as Record<string, unknown>
        : undefined
      const clerkOrgId =
        (typeof claims.org_id === "string" && claims.org_id) ||
        (typeof organizationClaim?.id === "string" && organizationClaim.id) ||
        null

      const principal: AuthenticatedPrincipal = {
        clerkUserId,
        clerkOrgId,
        clerkOrgRole:
          (typeof claims.org_role === "string" && claims.org_role) ||
          (typeof organizationClaim?.rol === "string" && organizationClaim.rol) ||
          null,
        clerkOrgSlug:
          (typeof claims.org_slug === "string" && claims.org_slug) ||
          (typeof organizationClaim?.slg === "string" && organizationClaim.slg) ||
          null,
        sessionId: typeof claims.sid === "string" ? claims.sid : null,
        email:
          (typeof claims.email === "string" && claims.email) ||
          (typeof claims.email_address === "string" && claims.email_address) ||
          null,
        firstName: typeof claims.first_name === "string" ? claims.first_name : null,
        lastName: typeof claims.last_name === "string" ? claims.last_name : null,
      }

      req.auth = principal
      next()
    } catch (error) {
      // Don't disclose verification internals or token content in API responses/logs.
      console.warn("[auth] Clerk session rejected:", error instanceof Error ? error.message : "verification failed")
      res.status(401).json({ error: { code: "invalid_session", message: "La session a expiré ou n'est pas valide. Reconnectez-vous." } })
    }
  })().catch(next)
}

export interface ClerkUserProfile {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  avatarUrl: string | null
}

export interface ClerkOrganizationProfile {
  id: string
  name: string
  slug: string | null
}

const profileCache = new Map<string, { value: ClerkUserProfile; expiresAt: number }>()
const organizationCache = new Map<string, { value: ClerkOrganizationProfile; expiresAt: number }>()
const membershipCache = new Map<string, { value: string | null; expiresAt: number }>()
const PROFILE_CACHE_TTL_MS = 30_000
const MEMBERSHIP_CACHE_TTL_MS = 10_000
const CACHE_MAX_ENTRIES = 1_000

function trimCache<T>(cache: Map<string, T>) {
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }
}

function profileFromClerk(user: User): ClerkUserProfile {
  const primary = user.emailAddresses.find((item) => item.id === user.primaryEmailAddressId)
  const email = primary?.emailAddress || user.emailAddresses[0]?.emailAddress
  if (!email) {
    throw new HttpError(422, "email_required", "Une adresse e-mail est requise pour utiliser WashPilot.")
  }

  return {
    id: user.id,
    email: email.trim().toLowerCase(),
    firstName: user.firstName?.trim() || null,
    lastName: user.lastName?.trim() || null,
    phone: user.primaryPhoneNumber?.phoneNumber || null,
    avatarUrl: user.imageUrl || null,
  }
}

export async function getClerkUserProfile(userId: string): Promise<ClerkUserProfile> {
  const cached = profileCache.get(userId)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  let user: User
  try {
    user = await getClerkClient().users.getUser(userId)
  } catch (error) {
    console.error("[auth] Unable to retrieve the Clerk user profile:", error instanceof Error ? error.message : "unknown error")
    throw new HttpError(502, "clerk_profile_unavailable", "Impossible de récupérer votre profil Clerk. Réessayez.")
  }

  const profile = profileFromClerk(user)
  profileCache.set(userId, { value: profile, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS })
  trimCache(profileCache)
  return profile
}

export async function getClerkOrganizationProfile(orgId: string): Promise<ClerkOrganizationProfile> {
  const cached = organizationCache.get(orgId)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  let organization: Organization
  try {
    organization = await getClerkClient().organizations.getOrganization({ organizationId: orgId })
  } catch (error) {
    console.error("[auth] Unable to retrieve the Clerk organization:", error instanceof Error ? error.message : "unknown error")
    throw new HttpError(502, "clerk_organization_unavailable", "Impossible de récupérer votre organisation Clerk. Réessayez.")
  }

  const profile = { id: organization.id, name: organization.name, slug: organization.slug || null }
  organizationCache.set(orgId, { value: profile, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS })
  trimCache(organizationCache)
  return profile
}

/** Verify membership against Clerk when bootstrapping a local tenant membership. */
export async function getClerkOrganizationMembershipRole(organizationId: string, userId: string): Promise<string | null> {
  const cacheKey = `${organizationId}:${userId}`
  const cached = membershipCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  if (cached) membershipCache.delete(cacheKey)

  try {
    const response = await getClerkClient().organizations.getOrganizationMembershipList({
      organizationId,
      userId: [userId],
      limit: 1,
    })
    const membership = response.data.find((item) => item.publicUserData?.userId === userId) ?? response.data[0]
    const role = membership?.role ?? null
    membershipCache.set(cacheKey, { value: role, expiresAt: Date.now() + MEMBERSHIP_CACHE_TTL_MS })
    trimCache(membershipCache)
    return role
  } catch (error) {
    console.error("[auth] Unable to verify the Clerk organization membership:", error instanceof Error ? error.message : "unknown error")
    throw new HttpError(502, "clerk_membership_unavailable", "Impossible de vérifier votre appartenance à l'organisation. Réessayez.")
  }
}

export function invalidateClerkProfileCache(userId: string) {
  profileCache.delete(userId)
}

export function invalidateClerkOrganizationCache(organizationId: string) {
  organizationCache.delete(organizationId)
}

export function invalidateClerkOrganizationMembershipCache(organizationId: string, userId: string) {
  membershipCache.delete(`${organizationId}:${userId}`)
}
