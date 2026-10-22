/**
 * Retrouver le chemin d'origine d'une requête API derrière une fonction
 * serverless.
 *
 * Sur Vercel, une fonction placée dans `api/` ne reçoit pas l'URL complète :
 * la route dynamique `api/[...slug].ts` reçoit les segments dans `req.query.slug`
 * et l'URL de la fonction (`/api`) dans `req.url`. Express, lui, route sur
 * `req.url` : sans reconstitution, toutes les routes répondraient 404 — c'est
 * exactement la panne constatée en production.
 *
 * Cette fonction est pure pour une raison simple : c'est de la logique de
 * routage. Une erreur ici rend l'API entière muette, et il faut pouvoir la
 * vérifier sans déployer.
 */

/** Segments tels que Vercel les fournit (`string`, tableau, ou absents). */
export type SlugInput = string | string[] | undefined | null

export interface RestoreInput {
  /** Segments après `/api`, issus de la route dynamique. */
  slug?: SlugInput
  /** Chaîne de requête brute (`?limit=2`), si connue. */
  search?: string
  /** URL reçue par la fonction. */
  url?: string
}

export interface RestoredPath {
  /** URL complète à donner à Express, ou `null` si le chemin est introuvable. */
  url: string | null
  /** D'où vient le chemin — lisible dans les journaux d'incident. */
  source: "slug" | "url" | "none"
}

/** Normalise les segments : ni vide, ni barre oblique, ni préfixe `api`. */
function normalizeSegments(slug: SlugInput): string[] {
  const raw = Array.isArray(slug) ? slug : typeof slug === "string" ? slug.split("/") : []
  return raw
    .map((segment) => decodeURIComponent(String(segment)).replace(/^\/+|\/+$/g, ""))
    .filter((segment) => segment.length > 0)
}

function withSearch(path: string, search: string | undefined): string {
  if (!search) return path
  const query = search.startsWith("?") ? search : `?${search}`
  return query === "?" ? path : `${path}${query}`
}

/**
 * Reconstruit `/api/<segments><query>`.
 *
 * Ordre de préférence : les segments dynamiques, puis l'URL si elle porte déjà
 * le chemin, sinon rien. Ce dernier cas renvoie `null` plutôt qu'un `/api`
 * nu : mieux vaut un 404 explicite qu'une requête servie sur la mauvaise route.
 */
export function restoreApiPath(input: RestoreInput): RestoredPath {
  const segments = normalizeSegments(input.slug)
  if (segments.length > 0) {
    return { url: withSearch(`/api/${segments.join("/")}`, input.search), source: "slug" }
  }

  const url = (input.url ?? "").trim()
  if (url.startsWith("/api/") && url.length > "/api/".length) {
    return { url: withSearch(url, input.search), source: "url" }
  }
  if (url === "/api" || url === "/api/") {
    return { url: withSearch("/api", input.search), source: "url" }
  }
  return { url: null, source: "none" }
}
