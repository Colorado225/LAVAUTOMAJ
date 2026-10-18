import { useAuth } from "@clerk/clerk-react"
import { useEffect, useState } from "react"

const configuredApiBase = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/, "")
const API_BASE_URL = /^(https?:\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(
  configuredApiBase
)
  ? ""
  : configuredApiBase

let clerkTokenGetter: (() => Promise<string | null>) | null = null

/** Keep non-hook API helpers connected to the same Clerk session as React hooks. */
export function ClerkTokenBridge() {
  const { getToken, isLoaded } = useAuth()

  useEffect(() => {
    if (!isLoaded) return
    const getter = () => getToken()
    clerkTokenGetter = getter
    return () => {
      if (clerkTokenGetter === getter) clerkTokenGetter = null
    }
  }, [getToken, isLoaded])

  return null
}

/** Get a current Clerk session token for API calls made outside a React hook. */
export async function getClerkToken(): Promise<string | null> {
  if (clerkTokenGetter) return clerkTokenGetter()

  // Clerk also exposes its browser instance on window in supported deployments;
  // this is a fallback for helpers invoked during provider startup only.
  if (typeof window !== "undefined") {
    const clerk = (window as unknown as {
      Clerk?: { session?: { getToken: () => Promise<string | null> } }
    }).Clerk
    if (clerk?.session) return clerk.session.getToken()
  }
  return null
}

export { API_BASE_URL }

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

export function useApi<T = unknown>(path: string): UseApiResult<T> {
  const { getToken, isLoaded } = useAuth()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoaded || !path) return

    const controller = new AbortController()

    ;(async () => {
      setLoading(true)
      setData(null)
      setError(null)
      try {
        const token = await getToken()
        if (controller.signal.aborted) return

        const headers = new Headers({ Accept: "application/json" })
        if (token) headers.set("Authorization", `Bearer ${token}`)

        const res = await fetch(`${API_BASE_URL}${path}`, {
          headers,
          signal: controller.signal,
          credentials: "same-origin",
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
  const headers = new Headers(options.headers)
  headers.set("Accept", "application/json")
  if (options.body !== undefined && !headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }

  const resolvedToken = token === undefined ? await getClerkToken() : token
  if (resolvedToken) headers.set("Authorization", `Bearer ${resolvedToken}`)

  return fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: options.credentials ?? "same-origin",
  })
}
