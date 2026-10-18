# Élagage du template et périmètre WashPilot CI

Ce document décrit le nettoyage réalisé sur le template d'origine. Le dépôt exécutable est React/Vite/TypeScript, Express/TypeScript et PostgreSQL/Neon.

## Éléments retirés du produit

Les pages de démonstration sans lien avec la gestion d'une station ont été supprimées de `src/app` : calendrier générique, chat, mail, tâches, gestion d'utilisateurs de démonstration, FAQ/pricing autonomes non routés, et ancien tableau de bord d'exemple. Les variantes inutilisées de connexion/inscription ont également été supprimées ; seules les pages Clerk utilisées par le routeur sont conservées.

Le tableau de bord a aussi été débarrassé des éléments génériques de template : liens ShadcnStore/GitHub/Discord, carte promotionnelle, bannière « Upgrade to Pro », contrôleur visuel de thème/layout et pages de préférences fictives (apparence/notifications). Les vues d'erreur utilisent maintenant une interface française sans images placeholder ni liens cassés.

## Éléments WashPilot conservés

- Landing page et parcours Clerk (inscription, connexion, réinitialisation, sélection/création d'organisation).
- Onboarding de la station, choix du catalogue et du forfait.
- Tableau de bord, lavages, caisse, dépenses, rapports, équipe et catalogue.
- Paramètres du compte via le composant `UserProfile` de Clerk.
- Page forfait/abonnement alimentée par le récapitulatif API Neon ; elle n'affiche plus de faux historique ni de plans de démonstration.
- Composants UI de base réutilisés par les pages métier.

## Navigation dashboard actuelle

- **Principal :** Tableau de bord, Nouveau lavage, Caisse, Dépenses, Rapports, Équipe, Catalogue (Prestations, Catégories de véhicules).
- **Configuration :** Paramètres (Compte, Facturation).
- Le menu de recherche reprend les routes métier et de configuration disponibles, pas les pages d'authentification ou d'erreur.

## Évolution

Toute nouvelle entrée de navigation doit correspondre à une fonctionnalité WashPilot réellement utile et, lorsqu'elle implique des données métier, à une API persistante et tenant-scopée. Les exemples fictifs ou boutons non opérationnels ne doivent pas être exposés comme des fonctions disponibles.
