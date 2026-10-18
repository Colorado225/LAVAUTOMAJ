/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useMemo } from "react"

interface MockUser {
  id: string
  firstName: string
  lastName: string
  fullName: string
  primaryEmailAddress: { emailAddress: string }
  imageUrl: string
}

interface MockOrganization {
  id: string
  name: string
  slug: string
  imageUrl: string | null
}

interface AuthContextValue {
  isLoaded: boolean
  isSignedIn: boolean
  userId: string | null
  sessionId: string | null
  orgId: string | null
  orgRole: string | null
  getToken: () => Promise<string | null>
  signIn: (email?: string) => void
  signOut: () => void
  user: MockUser | null
  organization: MockOrganization | null
  setOrganization: (org: MockOrganization | null) => void
}

const defaultUser: MockUser = {
  id: "user_demo_washpilot",
  firstName: "Amadou",
  lastName: "Koné",
  fullName: "Amadou Koné",
  primaryEmailAddress: { emailAddress: "amadou.kone@washpilot.ci" },
  imageUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop",
}

const defaultOrg: MockOrganization = {
  id: "org_washpilot_cocody",
  name: "Station Cocody Riviera",
  slug: "cocody-riviera",
  imageUrl: null,
}

const MockAuthContext = createContext<AuthContextValue>({
  isLoaded: true,
  isSignedIn: true,
  userId: defaultUser.id,
  sessionId: "sess_demo_washpilot",
  orgId: defaultOrg.id,
  orgRole: "org:admin",
  getToken: async () => "mock-washpilot-clerk-token",
  signIn: () => {},
  signOut: () => {},
  user: defaultUser,
  organization: defaultOrg,
  setOrganization: () => {},
})

export function ClerkProvider({ children }: { children: React.ReactNode; publishableKey?: string }) {
  const [isSignedIn, setIsSignedIn] = useState(true)
  const [organization, setOrganization] = useState<MockOrganization | null>(defaultOrg)

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoaded: true,
      isSignedIn,
      userId: isSignedIn ? defaultUser.id : null,
      sessionId: isSignedIn ? "sess_demo_washpilot" : null,
      orgId: isSignedIn && organization ? organization.id : null,
      orgRole: isSignedIn && organization ? "org:admin" : null,
      getToken: async () => (isSignedIn ? "mock-washpilot-clerk-token" : null),
      signIn: () => setIsSignedIn(true),
      signOut: () => setIsSignedIn(false),
      user: isSignedIn ? defaultUser : null,
      organization: isSignedIn ? organization : null,
      setOrganization,
    }),
    [isSignedIn, organization]
  )

  return <MockAuthContext.Provider value={value}>{children}</MockAuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(MockAuthContext)
  return {
    isLoaded: ctx.isLoaded,
    isSignedIn: ctx.isSignedIn,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    orgId: ctx.orgId,
    orgRole: ctx.orgRole,
    getToken: ctx.getToken,
    signOut: async () => ctx.signOut(),
  }
}

export function useUser() {
  const ctx = useContext(MockAuthContext)
  return {
    isLoaded: ctx.isLoaded,
    isSignedIn: ctx.isSignedIn,
    user: ctx.user,
  }
}

export function useOrganization() {
  const ctx = useContext(MockAuthContext)
  return {
    isLoaded: ctx.isLoaded,
    organization: ctx.organization,
    membership: ctx.organization ? { role: "org:admin" } : null,
  }
}

export function useSignIn() {
  const ctx = useContext(MockAuthContext)
  return {
    isLoaded: true,
    signIn: {
      create: async (params: { identifier?: string; password?: string; strategy?: string }) => {
        ctx.signIn(params.identifier)
        return { status: "complete", createdSessionId: "sess_demo_washpilot" }
      },
      attemptFirstFactor: async () => ({ status: "needs_new_password" }),
      resetPassword: async () => ({ status: "complete" }),
    },
    setActive: async () => {
      ctx.signIn()
    },
  }
}

export function useSignUp() {
  const ctx = useContext(MockAuthContext)
  return {
    isLoaded: true,
    signUp: {
      create: async (params: { emailAddress?: string }) => {
        ctx.signIn(params.emailAddress)
        return { status: "complete", createdSessionId: "sess_demo_washpilot" }
      },
      prepareEmailAddressVerification: async () => ({ status: "complete" }),
      attemptEmailAddressVerification: async () => ({ status: "complete", createdSessionId: "sess_demo_washpilot" }),
    },
    setActive: async () => {
      ctx.signIn()
    },
  }
}

export function SignedIn({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuth()
  if (!isSignedIn) return null
  return <>{children}</>
}

export function SignedOut({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuth()
  if (isSignedIn) return null
  return <>{children}</>
}

export function UserButton() {
  const { user, signOut } = useContext(MockAuthContext)
  if (!user) return null
  return (
    <button
      type="button"
      onClick={signOut}
      title={`${user.fullName} (${user.primaryEmailAddress.emailAddress}) - Déconnexion`}
      className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground transition hover:opacity-85"
    >
      {user.firstName[0]}
      {user.lastName[0]}
    </button>
  )
}

export function OrganizationSwitcher() {
  const { organization } = useOrganization()
  return (
    <div className="flex items-center gap-2 text-sm font-medium">
      <span>{organization?.name ?? "WashPilot Station"}</span>
    </div>
  )
}

export function CreateOrganization({
  afterCreateOrganizationUrl,
}: {
  routing?: string
  afterCreateOrganizationUrl?: string
  skipInvitationScreen?: boolean
}) {
  const { setOrganization } = useContext(MockAuthContext)
  const [name, setName] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setOrganization({
      id: `org_${Date.now()}`,
      name: name.trim(),
      slug: name.trim().toLowerCase().replace(/\s+/g, "-"),
      imageUrl: null,
    })
    if (afterCreateOrganizationUrl) {
      window.location.href = afterCreateOrganizationUrl
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Nom de l'organisation
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Station Cocody Riviera"
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          required
        />
      </label>
      <button
        type="submit"
        className="rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
      >
        Créer et continuer
      </button>
    </form>
  )
}
