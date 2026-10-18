# Base de données — WashPilot CI

Le backend utilise PostgreSQL/Neon avec `pg`. Clerk reste la source de vérité pour l'identité ; la base conserve une projection applicative et les données opérationnelles. Aucun mot de passe Clerk n'est stocké dans Neon.

## Schéma réellement déployé par le dépôt

Les migrations SQL versionnées dans `server/migrations/` sont appliquées au démarrage, dans une transaction et sous verrou advisory PostgreSQL, puis enregistrées dans `app_schema_migrations`.

| Migration | Tables et changements principaux |
|---|---|
| `001_auth_onboarding.sql` | `organizations`, `users`, `organization_members`, `sites`, `plans`, `subscriptions`, `onboarding_progress`, catalogue de prestations, catégories, `workers`, événements webhook Clerk. Insère les forfaits et prestations de base. |
| `002_operations.sql` | `cash_sessions`, `cash_movements`, `washes`, `wash_items`, `wash_worker_assignments`, `payments`, `expenses`, index opérationnels et règle d'une session ouverte par site. |
| `003_financial_safety.sql` | Empreintes et index d'idempotence tenant-scopés, index financiers supplémentaires, compteur atomique de références de lavage par organisation et année. |
| `004_global_user_role.sql` | Définit `users.role` comme rôle global neutre ; l'autorisation par tenant appartient à `organization_members.role`. |
| `005_team_reporting_indexes.sql` | Index tenant/statut/nom des travailleurs et index partiels des paiements vérifiés et dépenses enregistrées pour les rapports. |

Les scripts sont rejoués seulement si leur version n'est pas enregistrée. Une migration déjà appliquée ne doit pas être éditée en production : ajouter un nouveau fichier numéroté. Exécuter et vérifier les migrations d'abord sur une base Neon de test.

## Identité et isolation tenant

- `users.clerk_user_id` identifie l'utilisateur Clerk ; `users.organization_id` est un ancien rattachement facultatif, pas la relation d'autorisation.
- `organization_members` porte l'appartenance et le rôle de l'utilisateur pour chaque organisation. La paire `(organization_id, user_id)` est unique.
- `organizations.clerk_org_id` associe l'organisation Clerk au tenant interne.
- Les tables métier portent `organization_id`; les routes dérivent l'UUID interne depuis le JWT Clerk vérifié et filtrent leurs lectures/écritures par ce tenant. Les ID reçus dans le corps ou l'URL ne suffisent jamais à autoriser une ressource.
- Le schéma ne configure pas actuellement PostgreSQL Row-Level Security (RLS) : l'isolation dépend des vérifications applicatives et des requêtes tenant-scopées. Ajouter RLS nécessitera un contexte de session/transaction fiable avant de l'activer.
- Les appartenances nouvellement synchronisées sont vérifiées auprès de l'API Backend Clerk. Les webhooks signés et dédupliqués mettent à jour ou révoquent la projection locale.

## Onboarding et forfaits

`onboarding_progress` stocke les brouillons et l'étape courante. La confirmation verrouille l'organisation/progression et crée la station, les catégories initiales, les prestations, les travailleurs et l'abonnement dans une transaction. Les limites de forfait disponibles (`max_users`, `max_services`, `max_workers`, `max_sites`) sont contrôlées côté serveur sur les flux couverts.

Les forfaits payants restent en état `pending` : aucun paiement ou abonnement n'est simulé. L'intégration de paiement d'abonnement et la gestion complète des membres/sites au-delà du MVP ne sont pas encore présentes.

## Opérations financières

- Les montants sont des entiers `BIGINT` en centimes XOF dans PostgreSQL et restent des entiers sûrs côté API.
- `cash_sessions` détient le solde théorique ; ouvertures, mouvements, paiements cash, dépenses et annulations mettent à jour le solde dans une transaction avec verrou de ligne.
- Une dépense cash exige une session ouverte et hérite de son site si `site_id` est omis.
- Les mutations de lavage, ouverture de caisse, mouvement manuel et création de dépense exigent `Idempotency-Key`. Le backend conserve une empreinte SHA-256 et répond avec `Idempotency-Replayed: true` lors d'un retry identique ; la réutilisation de la clé avec un payload différent renvoie `409`.
- Les références sont allouées par un compteur transactionnel `(organization_id, année)` au lieu d'un scan global des lavages.
- Les écritures financières sont annulées par statut et mouvements inverses ; les lignes originales ne sont pas supprimées physiquement.

## Équipe et rapports

- `workers` désigne les profils opérationnels qui reçoivent des affectations de lavage ; ce ne sont pas des comptes Clerk. La liste des membres authentifiés reste dans `organization_members`/`users`. Un travailleur est désactivé par statut afin de préserver l’historique.
- Les mutations `/api/v1/workers` sont réservées au propriétaire/manager et filtrées par tenant. La création et la réactivation prennent un verrou advisory transactionnel avant de compter les travailleurs actifs et d’appliquer `plans.max_workers` ; une limite `NULL` signifie illimitée.
- `GET /api/v1/reports/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` est réservé au propriétaire/manager. Les bornes sont inclusives et les journées sont interprétées dans `Africa/Abidjan`; la période est limitée à 366 jours. Les totaux comptent les lavages non annulés, paiements `verified` et dépenses `recorded`; les ventilations de prestations utilisent le snapshot du prix au lavage. La lecture est faite dans une transaction `REPEATABLE READ READ ONLY`.

## Index et exploitation

Les index couvrent les filtres tenant/fréquence, l'historique des opérations, les références uniques, les sessions ouvertes et les clés idempotentes. Le pool est configurable via `PG_POOL_MAX` (1 à 50, valeur par défaut 10), avec délais de connexion et SSL en production/Neon.

`GET /healthz` contrôle que le serveur HTTP répond ; `GET /readyz` vérifie que les migrations/base et la configuration Clerk sont prêtes. Une base réelle reste nécessaire pour valider les migrations, contraintes, transactions et flux de bout en bout.
