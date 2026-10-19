# WashPilot CI 🚿🚗

Application SaaS **multi-tenant** de gestion de stations de lavage auto en Côte d'Ivoire :
enregistrement des lavages, caisse (sessions, mouvements, clôture), dépenses, équipe,
rapports d'activité et onboarding guidé. Montants en **F CFA (XOF)**, stockés en centimes.

## Stack

| Couche | Technologies |
|---|---|
| Frontend | React 19 · Vite · TypeScript · Tailwind CSS 4 · shadcn/ui · React Router 7 · Recharts |
| Backend | Express 5 (exécuté via `tsx`), API REST `/api/v1` |
| Authentification | [Clerk](https://clerk.com) (sessions + organisations + webhooks) |
| Base de données | PostgreSQL ([Neon](https://neon.tech)) — schéma auto-créé au démarrage |

Un seul serveur sert l'API **et** la SPA (middleware Vite en développement, `dist/` en production).

## Démarrage rapide

```bash
# 1. Dépendances
npm install

# 2. Environnement
cp .env.example .env     # puis complétez DATABASE_URL + clés Clerk

# 3. Développement (API + frontend sur http://localhost:3000)
npm run dev
```

### Scripts

| Commande | Description |
|---|---|
| `npm run dev` | Serveur de développement (Express + Vite middleware) |
| `npm run build` | Typecheck (`tsc -b`) + build frontend (`vite build`) |
| `npm start` | Serveur (en production : servir `dist/`, build préalable requis) |
| `npm test` | Tests unitaires (validateurs, idempotence, rapports) |
| `npm run lint` | ESLint |

## Configuration

Variables d'environnement (voir [`.env.example`](.env.example)) :

- `DATABASE_URL` — connexion Neon/PostgreSQL. **Obligatoire en production.**
- `VITE_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — clés Clerk. **Obligatoires.**
- `CLERK_WEBHOOK_SIGNING_SECRET` — secret svix du webhook `POST /api/webhooks/clerk`
  (événements `user.*`, `organization.*`, `organizationMembership.*`).
- `CORS_ORIGINS` — origines frontend autorisées (séparées par des virgules).

> Sans webhook configuré (développement), le serveur **auto-provisionne** l'organisation
> et l'adhésion depuis l'API Clerk à la première requête authentifiée.

## Architecture

```
server.ts            # Express : sécurité, CORS, webhook Clerk, montage des routeurs, SPA
server/
  env.ts             # Validation zod des variables d'environnement
  db.ts              # Pool pg + schéma SQL idempotent (CREATE/ALTER IF NOT EXISTS)
  auth.ts            # Vérification des tokens Clerk + profils via l'API Clerk
  tenant.ts          # Résolution du tenant (org + rôle) et auto-provisionnement
  auth-router.ts     # /auth/sync, /auth/me
  onboarding.ts      # Assistant : status, progress, summary, confirm, plans, catalogue
  api.ts             # CRUD sites, services, catégories + lavages (création idempotente, annulation)
  operations.ts      # Sessions de caisse, mouvements, clôture, dépenses
  team.ts            # Travailleurs (/workers) + comptes (/users)
  reports.ts         # Rapports d'activité + métriques du dashboard
  idempotency.ts     # Clés d'idempotence génériques (rejeu avec Idempotency-Replayed)
src/
  app/               # Pages (landing, auth, onboarding, lavages, caisse, dépenses, …)
  components/        # UI (shadcn) + layouts + gardes de routes
  lib/               # Client API (useApi/apiFetch) + types partagés
tests/               # Tests unitaires (node:test via tsx)
```

### Principes de l'API

- **Multi-tenant strict** : chaque requête SQL filtre par `organization_id`, le tenant est
  résolu côté serveur depuis le token Clerk — jamais depuis le navigateur.
- **Rôles** : `owner` / `manager` / `cashier` (mappés depuis les rôles d'organisation Clerk).
- **Idempotence** : `POST /washes`, `/cash-sessions/open`, `/cash-sessions/:id/movements` et
  `/expenses` exigent l'en-tête `Idempotency-Key`. Un rejeu renvoie la réponse d'origine avec
  l'en-tête `Idempotency-Replayed: true` ; une réutilisation avec un contenu différent → `409`.
- **Limites de forfait** : `max_workers` / `max_users` imposés sous verrou advisory PostgreSQL.
- **Argent** : entiers en centimes de XOF (`*_cents`), jamais de flottants.

### Endpoints principaux (`/api/v1`, session Clerk requise)

| Domaine | Routes |
|---|---|
| Auth | `POST /auth/sync` · `GET /auth/me` |
| Onboarding | `GET /onboarding/status` · `GET/PUT /onboarding/progress` · `GET /onboarding/summary` · `POST /onboarding/confirm` · `GET /plans` · `GET /service-catalog` |
| Catalogue | CRUD `/sites`, `/services`, `/service-categories`, `/vehicle-categories` |
| Lavages | `GET /washes` · `GET /washes/:id` · `POST /washes` (idempotent) · `POST /washes/:id/cancel` |
| Caisse | `GET /cash-sessions` · `GET /cash-sessions/current` · `POST /cash-sessions/open` · `GET/POST /cash-sessions/:id/movements` · `POST /cash-sessions/:id/close` |
| Dépenses | `GET/POST /expenses` |
| Équipe | `GET/POST /workers` · `PATCH /workers/:id` · `GET /users` |
| Rapports | `GET /reports/summary?from&to` · `GET /dashboard/metrics` |

## Flux métier clés

1. **Inscription → Organisation → Onboarding** : après la création du compte et de
   l'organisation Clerk, l'assistant en 5 étapes (station → services → travailleurs →
   forfait → confirmation) persiste chaque étape côté serveur ; `POST /onboarding/confirm`
   matérialise le tout (site, services, travailleurs, abonnement) en une transaction.
2. **Lavage** : prix recopiés depuis le catalogue au moment de l'enregistrement
   (`service_name`/`unit_price_cents` figés dans `wash_items`) ; un paiement espèces exige
   une session de caisse ouverte et génère un mouvement d'entrée.
3. **Caisse** : solde théorique = ouverture + entrées − sorties ; la clôture exige la
   justification de tout écart.
4. **Annulation de lavage** : motif obligatoire, paiements marqués `refunded`, contre-passation
   en caisse si la session d'origine est encore ouverte.
