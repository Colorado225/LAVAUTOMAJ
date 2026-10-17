# WashPilot CI — Todo List et Workflows

# NB : gader le design intcat mais adpater les contenu selon le contexte!!!!!!!!

Ce fichier traduit `PLAN.md` en une todo list actionnable, phase par phase, avec un workflow de vérification pour chaque tâche.

## Workflow standard (à appliquer à chaque tâche)

Pour chaque tâche, respecter l'ordre de la PARTIE 14 de `PLAN.md` :

1. [ ] Examiner l'existant (code, docs, migrations, routes)
2. [ ] Identifier les fichiers concernés
3. [ ] Décrire brièvement la modification prévue
4. [ ] Implémenter un lot cohérent
5. [ ] Exécuter les tests pertinents
6. [ ] Corriger les erreurs
7. [ ] Vérifier le build (`pnpm build` / `go build ./...`)
8. [ ] Mettre à jour la documentation (`docs/`, `docs/PROGRESS.md`)
9. [ ] Mettre à jour la checklist de progression (`docs/PROGRESS.md`)
10. [ ] Présenter les résultats et blocages

**Règle :** ne jamais cocher une tâche sur la seule base de la création d'un fichier. Preuve requise : test exécuté, build réussi, migration appliquée, ou parcours testé.

---

## PHASE 0 — Audit et cadrage

**Critère de validation :** aucune suppression majeure avant validation de ses dépendances ; rapport d'audit livré.

- [ ] 0.1 — Analyser le dépôt vite-version existant (inventaire pages, dépendances, composants)
  - Preuve : fichier d'inventaire produit
- [ ] 0.2 — Rédiger `docs/AUDIT_VITE_VERSION.md`
  - Preuve : document créé et relu
- [ ] 0.3 — Définir l'architecture cible (`docs/ARCHITECTURE.md`)
  - Preuve : architecture Next.js + React + TypeScript + Go + Neon + Clerk documentée
- [ ] 0.4 — Détailler le plan d'implémentation (`docs/ROADMAP.md`)
  - Preuve : roadmap ordonnée phase 0 à 7
- [ ] 0.5 — Lister les fichiers à conserver, migrer, adapter, supprimer ou différer
  - Preuve : liste explicite par fichier
- [ ] 0.6 — Schématiser les flux métier (diagramme)
  - Preuve : diagramme présent dans les docs
- [ ] 0.7 — Identifier les risques techniques
  - Preuve : liste des risques avec atténuation
- [ ] 0.8 — Préparer le plan de migration
  - Preuve : plan de migration écrit
- [ ] 0.9 — Définir les critères de validation de la phase 1
  - Preuve : critères listés et acceptés
- [ ] 0.10 — Livrer le rapport d'audit final (structure réelle, éléments à conserver/supprimer/migrer, risques, architecture cible, plan ordonné, critères de validation phase 1)
  - Preuve : rapport présenté

---

## PHASE 1 — Fondations

**Critère de validation :** un utilisateur authentifié peut accéder uniquement aux ressources de son entreprise.

- [ ] 1.1 — Mettre en place la structure frontend et backend
- [ ] 1.2 — Configurer les environnements (dev, test, prod)
- [ ] 1.3 — Établir la connexion Neon
- [ ] 1.4 — Créer et appliquer la première migration SQL (utilisateurs, organisations)
- [ ] 1.5 — Vérifier les jetons Clerk côté backend
- [ ] 1.6 — Implémenter le modèle utilisateur et organisation
- [ ] 1.7 — Implémenter l'isolation multi-tenant
- [ ] 1.8 — Mettre en place la gestion des rôles (PLATFORM_ADMIN, OWNER, MANAGER, CASHIER, WASHER)
- [ ] 1.9 — Configurer la journalisation de base
- [ ] 1.10 — Créer les endpoints de santé (`GET /healthz`, `GET /readyz`)
- [ ] 1.11 — Écrire les tests d'isolation (utilisateur entreprise A ne voit pas les données entreprise B)
  - Preuve : tests d'isolation passent
