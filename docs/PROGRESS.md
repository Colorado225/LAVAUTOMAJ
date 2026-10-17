# WashPilot_CI - Suivi de Progression

Ce document suit l'avancement du projet conformément à la `ROADMAP.md` et à `TODO.md`.

## PHASE 0 — Audit et cadrage

- [x] **docs/AUDIT_SHADCN_TEMPLATE.md** : Analyser le template Shadcn UI existant.
- [x] **docs/ARCHITECTURE.md** : Définir l'architecture technique cible.
- [x] **docs/ROADMAP.md** : Détailler le plan d'implémentation.
- [x] **Migration Plan** : Lister les fichiers à conserver, migrer, adapter, supprimer ou différer.
- [x] **Business Flow Diagram** : Schématiser les flux métier.
- [x] **Technical Risks** : Identifier les risques techniques.
- [x] **docs/DATABASE.md** : Schéma relationnel, tables, colonnes, relations, index, contraintes, règles de suppression, stratégies d'isolation.
- [x] **docs/TODO.md** : Traduction de PLAN.md en todo list actionnable avec workflow de vérification.

## PHASE 1 — Fondations

- [x] **Backend/Frontend Structure** : Structure des projets en place (Go backend + Vite frontend).
  - [x] Initialiser le module Go pour le backend
- [x] **Environment Config** : Config chargée depuis `.env` (DATABASE_URL, CLERK_SECRET_KEY).
- [x] **Neon DB Connection** : Connexion établie via `sqlx`/`pgx`, `Ping()` OK.
- [x] **First SQL Migration** : Migration `000001_init_schema` créée (`organizations`, `users`).
  - [x] Créer les fichiers de migration pour `users` et `organizations`.
  - [x] Migration `000001` appliquée et validée sur Neon (tests passent).
