# Authentification Clerk, synchronisation Neon et onboarding

## Source de vérité et flux utilisateur

- **Clerk** est l'unique fournisseur d'identité : création de compte, connexion, vérification de l'adresse, réinitialisation du mot de passe et sessions.
- Le backend ne reçoit jamais le mot de passe. Il valide le JWT de session Clerk signé avec `@clerk/backend`.
- **Neon/PostgreSQL** contient une projection métier du profil Clerk dans `users`, les organisations dans `organizations`, les rôles de tenant dans `organization_members` et l'avancement d'inscription dans `onboarding_progress`.
- L'identifiant utilisateur et l'organisation active viennent des claims du JWT vérifié. Le backend n'utilise jamais `clerk_user_id`, `organization_id`, l'e-mail ou le rôle envoyés dans le body comme preuve d'identité.

Parcours :

1. Le navigateur crée/vérifie l'identité via les API Clerk.
2. Après activation de la session, `POST /api/v1/auth/sync` lit le profil depuis l'API Backend Clerk et le synchronise dans Neon. Avant la création d'une organisation, `users.organization_id` reste nul.
3. L'utilisateur crée ou rejoint une organisation avec Clerk Organizations.
4. Au premier appel API authentifié avec l'organisation active, le backend vérifie l'appartenance auprès de l'API Backend Clerk avant de synchroniser l'organisation et l'utilisateur dans Neon, puis crée `onboarding_progress`. Une appartenance supprimée ne peut donc pas être recréée par un ancien JWT.
5. `GET /api/v1/onboarding/status` décide côté serveur si le client doit poursuivre l'onboarding ou peut accéder au dashboard.
6. Les étapes sont sauvegardées dans Neon. « Enregistrer et quitter » enregistre un brouillon puis déconnecte l'utilisateur ; la prochaine connexion reprend à la même étape.
7. `POST /api/v1/onboarding/confirm` valide de nouveau les données et crée, dans une seule transaction, la station, le catalogue tenant, les travailleurs, l'abonnement et l'état terminé. L'opération est idempotente.

L'utilisateur déjà connecté qui visite l'inscription peut rejoindre son espace ou se déconnecter explicitement pour changer de compte. L'app ne supprime pas automatiquement une session Clerk valide.

## Configuration

Copier `.env.example` vers `.env` localement (ne jamais committer `.env`) et renseigner :

| Variable | Obligatoire | Usage |
|---|---:|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | Oui, build frontend | SDK Clerk navigateur (nom canonique Vite) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Alias facultatif | Accepté comme alias public pour les configurations migrées depuis Next.js |
| `CLERK_SECRET_KEY` | Oui pour la synchronisation | Vérification Clerk et lecture profil/organisation via l'API Backend |
| `CLERK_JWT_KEY` | Non | Clé PEM facultative pour vérification JWT sans récupération JWKS |
| `CLERK_AUTHORIZED_PARTIES` | Recommandé | Liste des origines frontend autorisées, séparées par des virgules |
| `DATABASE_URL` | Oui hors mode UI local | URL PostgreSQL Neon ; utiliser SSL et de préférence l'URL pooled Neon |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Recommandé | Vérification des webhooks Clerk |
| `CORS_ORIGINS` | Si API séparée | Liste des origines browser autorisées |
| `VITE_API_BASE_URL` | Non | Laisser vide si le frontend et l'API partagent une origine |

Dans Clerk, activer le parcours e-mail/mot de passe utilisé par l'application, la vérification e-mail et Organizations. Les URLs de redirection doivent conserver les routes `/auth/sign-in`, `/auth/sign-up`, `/auth/create-organization`, `/onboarding` et `/dashboard`.

Créer un webhook Clerk vers `https://<domaine-api>/api/webhooks/clerk` pour les événements `user.created`, `user.updated`, `user.deleted`, `organization.created`, `organization.updated`, `organizationMembership.created` et `organizationMembership.updated`. Le webhook vérifie la signature et déduplique les événements. La synchronisation au premier appel authentifié reste un filet de sécurité en cas de retard de webhook.

## Schéma et opérations Neon

Les migrations versionnées `server/migrations/001_auth_onboarding.sql` à `005_team_reporting_indexes.sql` sont appliquées sous verrou PostgreSQL advisory et enregistrées dans `app_schema_migrations`. Elles sont additives : aucune table métier n'est supprimée. Le processus démarre sans données de démonstration ; en production, `DATABASE_URL` et `CLERK_SECRET_KEY` sont requis.

Endpoints de diagnostic :

- `GET /healthz` : processus HTTP en vie.
- `GET /readyz` : serveur prêt uniquement si Neon/migrations et la clé serveur Clerk sont configurés.

Sans secret Clerk valide, l'API renvoie `401` ou `503`. Sans base Neon, les endpoints tenant renvoient `503`; l'ancien store global en mémoire et ses utilisateurs fictifs ne sont plus utilisés.

## Sécurité multi-tenant

- Chaque route `/api/v1/*` exige un Bearer JWT Clerk signé et non expiré.
- Chaque route tenant résout `(clerk_org_id, clerk_user_id)` à partir du JWT vérifié. Une appartenance locale absente est vérifiée via l'API Backend Clerk avant création ; les webhooks signés synchronisent et révoquent les appartenances.
- Le rôle vient de l'appartenance Clerk vérifiée et est répliqué dans `organization_members` ; aucune identité ou rôle fourni dans le body n'est accepté. Un rôle divergant du claim déclenche une revalidation serveur.
- Les opérations financières et services vérifient également l'appartenance du site, de la prestation, du travailleur et de la session de caisse au tenant actif. Les limites `max_users`, `max_services` et `max_workers` sont contrôlées côté serveur.
- Les mutations d'onboarding et opérations financières utilisent des transactions, validations serveur et contraintes/index PostgreSQL. Les lavages, ouvertures de caisse, mouvements manuels et dépenses utilisent `Idempotency-Key`; le solde espèces est verrouillé et vérifié dans la transaction.
- Les erreurs internes ne renvoient pas les détails SQL ni les jetons au navigateur.

## Vérifications avant déploiement

1. Renseigner une base Neon de test et les clés Clerk d'un environnement de développement.
2. Démarrer `npm run dev`, créer un compte, vérifier l'e-mail, créer une organisation puis terminer l'onboarding.
3. Vérifier la ligne `users` par `clerk_user_id`, la relation `organization_members`, une progression terminée et une station tenant-scopée dans Neon.
4. Refaire l'appel `POST /api/v1/onboarding/confirm` : il doit répondre `already_completed: true` sans créer de doublons.
5. Tester deux organisations et vérifier qu'un identifiant de lavage/service/site de l'une est inaccessible depuis l'autre.
6. Configurer le webhook, valider une signature valide, puis vérifier qu'un événement rejoué ne crée pas de doublon.
7. Contrôler les journaux, `GET /readyz`, `npm run build` et `npm run lint`.

Les clés Clerk et Neon de production ne doivent jamais être placées dans des variables `VITE_*`, sauf la clé publique Clerk.
