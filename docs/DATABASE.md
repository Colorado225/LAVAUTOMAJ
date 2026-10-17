# Schéma de la Base de Données — WashPilot CI

## Conventions de conception

- Identifiants : UUID (`gen_random_uuid()`)
- Toutes les entités métier isolées possèdent une colonne `organization_id`
- Les opérations rattachées à une station possèdent une colonne `site_id`
- Clés étrangères définies sur toutes les relations
- Index sur les colonnes de recherche et filtres fréquents (`organization_id`, `site_id`, `created_at`, `status`)
- Contraintes d'unicité sur les références métier
- Dates stockées en `TIMESTAMPTZ` (UTC), conversion dans le fuseau d'affichage `Africa/Abidjan` côté application
- Champs `created_at` et `updated_at` sur toutes les tables
- Suppression logique (statuts) plutôt que suppression en cascade pour l'historique financier

---

## 1. Identité et organisations

### organizations (entreprises clientes)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant de l'entreprise |
| clerk_org_id | VARCHAR(255) | UNIQUE, NOT NULL | Référence à l'organisation Clerk |
| name | VARCHAR(255) | NOT NULL | Nom commercial |
| plan | VARCHAR(50) | NOT NULL DEFAULT 'free' | Offre d'abonnement (free, pro, business) |
| subscription_status | VARCHAR(50) | NOT NULL DEFAULT 'trialing' | État de l'abonnement |
| timezone | VARCHAR(50) | NOT NULL DEFAULT 'Africa/Abidjan' | Fuseau horaire |
| default_currency | VARCHAR(3) | NOT NULL DEFAULT 'XOF' | Devise par défaut |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_organizations_clerk_org_id` (unique), `idx_organizations_plan`

### users (identité interne + référence Clerk)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant utilisateur |
| clerk_user_id | VARCHAR(255) | UNIQUE, NOT NULL | Référence à l'utilisateur Clerk |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise propriétaire |
| first_name | VARCHAR(100) | | Prénom |
| last_name | VARCHAR(100) | | Nom |
| email | VARCHAR(255) | UNIQUE, NOT NULL | Email |
| role | VARCHAR(50) | NOT NULL DEFAULT 'cashier' | Rôle (platform_admin, owner, manager, cashier, washer) |
| status | VARCHAR(50) | NOT NULL DEFAULT 'active' | Statut (active, invited, inactive) |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_users_organization_id`, `idx_users_clerk_user_id` (unique), `idx_users_email` (unique)

### organization_members (appartenance, rôle, périmètre)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise |
| user_id | UUID | NOT NULL, FK -> users.id | Utilisateur |
| role | VARCHAR(50) | NOT NULL | Rôle dans l'organisation |
| site_id | UUID | FK -> sites.id | Périmètre site (optionnel) |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_organization_members_organization_id`, `idx_organization_members_user_id`, `idx_organization_members_site_id`
Unique : `(user_id, organization_id)`

### sites (stations de lavage)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise propriétaire |
| name | VARCHAR(255) | NOT NULL | Nom de la station |
| address | TEXT | | Adresse / repère de localisation |
| city | VARCHAR(100) | | Ville |
| commune | VARCHAR(100) | | Commune |
| phone | VARCHAR(50) | | Téléphone |
| is_active | BOOLEAN | NOT NULL DEFAULT true | Statut actif |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_sites_organization_id`
Unique : `(organization_id, name)`

### invitations (invitations de collaborateurs)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise |
| email | VARCHAR(255) | NOT NULL | Email invité |
| role | VARCHAR(50) | NOT NULL | Rôle proposé |
| site_id | UUID | FK -> sites.id | Site assigné |
| token | VARCHAR(255) | UNIQUE, NOT NULL | Jeton d'invitation |
| accepted_at | TIMESTAMPTZ | | Date d'acceptation |
| expires_at | TIMESTAMPTZ | NOT NULL | Date d'expiration |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_invitations_organization_id`, `idx_invitations_token` (unique)

---

## 2. Catalogue et opérations

