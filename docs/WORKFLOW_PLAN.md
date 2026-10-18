# Plan d'architecture et d'implémentation actuel

> Les détails des anciennes phases Go/chi/sqlx sont obsolètes et ne décrivent pas le dépôt courant. L'architecture exécutée est React/Vite + Express/TypeScript + PostgreSQL/Neon.

## Architecture cible maintenue

```text
React/Vite + Clerk
       │ Bearer JWT Clerk
       ▼
Express/TypeScript (server.ts, server/*)
       │ pool pg + migrations SQL
       ▼
PostgreSQL/Neon
```

Clerk gère l'identité et les organisations. Neon conserve les profils métier, les appartenance/rôles par tenant, les progrès d'onboarding et les opérations. L'UUID d'organisation est dérivé exclusivement du contexte serveur authentifié ; le body ne peut pas choisir le tenant.

## Domaines actuellement livrés

1. **Auth et tenant** — vérification JWT, synchronisation profil Clerk→`users`, appartenance→`organization_members`, webhooks signés, révocation et limites utilisateurs.
2. **Onboarding** — sauvegarde de brouillons, reprise, validation de chaque étape, catalogue, travailleurs, plan et confirmation transactionnelle.
3. **Catalogue** — catégories, prestations et catégories de véhicules isolées par organisation, restrictions de rôle et limite de services.
4. **Opérations** — lavages avec snapshots, paiements saisis, sessions/mouvements de caisse, dépenses et annulations sûres.
5. **Équipe et rapports** — gestion des travailleurs owner/manager avec quota transactionnel ; rapports tenant-scopés agrégés par période, graphiques et export CSV.
6. **Exploitation** — migrations `001` à `005`, pool PostgreSQL borné, health/readiness, erreurs HTTP normalisées.

## Priorités restantes

- Tests d'intégration PostgreSQL sur une base jetable : migrations, isolation A/B, concurrence des soldes et des compteurs, réessais idempotents et limites de forfait.
- Tests E2E avec un environnement Clerk de test : sign-up, vérification, sélection/adhésion d'organisation, onboarding, dashboard, révocation.
- Compléter remboursements et paiements externes avec preuves de confirmation fournisseur ; ne jamais assimiler une sélection UI à un paiement vérifié.
- Ajouter les routes d’invitation/révocation des membres Clerk et de gestion des sites si nécessaires, avec contrôle des quotas.
- Ajouter audit log, billing et observabilité ; étendre les rapports/export seulement selon les besoins métier.
- Évaluer RLS PostgreSQL avant toute exposition SQL directe ; elle n'est pas activée aujourd'hui.
- Revoir les vulnérabilités de dépendances de développement sans appliquer de mise à niveau majeure non validée.

## Ordre de validation

1. `npm run build`, `npm run lint`, `npm test` et `git diff --check`.
2. Charger migrations `001`–`005` dans une base PostgreSQL de test/Neon.
3. Vérifier les parcours Clerk et les webhooks d'un environnement de test isolé.
4. Vérifier par requêtes SQL les soldes, les enregistrements et l'isolation entre organisations.
5. Déployer uniquement après configuration des secrets côté serveur, restauration testée et monitoring.

Les tests locaux ne prouvent pas que Neon/Clerk sont opérationnels : une configuration réelle valide reste une condition d'acceptation du déploiement.
