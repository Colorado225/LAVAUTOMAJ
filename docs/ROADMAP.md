# Roadmap d'Implémentation de WashPilot_CI

Ce document résume les grandes phases de développement pour la création de l'application WashPilot_CI.

## PHASE 0 — Audit et Cadrage

**Objectif :** Définir les fondations techniques et fonctionnelles du projet.

- **Livrables :**
  - `docs/AUDIT_SHADCN_TEMPLATE.md` : Analyse du template existant.
  - `docs/ARCHITECTURE.md` : Définition de l'architecture technique cible.
  - `docs/ROADMAP.md` : Ce document.
  - `docs/DATABASE.md` : Schéma de la base de données.
  - Un plan de migration clair identifiant les fichiers à supprimer, adapter et créer.

## PHASE 1 — Fondations Techniques

**Objectif :** Mettre en place le squelette de l'application (frontend et backend) et assurer une isolation multi-tenant fonctionnelle.

- **Livrables :**
  - Structure des projets frontend (Vite) et backend (Go).
  - Connexion à la base de données Neon.
  - Première migration SQL (utilisateurs, organisations).
  - Intégration de Clerk pour l'authentification et la validation des jetons côté backend.
  - Tests d'isolation prouvant qu'un utilisateur de l'entreprise A ne peut pas accéder aux données de l'entreprise B.

## PHASE 2 — Interface et Migration du Template

**Objectif :** Transformer le template existant en une coquille fonctionnelle pour WashPilot_CI, avec une navigation et une mise en page adaptées.

- **Livrables :**
  - Layout principal de l'application avec la nouvelle barre de navigation.
  - Suppression des pages et composants de démo inutiles.
  - Adaptation du tableau de bord de base.
  - Intégration complète des pages de connexion/inscription de Clerk.

## PHASE 3 — Fonctionnalités Cœur : Catalogue et Lavages

**Objectif :** Développer la fonctionnalité la plus critique de l'application : l'enregistrement d'un lavage.

- **Livrables :**
  - API et interface pour gérer le catalogue des prestations.
  - Formulaire de création d'un nouveau lavage, fonctionnel sur mobile.
  - Historique des lavages avec possibilité de voir les détails.
  - Enregistrement transactionnel et protection contre les doubles soumissions.

## PHASE 4 — Gestion Financière : Caisse et Dépenses

**Objectif :** Permettre un suivi financier de base.

- **Livrables :**
  - Système de gestion des sessions de caisse (ouverture, clôture, calcul des écarts).
  - Module d'enregistrement des dépenses.
  - Historique des mouvements financiers.

## PHASE 5 — Analyse : Rapports et Équipe

**Objectif :** Fournir aux gérants les outils pour analyser leur activité.

- **Livrables :**
  - Rapports de base (journaliers, par période).
  - Indicateurs de performance par prestation et par employé.
  - Module de gestion simple des employés.

## PHASE 6 — Monétisation : Abonnements

**Objectif :** Mettre en place le système de gestion des abonnements.

- **Livrables :**
  - Catalogue des offres (Free, Pro, Business).
  - Protection des fonctionnalités par des contrôles d'entitlement côté backend.
  - Interface permettant de gérer son abonnement (avec paiement manuel pour le MVP).

## PHASE 7 — Lancement : Pilote et Production

**Objectif :** Préparer et lancer l'application pour un premier groupe d'utilisateurs pilotes.

- **Livrables :**
  - Environnement de production configuré et sécurisé.
  - Pipeline de déploiement continue (CI/CD).
  - Documentation complète (déploiement, sauvegarde, guide utilisateur).
  - Un produit testé, stable et prêt à être utilisé par les premiers clients.
