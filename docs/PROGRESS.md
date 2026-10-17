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
- [-] **Clerk Login Pages** : ClerkProvider intégré (App.tsx), `.env` frontend créé avec `VITE_CLERK_PUBLISHABLE_KEY`, couche API `src/lib/api.ts` (`useApi` hook avec token Clerk).
- [-] **Frontend Permissions** : Système de permissions frontend à mettre en place (PHASE 3+).

Critère de validation PHASE 2 : build réussi, navigation stable, aucun lien majeur cassé. ✅ Vérifié.

## PHASE 3 — Catalogue et lavages

[-] **Service Catalog** : Migration 000002 appliquée, modèles Go, stores et endpoints API implémentés (`GET/POST/PATCH/POST deactivate /api/v1/service-categories`, `GET/POST/PATCH/POST deactivate /api/v1/services`). Page frontend `/services` affichant le catalogue depuis l'API.
- [x] Modèles Go : `VehicleCategory`, `ServiceCategory`, `Service`
- [x] Stores : `vehicle_categories.go`, `service_categories.go`, `services.go`
- [x] Endpoints API avec isolation par `organization_id` et vérification Clerk
- [x] Frontend : page `/services` consommant l'API via `useApi`
- [x] Navigation : sidebar + command-search mis à jour
[-] **Vehicle Categories** : Même traitement (voir ci-dessus). Page frontend `/vehicle-categories` créée.
- [ ] **"New Wash" Form** : Créer le formulaire d'enregistrement d'un nouveau lavage.
- [ ] **Wash History** : Afficher l'historique des lavages.
- [ ] **Wash Details** : Afficher le détail d'un lavage.
- [ ] **Transactional Recording** : Assurer l'enregistrement transactionnel des données.
- [ ] **Cancellation Management** : Gérer l'annulation d'un lavage.
- [ ] **Idempotency** : Protéger contre les doubles soumissions.

## PHASE 4 — Paiements et caisse

[-] **Payment Recording** : Migration 000004 (`payments`) appliquée, modèle `Payment`, store `payment_store`, endpoints `GET/POST /api/v1/payments` avec isolation `organization_id`.
- [x] Modèles Go : `Payment`, `PaymentMethod`, `PaymentStatus`
- [x] Store : `payment_store.go`
- [x] Endpoints API avec isolation et vérification Clerk

[-] **Cash Sessions** : Migration 000004 (`cash_sessions`, `cash_movements`) appliquée, modèles `CashSession`, `CashMovement`, stores, endpoints `POST /cash-sessions/open`, `GET /cash-sessions/current`, `GET/POST /cash-sessions/{id}/movements`, `POST /cash-sessions/{id}/close`.
- [x] Modèles Go : `CashSession`, `CashMovement`, `CashSessionStatus`, `CashMovementType`
- [x] Stores : `cash_session_store.go`, `cash_movement_store.go`
- [x] Endpoints API avec isolation (une session ouverte par site)

[-] **Expense Recording** : Migration 000004 (`expenses`, `expense_categories`) appliquée, modèles `Expense`, `ExpenseCategory`, stores, endpoints `GET/POST/GET/POST /expenses`.
- [x] Modèles Go : `Expense`, `ExpenseCategory`, `ExpenseStatus`
- [x] Stores : `expense_category_store.go`, `expense_store.go`
- [x] Endpoints API avec isolation

[-] **Discrepancy Calculation** : Clôture calcule l'écart (compté - théorique) et le stocke.

[-] **Frontend** : Pages `/cash-drawer`, `/expenses`, `/washes` créées, consommant l'API via `useApi` avec token Clerk.
- [x] Page cash-drawer (sessions, soldes, écarts, mouvements)
- [x] Page expenses (liste des dépenses)
- [x] Page washes (liste des lavages)
- [x] Navigation sidebar + command-search (Caisse, Dépenses, Lavages déjà présents)

Critère de validation PHASE 4 : montants du rapport, encaissements et solde de caisse correspondent aux mêmes opérations sources sans double comptabilisation. ⬅️ En cours (tests à écrire).

## PHASE 5 — Rapports et équipe

- [ ] **Daily Reports** : Générer les rapports journaliers.
- [ ] **Periodical Reports** : Générer les rapports par période (hebdomadaire, mensuel).
- [ ] **Service Performance Reports** : Analyser la performance des prestations.
- [ ] **Employee Performance Indicators** : Suivre la performance des employés.
- [ ] **Report Filters** : Ajouter des filtres aux rapports.
- [ ] **CSV Export** : Permettre l'export des données en CSV (selon les permissions).
- [ ] **Team Management** : Gérer les collaborateurs.

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