### service_categories

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise |
| name | VARCHAR(100) | NOT NULL | Nom de la catégorie |
| is_active | BOOLEAN | NOT NULL DEFAULT true | Statut |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_service_categories_organization_id`
Unique : `(organization_id, name)`

### services (prestations)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise |
| category_id | UUID | FK -> service_categories.id | Catégorie |
| name | VARCHAR(100) | NOT NULL | Nom de la prestation |
| price_cents | BIGINT | NOT NULL DEFAULT 0 | Prix en centimes XOF (entier) |
| duration_minutes | INTEGER | | Durée indicative |
| is_active | BOOLEAN | NOT NULL DEFAULT true | Statut actif/inactif |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_services_organization_id`, `idx_services_category_id`, `idx_services_is_active`
Unique : `(organization_id, name)`

### vehicle_categories

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise |
| name | VARCHAR(100) | NOT NULL | Nom de la catégorie |
| is_active | BOOLEAN | NOT NULL DEFAULT true | Statut |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_vehicle_categories_organization_id`
Unique : `(organization_id, name)`

### customers (facultatif dans le MVP)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise |
| name | VARCHAR(100) | NOT NULL | Nom du client |
| phone | VARCHAR(50) | | Téléphone |
| site_id | UUID | FK -> sites.id | Site habituel |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_customers_organization_id`

### washes (enregistrements de lavage)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise |
| site_id | UUID | FK -> sites.id | Station |
| vehicle_category_id | UUID | FK -> vehicle_categories.id | Catégorie du véhicule |
| customer_id | UUID | FK -> customers.id | Client (optionnel) |
| reference | VARCHAR(50) | UNIQUE, NOT NULL | Numéro de référence unique |
| total_cents | BIGINT | NOT NULL DEFAULT 0 | Montant total |
| status | VARCHAR(50) | NOT NULL DEFAULT 'completed' | Statut (completed, cancelled, pending) |
| payment_status | VARCHAR(50) | NOT NULL DEFAULT 'unpaid' | Statut paiement (unpaid, paid, partial, refunded) |
| author_id | UUID | NOT NULL, FK -> users.id | Auteur de l'opération |
| idempotency_key | VARCHAR(255) | UNIQUE | Clé d'idempotence |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_washes_organization_id`, `idx_washes_site_id`, `idx_washes_reference` (unique), `idx_washes_status`, `idx_washes_created_at`, `idx_washes_idempotency_key` (unique)

### wash_items (lignes de prestation vendues — snapshot prix/nom)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| wash_id | UUID | NOT NULL, FK -> washes.id ON DELETE CASCADE | Lavage |
| service_id | UUID | FK -> services.id | Prestation (référence catalogue) |
| service_name_snapshot | VARCHAR(100) | NOT NULL | Nom figé au moment de la vente |
| price_cents_snapshot | BIGINT | NOT NULL | Prix figé en centimes XOF |
| quantity | INTEGER | NOT NULL DEFAULT 1 | Quantité |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_wash_items_wash_id`, `idx_wash_items_service_id`

### wash_assignments (attribution aux employés)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| wash_id | UUID | NOT NULL, FK -> washes.id ON DELETE CASCADE | Lavage |
| user_id | UUID | NOT NULL, FK -> users.id | Employé laveur |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_wash_assignments_wash_id`, `idx_wash_assignments_user_id`
Unique : `(wash_id, user_id)`

### payments (encaissements associés)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise |
| wash_id | UUID | FK -> washes.id | Lavage lié (optionnel) |
| amount_cents | BIGINT | NOT NULL | Montant en centimes XOF |
| method | VARCHAR(50) | NOT NULL | Moyen (cash, orange_money, mtn_momo, moov_money, wave, other) |
| status | VARCHAR(50) | NOT NULL DEFAULT 'pending' | Statut (pending, verified, failed, refunded) |
| reference | VARCHAR(100) | | Référence de transaction |
| received_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | Date/heure de réception |
| author_id | UUID | NOT NULL, FK -> users.id | Auteur |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_payments_organization_id`, `idx_payments_wash_id`, `idx_payments_status`, `idx_payments_created_at`, `idx_payments_method`

### refunds (remboursements — workflow futur)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| payment_id | UUID | NOT NULL, FK -> payments.id | Paiement remboursé |
| amount_cents | BIGINT | NOT NULL | Montant remboursé |
| reason | TEXT | | Motif |
| author_id | UUID | NOT NULL, FK -> users.id | Auteur |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_refunds_payment_id`

---

## 3. Finances

