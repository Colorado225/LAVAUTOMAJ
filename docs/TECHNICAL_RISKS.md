# Risques Techniques et Stratégies d'Atténuation

Ce document identifie les principaux risques techniques du projet WashPilot_CI et propose des mesures pour les gérer.

## 1. Intégrité des Données Financières

- **Risque :** Des erreurs de calcul, des doubles comptages ou des pertes de données dans les transactions financières (lavages, paiements, dépenses, caisse) pourraient rendre l'application inutilisable et détruire la confiance des clients.
- **Stratégie d'atténuation :**
  - **Transactions SQL :** Utiliser systématiquement des transactions de base de données pour les opérations qui modifient plusieurs tables (ex: un lavage + un paiement).
  - **Idempotence :** Mettre en place des clés d'idempotence pour les endpoints d'API critiques (création de lavage, paiement) afin d'éviter les doublons en cas de répétition de la requête réseau.
  - **Tests Rigoureux :** Écrire des tests unitaires et d'intégration spécifiques pour les calculs financiers (solde de caisse, écarts, totaux de rapports).
  - **Audit Log :** Journaliser toutes les opérations financières sensibles pour permettre une traçabilité complète.
  - **Soft Deletes :** Ne jamais supprimer physiquement les enregistrements financiers. Utiliser une suppression logique (ex: un statut `cancelled`) pour conserver l'historique.

## 2. Sécurité et Isolation Multi-Tenant

- **Risque :** Une faille dans l'isolation des données pourrait permettre à un utilisateur de l'entreprise A de voir ou de modifier les données de l'entreprise B. C'est le risque le plus critique pour un SaaS.
- **Stratégie d'atténuation :**
  - **Contrôle Systématique au Backend :** Chaque requête à l'API Go doit valider le jeton Clerk et extraire l'`organization_id`. Cet ID doit être utilisé comme filtre (`WHERE organization_id = ?`) dans **chaque requête SQL** qui lit ou écrit des données métier.
  - **Pas de Confiance au Frontend :** Ne jamais se fier à un `organization_id` envoyé par le client dans le corps d'une requête. La seule source de vérité est le jeton d'authentification.
  - **Tests d'Intrusion :** Mettre en place des tests automatisés qui tentent explicitement d'accéder à des ressources appartenant à une autre organisation pour s'assurer que l'accès est bien refusé.
  - **Permissions par Rôle :** Appliquer une vérification des rôles (Owner, Manager, Cashier) côté backend pour chaque action.

## 3. Intégration avec les Services Tiers

- **Risque :** Une dépendance excessive ou une mauvaise intégration avec Clerk ou Neon pourrait causer des pannes ou des comportements inattendus.
- **Stratégie d'atténuation :**
  - **Clerk :**
    - **Webhooks :** Gérer les webhooks de Clerk de manière asynchrone et idempotente pour synchroniser les utilisateurs et les organisations. Prévoir les cas où un webhook pourrait être reçu plusieurs fois.
    - **Déconnexion :** Avoir une stratégie claire si l'API de Clerk est indisponible (ex: afficher un message d'erreur clair, empêcher les nouvelles connexions mais maintenir les sessions actives si possible).
  - **Neon :**
    - **Pool de Connexions :** Configurer correctement le pool de connexions dans l'API Go pour gérer efficacement la charge et éviter l'épuisement des connexions.
    - **Plan de Sauvegarde :** Bien que Neon gère les sauvegardes, comprendre et documenter la procédure de restauration en cas de problème majeur.

## 4. Performance à Grande Échelle

- **Risque :** L'application pourrait devenir lente à mesure que le volume de données (lavages, transactions) augmente.
- **Stratégie d'atténuation :**
  - **Indexation de la Base de Données :** Définir des index pertinents sur les colonnes fréquemment utilisées dans les clauses `WHERE` et `JOIN` (ex: `organization_id`, `site_id`, `created_at`).
  - **Pagination :** Paginer toutes les listes renvoyées par l'API (historique des lavages, rapports, etc.) pour éviter de charger des milliers d'enregistrements en une seule fois.
  - **Requêtes Optimisées :** Analyser les requêtes SQL complexes avec `EXPLAIN ANALYZE` pour identifier et corriger les goulots d'étranglement.
  - **Mise en Cache Côté Client :** Utiliser TanStack Query pour mettre en cache les données côté frontend et réduire le nombre d'appels API redondants.

## 5. Complexité du Développement Frontend

- **Risque :** Le code frontend pourrait devenir difficile à maintenir si la gestion de l'état et la structure des composants ne sont pas bien définies.
- **Stratégie d'atténuation :**
  - **Structure Claire :** Maintenir une structure de projet par fonctionnalité.
  - **Hooks Réutilisables :** Encapsuler la logique d'appel API et la gestion de l'état du serveur dans des hooks réutilisables (ex: `useWashes`, `useCashSession`).
  - **Composants Atomiques :** Continuer à utiliser la philosophie de Shadcn UI en créant des composants de base réutilisables et bien définis.
  - **Revue de Code :** Mettre en place un processus de revue de code pour s'assurer que les nouvelles fonctionnalités suivent les conventions établies.