- [ ] 1.12 — Mettre à jour `docs/PROGRESS.md` et `docs/DATABASE.md` (schéma relationnel, tables, colonnes, relations, index, contraintes, règles de suppression, stratégies d'isolation)
  - Preuve : docs à jour

---

## PHASE 2 — Interface et migration du template

**Critère de validation :** build réussi, navigation stable, aucun lien majeur cassé.

- [ ] 2.1 — Implémenter le layout principal
- [ ] 2.2 — Mettre en place la navigation principale (Tableau de bord, Lavages, Caisse, Dépenses, Rapports, Équipe, Paramètres)
- [ ] 2.3 — Créer les composants réutilisables
- [ ] 2.4 — Développer une première version du tableau de bord
- [ ] 2.5 — Assurer le design responsive (mobile-first)
- [ ] 2.6 — Gérer les états de chargement, d'erreur et de liste vide
- [ ] 2.7 — Intégrer les pages de connexion via Clerk
- [ ] 2.8 — Mettre en place la première version du système de permissions frontend
- [ ] 2.9 — Vérifier le build de production et l'absence de liens cassés
  - Preuve : `pnpm build` réussit, navigation testée

---

## PHASE 3 — Catalogue et lavages

**Critère de validation :** un lavage peut être enregistré, retrouvé, contrôlé et annulé sans corrompre l'historique. En cours : valider les tests sur une base jetable et compléter le cas d'annulation après paiement vérifié via le workflow de remboursement.

- [x] 3.1 — Catalogue des prestations : catalogue standard d'onboarding et création de prestations personnalisées depuis `/services`.
- [x] 3.2 — Catégories de véhicules : catégories de départ provisionnées, création disponible depuis `/vehicle-categories`.
- [x] 3.3 — Formulaire de nouveau lavage : site, catégorie, prestations/quantités, total, employés, moyen et montant reçu.
- [x] 3.4 — Historique des lavages avec recherche par les 200 opérations récentes.
- [x] 3.5 — Détail du lavage : snapshots, employés, paiements et motif d'annulation.
- [x] 3.6 — Calcul du total backend à partir des prix catalogue figés au moment de la vente.
- [x] 3.7 — Enregistrement atomique du lavage, lignes, affectations, paiement et mouvement cash éventuel.
- [-] 3.8 — Annulation conservée dans l'historique; les paiements vérifiés doivent être remboursés avant annulation (workflow de remboursement à compléter).
- [x] 3.9 — Idempotence serveur par organisation et empreinte du payload; le frontend réutilise la même clé lors d'une reprise.
- [-] 3.10 — Tests ajoutés pour les snapshots, doubles envois, annulation et règles d'entrée; exécution en attente d'un environnement Go/PostgreSQL.
  - Preuve : `backend/internal/stores/wash_store_test.go`, `backend/cmd/server/washes_test.go`; non exécutés dans cet environnement.

---

## PHASE 4 — Paiements et caisse

**Critère de validation :** montants du rapport, encaissements et solde de caisse correspondent aux mêmes opérations sources sans double comptabilisation.

- [ ] 4.1 — Enregistrer les paiements multiples si nécessaire
- [ ] 4.2 — Gérer les sessions de caisse (ouverture, clôture)
- [ ] 4.3 — Suivre les mouvements de caisse
- [ ] 4.4 — Calculer et afficher les écarts de caisse (solde théorique = solde initial + entrées - sorties)
- [ ] 4.5 — Enregistrer les dépenses (eau, électricité, produits, loyer, entretien, réparations, transport, autres)
- [ ] 4.6 — Afficher l'historique des opérations financières
- [ ] 4.7 — Règles : paiement électronique n'ajoute pas à la caisse physique ; dépense en espèces imputée à une session produit une sortie cohérente
- [ ] 4.8 — Tests : paiement électronique ne modifie pas la caisse physique ; dépense en espèces affecte la caisse ; clôture calcule l'écart ; session clôturée ne peut être modifiée sans procédure autorisée
  - Preuve : tests passent

---

## PHASE 5 — Rapports et équipe

**Critère de validation :** chaque indicateur possède une définition documentée et des tests de calcul.

- [ ] 5.1 — Générer les rapports journaliers
- [ ] 5.2 — Générer les rapports par période (hebdomadaire, mensuel)
- [ ] 5.3 — Analyser la répartition des prestations
- [ ] 5.4 — Suivre la performance des employés (indicateurs par période)
- [ ] 5.5 — Ajouter des filtres (période, site selon permissions)
- [ ] 5.6 — Permettre l'export CSV (selon forfait et permissions)
- [ ] 5.7 — Gérer les collaborateurs (fiche employé, nom, téléphone, statut, prestations réalisées)
- [ ] 5.8 — Tests : rapport respecte le filtre de période et site ; ventes annulées exclues des ventes actives
  - Preuve : tests de calcul passent, définitions documentées

---

## PHASE 6 — Abonnements et entitlements

**Critère de validation :** un forfait ne peut pas être contourné en appelant directement l'API.

- [ ] 6.1 — Gérer le catalogue des offres (Free, Pro, Business)
- [ ] 6.2 — Gérer l'abonnement par entreprise
- [ ] 6.3 — Vérifier les droits d'accès aux fonctionnalités (entitlements) côté backend à chaque opération protégée
- [ ] 6.4 — Mettre en place le paiement manuel avec validation par administrateur
- [ ] 6.5 — Historiser les changements d'abonnement
- [ ] 6.6 — Gérer l'expiration des abonnements (trialing, active, past_due, cancelled, expired ; période de grâce configurable)
- [ ] 6.7 — Interface de changement de forfait
- [ ] 6.8 — Tests : abonnement expiré ne permet pas les fonctionnalités payantes protégées ; changement de forfait prend effet selon les règles documentées
  - Preuve : tests d'entitlement passent

---

## PHASE 7 — Pilote et production

**Critère de validation :** le produit est utilisable par une petite station pilote, opérations essentielles fonctionnent sans données fictives ni contournements.

- [ ] 7.1 — Créer un jeu de données de test
- [ ] 7.2 — Définir et exécuter le parcours de test complet
- [ ] 7.3 — Exécuter les tests de permissions (multi-tenant)
- [ ] 7.4 — Exécuter les tests de calcul financier
- [ ] 7.5 — Exécuter les tests responsive
- [ ] 7.6 — Exécuter les tests E2E
- [ ] 7.7 — Configurer l'environnement de production (Next.js + Go + Neon + Clerk + HTTPS)
- [ ] 7.8 — Mettre en place la gestion sécurisée des secrets
- [ ] 7.9 — Rédiger la documentation de déploiement
- [ ] 7.10 — Documenter la procédure de sauvegarde et restauration
- [ ] 7.11 — Mettre en place le suivi des erreurs (logs structurés sans secrets)
- [ ] 7.12 — Rédiger le guide utilisateur en français
- [ ] 7.13 — Fournir `.env.example` sans secrets et documenter les commandes (install, lancer frontend/backend, migrations, tests, build, déployer, diagnostiquer)
  - Preuve : environnement vierge fonctionne, tests et migrations passent

---

## Parties transversales (à maintenir tout au long)

### Sécurité et intégrité financière (PARTIE 10)

- [ ] Authentification vérifiée côté backend
- [ ] Autorisation par rôle et ressource
- [ ] Validation des entrées
- [ ] Requêtes SQL paramétrées
- [ ] Gestion sécurisée des secrets
- [ ] Protection contre les soumissions répétées
- [ ] Limitation de débit sur les endpoints sensibles
- [ ] Journal d'audit pour les actions critiques (`audit_logs`)
- [ ] Transactions SQL pour les opérations financières
- [ ] Empêcher les doubles encaissements accidentels
- [ ] Empêcher la modification silencieuse des opérations clôturées
- [ ] Enregistrer l'auteur et la date de chaque action sensible
- [ ] Procédure d'annulation contrôlée
- [ ] Pas de suppression en cascade destructive de l'historique financier
- [ ] CORS limité aux origines autorisées

### Modèle de données (PARTIE 6)

Tables à créer : `users`, `organizations`, `organization_members`, `sites`, `invitations`, `service_categories`, `services`, `vehicle_categories`, `customers`, `washes`, `wash_items`, `wash_assignments`, `payments`, `refunds`, `cash_sessions`, `cash_movements`, `expenses`, `expense_categories`, `plans`, `subscriptions`, `subscription_payments`, `subscription_events`, `audit_logs`, `idempotency_keys`, `organization_settings`

- [ ] UUID ou identifiants adaptés
- [ ] `organization_id` sur les entités métier isolées
- [ ] `site_id` sur les opérations rattachées à une station
- [ ] Clés étrangères définies
- [ ] Index sur colonnes de recherche et filtres fréquents
- [ ] Contraintes d'unicité pour les références métier
- [ ] Dates cohérentes avec conversion fuseau d'affichage (Africa/Abidjan)
- [ ] Champs de création et de modification
- [ ] Historique d'audit pour les opérations sensibles

### API REST Go (PARTIE 7)

Endpoints à implémenter :

- [ ] `GET /healthz`, `GET /readyz`, `GET /api/v1/me`
- [ ] `GET /api/v1/organizations/current`, `PATCH /api/v1/organizations/current`
- [ ] `GET /api/v1/sites`, `POST /api/v1/sites`, `PATCH /api/v1/sites/{siteID}`
- [ ] `GET /api/v1/services`, `POST /api/v1/services`, `PATCH /api/v1/services/{serviceID}`, `POST /api/v1/services/{serviceID}/deactivate`
- [ ] `GET /api/v1/washes`, `POST /api/v1/washes`, `GET /api/v1/washes/{washID}`, `POST /api/v1/washes/{washID}/cancel`
- [ ] `POST /api/v1/washes/{washID}/payments`, `GET /api/v1/payments`
- [ ] `POST /api/v1/cash-sessions/open`, `GET /api/v1/cash-sessions/current`, `POST /api/v1/cash-sessions/{sessionID}/movements`, `POST /api/v1/cash-sessions/{sessionID}/close`
- [ ] `GET /api/v1/expenses`, `POST /api/v1/expenses`, `GET /api/v1/expenses/{expenseID}`, `POST /api/v1/expenses/{expenseID}/cancel`
- [ ] `GET /api/v1/employees`, `POST /api/v1/employees`
- [ ] `GET /api/v1/reports/summary`, `GET /api/v1/reports/daily`, `GET /api/v1/reports/services`, `GET /api/v1/reports/employees`
- [ ] `GET /api/v1/subscription`, `GET /api/v1/plans`, `POST /api/v1/subscription/change-plan`, `POST /api/v1/subscription/cancel`
- [ ] Pagination pour les listes volumineuses
- [ ] Validation backend pour chaque endpoint
- [ ] Rôle autorisé, format de réponse, erreurs métier, règles d'isolation, tests pour chaque endpoint

### Abonnements (PARTIE 8)

- [ ] Offre Free (découverte) : une entreprise, un site, un utilisateur propriétaire
- [ ] Offre Pro (~5 000 FCFA/mois) : historique étendu, rapports détaillés, clôture de caisse, plusieurs employés, export
- [ ] Offre Business (15 000–25 000 FCFA/mois) : plusieurs sites, consolidation, comparaison, permissions avancées
- [ ] Matrice d'entitlements : `sites.multiple`, `reports.advanced`, `reports.export`, `employees.advanced`, `cash.reconciliation`, `audit.advanced`, `analytics.consolidated`
- [ ] Cycle de vie : trialing, active, past_due, cancelled, expired
- [ ] Paiement initial : validation manuelle par l'administrateur, jamais confirmé sur simple référence utilisateur

### Design UX/UI (PARTIE 9)

- [ ] Référence visuelle Gentelella adaptée à une application métier moderne
- [ ] Mode clair prioritaire
- [ ] Écran mobile de nouveau lavage (action rapide, bouton principal visible, catégories lisibles, total automatique, paiement facile, validation explicite, confirmation)
- [ ] États d'interface : chargement, liste vide, erreur réseau, erreur validation, permission insuffisante, fonctionnalité indisponible selon forfait, succès confirmé, double soumission évitée, session expirée

### Tests obligatoires (PARTIE 12)

- [ ] Utilisateur non authentifié ne peut pas accéder aux données privées
- [ ] Utilisateur entreprise A ne peut pas consulter données entreprise B
- [ ] Employé ne peut pas exécuter opérations réservées au propriétaire
- [ ] Prix modifié ne change pas les anciens lavages
- [ ] Double envoi ne crée pas deux ventes accidentelles
- [ ] Paiement électronique ne modifie pas la caisse physique
- [ ] Dépense en espèces affecte correctement la caisse concernée
- [ ] Clôture calcule correctement l'écart
- [ ] Session clôturée ne peut pas être modifiée sans procédure autorisée
- [ ] Lavage annulé exclu des indicateurs de ventes actives
- [ ] Abonnement expiré ne permet pas les fonctionnalités payantes protégées
- [ ] Changement de forfait prend effet conformément aux règles documentées
- [ ] Rapport respecte le filtre de période et le site sélectionné
- [ ] Erreurs API affichées correctement dans l'interface
- [ ] Build de production ne dépend pas de données de démonstration
- [ ] Tests et migrations fonctionnent sur environnement vierge
- [ ] Événements Clerk traités plusieurs fois ne créent pas de doublons métier
- [ ] Erreurs ou interruptions de connexion ne provoquent pas de confirmations trompeuses

### Définition de « terminé » (PARTIE 15)

Une fonctionnalité est terminée seulement si :

- [ ] Parcours utilisateur implémenté
- [ ] Interface responsive
- [ ] API fonctionnelle
- [ ] Validations appliquées côté serveur
- [ ] Permissions contrôlées
- [ ] Données réellement persistées
- [ ] Erreurs gérées
- [ ] Tests critiques passent
- [ ] Documentation mise à jour
- [ ] Effets sur les abonnements appliqués côté backend
- [ ] Données d'une autre entreprise jamais accessibles
- [ ] Aucun secret exposé
- [ ] Aucun bouton essentiel ne simule une action
- [ ] Build correspondant réussit

---

## Statuts utilisés dans `docs/PROGRESS.md`

- `[ ]` À faire
- `[-]` En cours
- `[x]` Terminé et vérifié
- `[!]` Bloqué ou nécessitant une décision
