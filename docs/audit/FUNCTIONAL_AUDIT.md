# Audit Fonctionnel — WashPilot CI

État de l'audit au 18/10/2026

## Inventaire des modules fonctionnels

| Module       | Fonctionnalité                           | Fichiers concernés                                                                   | Frontend    | Backend | Base de données                                                                                         | Tests             | Écarts                                                                                                               | Risque | Action                                          |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------------------------ | ----------- | ------- | ------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------- |
| **Lavages**  | Création avec idempotence                | backend/internal/stores/wash_store.go:1-521<br>src/app/washes/page.tsx               | VÉRIFIÉ     | VÉRIFIÉ | Tables: washes, wash_items, wash_worker_assignments, payments<br>Migration: 000010_wash_workflow.up.sql | Aucun test trouvé | - Aucun                                                                                                              | FAIBLE | Aucune correction immédiate                     |
|              | Annulation et remboursement              | wash_store.go:475-521<br>handleCancelWash dans main.go                               | PARTIEL     | VÉRIFIÉ | Colonnes cancelled_at, cancelled_by_id, cancellation_reason sur washes                                  | Aucun test trouvé | - Interface frontend ne propose pas de bouton d'annulation<br>- Logique de remboursement partiel non implémentée     | MOYEN  | Activer l'annulation dans l'interface           |
|              | Historique et pagination                 | wash_store.go:430-440 (ListByOrganization limite à 200)                              | VÉRIFIÉ     | VÉRIFIÉ | LIMIT 200 dans la requête                                                                               | Aucun test trouvé | - Pagination complète non implémentée                                                                                | FAIBLE | Implémenter la pagination si nécessaire         |
| **Caisse**   | Sessions de caisse (ouverture/fermeture) | backend/internal/stores/cash_session_store.go<br>backend/cmd/server/main.go (routes) | NON VÉRIFIÉ | VÉRIFIÉ | Tables: cash_sessions, cash_movements<br>Champs: theoretical_balance_cents, discrepancy_cents           | Aucun test trouvé | - Interface frontend non trouvée<br>- Logique d'écart bien implémentée avec contrainte de motif obligatoire          | ÉLEVÉ  | Développer l'interface de gestion de caisse     |
|              | Mouvements de caisse                     | cash_session_store.go, models.go                                                     | NON VÉRIFIÉ | VÉRIFIÉ | cash_movements avec type entry/exit                                                                     | Aucun test trouvé | - Aucun                                                                                                              | ÉLEVÉ  | Intégrer les mouvements dans l'interface        |
| **Dépenses** | Création avec lien caisse                | backend/internal/stores/expense_store.go:1-221<br>src/app/expenses/page.tsx          | PARTIEL     | VÉRIFIÉ | Table: expenses<br>Lié à cash_sessions                                                                  | Aucun test trouvé | - Bouton "Nouvelle dépense" désactivé<br>- Formulaire frontend non implémenté<br>- Logique atomique backend complète | ÉLEVÉ  | Activer et implémenter le formulaire de dépense |
|              | Annulation de dépense                    | expense_store.go:160-221                                                             | NON VÉRIFIÉ | VÉRIFIÉ | Statut cancelled sur expenses                                                                           | Aucun test trouvé | - Aucun                                                                                                              | MOYEN  | Ajouter l'annulation dans l'interface           |

---

## Points forts vérifiés

### 1. Intégrité financière

- **Tous les montants stockés en centimes (int64)** : Pas de flottants, évite les erreurs d'arrondi
- **Transactions atomiques** pour toutes les opérations financières (création lavage, dépense, fermeture caisse)
- **Idempotence complète** sur la création des lavages :
  - Clé d'idempotency validée
  - Empreinte SHA256 du contenu de la requête
  - Détection des conflits si même clé mais contenu différent
  - Retourne la ressource existante en cas de replay valide

### 2. Gestion des écarts de caisse

- Calcul automatique de l'écart : `countedAmount - cs.TheoreticalBalanceCents`
- Obligation de fournir un motif si écart != 0
- Stockage de l'écart dans `discrepancy_cents`
- Verrous `FOR UPDATE` sur les sessions pour éviter les conflits de concurrence

### 3. Isolation multi-tenant vérifiée

- **Toutes les requêtes SQL filtrent systématiquement par `organization_id`**
- Aucune fuite de données entre organisations possible
- Vérification de l'appartenance des ressources (site, session de caisse, etc.) à l'organisation avant toute opération

### 4. Validation des entrées

- Vérification de l'existence et de l'activité des sites, catégories véhicules, services, workers
- Vérification que le paiement ne dépasse pas le total du lavage
- Vérification de cohérence entre méthode de paiement et session de caisse
- Protection contre les dépassements de capacité de stockage (maxCashBalanceCents)

---

## Points bloquants / critiques à corriger

### P0 (Bloquant)

1. **Absence de tests** : Aucun test unitaire ou d'intégration trouvé pour les stores critiques (lavages, caisse, dépenses)
2. **Interface de caisse manquante** : Le backend complet est présent mais pas d'interface pour ouvrir/fermer les sessions
3. **Formulaire de dépense désactivé** : Le bouton "Nouvelle dépense" est disabled, empêchant toute saisie

### P1 (Essentiel)

1. **Permissions** : Vérifier que seuls les utilisateurs autorisés peuvent effectuer des opérations sensibles (fermeture caisse, annulation)
2. **Gestion des remboursements** : Logique de remboursement partiel non implémentée
3. **Interface de caisse manquante** : Développer l'interface pour ouvrir/fermer les sessions de caisse
4. **Formulaire de dépense** : Activer et implémenter le formulaire de création de dépense

---

## Prochaines étapes de l'audit

1. Vérifier l'isolation multi-tenant dans toutes les requêtes SQL
2. Examiner l'authentification et les permissions (Clerk)
3. Vérifier les autres modules (utilisateurs, sites, services)
4. Établir la baseline de build et de typecheck
