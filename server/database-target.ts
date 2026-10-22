/**
 * Quelle base de données le serveur doit-il ouvrir ?
 *
 * La décision était prise en ligne, au milieu de `initDatabaseSchema`, mêlée
 * aux connexions et aux migrations : impossible à vérifier sans démarrer
 * PostgreSQL. Elle est ici, pure, pour une raison précise — c'est elle qui
 * empêche la suite de tests d'écrire dans la base réelle.
 *
 * Le scénario qui a motivé ce module : un développeur a `DATABASE_URL` dans
 * son `.env` (production, préproduction, ou simplement sa base locale qu'il
 * tient à garder). Il lance `npm test`. Les tests créent des stations, des
 * lavages, des encaissements — et les écrivent **chez lui**. Pire, ils
 * modifient le schéma et peuvent désactiver des comptes d'opérateur.
 *
 * Règle : en mode test, `DATABASE_URL` est ignorée. Toujours. La suite tourne
 * sur une base embarquée en mémoire, jetée avec le processus.
 */

export type DatabaseTarget = "embedded" | "external"

export interface DatabaseTargetInput {
  /** `NODE_ENV` effectif. */
  nodeEnv: string
  /** Valeur brute de `DATABASE_URL` ; chaîne vide si non renseignée. */
  databaseUrl?: string
}

export interface DatabaseTargetDecision {
  target: DatabaseTarget
  /** Vrai quand `DATABASE_URL` a été volontairement ignorée (mode test). */
  ignoredDatabaseUrl: boolean
}

/**
 * Choisit la base à ouvrir.
 *
 * - `test` → base embarquée, même si `DATABASE_URL` est renseignée ;
 * - `DATABASE_URL` renseignée → base externe ;
 * - sinon → base embarquée (développement), refusée en production ailleurs
 *   par `embeddedFallbackAllowed`.
 */
export function chooseDatabaseTarget(input: DatabaseTargetInput): DatabaseTargetDecision {
  const url = (input.databaseUrl ?? "").trim()
  if (input.nodeEnv === "test") {
    return { target: "embedded", ignoredDatabaseUrl: url !== "" }
  }
  return { target: url === "" ? "embedded" : "external", ignoredDatabaseUrl: false }
}
