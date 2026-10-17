# Audit du Template Shadcn UI

Ce document analyse la structure du template Vite + React + Shadcn UI existant et propose une stratégie pour sa transformation en l'application SaaS "WashPilot_CI".

## 1. Analyse de la Structure Actuelle

Le projet est basé sur un template riche en fonctionnalités, organisé de manière modulaire.

### 1.1. Organisation Générale (`src/app`)

- **Structure par Fonctionnalité :** Le code est majoritairement organisé par fonctionnalité (ex: `app/dashboard-2`, `app/calendar`, `app/tasks`). C'est une excellente base que nous conserverons.
- **Contenu d'une Fonctionnalité :** Chaque module contient généralement :
  - `components/` : Des composants React spécifiques à la fonctionnalité.
  - `data/` : Des données statiques (`.json`) utilisées pour la démonstration.
  - `page.tsx` : Le point d'entrée de la route, qui assemble les composants.

### 1.2. Routing (`src/config/routes.tsx`)

- **Centralisé :** La gestion des routes est centralisée, ce qui facilite la maintenance. Nous garderons ce fichier pour définir les routes de WashPilot_CI.
- **Lazy Loading :** Le template utilise le chargement paresseux (`lazy`) pour les pages, ce qui est une bonne pratique de performance.

### 1.3. Composants UI (`src/components`)

- **`ui/` :** Contient les composants de base de la bibliothèque Shadcn UI (Button, Card, Input, etc.). Ces composants seront la base de notre système de design.
- **Composants Spécifiques :** Le répertoire racine `components/` contient des éléments plus complexes comme la barre latérale (`app-sidebar.tsx`) et la recherche (`command-search.tsx`). Nous les adapterons ou les remplacerons.

### 1.4. Données et État

- **Données Statiques :** Le template repose massivement sur des fichiers `.json` pour simuler des données. **Toutes ces données devront être supprimées et remplacées par des appels à l'API Go.**
- **Gestion d'état :** La gestion de l'état est principalement locale aux composants ou via des hooks React simples. Pour une application complexe comme WashPilot_CI, nous devrons évaluer si un gestionnaire d'état global (comme Zustand ou Redux Toolkit) est nécessaire, bien que les hooks et le cache de requêtes (comme TanStack Query) soient souvent suffisants.

### 1.5. Authentification (`src/app/auth`)

- **Multiples Exemples :** Le projet fournit de nombreux exemples de formulaires. C'est utile pour la référence visuelle, mais crée de la redondance.
- **Action à Mener :** Nous devrons unifier ces formulaires et les intégrer avec Clerk pour l'authentification, comme spécifié dans le `PLAN.md`.

## 2. Stratégie de Migration

L'objectif n'est pas de tout supprimer, mais de transformer intelligemment ce template.

### 2.1. Fichiers à Supprimer

Nous allons supprimer la majorité des fonctionnalités de démo qui ne sont pas pertinentes pour WashPilot_CI. Cela simplifiera grandement la base de code.

- **Répertoires à supprimer dans `src/app` :**
  - `calendar/`
  - `chat/`
  - `faqs/`
  - `landing/`
  - `mail/`
  - `pricing/`
  - `tasks/`
  - `users/`
- **Nettoyage des routes :** Les routes correspondantes seront supprimées de `src/config/routes.tsx`.

### 2.2. Fichiers à Adapter

Certains éléments du template sont une excellente base pour WashPilot_CI.

- **`app/dashboard-2/` :** Servira de base pour le tableau de bord principal de WashPilot_CI. Les composants de métriques, de graphiques et de transactions récentes sont très pertinents.
- **`app/settings/` :** La structure des pages de paramètres (Compte, Apparence, Facturation) est un bon point de départ.
- **`app/auth/` :** Nous conserverons un seul style de formulaire (par exemple, `sign-in`, `sign-up`, `forgot-password`) et supprimerons les variantes (`-2`, `-3`).
- **`components/ui/` :** Sera conservé comme notre bibliothèque de composants de base.
- **`components/layouts/` et `components/router/` :** Le layout principal (`base-layout.tsx`) et la structure de routage (`root-layout.tsx`) seront adaptés.
- **`components/app-sidebar.tsx` et `components/command-search.tsx` :** Seront adaptés pour refléter la navigation de WashPilot_CI (Tableau de bord, Lavages, Caisse, etc.).

### 2.3. Fichiers à Créer

Nous créerons de nouveaux répertoires dans `src/app` pour les fonctionnalités spécifiques de WashPilot_CI, en suivant la structure existante :

- `app/onboarding/` (pour la création de l'entreprise)
- `app/washes/` (pour l'enregistrement et l'historique des lavages)
- `app/cash-drawer/` (pour la gestion de la caisse)
- `app/expenses/` (pour les dépenses)
- `app/reports/` (pour les rapports)
- `app/team/` (pour la gestion des employés)

## 3. Conclusion de l'Audit

Le template est une base technique solide. La stratégie consiste à :

1.  **Élaguer :** Supprimer toutes les fonctionnalités de démo non pertinentes.
2.  **Adapter :** Modifier les composants et layouts de base (dashboard, sidebar, settings) pour les besoins de WashPilot_CI.
3.  **Construire :** Développer les nouvelles fonctionnalités métier (lavages, caisse, etc.) en s'appuyant sur la structure et les composants existants.

Cette approche progressive nous permettra de bénéficier de la qualité du template tout en construisant une application ciblée et maintenable.
