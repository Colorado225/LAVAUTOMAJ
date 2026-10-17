# Plan de Migration du Template

Ce document détaille les actions spécifiques à entreprendre pour transformer le template Shadcn UI en l'application WashPilot_CI.

## 1. Fichiers et Répertoires à Supprimer

L'objectif est d'élaguer le projet pour ne conserver que ce qui est nécessaire.

### Répertoires principaux dans `src/app` :

- `src/app/calendar/`
- `src/app/chat/`
- `src/app/faqs/`
- `src/app/landing/`
- `src/app/mail/`
- `src/app/pricing/`
- `src/app/tasks/`
- `src/app/users/`

### Variantes de formulaires d'authentification dans `src/app/auth` :

- `src/app/auth/forgot-password-2/`
- `src/app/auth/forgot-password-3/`
- `src/app/auth/sign-in-2/`
- `src/app/auth/sign-in-3/`
- `src/app/auth/sign-up-2/`
- `src/app/auth/sign-up-3/`

### Fichiers de données statiques :

- Tous les fichiers `.json` situés dans les sous-répertoires `data/` des fonctionnalités supprimées.
- `src/app/dashboard-2/data/dashboard-data.json` (sera remplacé par un appel API).

## 2. Fichiers et Répertoires à Adapter

Ces éléments constituent la base de notre nouvelle application.

### `src/config/routes.tsx`

- **Action :** Supprimer toutes les routes liées aux fonctionnalités supprimées.
- **Action :** Renommer la route `/dashboard-2` en `/dashboard`.
- **Action :** Ajouter les futures routes de WashPilot_CI (ex: `/washes`, `/cash-drawer`).

### `src/app/dashboard-2/`

- **Action :** Renommer le répertoire en `src/app/dashboard/`.
- **Action :** Adapter les composants (`MetricsOverview`, `RecentTransactions`, `SalesChart`) pour qu'ils affichent les données de WashPilot_CI (nombre de lavages, chiffre d'affaires, etc.).
- **Action :** Remplacer les appels aux données statiques par des appels à l'API (via TanStack Query).

### `src/app/settings/`

- **Action :** Conserver la structure.
- **Action :** Adapter la page `billing` pour qu'elle corresponde à la gestion des abonnements de WashPilot_CI.
- **Action :** Simplifier ou supprimer les pages non nécessaires pour le MVP (ex: `connections`).

### `src/app/auth/`

- **Action :** Conserver uniquement les répertoires `forgot-password`, `sign-in`, et `sign-up`.
- **Action :** Intégrer les composants de Clerk pour gérer la logique d'authentification, en remplacement des formulaires statiques.

### `src/components/app-sidebar.tsx`

- **Action :** Mettre à jour les liens de navigation pour correspondre aux fonctionnalités de WashPilot_CI :
  - Tableau de bord
  - Lavages
  - Caisse
  - Dépenses
  - Rapports
  - Équipe
  - Paramètres

### `src/components/command-search.tsx`

- **Action :** Mettre à jour les commandes de recherche pour refléter la nouvelle navigation.

## 3. Fichiers et Répertoires à Créer

Ces nouveaux modules contiendront la logique métier de WashPilot_CI.

### Structure de base :

- `docs/DATABASE.md` : Documentation du schéma de la base de données.
- `backend/` : Répertoire racine pour le projet Go.

### Nouvelles fonctionnalités dans `src/app` :

- `src/app/onboarding/` : Pour le processus d'inscription et de configuration de l'entreprise.
- `src/app/washes/` : Pour l'enregistrement et la consultation de l'historique des lavages.
- `src/app/cash-drawer/` : Pour la gestion des sessions de caisse.
- `src/app/expenses/` : Pour l'enregistrement des dépenses.
- `src/app/reports/` : Pour l'affichage des rapports.
- `src/app/team/` : Pour la gestion des employés.

### Services et Hooks :

- `src/services/api-client.ts` : Un client centralisé pour les appels à l'API Go.
- `src/hooks/queries/` : Répertoire pour organiser les hooks de TanStack Query (ex: `useWashes.ts`, `useDashboardMetrics.ts`).
