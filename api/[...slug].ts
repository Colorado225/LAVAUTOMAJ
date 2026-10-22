/**
 * Fonction serverless attrape-tout : `/api/...`.
 *
 * Vercel fournit les segments du chemin dans `req.query.slug` et non dans
 * `req.url` ; la reconstitution du chemin se fait dans `server/vercel-app.ts`.
 * C'est exactement ce qui manquait au déploiement cassé, où toutes les routes
 * répondaient 404 alors que l'API existait.
 *
 * L'import pointe vers le bundle (`npm run build:api`) : le code serveur
 * importe ses voisins en `.ts`, que le runtime de Vercel ne résout pas.
 */
export { default } from "../server/vercel-bundle.js"