### cash_sessions (sessions de caisse)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise |
| site_id | UUID | NOT NULL, FK -> sites.id | Station |
| user_id | UUID | NOT NULL, FK -> users.id | Ouvrant de session |
| opening_amount_cents | BIGINT | NOT NULL DEFAULT 0 | Montant initial |
| theoretical_balance_cents | BIGINT | NOT NULL DEFAULT 0 | Solde théorique calculé |
| counted_amount_cents | BIGINT | | Montant réellement compté |
| discrepancy_cents | BIGINT | | Écart de caisse |
| discrepancy_reason | TEXT | | Motif si écart non nul |
| status | VARCHAR(50) | NOT NULL DEFAULT 'open' | Statut (open, closed) |
| opened_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| closed_at | TIMESTAMPTZ | | Date de clôture |
| closed_by_id | UUID | FK -> users.id | Personne ayant clôturé |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_cash_sessions_organization_id`, `idx_cash_sessions_site_id`, `idx_cash_sessions_status`, `idx_cash_sessions_opened_at`
Règle : une seule session ouverte par site à un instant t (contrainte d'application côté backend)

### cash_movements (mouvements de caisse)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise |
| cash_session_id | UUID | NOT NULL, FK -> cash_sessions.id | Session de caisse |
| type | VARCHAR(20) | NOT NULL | Type (entry, exit) |
| amount_cents | BIGINT | NOT NULL | Montant en centimes XOF |
| source | VARCHAR(50) | NOT NULL | Source (wash_payment, expense, manual_entry, manual_exit) |
| reference_id | UUID | | Référence vers l'opération source |
| description | TEXT | | Description |
| author_id | UUID | NOT NULL, FK -> users.id | Auteur |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_cash_movements_organization_id`, `idx_cash_movements_cash_session_id`, `idx_cash_movements_type`, `idx_cash_movements_created_at`
Règle : comptabilisé exactement une fois (idempotence)

### expenses (dépenses)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise |
| site_id | UUID | FK -> sites.id | Station |
| category | VARCHAR(100) | NOT NULL | Catégorie (eau, électricité, produits, loyer, entretien, réparations, transport, autre) |
| amount_cents | BIGINT | NOT NULL | Montant en centimes XOF |
| expense_date | DATE | NOT NULL | Date de la dépense |
| payment_method | VARCHAR(50) | NOT NULL | Moyen de paiement |
| beneficiary | VARCHAR(100) | | Bénéficiaire / fournisseur |
| description | TEXT | | Description |
| author_id | UUID | NOT NULL, FK -> users.id | Auteur |
| reference | VARCHAR(100) | | Référence / justificatif |
| status | VARCHAR(50) | NOT NULL DEFAULT 'recorded' | Statut (recorded, cancelled) |
| cash_session_id | UUID | FK -> cash_sessions.id | Session de caisse si payée en espèces |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_expenses_organization_id`, `idx_expenses_site_id`, `idx_expenses_category`, `idx_expenses_expense_date`, `idx_expenses_status`, `idx_expenses_cash_session_id`

### expense_categories

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise |
| name | VARCHAR(100) | NOT NULL | Nom de la catégorie |
| is_active | BOOLEAN | NOT NULL DEFAULT true | Statut |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_expense_categories_organization_id`
Unique : `(organization_id, name)`

---

## 4. Abonnements

### plans (catalogue des offres)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| name | VARCHAR(50) | NOT NULL | Nom (free, pro, business) |
| price_cents_month | BIGINT | NOT NULL | Prix mensuel en centimes XOF |
| features | JSONB | NOT NULL DEFAULT '{}' | Liste des clés d'entitlement |
| max_sites | INTEGER | NOT NULL DEFAULT 1 | Nombre max de sites |
| max_users | INTEGER | NOT NULL DEFAULT 1 | Nombre max d'utilisateurs |
| is_active | BOOLEAN | NOT NULL DEFAULT true | Statut |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_plans_name` (unique)

### subscriptions (abonnement par entreprise)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise |
| plan_id | UUID | NOT NULL, FK -> plans.id | Offre souscrite |
| status | VARCHAR(50) | NOT NULL | Statut (trialing, active, past_due, cancelled, expired) |
| started_at | TIMESTAMPTZ | NOT NULL | Date de début |
| ended_at | TIMESTAMPTZ | | Date de fin |
| grace_period_ends_at | TIMESTAMPTZ | | Fin de période de grâce |
| trial_ends_at | TIMESTAMPTZ | | Fin d'essai |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_subscriptions_organization_id`, `idx_subscriptions_status`, `idx_subscriptions_plan_id`
Unique : `(organization_id)` — un abonnement actif à la fois par entreprise

