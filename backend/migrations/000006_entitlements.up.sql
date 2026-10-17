-- +migrate Up
-- PHASE 6 — États d'abonnement complets + entitlements structurés
ALTER TYPE subscription_state ADD VALUE IF NOT EXISTS 'trialing';
ALTER TYPE subscription_state ADD VALUE IF NOT EXISTS 'past_due';

-- Restructurer plans.features : de tableau de chaînes à objet d'entitlements clés/valeurs.
-- Ancienne valeur : '["1 station","3 travailleurs",...]'
-- Nouvelle valeur : {"sites.multiple": true, "reports.advanced": false, ...}
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS max_sites INT,
  ADD COLUMN IF NOT EXISTS max_users INT;

-- Mettre à jour le catalogue de forfaits avec des entituments structurés et des limites.
UPDATE plans
SET features = '{
  "sites.multiple": false,
  "reports.advanced": false,
  "reports.export": false,
  "employees.advanced": false,
  "cash.reconciliation": true,
  "audit.advanced": false,
  "analytics.consolidated": false
}'::jsonb,
    max_sites = 1,
    max_users = 1
WHERE code = 'free';

UPDATE plans
SET features = '{
  "sites.multiple": false,
  "reports.advanced": true,
  "reports.export": true,
  "employees.advanced": true,
  "cash.reconciliation": true,
  "audit.advanced": false,
  "analytics.consolidated": false
}'::jsonb,
    max_sites = 1,
    max_users = 10
WHERE code = 'pro';

UPDATE plans
SET features = '{
  "sites.multiple": true,
  "reports.advanced": true,
  "reports.export": true,
  "employees.advanced": true,
  "cash.reconciliation": true,
  "audit.advanced": true,
  "analytics.consolidated": true
}'::jsonb,
    max_sites = NULL,
    max_users = NULL
WHERE code = 'business';

-- +migrate Down
ALTER TABLE plans
  DROP COLUMN IF EXISTS max_sites,
  DROP COLUMN IF EXISTS max_users;

-- Remettre features en tableau de chaînes (état avant 000006).
UPDATE plans
SET features = CASE code
  WHEN 'free' THEN '["1 station","3 travailleurs","10 services","Tableau de bord","Suivi des lavages"]'::jsonb
  WHEN 'pro' THEN '["1 station","10 travailleurs","50 services","Rapports d''activité","Support prioritaire"]'::jsonb
  WHEN 'business' THEN '["Multi-stations","Travailleurs illimités","Rapports avancés","Export comptable","Support dédié"]'::jsonb
  ELSE '[]'::jsonb
END;

-- Impossible de retirer des valeurs d'un ENUM en PostgreSQL sans recréer le type.
-- Les valeurs 'trialing' et 'past_due' restent disponibles mais inutilisées en cas de rollback.