- [x] **Catalog Migration** : Migration `000002_catalog` (`vehicle_categories`, `service_categories`, `services`) créée et appliquée sur Neon.
- [x] **Clerk Token Verification** : Vérification des jetons Clerk côté backend (`clerkhttp.RequireHeaderAuthorization`, `SessionClaimsFromContext`).
- [x] **User & Organization Models** : Modèles alignés sur PLAN.md (rôles PLATFORM_ADMIN, OWNER, MANAGER, CASHIER, WASHER).
- [x] **Multi-tenant Isolation** : Isolation par `organization_id` vérifiée (test d'isolation passe).
- [x] **Role Management** : Rôles définis côté modèle.
- [x] **Basic Logging** : Journalisation structurée (`slog` JSON).
- [x] **Health Endpoints** : `GET /healthz`, `GET /readyz` fonctionnels.
- [x] **Isolation Tests** : Test d'isolation multi-tenant écrit et validé contre Neon.

Critère de validation PHASE 1 : un utilisateur authentifié ne peut accéder qu'aux ressources de son entreprise. ✅ Vérifié.

## PHASE 2 — Interface et migration du template

- [x] **Main Layout** : `base-layout.tsx` et `root-layout.tsx` adaptés (WashPilot CI, sidebar, header, footer).
- [x] **Navigation** : Routes, sidebar et command-search alignés sur WashPilot_CI (Tableau de bord, Lavages, Caisse, Dépenses, Rapports, Équipe, Onboarding, Paramètres, Authentification, Erreurs). Anciennes routes démo supprimées.
- [x] **Reusable Components** : Bibliothèque `components/ui/` (Shadcn) conservée.
- [x] **Basic Dashboard** : Page `/dashboard` créée (placeholder, PHASE 3 affinera les indicateurs).
- [-] **Responsive Design** : Tailwind mobile-first en place, à affiner sur les nouvelles pages.
- [-] **UI States** : États chargement/erreur/liste vide à implémenter avec les fonctionnalités.
- [-] **Clerk Login Pages** : Pages auth existantes (`sign-in`, `sign-up`, `forgot-password`) à intégrer avec Clerk SDK.
- [-] **Frontend Permissions** : Système de permissions frontend à mettre en place (PHASE 3+).

Critère de validation PHASE 2 : build réussi, navigation stable, aucun lien majeur cassé. ✅ Vérifié.

## PHASE 3 — Catalogue et lavages

[-] **Service Catalog** : Migration 000002 appliquée, modèles Go, stores et endpoints API implémentés (`GET/POST/PATCH/POST deactivate /api/v1/service-categories`, `GET/POST/PATCH/POST deactivate /api/v1/services`).
- [x] Modèles Go : `VehicleCategory`, `ServiceCategory`, `Service`
- [x] Stores : `vehicle_categories.go`, `service_categories.go`, `services.go`
- [x] Endpoints API avec isolation par `organization_id` et vérification Clerk
- [ ] Frontend : pages catalogue et formulaire de nouveau lavage à implémenter
[-] **Vehicle Categories** : Même traitement que le service catalog (voir ci-dessus).
- [ ] **"New Wash" Form** : Créer le formulaire d'enregistrement d'un nouveau lavage.
- [ ] **Wash History** : Afficher l'historique des lavages.
- [ ] **Wash Details** : Afficher le détail d'un lavage.
- [ ] **Transactional Recording** : Assurer l'enregistrement transactionnel des données.
- [ ] **Cancellation Management** : Gérer l'annulation d'un lavage.
- [ ] **Idempotency** : Protéger contre les doubles soumissions.

## PHASE 4 — Paiements et caisse

- [ ] **Payment Recording** : Enregistrer les paiements.
- [ ] **Cash Sessions** : Gérer les sessions de caisse (ouverture, clôture).
- [ ] **Cash Movements** : Suivre les mouvements de caisse.
- [ ] **Discrepancy Calculation** : Calculer et afficher les écarts de caisse.
- [ ] **Expense Recording** : Enregistrer les dépenses.
- [ ] **Financial History** : Afficher l'historique des opérations financières.

## PHASE 5 — Rapports et équipe

- [ ] **Daily Reports** : Générer les rapports journaliers.
- [ ] **Periodical Reports** : Générer les rapports par période (hebdomadaire, mensuel).
- [ ] **Service Performance Reports** : Analyser la performance des prestations.
- [ ] **Employee Performance Indicators** : Suivre la performance des employés.
- [ ] **Report Filters** : Ajouter des filtres aux rapports.
- [ ] **CSV Export** : Permettre l'export des données en CSV (selon les permissions).
- [ ] **Team Management** : Gérer les collaborateurs.

## PHASE 6 — Abonnements et entitlements

- [ ] **Plan Catalog** : Gérer les offres d'abonnement.
- [ ] **Subscription Management** : Gérer l'abonnement de chaque entreprise.
- [ ] **Entitlement Checks** : Vérifier les droits d'accès aux fonctionnalités.
- [ ] **Manual Payment** : Mettre en place un système de paiement manuel.
- [ ] **Admin Validation** : Permettre la validation des paiements par un administrateur.
- [ ] **Subscription History** : Historiser les changements d'abonnement.
- [ ] **Expiration Management** : Gérer l'expiration des abonnements.

## PHASE 7 — Pilote et production

- [ ] **Test Dataset** : Créer un jeu de données de test complet.
- [ ] **E2E Test Plan** : Définir et exécuter le plan de test de bout en bout.
- [ ] **Production Configuration** : Configurer l'environnement de production.
- [ ] **Secret Management** : Mettre en place une gestion sécurisée des secrets.
- [ ] **Deployment Documentation** : Documenter la procédure de déploiement.
- [ ] **Backup & Restore Procedure** : Documenter la procédure de sauvegarde et de restauration.
- [ ] **Error Monitoring** : Mettre en place le suivi des erreurs.
- [ ] **User Guide** : Rédiger le guide utilisateur en français.
