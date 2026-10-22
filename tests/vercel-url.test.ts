/**
 * Reconstitution du chemin derrière une fonction serverless.
 *
 * C'est la pièce qui a manqué au déploiement Vercel : la fonction recevait
 * `/api` et Express n'avait aucune route à servir, donc **toutes** les requêtes
 * répondaient 404. Ces tests couvrent les trois sources possibles et le cas
 * où aucune ne donne de chemin.
 */
import test from "node:test"
import assert from "node:assert/strict"

import { restoreApiPath } from "../server/vercel-url.ts"

test("les segments dynamiques reconstituent le chemin complet", () => {
  assert.deepEqual(restoreApiPath({ slug: ["v1", "auth", "me"], url: "/api" }), {
    url: "/api/v1/auth/me",
    source: "slug",
  })
})

test("un slug fourni en chaîne est accepté", () => {
  assert.equal(restoreApiPath({ slug: "v1/washes", url: "/api" }).url, "/api/v1/washes")
})

test("la chaîne de requête est conservée", () => {
  assert.equal(
    restoreApiPath({ slug: ["v1", "washes"], search: "?limit=2&plate=1234", url: "/api" }).url,
    "/api/v1/washes?limit=2&plate=1234",
  )
  // Sans `?` initial, la même chose.
  assert.equal(
    restoreApiPath({ slug: ["v1", "washes"], search: "limit=2", url: "/api" }).url,
    "/api/v1/washes?limit=2",
  )
})

test("les segments encodés sont décodés, les barres superflues ignorées", () => {
  assert.equal(
    restoreApiPath({ slug: ["/v1/", "vehicles", "1234%20AB%2001"], url: "/api" }).url,
    "/api/v1/vehicles/1234 AB 01",
  )
  // Un segment vide (double barre) ne doit pas produire de `//`.
  assert.equal(restoreApiPath({ slug: ["v1", "", "sites"], url: "/api" }).url, "/api/v1/sites")
})

test("sans segments, une URL déjà complète est conservée", () => {
  assert.deepEqual(restoreApiPath({ url: "/api/v1/plans" }), {
    url: "/api/v1/plans",
    source: "url",
  })
})

test("la racine /api reste la racine, elle ne devient pas une fausse route", () => {
  assert.deepEqual(restoreApiPath({ url: "/api" }), { url: "/api", source: "url" })
  assert.deepEqual(restoreApiPath({ url: "/api/" }), { url: "/api", source: "url" })
})

test("un chemin introuvable renvoie null plutôt qu'une route inventée", () => {
  assert.deepEqual(restoreApiPath({ url: "/" }), { url: null, source: "none" })
  assert.deepEqual(restoreApiPath({ slug: [], url: "" }), { url: null, source: "none" })
  assert.deepEqual(restoreApiPath({ url: undefined }), { url: null, source: "none" })
})

test("les segments priment sur l'URL de la fonction", () => {
  // Vercel fournit `/api` dans `req.url` : c'est bien le slug qui fait foi.
  assert.equal(restoreApiPath({ slug: ["v1", "console", "metrics"], url: "/api" }).source, "slug")
})
