import { useEffect, useState } from "react"

const configuredApiBase = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "")
const API_BASE_URL = /^(https?:\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(
  configuredApiBase
)
  ? ""
  : configuredApiBase

export { API_BASE_URL }

// ---------------------------------------------------------------------------
// Jeton de session de secours : le cookie httpOnly reste la voie principale,
// mais certains contextes (aperçu intégré dans une iframe) bloquent les
// cookies tiers. Le serveur accepte alors `Authorization: Bearer <jeton>`.
// ---------------------------------------------------------------------------
const SESSION_TOKEN_KEY = "washpilot.session-token"

export function getStoredSessionToken(): string | null {
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY)
  } catch {
    return null
  }
}

export function storeSessionToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(SESSION_TOKEN_KEY, token)
    else window.localStorage.removeItem(SESSION_TOKEN_KEY)
  } catch {
    // Stockage local indisponible : le cookie reste la seule voie.
  }
}

export function authHeaders(): Record<string, string> {
  const token = getStoredSessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export interface UseApiResult<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export async function apiErrorMessage(response: Response): Promise<string> {
  const body = await response.text()
  if (!body) return `API ${response.status}`
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    return parsed.error?.message || parsed.message || `API ${response.status}`
  } catch {
    return body.slice(0, 500)
  }
}

const responseError = apiErrorMessage

/** Fetch an API resource; the session cookie authenticates the request. */
export function useApi<T = unknown>(path: string): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!path) return

    const controller = new AbortController()

    ;(async () => {
      setLoading(true)
      setData(null)
      setError(null)
      try {
        const res = await fetch(`${API_BASE_URL}${path}`, {
          headers: new Headers({ Accept: "application/json", ...authHeaders() }),
          signal: controller.signal,
          credentials: "include",
        })
        if (controller.signal.aborted) return
        if (!res.ok) throw new Error(await responseError(res))

        const contentType = res.headers.get("content-type") || ""
        if (contentType.includes("application/json")) {
          const json = (await res.json()) as T
          if (!controller.signal.aborted) setData(json)
        } else {
          const text = await res.text()
          if (!controller.signal.aborted) setData(text as unknown as T)
        }
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [path])

  return {
    data: path ? data : null,
    loading: path ? loading : false,
    error: path ? error : null,
  }
}

/** Authenticated fetch helper — the httpOnly session cookie is sent automatically. */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers)
  headers.set("Accept", "application/json")
  if (options.body !== undefined && !headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }
  const token = getStoredSessionToken()
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`)

  return fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: options.credentials ?? "include",
  })
}
