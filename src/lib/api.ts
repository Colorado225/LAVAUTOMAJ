import { useAuth } from "@clerk/clerk-react"
import { useEffect, useState } from "react"

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080"

export interface UseApiResult<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export function useApi<T = unknown>(path: string): UseApiResult<T> {
  const { getToken, isLoaded } = useAuth()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(!isLoaded)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoaded || !path) return

    let cancelled = false

    ;(async () => {
      setLoading(true)
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

  return { data, loading, error }
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
