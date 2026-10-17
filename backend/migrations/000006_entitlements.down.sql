-- +migrate Down
ALTER TABLE plans
  DROP COLUMN IF EXISTS max_sites,
  DROP COLUMN IF EXISTS max_users;

UPDATE plans
SET features = CASE code
  WHEN 'free' THEN '["1 station","3 travailleurs","10 services","Tableau de bord","Suivi des lavages"]'::jsonb
  WHEN 'pro' THEN '["1 station","10 travailleurs","50 services","Rapports d''activité","Support prioritaire"]'::jsonb
  WHEN 'business' THEN '["Multi-stations","Travailleurs illimités","Rapports avancés","Export comptable","Support dédié"]'::jsonb
  ELSE '[]'::jsonb
END;

-- Les valeurs d'ENUM 'trialing' et 'past_due' ajoutées en UP ne peuvent pas être retirées
-- sans recréer le type ; elles restent simplement inutilisées après rollback.
