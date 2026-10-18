# Audit et nettoyage du template Shadcn UI

Le template Vite/React d'origine fournissait des modules de démonstration génériques. Il a été élagué pour ne conserver que les parcours et composants utiles à WashPilot CI.

## Architecture produit conservée

- SPA React/Vite/TypeScript avec routes lazy chargées depuis `src/config/routes.tsx`.
- API Express/TypeScript et PostgreSQL/Neon.
- Clerk pour l'authentification et la gestion d'identité.
- Parcours public de présentation et d'inscription, configuration d'organisation, onboarding, puis modules métier.
- Composants Shadcn UI réutilisés comme primitives de design, sans conserver leurs pages de démo comme fonctions du produit.

## Nettoyage appliqué

Les pages non liées aux opérations d'une station (calendrier générique, chat, mail, tâches, utilisateurs de démonstration, pages FAQ/pricing autonomes non routées et ancien dashboard d'exemple) ont été retirées. Les variantes inutilisées des formulaires d'authentification, les réglages de thème/notifications non persistés, la promotion ShadcnStore, les données de facturation fictives et les vues d'erreur à liens cassés ont également été retirés ou remplacés.

La landing page principale reste présente parce qu'elle présente WashPilot CI et mène vers les parcours Clerk. Les erreurs système et les composants UI de base sont conservés.

## Règle de maintenance

Une page ou une entrée de navigation ne doit être ajoutée que si elle correspond au périmètre WashPilot : entreprise et sites, utilisateurs/rôles, catalogue, lavages, paiements et remboursements, caisse, dépenses, équipe, rapports, abonnements ou onboarding. Les données d'exemple ne doivent jamais être présentées comme des données réelles.
