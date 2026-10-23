import { currentTenantScope } from "./tenant-context.ts"

/**
 * Garde-fou multi-station au niveau des lignes (RLS).
 *
 * Le schéma (voir `server/db.ts`) pose sur chaque table de station une
 * politique `org_isolation` qui n'accepte que les lignes dont
 * `organization_id` vaut la variable `app.current_org`. Ce module fait le
 * lien : pour chaque requête exécutée **dans une portée de locataire**, la
 * connexion est mise en rôle applicatif `washpilot_app` (droits DML
 * uniquement, sans superutilisateur ni `BYPASSRLS`) et la variable porte
 * l'organisation courante. Deux verrous se ferment alors :
 *
 *   • le rôle applicatif n'est pas propriétaire des tables : les politiques
 *     RLS s'appliquent à lui (Postgres épargne le propriétaire et, quoi
 *     qu'il arrive, les superutilisateurs — d'où le `SET ROLE`) ;
 *   • la variable d'organisation aligne chaque politique sur le seul client
 *     de la requête en cours.
 *
 * Hors portée — démarrage, semis, console de l'éditeur, travaux planifiés,
 * tests — la connexion reste telle quelle : ces passages sont
 * volontairement multi-clients (la console doit voir toutes les stations) et
 * le code qui les compose est audité à la main. C'est aussi pourquoi aucune
 * politique n'est posée sur `users`, `plans`, `service_catalog` ou les
 * tables d'authentification : leurs lectures traversent les organisations
 * par conception (connexion, invitations par e-mail, catalogue partagé).
 *
 * Le coût est de quelques allers-retours par requête de station. C'est
 * volontaire : l'isolation ne se négocie pas en latence.
 */

export const RLS_ROLE = "washpilot_app"
export const ORG_SETTING = "app.current_org"

let roleAvailable = false

/** Appelé après l'initialisation du schéma, selon que le rôle existe. */
export function setRlsRoleAvailable(available: boolean): void {
  roleAvailable = available
}

export function isRlsRoleAvailable(): boolean {
  return roleAvailable
}

/**
 * Mise en place de la portée sur une connexion : rôle applicatif, puis
 * organisation courante. La variable est définie au niveau session (et non
 * `SET LOCAL`) pour survivre aux transactions ouvertes par les services,
 * qui ne voient pas le début de la requête HTTP.
 */
export function tenantSetupStatements(
  organizationId: string,
): Array<{ text: string; values?: unknown[] }> {
  const statements: Array<{ text: string; values?: unknown[] }> = []
  if (roleAvailable) statements.push({ text: `SET ROLE ${RLS_ROLE}` })
  statements.push({
    text: `SELECT set_config('${ORG_SETTING}', $1, false)`,
    values: [organizationId],
  })
  return statements
}

/**
 * Nettoyage avant de rendre la connexion au pool. Sans `RESET`, la
 * connexion suivante — peut-être d'une autre station — hériterait de la
 * précédente : c'est précisément la fuite que RLS doit empêcher.
 */
export function tenantTeardownStatements(): Array<{ text: string }> {
  const statements: Array<{ text: string }> = [{ text: `RESET ${ORG_SETTING}` }]
  if (roleAvailable) statements.push({ text: "RESET ROLE" })
  return statements
}

interface Queryable {
  query: <R = Record<string, unknown>>(
    sqlOrConfig: string | { text?: string; sql?: string; values?: unknown[] },
    params?: unknown[],
  ) => Promise<{ rows: R[]; rowCount: number; fields: unknown[]; command: string; affectedRows?: number }>
}

export interface RlsPool extends Queryable {
  connect: () => Promise<RlsPooledClient>
  end: () => Promise<void>
}

export interface RlsPooledClient extends Queryable {
  release: () => void
}

interface GuardedClient extends Queryable {
  release: () => void
}

/**
 * Enveloppe un pool pour appliquer automatiquement le garde RLS.
 *
 * Transparent pour les appelants : même interface, aucune modification des
 * routes. Sans portée active, les appels passent inchangés (chemin système).
 * Avec une portée, chaque emprunt de connexion passe par la mise en place et
 * le nettoyage décrits ci-dessus — y compris les transactions interactives
 * (`connect()`), dont le nettoyage n'a lieu qu'à la restitution, après le
 * `COMMIT` du service.
 */
export function bindRlsGuard(raw: RlsPool): RlsPool {
  async function setup(client: Queryable, organizationId: string): Promise<void> {
    for (const statement of tenantSetupStatements(organizationId)) {
      await client.query(statement.text, statement.values)
    }
  }

  async function teardown(client: Queryable): Promise<void> {
    for (const statement of tenantTeardownStatements()) {
      await client.query(statement.text)
    }
  }

  return {
    async query(sqlOrConfig, params) {
      const scope = currentTenantScope()
      if (!scope) return raw.query(sqlOrConfig, params)
      const client = await raw.connect()
      try {
        await setup(client, scope.organizationId)
        return await client.query(sqlOrConfig, params)
      } finally {
        try {
          await teardown(client)
        } finally {
          client.release()
        }
      }
    },

    async connect() {
      const scope = currentTenantScope()
      const client = await raw.connect()
      if (!scope) return client
      try {
        await setup(client, scope.organizationId)
      } catch (error) {
        client.release()
        throw error
      }
      let released = false
      const guarded: GuardedClient = {
        query: (sqlOrConfig, params) => client.query(sqlOrConfig, params),
        release() {
          if (released) return
          released = true
          // La connexion ne rejoint le pool qu'après le nettoyage ; la
          // suivante à l'emprunter repart d'un état neutre. Les appelants
          // ne devant pas attendre ce ménage, une erreur de `RESET` est
          // journalisée, jamais laissée en rejet volant.
          void (async () => {
            try {
              await teardown(client)
            } catch (error) {
              console.warn(
                "[rls] Nettoyage de connexion échoué:",
                error instanceof Error ? error.message : error,
              )
            } finally {
              client.release()
            }
          })()
        },
      }
      return guarded as RlsPooledClient
    },

    async end() {
      await raw.end()
    },
  }
}
