import { useAuth } from "@clerk/clerk-react"
import { useEffect, useState } from "react"

const configuredApiBase = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "")
const API_BASE_URL = /^(https?:\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(
  configuredApiBase
)
  ? ""
  : configuredApiBase

/** Récupère un jeton de session Clerk (utilisé par les formulaires hors hook). */
export async function getClerkToken(): Promise<string | null> {
  // Clerk expose getToken via useAuth ; pour les composants hors provider hook,
  // on passe par l'instance window.Clerk (injectée par clerk-react).
  const clerk = (window as unknown as {
    Clerk?: { session?: { getToken: () => Promise<string | null> } }
  }).Clerk
  return clerk?.session?.getToken() ?? null
}

export { API_BASE_URL }

export interface UseApiResult<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export function useApi<T = unknown>(path: string): UseApiResult<T> {
  const { getToken, isLoaded } = useAuth()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoaded || !path) return

    let cancelled = false

    ;(async () => {
      setLoading(true)
      setData(null)
      setError(null)
      try {
        const token = await getToken()
        if (cancelled) return

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        }
        if (token) {
          headers["Authorization"] = `Bearer ${token}`
        }

        const res = await fetch(`${API_BASE_URL}${path}`, { headers })
        if (cancelled) return

        if (!res.ok) {
          const body = await res.text()
          throw new Error(`API ${res.status}: ${body}`)
        }

        const contentType = res.headers.get("content-type") || ""
        if (contentType.includes("application/json")) {
          const json = (await res.json()) as T
          if (!cancelled) setData(json)
        } else {
          const text = await res.text()
          if (!cancelled) setData(text as unknown as T)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [path, getToken, isLoaded])

  return {
    data: isLoaded && path ? data : null,
    loading: !isLoaded ? true : path ? loading : false,
    error: isLoaded && path ? error : null,
  }
}

export async function apiFetch(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string> | undefined) || {}),
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  return fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  })
}
