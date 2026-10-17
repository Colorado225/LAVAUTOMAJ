# Architecture Technique de WashPilot_CI

Ce document définit l'architecture technique cible pour l'application SaaS WashPilot_CI.

## 1. Vue d'ensemble

WashPilot_CI sera construit sur une architecture moderne, découplée et évolutive, composée des éléments suivants :

- **Frontend :** Une Single-Page Application (SPA) construite avec **React (Vite)** et **TypeScript**, en utilisant la bibliothèque de composants **Shadcn UI**.
- **Backend :** Une API RESTful écrite en **Go (Golang)**, responsable de toute la logique métier, des autorisations et de la communication avec la base de données.
- **Base de données :** Une base de données PostgreSQL managée par **Neon**, qui offre une excellente scalabilité et des fonctionnalités serverless.
- **Authentification :** Un service d'identité managé, **Clerk**, pour gérer l'authentification des utilisateurs, les organisations et les invitations.

![Diagramme d'architecture simple](https://i.imgur.com/your-diagram-image.png)
_(Note : Un diagramme visuel sera ajouté pour illustrer cette architecture)_

## 2. Frontend (React + Vite)

- **Framework :** Nous utiliserons le projet Vite existant comme base, en le transformant pour répondre aux besoins de WashPilot_CI.
- **Langage :** TypeScript sera utilisé pour assurer la robustesse et la maintenabilité du code.
- **UI :** Nous nous appuierons sur **Shadcn UI** pour construire une interface utilisateur cohérente et professionnelle. Les composants seront adaptés et étendus au besoin.
- **Gestion de l'état :**
  - **État du serveur :** **TanStack Query (React Query)** sera utilisé pour gérer l'état du serveur (données de l'API). Il prendra en charge le cache, la synchronisation en arrière-plan et la mise à jour des données, ce qui est crucial pour une application dynamique.
  - **État local/global :** Pour l'état de l'interface (ex: état d'un formulaire complexe, ouverture/fermeture d'une modale), nous utiliserons les hooks React (`useState`, `useContext`). Si un état global plus complexe s'avère nécessaire, **Zustand** sera envisagé pour sa simplicité et sa performance.
- **Routage :** **React Router** restera le routeur principal, configuré de manière centralisée.
- **Communication API :** Les appels à l'API Go se feront via des requêtes `fetch` encapsulées dans les fonctions de TanStack Query. Un client API (type `axios` ou un wrapper simple) pourra être créé pour centraliser la configuration (headers, gestion des erreurs).

## 3. Backend (Go)

- **Langage :** Go a été choisi pour sa performance, sa simplicité et sa robustesse, ce qui est idéal pour une API métier.
- **Framework :** Nous utiliserons un routeur HTTP léger et performant comme `chi` ou `gorilla/mux`, ainsi que la bibliothèque standard `net/http`.
- **Structure du projet :** Le projet suivra une organisation en couches (Domain-Driven Design) pour séparer clairement les préoccupations :
  - `cmd/` : Points d'entrée de l'application (serveur API).
  - `internal/` :
    - `api/` ou `handler/` : Gestionnaires HTTP, validation des requêtes.
    - `service/` ou `usecase/` : Logique métier principale.
    - `repository/` ou `storage/` : Accès à la base de données.
    - `domain/` : Modèles de données et règles métier pures.
- **Communication avec la base de données :** Nous utiliserons la bibliothèque `pgx` pour interagir avec la base de données PostgreSQL. Les migrations SQL seront gérées avec un outil comme `golang-migrate/migrate`.
- **API :** L'API sera versionnée (ex: `/api/v1`) et suivra les principes REST. Les réponses seront au format JSON.

## 4. Base de données (PostgreSQL sur Neon)

- **SGBD :** PostgreSQL est un choix robuste et éprouvé pour les applications relationnelles.
- **Hébergement :** Neon offre une solution serverless pour PostgreSQL, ce qui simplifie la gestion de l'infrastructure, les sauvegardes et la scalabilité.
- **Modèle de données :** Le modèle de données suivra les spécifications de `PLAN.md`, avec une attention particulière à l'isolation multi-tenant (toutes les tables métier auront une colonne `organization_id`).
- **Schéma :** Un document `docs/DATABASE.md` sera créé pour détailler le schéma relationnel, les tables, les colonnes et les contraintes.

## 5. Authentification (Clerk)

- **Rôle :** Clerk gérera tout le cycle de vie de l'authentification : inscription, connexion, gestion des sessions, authentification multi-facteurs (MFA).
- **Intégration Frontend :** Le SDK React de Clerk sera utilisé pour protéger les routes, accéder aux informations de l'utilisateur et afficher les composants d'UI (formulaires de connexion, bouton utilisateur).
- **Intégration Backend :** Le backend Go validera les JSON Web Tokens (JWT) fournis par Clerk à chaque requête API. Un middleware sera mis en place pour extraire l'ID de l'utilisateur et l'ID de l'organisation du jeton, garantissant que chaque requête est authentifiée et autorisée.
- **Multi-tenancy :** Nous utiliserons la fonctionnalité "Organizations" de Clerk pour gérer les entreprises clientes, les membres et les rôles, ce qui s'intègre parfaitement à notre architecture multi-tenant.

## 6. Déploiement

- **Frontend :** L'application React sera déployée sur un hébergeur de sites statiques moderne comme **Vercel** ou **Netlify**.
- **Backend :** L'API Go sera conteneurisée avec **Docker** et déployée sur un service comme **Google Cloud Run**, **AWS Fargate**, ou un autre service d'hébergement de conteneurs.
- **CI/CD :** Une pipeline de CI/CD (par exemple, avec GitHub Actions) sera mise en place pour automatiser les tests, la construction des images Docker et le déploiement.