### subscription_payments (paiements d'abonnement — validation manuelle MVP)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| subscription_id | UUID | NOT NULL, FK -> subscriptions.id | Abonnement concerné |
| amount_cents | BIGINT | NOT NULL | Montant payé |
| method | VARCHAR(50) | NOT NULL | Moyen de paiement |
| transaction_reference | VARCHAR(100) | NOT NULL | Référence de transaction |
| period_covered_start | DATE | NOT NULL | Période couverte début |
| period_covered_end | DATE | NOT NULL | Période couverte fin |
| received_at | DATE | NOT NULL | Date de réception |
| verification_status | VARCHAR(50) | NOT NULL DEFAULT 'unverified' | Statut (unverified, verified, rejected) |
| verified_by_id | UUID | FK -> users.id | Auteur de la validation |
| verified_at | TIMESTAMPTZ | | Date de validation |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_subscription_payments_subscription_id`, `idx_subscription_payments_verification_status`

### subscription_events (historique des changements)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| subscription_id | UUID | NOT NULL, FK -> subscriptions.id | Abonnement |
| event_type | VARCHAR(50) | NOT NULL | Type (created, changed, cancelled, expired, renewed) |
| previous_status | VARCHAR(50) | | Statut précédent |
| new_status | VARCHAR(50) | | Nouveau statut |
| changed_by_id | UUID | FK -> users.id | Auteur du changement |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_subscription_events_subscription_id`, `idx_subscription_events_created_at`

---

## 5. Sécurité et suivi

### audit_logs (journal d'audit pour les opérations sensibles)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise |
| user_id | UUID | FK -> users.id | Auteur de l'action |
| action | VARCHAR(100) | NOT NULL | Action effectuée |
| resource_type | VARCHAR(50) | | Type de ressource |
| resource_id | UUID | | Identifiant de la ressource |
| metadata | JSONB | NOT NULL DEFAULT '{}' | Données contextuelles |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_audit_logs_organization_id`, `idx_audit_logs_user_id`, `idx_audit_logs_action`, `idx_audit_logs_created_at`

### idempotency_keys (protection contre les doubles soumissions)

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| key | VARCHAR(255) | UNIQUE, NOT NULL | Clé d'idempotence |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise |
| endpoint | VARCHAR(100) | NOT NULL | Endpoint appelé |
| response_status | INTEGER | | Statut de la réponse |
| response_body | JSONB | | Corps de la réponse mise en cache |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| expires_at | TIMESTAMPTZ | NOT NULL | Date d'expiration de la clé |

Index : `idx_idempotency_keys_key` (unique), `idx_idempotency_keys_organization_id`, `idx_idempotency_keys_expires_at`

### organization_settings

| Colonne | Type | Contraintes | Description |
|---------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Identifiant |
| organization_id | UUID | NOT NULL, FK -> organizations.id | Entreprise |
| key | VARCHAR(100) | NOT NULL | Clé de paramètre |
| value | JSONB | NOT NULL | Valeur |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | |

Index : `idx_organization_settings_organization_id`
Unique : `(organization_id, key)`

---

## Règles de suppression et d'annulation

- Aucune suppression physique (hard delete) sur les entités financières : `washes`, `payments`, `cash_sessions`, `cash_movements`, `expenses`, `refunds`, `subscription_payments`
- Utiliser les statuts (`cancelled`, `closed`, `rejected`, `inactive`) pour marquer les enregistrements comme non actifs
- Les relations `ON DELETE CASCADE` sont limitées aux lignes dépendantes purement techniques (`wash_items`, `wash_assignments`) liées à un `wash` supprimé logiquement
- L'annulation contrôlée d'une dépense ou d'un paiement crée un enregistrement inverse ou change le statut, sans effacer l'original

---

## Stratégies d'isolation multi-tenant

1. Chaque requête métier identifie l'entreprise à partir du contexte authentifié (jeton Clerk validé côté backend)
2. Le backend n'accepte jamais un `organization_id` arbitraire comme preuve d'autorisation
3. Chaque lecture, modification, suppression logique et export est filtré par `WHERE organization_id = <org du contexte>`
4. Les opérations financières contrôlent en outre le `site_id`, l'`user_id` et la `cash_session_id` concernés
5. Les tests doivent prouver qu'un utilisateur d'une entreprise ne peut pas consulter les données d'une autre entreprise, même en connaissant ses identifiants
