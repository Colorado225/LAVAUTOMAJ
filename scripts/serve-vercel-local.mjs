/**
 * Reproduit localement le runtime des fonctions serverless de Vercel.
 *
 * Pourquoi ce fichier : sur Vercel, une fonction de `api/` ne reçoit pas
 * l'URL demandée par le navigateur. Elle reçoit l'URL de la fonction (`/api`),
 * les segments du chemin dans `req.query.slug`, et le corps JSON **déjà
 * analysé**. C'est précisément ce comportement qui faisait répondre 404 à
 * toutes les routes en production, et il est impossible à retrouver avec
 * `npm run dev`, où Express reçoit l'URL d'origine.
 *
 * Ce serveur applique les trois règles ci-dessus, puis appelle la même
 * fonction que Vercel (`api/[...slug].ts`). Un test de fumée lancé contre lui
 * vérifie donc le déploiement, pas seulement la machine de développement.
 *
 * Deux sources possibles pour la fonction :
 *   • par défaut, le code source (`server/vercel-handler.ts`), lisible ;
 *   • avec `--bundle`, l'artefact réellement déployé (`server/vercel-bundle.js`,
 *     produit par `npm run build:api`) — c'est ce que fait `npm run
 *     smoke:serverless`, pour vérifier ce que la production exécutera et non
 *     seulement les sources.
 *
 * Usage :
 *   node --import tsx scripts/serve-vercel-local.mjs [--bundle]   # PORT=3001
 */
import http from "node:http"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const useBundle = process.argv.includes("--bundle")
const bundlePath = path.join(root, "server", "vercel-bundle.js")

if (useBundle && !existsSync(bundlePath)) {
  console.error("[vercel-local] server/vercel-bundle.js absent : lancez d'abord `npm run build:api`.")
  process.exit(1)
}

const handler = useBundle
  ? (await import(new URL("../server/vercel-bundle.js", import.meta.url).href)).default
  : (await import("../server/vercel-handler.ts")).default

const port = Number(process.env.PORT || 3001)

/** Comme @vercel/node : le JSON est analysé avant l'appel de la fonction. */
async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks)
  if (raw.length === 0) return undefined
  const type = req.headers["content-type"] ?? ""
  if (!type.includes("application/json")) return raw.toString("utf8")
  try {
    return JSON.parse(raw.toString("utf8"))
  } catch {
    return raw.toString("utf8")
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)

  if (!url.pathname.startsWith("/api")) {
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: { code: "not_found", message: "Cette route n'existe pas." } }))
    return
  }

  // Segments après /api → `req.query.slug`, exactement comme Vercel.
  const rest = url.pathname.replace(/^\/api\/?/, "")
  const slug = rest.length > 0 ? rest.split("/") : undefined

  // @vercel/node analyse le corps avant d'appeler la fonction. Le flux est
  // donc consommé : la fonction ne doit pas tenter de le relire.
  const body = await readBody(req)

  req.query = { ...Object.fromEntries(url.searchParams) }
  if (slug) req.query.slug = slug
  if (body !== undefined) req.body = body
  // L'URL reçue est celle de la fonction, pas celle du navigateur. C'est ce
  // détail qui faisait répondre 404 à tout : le chemin n'existe plus dans
  // `req.url`, il n'est plus que dans `req.query.slug`.
  req.url = "/api"

  await handler(req, res)
})

server.listen(port, "0.0.0.0", () => {
  console.log(
    `[vercel-local] http://0.0.0.0:${port} — runtime serverless simulé (${useBundle ? "bundle déployé" : "sources"})`,
  )
})
