/**
 * Fonction serverless pour `/api` et `/api/`.
 *
 * `api/[...slug].ts` ne couvre pas le chemin racine : sans ce fichier, `/api`
 * et `/api/healthz` tomberaient sur l'interface statique au lieu d'une réponse
 * JSON.
 */
export { default } from "../server/vercel-bundle.js"
