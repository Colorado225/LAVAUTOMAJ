import { AsyncLocalStorage } from "node:async_hooks"

/**
 * Qui exécute le travail en cours, pour l'isolation multi-station en base.
 *
 * La sécurité de l'application repose sur quatre barrières successives :
 * session → appartenance à une organisation → permission → **portée de la
 * base**. Les trois premières disent « cette personne a le droit » ; celle-ci
 * dit « ces lignes-là seulement sont visibles ». C'est la filet de sécurité
 * derrière les `WHERE organization_id` écrits à la main dans chaque route :
 * une requête qui oublierait ce filtre ne pourrait quand même pas lire ou
 * écrire chez un autre client.
 *
 * Le portée est propagée par `AsyncLocalStorage` : posée une fois par
 * `requireTenantContext` au début de la requête, elle accompagne tous les
 * `await` qui suivent, jusqu'aux transactions ouvertes dans les services.
 * Aucun appelant n'a de paramètre supplémentaire à porter.
 *
 * En dehors d'une requête de station (démarrage, migrations, console de
 * l'éditeur, travaux planifiés), aucune portée n'est active : ces passages
 * volontairement multi-clients s'exécutent alors sans le garde RLS. Voir
 * `server/db-rls.ts` pour le mécanisme exact.
 */
export interface TenantScope {
  organizationId: string
  userId: string
}

const storage = new AsyncLocalStorage<TenantScope>()

/** Exécute `fn` avec la portée de locataire donnée. */
export function runWithTenant<T>(scope: TenantScope, fn: () => T): T {
  return storage.run(scope, fn)
}

/** Portée courante, ou `null` hors d'une requête de station. */
export function currentTenantScope(): TenantScope | null {
  return storage.getStore() ?? null
}
