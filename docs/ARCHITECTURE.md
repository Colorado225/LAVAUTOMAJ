# Architecture technique — WashPilot CI

## Vue actuelle

```text
React + Vite + TypeScript + React Router
        │ Bearer JWT Clerk (same-origin /api/v1)
        ▼
Express 5 + TypeScript (Node)
  ├─ @clerk/backend : vérification JWT, profil Clerk, webhooks signés
  ├─ routes auth, organisations, onboarding, catalogue, équipe, rapports et opérations
  └─ pg Pool + migrations SQL versionnées
        ▼
PostgreSQL managé Neon
```

- **Frontend :** SPA React 19, Vite, React Router et composants shadcn/ui.
- **API :** serveur Express 5 en TypeScript, lancé par `tsx server.ts`. Les modules de domaine sont dans `server/` ; les réponses JSON sont versionnées sous `/api/v1`.
- **Base de données :** PostgreSQL Neon via `pg`, pool borné et migrations SQL dans `server/migrations/`.
- **Authentification :** Clerk gère les comptes, mots de passe, vérifications, sessions et organisations. Le backend valide la signature et l'expiration de chaque jeton via le SDK officiel `@clerk/backend`.

## Authentification et synchronisation des utilisateurs

Clerk est la source de vérité pour l'identité. Neon conserve une projection applicative : `users` (identifiant Clerk unique, coordonnées, statut), `organizations` (identifiant Clerk unique), et `organization_members` (rôle et appartenance tenant). Les webhooks signés synchronisent les changements Clerk ; `POST /api/v1/auth/sync` et la résolution au premier appel authentifié permettent de réparer un événement manqué.

Le profil transmis dans le navigateur n'est jamais considéré comme preuve d'identité. L'ID utilisateur et l'organisation active viennent d'un JWT vérifié. Le rôle est résolu depuis l'appartenance Clerk vérifiée puis répliqué localement ; une appartenance locale manquante est revalidée auprès de Clerk avant sa création. L'organisation active doit correspondre à une appartenance tenant avant toute lecture ou écriture.

## Isolation multi-tenant

- Chaque requête `/api/v1/*` exige un Bearer JWT Clerk valide.
- L'identifiant interne d'organisation est résolu depuis `clerk_org_id`, lui-même issu du claim Clerk vérifié, jamais depuis `organization_id` dans le body ou l'URL.
- Les requêtes SQL opérationnelles filtrent par `organization_id`; les sites, services, catégories, travailleurs et sessions de caisse sont aussi vérifiés par tenant.
- Le dashboard et les opérations sont refusés tant que `onboarding_completed` n'est pas vrai ; les limites utilisateurs, prestations et travailleurs du forfait sont contrôlées serveur.
- Les écritures d’équipe utilisent des transactions PostgreSQL ; la création/réactivation verrouille le quota de travailleurs actifs du forfait. Les rapports utilisent des lectures tenant-scopées dans une transaction repeatable-read read-only et sont réservés owner/manager.
- Les modifications d’onboarding et les écritures financières utilisent des transactions PostgreSQL. Les clés d'idempotence sont tenant-scopées, associées à une empreinte SHA-256, et protègent les lavages, ouvertures de caisse, mouvements manuels et dépenses contre les retries.
- Les soldes de caisse sont modifiés sous verrou de ligne, refusent les sorties supérieures au solde, et les dépenses espèces héritent du site de leur session. Les références de lavage sont allouées atomiquement par organisation et année.
- Les profils globaux et appartenances multi-organisation sont distincts : l'organisation de rattachement historique dans `users` peut être nulle ; `organization_members` représente les relations multi-tenant.

## Onboarding

La progression côté serveur (`onboarding_progress`) est la seule source de vérité. Les étapes `station`, `services`, `workers` et `plan` sont validées côté frontend et backend. Les brouillons peuvent être enregistrés et l'utilisateur peut quitter ; à la prochaine connexion, le parcours reprend à l'étape stockée. La confirmation finale valide de nouveau les données, applique les limites du forfait et crée en transaction la station, les services, les travailleurs et l'abonnement. Un forfait payant reste `pending` tant qu'aucun paiement réel n'a été vérifié.

## Migrations et diagnostic

Le serveur charge les migrations numérotées `001_auth_onboarding.sql` à `005_team_reporting_indexes.sql` sous `server/migrations/`, sous un verrou advisory PostgreSQL, puis les enregistre dans `app_schema_migrations`. Elles sont additives et peuvent être rejouées en sécurité lorsqu'elles n'ont pas encore été marquées comme appliquées. En production, fournir un `DATABASE_URL` Neon avec SSL et `CLERK_SECRET_KEY`.

- `GET /healthz` : liveness HTTP.
- `GET /readyz` : readiness, renvoie `503` tant que Neon/migrations ou Clerk ne sont pas prêts.

Les endpoints `/api/v1/workers` et `/api/v1/reports/summary` sont basés sur Neon ; les rapports exposent les lavages par jour, paiements vérifiés, dépenses enregistrées, prestations, moyens de paiement et catégories. Les mutations du catalogue utilisent les routes Neon tenant-scopées (`POST`/`PATCH`) et renvoient les lignes enregistrées ; l’interface relit les listes après chaque succès. Les suppressions de catalogue sont des désactivations afin de préserver les références historiques. Les anciennes données API en mémoire et utilisateurs de démonstration ne sont plus servis sur les routes applicatives.

## Variables et déploiement

Voir `.env.example` et `docs/AUTHENTICATION.md`. En particulier : `VITE_CLERK_PUBLISHABLE_KEY` (ou son alias public `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`) est la seule clé Clerk exposée au navigateur ; `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET` et `DATABASE_URL` restent côté serveur. Le frontend utilise des URL API relatives par défaut pour fonctionner derrière le proxy de preview et sur une origine unique.

Le projet reste déployable comme un serveur Node Express qui sert le build Vite. Une évolution vers un déploiement frontend/API séparé doit définir explicitement `CORS_ORIGINS`, `VITE_API_BASE_URL` et `CLERK_AUTHORIZED_PARTIES`.
