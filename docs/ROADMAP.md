# Feuille de route — WashPilot CI

Cette feuille de route décrit l'état du dépôt réel : SPA React/Vite/TypeScript, API Express/TypeScript et PostgreSQL/Neon. Les anciennes notes Go/chi/Prisma sont historiques et ne décrivent pas l'architecture actuellement exécutée.

## Réalisé localement

- **Authentification et tenant** : Clerk gère l'inscription, la connexion, les sessions et les organisations. Les JWT sont vérifiés côté serveur ; les profils et appartenances sont projetés dans `users` et `organization_members`.
- **Synchronisation fiable** : routes de synchronisation Clerk, webhooks signés/dédupliqués, vérification Backend Clerk à la création d'une appartenance locale, récupération des profils et gestion des rôles.
- **Onboarding persistant** : progression et brouillons Neon, validations serveur, création transactionnelle de station/catalogue/travailleurs/abonnement, reprise après connexion.
- **Catalogue et opérations** : CRUD tenant-scopé des prestations et catégories (avec archivage plutôt que suppression physique), lavages, paiements enregistrés, caisse, mouvements et dépenses synchronisés via l’API Neon.
- **Équipe** : liste des travailleurs et comptes Clerk distincts, création/modification/activation/désactivation tenant-scopées, droits owner/manager et quota actif du forfait contrôlé transactionnellement.
- **Rapports** : période personnalisable, volumes de lavage, paiements vérifiés, dépenses enregistrées, série journalière, ventilations par service/moyen/catégorie et export CSV ; accès owner/manager.
- **Sécurité financière locale** : contrôle de solde en transaction, restrictions de rôles, idempotence des lavages/ouvertures de caisse/mouvements/dépenses et compteurs atomiques des références.
- **Exploitation** : migrations SQL numérotées, pool PostgreSQL borné, `/healthz`, `/readyz`, gestion des erreurs et documentation de configuration.
- **Vérifications locales** : `npm run build`, `npm run lint`, `npm test` (12 tests) et `git diff --check` passent après l’implémentation.

## Étapes suivantes

1. Configurer une base Neon de test et des clés Clerk de développement renouvelées ; appliquer et contrôler les cinq migrations.
2. Exécuter des tests d'intégration contre PostgreSQL : isolation entre deux organisations, concurrence/idempotence, solde, annulations et limites de forfait.
3. Valider le parcours E2E réel : inscription, vérification e-mail, création/rejoindre une organisation, reprise onboarding et accès au dashboard.
4. Compléter la gestion des remboursements/annulations de paiements et l'intégration réelle des fournisseurs mobile money, sans marquer un paiement externe comme confirmé avant preuve.
5. Compléter les invitations/révocations des comptes Clerk depuis l’application, les abonnements/billing et le journal d’audit ; les rapports/exports et la gestion des travailleurs sont livrés.
6. Préparer la production : secrets Clerk/Neon, webhook, sauvegarde/restauration, monitoring, alertes, CI/CD, audit complet des dépendances et politique de migrations.

## Validation et limites connues

- `DATABASE_URL` et le secret serveur Clerk sont requis pour la validation réelle. Sans base, `/readyz` reste `503` et les migrations ne peuvent pas être exécutées.
- Les tests locaux ne remplacent pas les tests PostgreSQL/Clerk de bout en bout.
- L'isolation tenant est actuellement assurée par le backend et les requêtes SQL tenant-scopées ; RLS PostgreSQL n'est pas configuré.
- Les forfaits payants restent `pending`; aucun succès de paiement n'est simulé.
- L'audit de dépendances a trouvé des vulnérabilités élevées dans des dépendances de développement ; la mise à niveau majeure proposée par `npm audit fix --force` n'a pas été appliquée.
