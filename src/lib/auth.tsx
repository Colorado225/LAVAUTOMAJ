/**
 * Authentification maison (e-mail + mot de passe) adossée à la base Neon.
 * La session vit dans un cookie httpOnly géré par le serveur Express ;
 * ce provider interroge /api/v1/auth/me et expose connexion / inscription /
 * déconnexion à toute l'application.
 */
import * as React from "react"
import { API_BASE_URL, apiErrorMessage, authHeaders, storeSessionToken } from "@/lib/api"

export interface AuthUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  avatarUrl: string | null
  /**
   * Administrateur de plateforme (l'éditeur), et non un rôle de station.
   * Porté par le compte et non par l'appartenance : un administrateur peut
   * n'être rattaché à aucune organisation.
   */
  platformAdmin: boolean
}

export interface AuthOrganization {
  id: string
  name: string
  onboardingCompleted: boolean
}

export interface SignUpInput {
  firstName: string
  lastName: string
  email: string
  password: string
  phone?: string
  organizationName?: string
}

interface AuthState {
  status: "loading" | "signedIn" | "signedOut"
  user: AuthUser | null
  organization: AuthOrganization | null
  role: string | null
}

interface AuthContextValue extends AuthState {
  isLoaded: boolean
  isSignedIn: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (input: SignUpInput) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

interface MePayload {
  user: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
    phone: string | null
    avatar_url: string | null
    platform_admin?: boolean
  }
  organization: { id: string; name: string; onboarding_completed: boolean } | null
  role: string | null
  session_token?: string
}

function stateFromPayload(payload: MePayload): AuthState {
  return {
    status: "signedIn",
    user: {
      id: payload.user.id,
      email: payload.user.email,
      firstName: payload.user.first_name,
      lastName: payload.user.last_name,
      phone: payload.user.phone,
      avatarUrl: payload.user.avatar_url,
      platformAdmin: Boolean(payload.user.platform_admin),
    },
    organization: payload.organization
      ? {
          id: payload.organization.id,
          name: payload.organization.name,
          onboardingCompleted: payload.organization.onboarding_completed,
        }
      : null,
    role: payload.role,
  }
}

const SIGNED_OUT: AuthState = { status: "signedOut", user: null, organization: null, role: null }

async function postJson(path: string, body: unknown): Promise<MePayload> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await apiErrorMessage(response))
  const payload = (await response.json()) as MePayload
  // Secours pour les contextes où le cookie httpOnly est bloqué (iframe).
  if (payload.session_token) storeSessionToken(payload.session_token)
  return payload
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AuthState>({ status: "loading", user: null, organization: null, role: null })

  const refresh = React.useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        headers: { Accept: "application/json", ...authHeaders() },
        credentials: "include",
      })
      if (!response.ok) {
        setState(SIGNED_OUT)
        return
      }
      setState(stateFromPayload((await response.json()) as MePayload))
    } catch {
      setState(SIGNED_OUT)
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
          headers: { Accept: "application/json", ...authHeaders() },
          credentials: "include",
        })
        if (cancelled) return
        if (!response.ok) {
          setState(SIGNED_OUT)
          return
        }
        const payload = (await response.json()) as MePayload
        if (!cancelled) setState(stateFromPayload(payload))
      } catch {
        if (!cancelled) setState(SIGNED_OUT)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = React.useCallback(async (email: string, password: string) => {
    const payload = await postJson("/api/v1/auth/login", { email, password })
    setState(stateFromPayload(payload))
  }, [])

  const signUp = React.useCallback(async (input: SignUpInput) => {
    const payload = await postJson("/api/v1/auth/register", input)
    setState(stateFromPayload(payload))
  }, [])

  const signOut = React.useCallback(async () => {
    try {
      await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
        method: "POST",
        headers: authHeaders(),
        credentials: "include",
      })
    } finally {
      storeSessionToken(null)
      setState(SIGNED_OUT)
    }
  }, [])

  const value = React.useMemo<AuthContextValue>(
    () => ({
      ...state,
      isLoaded: state.status !== "loading",
      isSignedIn: state.status === "signedIn",
      signIn,
      signUp,
      signOut,
      refresh,
    }),
    [state, signIn, signUp, signOut, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext)
  if (!context) throw new Error("useAuth doit être utilisé à l'intérieur de <AuthProvider>.")
  return context
}
