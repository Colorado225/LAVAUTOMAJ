# Audit backend — WashPilot CI

## Périmètre réel

Le code exécutable est **React/Vite/TypeScript** côté navigateur, **Express 5/TypeScript** dans `server.ts` et `server/`, et **PostgreSQL/Neon** via `pg`. Les anciennes notes Go/chi/sqlx et migrations `00000x` ne correspondent pas au dépôt actuel.

## Architecture et identité

- Clerk est le fournisseur d'identité ; le backend vérifie les JWT via `@clerk/backend`.
- `users` stocke la projection globale du profil. `organization_members` stocke le rôle par tenant ; `users.role` n'est pas un rôle d'autorisation tenant.
- L'organisation vient du claim Clerk vérifié. Les requêtes SQL des routes métier filtrent par l'identifiant interne d'organisation.
- Les profils et appartenances sont synchronisés par `POST /api/v1/auth/sync` et webhooks Clerk signés, dédupliqués et transactionnels.
- Lorsqu'une appartenance locale manque, le backend vérifie l'appartenance actuelle auprès de l'API Backend Clerk avant de la créer, afin qu'un ancien JWT ne puisse pas rétablir une adhésion révoquée.

## Corrections de sécurité et d'intégrité implémentées

- Body parser : JSON mal formé → `400`, payload trop volumineux → `413`, encodage non supporté → `415`.
- Onboarding : progression et brouillons persistants, validations serveur, confirmation idempotente dans une transaction.
- Tenant : rôles par organisation, plafonds utilisateurs/prestations/travailleurs couverts côté serveur, contrôle des références inter-tenant.
- Lavages : empreinte SHA-256 déterministe, clé d'idempotence, contrôle des services/travailleurs/site/catégorie, paiement et mouvement cash atomiques, référence par compteur tenant/année.
- Caisse : clés d'idempotence à l'ouverture et sur mouvements manuels, rôle opérateur/gestionnaire, verrouillage du solde, refus des sorties excédentaires et clôture rejouable sans double écriture.
- Dépenses : clé d'idempotence, site déduit de la session cash si absent, rôle de caisse, contrôle de solde, annulation réservée aux propriétaires/responsables et mouvement inverse transactionnel.
- Catalogue : contrôle de doublons tenant et limites de prestations sérialisées sous verrou advisory.

## Résultats de validation locale

Les validations locales à enregistrer après chaque modification sont :

```text
npm run build
npm run lint
npm test
git diff --check
```

Elles ne remplacent pas une validation contre PostgreSQL/Neon.

## Risques ou travaux ouverts

1. Aucune base Neon valide (`DATABASE_URL`) n'est disponible dans cet environnement : les migrations, contraintes uniques, transactions concurrentes et flux E2E ne sont pas exécutés ici.
2. Aucun secret Clerk serveur valide n'est configuré ici ; la connexion Clerk réelle, les webhooks et la vérification des appartenances nécessitent des clés de test renouvelées.
3. Les paiements mobiles sont saisis comme opérations métier, mais aucun fournisseur Orange Money/MTN MoMo/Moov/Wave ni flux de remboursement n'est intégré ; une confirmation ne doit pas être simulée.
4. Les rapports d’activité avec export CSV et la gestion des travailleurs sont livrés ; restent les tests PostgreSQL de ces flux, les invitations/révocations Clerk, le billing et l’audit log.
5. L'isolation tenant est faite au niveau applicatif ; RLS PostgreSQL n'est pas configuré.
6. L'audit de dépendances a trouvé des vulnérabilités élevées dans des dépendances de développement ; aucune mise à niveau majeure forcée n'a été appliquée.
7. `docs/DATABASE.md` décrit le schéma réellement créé par les migrations `001`–`005` ; toute nouvelle migration doit être append-only en production.
