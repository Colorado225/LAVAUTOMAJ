# État d'avancement — WashPilot CI

> Ce suivi remplace les anciennes notes qui décrivaient un backend Go. Le dépôt actuel est une SPA React/Vite/TypeScript avec API Express/TypeScript et PostgreSQL/Neon.

## Backend actuel

- [x] Authentification Clerk : inscription, connexion, JWT vérifié par le backend ; aucun mot de passe n'est stocké dans Neon.
- [x] Synchronisation du profil Clerk dans `users` et appartenance tenant dans `organization_members`.
- [x] Vérification Clerk des appartenances à la création locale, webhook signé/dédupliqué pour synchroniser créations, mises à jour et révocations.
- [x] Isolation des routes tenant depuis l'organisation du JWT, filtre `organization_id` sur les requêtes métier.
- [x] Onboarding sauvegardé dans `onboarding_progress`, validation serveur, reprise de brouillon et confirmation transactionnelle.
- [x] Routes catalogue tenant-scopées pour lire/créer/modifier/désactiver les prestations et catégories ; les suppressions physiques sont évitées pour protéger l’historique.
- [x] Routes de lavages, paiements, caisse, mouvements et dépenses.
- [x] Routes d’équipe : création, modification et activation/désactivation de travailleurs, garde owner/manager et quota actif vérifié sous verrou transactionnel.
- [x] Route de rapport tenant-scopée, réservée owner/manager, avec dates inclusives, agrégats financiers/opérationnels et série journalière.
- [x] Contrôles de rôle, limites de forfait couvertes, validation de solde et calculs entiers sûrs.
- [x] Idempotence SHA-256 pour les mutations financières couvertes ; références de lavage générées via compteur transactionnel par tenant/année.
- [x] Migrations SQL versionnées `001` à `005`, readiness/liveness et pool PostgreSQL borné.

## Frontend actuel

- [x] React/Vite, React Router, Clerk et API same-origin.
- [x] Garde d'organisation et d'onboarding avec état servi par Neon.
- [x] Pages Clerk/onboarding, dashboard, lavages, caisse, dépenses, rapports, équipe et catalogue.
- [x] CRUD synchrone Neon pour travailleurs, prestations, catégories de prestations et catégories de véhicules : création, lecture, modification et archivage/réactivation. Les mutations relisent les données depuis l’API après succès.
- [x] Les formulaires de lavage, ouverture de caisse, mouvements manuels et dépenses transmettent des clés d'idempotence.

## Vérification locale

Vérification locale après l’implémentation des pages : `npm run build`, `npm run lint`, `npm test` (12 tests) et `git diff --check` passent.

## Validation encore nécessaire

- [ ] Renseigner `DATABASE_URL` de test et un secret Clerk serveur renouvelé ; appliquer/valider les migrations sur Neon.
- [ ] Tests d'intégration PostgreSQL pour transactions concurrentes, idempotence, soldes et isolation entre deux organisations.
- [ ] Parcours E2E Clerk réel : compte, e-mail, création/adhésion d'organisation, onboarding, dashboard et révocation de membre.
- [ ] Tests PostgreSQL des mutations de catalogue, travailleurs et rapports sur Neon de test (quota concurrent, transactions et isolation).
- [ ] Gestion des membres d’accès Clerk (invitation/révocation depuis l’application), flux de remboursement/paiement externe, facturation et journal d’audit.
- [ ] Préparation opérationnelle de production : monitoring, sauvegardes/restauration, CI/CD et audit final des dépendances.

## Limites importantes

- Sans `DATABASE_URL`, `/readyz` répond `503` et les migrations/transactions ne peuvent pas être validées contre une vraie base.
- Les forfaits payants restent en attente ; aucune confirmation de paiement n'est simulée.
- L'isolation est actuellement appliquée par le backend ; PostgreSQL RLS n'est pas configuré.
- L'audit npm a identifié des vulnérabilités élevées dans des dépendances de développement. La mise à niveau majeure proposée automatiquement n'a pas été appliquée.
