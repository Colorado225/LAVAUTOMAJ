# PHASE A — Audit de l'existant : rapport des écarts

Audit réalisé selon `docs/WORKFLOW.md` (workflow d'inscription, onboarding et personnalisation du dashboard). Référence : `docs/PROGRESS.md`, `TODO.md`, code réel.

## 1. État réel de l'application

### Backend (Go + chi + sqlx + Neon/PostgreSQL + Clerk)

- Serveur `cmd/server/main.go` (1 150+ lignes, mono-fichier), 30 handlers.
- Auth : Clerk (`clerkhttp.RequireHeaderAuthorization`), claims custom `org_id` requis par la quasi-totalité des endpoints.
- 4 migrations appliquées sur Neon : `organizations`, `users`, `vehicle_categories`, `service_categories`, `services`, `sites`, `customers`, `washes`, `wash_items`, `wash_assignments`, `payments`, `cash_sessions`, `cash_movements`, `expense_categories`, `expenses`.
- Isolation multi-tenant par `organization_id` vérifiée (test `isolation_test.go`).
- Endpoint `GET /api/v1/dashboard/metrics` renvoie `total_orders` / `total_revenue` (centimes) calculés sur la table `orders`.
- **Écart constaté** : `cmd/server/main_test.go` référence `github.com/golang-migrate/migrate/v4` qui n'est pas dans `go.mod` → `go test ./...` échoue au setup.

### Frontend (Vite + React 19 + react-router 7 + Clerk + shadcn/ui)

- Routes (`src/config/routes.tsx`) : `/`, `/dashboard`, `/onboarding`, `/washes`, `/cash-drawer`, `/expenses`, `/reports`, `/team`, `/services`, `/vehicle-categories`, auth (sign-in/sign-up/forgot), settings, erreurs.
- `ClerkProvider` dans `App.tsx`, mais **aucune protection de route** : `/dashboard` est accessible sans session (l'API renvoie alors une erreur, mais la page s'affiche).
- `sign-in/sign-up` : formulaires décoratifs du template (`login-form-1.tsx`, POST vers `/`), **non branchés sur Clerk** (pas de `<SignIn/>`/`<SignUp/>`, pas de redirection post-auth).
- `/onboarding` : placeholder « PHASE 1 / MODULE 1 » — **aucune étape, aucune donnée**.
- `/dashboard` : `DashboardMetrics` branché sur l'API réelle (recettes XOF, lavages), layout `BaseLayout`.
- Sidebar statique (`app-sidebar.tsx`) : nom « WashPilot CI » codé en dur, non lié à l'organisation réelle.
- Hook API réutilisable : `src/lib/api.ts` (`useApi`, `apiFetch`, token Clerk, `VITE_API_BASE_URL`).

### Base de données (Neon)

- 16 tables, 0 organisation, 0 utilisateur — base vierge.
- Table `organizations` minimale : `clerk_org_id`, `name` seulement (pas de téléphone/adresse/ville/logo).
- **Aucun modèle** pour : workers (travailleurs), plans/abonnements, progression d'onboarding.

## 2. Écarts par rapport au WORKFLOW.md

| #   | Exigence                                                                | État                           | Écart                                                                                                    |
| --- | ----------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1   | Landing page                                                            | ✅ `src/app/landing/` complète | Adapter les CTA vers sign-in/sign-up réels                                                               |
| 2   | Inscription/connexion                                                   | ❌                             | Formulaires non branchés sur Clerk                                                                       |
| 3   | Redirection selon état du compte                                        | ❌                             | Pas de garde de route, tout le monde arrive sur `/dashboard`                                             |
| 4   | Détection de l'état de configuration côté serveur                       | ❌                             | Aucun endpoint de statut                                                                                 |
| 5   | Onboarding multi-étapes (identité, catalogue, travailleurs, forfait)    | ❌                             | Page placeholder uniquement                                                                              |
| 6   | Récapitulatif + confirmation                                            | ❌                             | —                                                                                                        |
| 7   | Enregistrement transactionnel idempotent                                | ❌                             | —                                                                                                        |
| 8   | Animation de succès post-confirmation serveur                           | ❌                             | —                                                                                                        |
| 9   | Persistance/reprise (`OnboardingProgress`)                              | ❌                             | —                                                                                                        |
| 10  | Dashboard personnalisé (nom station, services, forfait, chiffres réels) | ◐                              | Métriques réelles OK ; nom/logo/services/forfait absents                                                 |
| 11  | Multi-stations par utilisateur                                          | ❌                             | Modèle 1 user = 1 org (claim `org_id` unique) — hors périmètre immédiat                                  |
| 12  | Entités `ServiceCatalog`/`StationService`                               | ◐                              | `services` existe (par org) : sert de catalogue par station ; un seed de prestations standard est requis |
| 13  | Forfaits Free/Pro/Business en base                                      | ❌                             | Aucune table                                                                                             |
| 14  | Tests backend/frontend                                                  | ◐                              | Isolation testée ; setup `go test` cassé ; aucun test onboarding                                         |

## 3. Composants réutilisables identifiés (à ne pas reconstruire)

- **Frontend** : `BaseLayout`, tous les `components/ui/*` (shadcn), `useApi`/`apiFetch`, `Logo`, `Toaster`, `lucide-react`, `react-hook-form` + `zod` + `Field*`, routeur lazy (`config/routes.tsx`), thème/clerk providers.
- **Backend** : middleware Clerk, pattern `ApiServer` + stores sqlx, migrations `golang-migrate`, test d'isolation.
- **Design** : conservé tel quel — seuls les contenus s'adaptent au contexte (règle NB du WORKFLOW.md).

## 4. Décisions d'audit

1. Ne pas toucher aux 4 migrations existantes (aucune migration destructive).
2. L'onboarding vit dans une **nouvelle migration 000005** : extension `organizations`, tables `workers`, `plans`, `subscriptions`, `onboarding_progress`.
3. Le catalogue standard de prestations est **seedé** dans la migration (données de référence par défaut, rattachées à l'org à la confirmation).
4. Correction immédiate du setup de tests backend (`go get golang-migrate`).
5. Les pages auth du template seront remplacées par les composants Clerk **sans changer le design** (carte centrée, logo, mêmes classes).

## 5. Risques

- Le claim `org_id` est créé côté Clerk (template session). En local, une org Clerk inexistante en base → 403. L'onboarding doit **auto-provisionner** l'org si absente (source : claims Clerk), sinon le parcours est bloqué avant de commencer.
- Clerk test key disponible ; le parcours complet (inscription réelle) est testable en dev.
- `main.go` est un mono-fichier : les nouveaux handlers onboarding seront isolés dans un fichier dédié (`onboarding_handlers.go`) pour limiter la pollution.
