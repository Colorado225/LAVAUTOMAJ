# Project Execution and Cleanup Plan

This document outlines the steps taken to run the project and clean up outdated references.

## 1. Initial Goal: Execute the Project

The initial request was to run the project.

- **Action:** Attempted to install dependencies using `pnpm install`.
- **Result:** The installation failed due to `pnpm`'s security policy, which blocks build scripts by default (`ERR_PNPM_IGNORED_BUILDS`).

## 2. Secondary Goal: Remove Outdated Dashboard

The second request was to delete `http://localhost:5173/src/app/dashboard/page.tsx` and all its links.

- **Action:** Since the file did not exist, the focus shifted to removing all references to the `/dashboard` route and other outdated template paths.

### Cleanup Steps:

1.  **Routing (`src/config/routes.tsx`):**
    - Removed the route for `/dashboard`.
    - Changed the default redirect from `/` to `/dashboard-2`.

2.  **Navigation Components:**
    - **Sidebar (`src/components/app-sidebar.tsx`):** Removed the "Dashboard 1" link and updated the logo's link to `/dashboard-2`.
    - **Command Search (`src/components/command-search.tsx`):** Removed the "Dashboard 1" entry.

3.  **Error Pages (`src/app/errors/**/\*.tsx`):\*\*
    - Updated the "Go Back Home" button on all five error pages (`forbidden`, `internal-server-error`, `not-found`, `unauthorized`, `under-maintenance`) to navigate to `/dashboard-2`.

4.  **Authentication Forms (`src/app/auth/**/\*.tsx`):\*\*
    - **Login Forms:** Updated the `action` attribute and any "Forgot Password" or "Sign Up" links in `login-form-1.tsx`, `login-form-2.tsx`, and `login-form-3.tsx` to point to the correct, non-template paths (e.g., `/auth/sign-up-2` instead of a long template path).
    - **Sign-up Forms:** Updated the "Sign in" links in `signup-form-1.tsx`, `signup-form-2.tsx`, and `signup-form-3.tsx`.
    - **Forgot Password Forms:** Updated the "Back to sign in" links in `forgot-password-form-1.tsx`, `forgot-password-form-2.tsx`, and `forgot-password-form-3.tsx`.

5.  **Project Root Files:**
    - **`index.html`:** Removed outdated canonical and social media URLs pointing to the old template path.
    - **`.env.example`:** Removed the example `VITE_BASENAME` value that used the old template path.

## 3. Final Execution

After cleaning up all references, the project was successfully run.

- **Action 1:** Approved the required `esbuild` build script non-interactively using `pnpm approve-builds esbuild`.
- **Action 2:** Ran `pnpm install` successfully.
- **Action 3:** Started the development server with `pnpm dev`.
- **Result:** The project is now running on `http://localhost:5174/`.

# Objectifs de WashPilot_CI identifés :

Les problèmes que WashPilot CI doit résoudre sont notamment :

L'absence de suivi fiable du nombre de véhicules lavés.

La difficulté à connaître les recettes réelles de la journée.

La confusion entre chiffre d'affaires, argent présent en caisse et bénéfice.

Les dépenses non enregistrées ou difficiles à justifier.

Le manque de visibilité sur les performances des employés.

L'absence d'historique des prestations et des clients.

Les difficultés à contrôler les écarts de caisse.

Le manque de rapports simples permettant au propriétaire de prendre de meilleures décisions.

La difficulté à suivre plusieurs stations lorsque l'entreprise se développe.

## Proposition de valeur

WashPilot CI doit permettre au gérant de répondre rapidement à cinq questions :

Combien de véhicules avons-nous lavés aujourd'hui ?

Combien avons-nous encaissé réellement ?

Combien avons-nous dépensé ?

Combien reste-t-il dans la caisse ?

L'activité est-elle rentable sur la période observée ?

La proposition commerciale principale est :

« Gérez vos lavages, contrôlez votre caisse et comprenez enfin ce que votre station vous rapporte. »

L'application doit rester compréhensible pour un utilisateur peu habitué aux logiciels professionnels.

## Principes non négociables

Concevoir une application mobile-first.

Utiliser le français comme langue principale.

Utiliser le franc CFA BCEAO (XOF) comme devise par défaut.

Utiliser le fuseau horaire Africa/Abidjan.

Éviter les écrans surchargés et les menus excessifs.

Mettre les actions quotidiennes essentielles en évidence.

Ne jamais présenter des données fictives comme des données réelles.

Ne jamais simuler une sauvegarde réussie si l'API a échoué.

Ne jamais coder les restrictions d'abonnement uniquement dans l'interface.

Ne jamais mélanger les données de deux entreprises clientes.

Ne pas développer toutes les fonctionnalités simultanément : respecter le MVP et les phases ci-dessous.

### PARTIE 4 — CONCEPTION MULTI-TENANT

WashPilot CI est un SaaS destiné à plusieurs entreprises indépendantes.

Chaque entreprise cliente doit disposer de son propre espace logique et de ses propres données.

Modèle recommandé :

Une entreprise possède un ou plusieurs sites.

Une entreprise possède plusieurs membres et employés.

Un membre a un rôle et un périmètre d'accès.

Un abonnement est associé à l'entreprise, pas uniquement à l'utilisateur.

Les prestations, paiements, dépenses, sessions de caisse et rapports sont rattachés à l'entreprise et, si nécessaire, au site.

Règles obligatoires :

Chaque requête métier identifie l'entreprise à partir du contexte authentifié et autorisé.

Le backend ne doit pas accepter un organization_id arbitraire comme preuve d'autorisation.

Chaque lecture, modification, suppression logique et export est filtré par le périmètre autorisé.

Les opérations financières doivent contrôler le site, l'utilisateur et la session de caisse concernés.

Les tests doivent prouver qu'un utilisateur d'une entreprise ne peut pas consulter les données d'une autre entreprise, même en connaissant ses identifiants.

Les permissions sont contrôlées côté serveur.

Les administrateurs de la plateforme ne disposent pas d'un accès implicite illimité aux données métier : tout accès exceptionnel doit être contrôlé et audité.

Rôles initiaux :

PLATFORM_ADMIN : administration de la plateforme.

OWNER : propriétaire de l'entreprise.

MANAGER : responsable autorisé de la station.

CASHIER : opérations de caisse autorisées.

WASHER : accès limité aux tâches et prestations autorisées.

N'accorde que les permissions nécessaires à chaque rôle.

## PARTIE 5 — FONCTIONNALITÉS DU MVP

MODULE 1 — Inscription et configuration de l'entreprise (Page Onboarding)

Objectif : permettre à un nouveau gérant de démarrer rapidement.

Fonctionnalités :

Inscription et connexion via Clerk.

Création du profil utilisateur interne.

Création de l'entreprise (Page Onboarding Step by Step) :

- Nom commercial.

- Téléphone.

- Ville et commune.

- Adresse ou repère de localisation.

- Devise par défaut XOF.

- Fuseau horaire Africa/Abidjan.

-Configuration des prestations et des prix.

- Invitation de collaborateurs selon les permissions et le forfait.

-Prévois un assistant de démarrage simple.

- Demander gerant de choisir plan de souscription

- Ne demande que les informations nécessaires au lancement. Les champs complémentaires peuvent être renseignés plus tard.

##MODULE 2 — Tableau de bord

Le tableau de bord doit afficher, pour une période sélectionnée :

Nombre de véhicules lavés.

Chiffre d'affaires des prestations enregistrées.

Montants encaissés.

Montants restant dus, s'il existe des ventes à crédit autorisées.

Dépenses enregistrées.

Solde de caisse théorique si une session est ouverte.

Évolution de l'activité.

Répartition des prestations.

Dernières opérations.

Alertes sur les écarts de caisse ou les opérations en attente.

Ajoute des filtres de période et de site lorsque l'utilisateur y est autorisé.

Les indicateurs doivent provenir de requêtes métier cohérentes. Ne mélange jamais les ventes, les encaissements et le solde de caisse.

MODULE 3 — Catalogue des prestations

Permettre au propriétaire ou au responsable autorisé de configurer :

Lavage extérieur.

Lavage intérieur.

Lavage complet.

Lavage moteur, si proposé.

Nettoyage approfondi.

Autres prestations personnalisées.

Catégories de véhicules.

Prix par prestation et catégorie, si nécessaire.

Durée indicative.

Statut actif ou inactif.

Les prestations doivent être personnalisables.

Les prix doivent être stockés comme des montants monétaires entiers en XOF lorsque la devise ne nécessite pas de fraction dans les usages retenus.

Chaque ligne de prestation vendue doit conserver un instantané du nom et du prix appliqués au moment de la vente. Une modification future du catalogue ne doit jamais modifier les ventes historiques.

MODULE 4 — Enregistrement d'un lavage

C'est l'écran opérationnel le plus important du produit.

L'enregistrement doit être rapide, lisible et utilisable sur téléphone.

Workflow :

Cliquer sur « Nouveau lavage ».

Choisir la catégorie de véhicule.

Choisir une ou plusieurs prestations.

Afficher automatiquement le total.

Sélectionner l'employé ou les employés concernés si nécessaire.

Sélectionner le moyen de paiement.

Saisir le montant reçu, si pertinent.

Valider l'opération.

Enregistrer le lavage et ses lignes.

Enregistrer les encaissements associés.

Actualiser les indicateurs et l'historique.

Moyens de paiement initiaux :

Espèces.

Orange Money.

MTN MoMo.

Moov Money.

Wave.

Autre.

Au lancement, ces moyens peuvent être enregistrés manuellement. Ne prétends pas qu'une transaction Mobile Money a été vérifiée par un opérateur si aucune intégration officielle n'existe.

Prévois :

Un numéro de référence unique.

La date et l'heure.

Le site.

L'auteur de l'opération.

Les prestations et prix appliqués.

Le montant total.

Le statut du lavage.

Le statut de paiement.

L'historique des modifications autorisées.

Évite les doublons lors des doubles clics, des répétitions de requêtes ou d'une connexion instable. Utilise une stratégie d'idempotence appropriée.

MODULE 5 — Caisse et clôture journalière

Le système doit différencier :

Le chiffre d'affaires.

Les encaissements.

Les sorties de caisse.

Le solde théorique.

Le montant réellement compté.

L'écart de caisse.

Workflow :

Ouverture de caisse avec un montant initial.

Enregistrement des encaissements liés aux ventes.

Enregistrement des entrées et sorties autorisées.

Consultation du solde théorique.

Comptage physique en fin de session.

Saisie du montant réellement présent.

Calcul de l'écart.

Saisie d'un motif lorsque l'écart n'est pas nul.

Clôture de session.

Conservation de l'historique.

Formule de base :

Solde théorique = solde initial + entrées de caisse - sorties de caisse

Les encaissements et sorties liés à la caisse doivent être comptabilisés exactement une fois.

Les paiements électroniques ne doivent pas être ajoutés automatiquement à la caisse physique.

Une session clôturée ne peut pas être modifiée librement. Toute correction exceptionnelle doit être autorisée, justifiée et auditée.

MODULE 6 — Dépenses

Permettre d'enregistrer :

Eau.

Électricité.

Produits de lavage.

Rémunérations ou avances, selon la politique retenue.

Loyer.

Entretien.

Réparations.

Transport.

Autres dépenses personnalisées.

Chaque dépense comprend :

Montant.

Catégorie.

Date.

Site.

Moyen de paiement.

Bénéficiaire ou fournisseur facultatif.

Description.

Auteur.

Référence ou justificatif facultatif.

Statut.

Une dépense payée en espèces et imputée à une session de caisse doit produire une sortie de caisse cohérente.

Une dépense réglée par un compte bancaire ou un portefeuille électronique ne doit pas être artificiellement présentée comme une sortie de la caisse physique.

Les dépenses enregistrées ne doivent pas être supprimées silencieusement après leur prise en compte dans un rapport. Prévois une annulation contrôlée et un historique.

MODULE 7 — Employés et suivi opérationnel

MVP :

Fiche employé.

Nom.

Téléphone facultatif.

Statut actif ou inactif.

Date d'arrivée facultative.

Attribution des prestations réalisées.

Historique d'activité.

Indicateurs par période.

Le système doit permettre au responsable de comprendre la contribution opérationnelle de chaque employé.

Ne développe pas encore une paie complexe. Le calcul des commissions doit être une évolution séparée, activable seulement lorsqu'une règle métier claire a été validée.

MODULE 8 — Historique et rapports

Prévoir :

Liste des lavages.

Recherche par référence, période et catégorie.

Filtres par site et statut selon les permissions.

Historique des encaissements.

Historique des dépenses.

Rapports journaliers.

Rapports hebdomadaires et mensuels.

Performance des prestations.

Performance des employés.

Écarts de caisse.

Export CSV, selon le forfait et les permissions.

Les rapports doivent utiliser une définition cohérente des dates, des montants et des statuts.

Les ventes annulées ne doivent pas être comptabilisées comme des ventes actives. Les remboursements et corrections doivent être traités explicitement.

Le chiffre d'affaires n'est pas le bénéfice net. Si toutes les charges et règles comptables ne sont pas gérées, appelle l'indicateur « résultat estimé » et explique sa méthode de calcul.

PARTIE 6 — MODÈLE DE DONNÉES INITIAL

Conçois les migrations PostgreSQL et documente les relations.

Tables ou agrégats recommandés :

Identité et organisations

users : identité interne et référence Clerk.

organizations : entreprises clientes.

organization_members : appartenance, rôle et statut.

sites : stations de lavage.

invitations : invitations de collaborateurs, si nécessaire.

Catalogue et opérations

service_categories.

services.

vehicle_categories.

customers : facultatif dans le MVP.

washes.

wash_items.

wash_assignments : attribution aux employés.

payments.

refunds : lorsque le workflow de remboursement sera implémenté.

Finances

cash_sessions.

cash_movements.

expenses.

expense_categories.

Abonnements

plans.

subscriptions.

subscription_payments.

subscription_events ou historique équivalent.

Sécurité et suivi

audit_logs.

idempotency_keys, si nécessaire.

organization_settings.

Règles de conception :

Utilise des UUID ou des identifiants adaptés à l'architecture retenue.

Ajoute organization_id aux entités métier qui doivent être isolées.

Ajoute site_id lorsque l'opération est rattachée à une station.

Définis précisément les clés étrangères.

Prévois des index sur les colonnes de recherche et les filtres fréquents.

Utilise des contraintes d'unicité pour les références métier.

Utilise des dates stockées de manière cohérente, avec conversion dans le fuseau d'affichage.

Prévois les champs de création et de modification.

Utilise un historique d'audit pour les opérations sensibles.

Évite de stocker plusieurs fois une information dérivée lorsqu'elle peut être recalculée de manière fiable.

Conserve néanmoins les instantanés nécessaires à l'intégrité des historiques commerciaux.

Avant d'implémenter, produis docs/DATABASE.md avec :

Le schéma relationnel.

La description de chaque table.

Les colonnes et leurs types.

Les relations.

Les index.

Les contraintes.

Les règles de suppression ou d'annulation.

Les stratégies d'isolation multi-tenant.

PARTIE 7 — API REST GO

Utilise une version d'API explicite, par exemple /api/v1.

Endpoints indicatifs :

Santé et identité

GET /healthz

GET /readyz

GET /api/v1/me

Organisations et sites

GET /api/v1/organizations/current

PATCH /api/v1/organizations/current

GET /api/v1/sites

POST /api/v1/sites

PATCH /api/v1/sites/{siteID}

Prestations

GET /api/v1/services

POST /api/v1/services

PATCH /api/v1/services/{serviceID}

POST /api/v1/services/{serviceID}/deactivate

Lavages

GET /api/v1/washes

POST /api/v1/washes

GET /api/v1/washes/{washID}

POST /api/v1/washes/{washID}/cancel

Paiements et caisse

POST /api/v1/washes/{washID}/payments

GET /api/v1/payments

POST /api/v1/cash-sessions/open

GET /api/v1/cash-sessions/current

POST /api/v1/cash-sessions/{sessionID}/movements

POST /api/v1/cash-sessions/{sessionID}/close

Dépenses

GET /api/v1/expenses

POST /api/v1/expenses

GET /api/v1/expenses/{expenseID}

POST /api/v1/expenses/{expenseID}/cancel

Employés et rapports

GET /api/v1/employees

POST /api/v1/employees

GET /api/v1/reports/summary

GET /api/v1/reports/daily

GET /api/v1/reports/services

GET /api/v1/reports/employees

Abonnements

GET /api/v1/subscription

GET /api/v1/plans

POST /api/v1/subscription/change-plan

POST /api/v1/subscription/cancel

Ces endpoints sont une base de conception. Ajuste les méthodes, les noms et les workflows après l'analyse du domaine.

Pour chaque endpoint, définis :

Le rôle autorisé.

Les données d'entrée.

La validation.

Le format de réponse.

Les erreurs métier.

Les règles d'isolation.

Les tests nécessaires.

Utilise une pagination pour les listes volumineuses. Valide toutes les données côté backend.

Ne crée pas d'endpoints qui contournent les règles métier pour simplifier l'interface.

PARTIE 8 — ABONNEMENTS FREE, PRO ET BUSINESS

8.1. Principe

L'offre gratuite doit permettre à un gérant de découvrir une valeur réelle.

Les offres payantes doivent vendre des gains opérationnels, du contrôle et une capacité de développement — pas simplement un grand nombre de menus.

Les prix ci-dessous sont des hypothèses de départ à tester auprès de vrais gérants. Ils ne constituent pas des prix de marché validés.

8.2. Offre Free — Découverte

Objectif : adoption et acquisition.

Fonctionnalités proposées :

Une entreprise.

Un site.

Un utilisateur propriétaire.

Catalogue de prestations.

Enregistrement des lavages.

Historique récent.

Résumé journalier.

Suivi simple des encaissements.

Enregistrement des dépenses de base.

Un nombre limité d'opérations ou un historique limité, uniquement si les tests terrain démontrent que cette limite est utile.

L'offre gratuite doit rester exploitable. Ne limite pas artificiellement les fonctions indispensables au suivi de base.

8.3. Offre Pro — Gestion quotidienne

Prix indicatif à tester : 5 000 FCFA par mois.

Fonctionnalités :

Historique étendu.

Rapports détaillés.

Suivi des dépenses par catégorie.

Clôture de caisse et historique des écarts.

Gestion de plusieurs employés.

Indicateurs de performance.

Export des rapports.

Paramètres métier avancés.

Support prioritaire selon les moyens disponibles.

Cette offre doit être la plus attractive pour les petites stations qui souhaitent professionnaliser leur gestion.

8.4. Offre Business — Développement et contrôle

Prix indicatif à tester : à partir de 15 000 à 25 000 FCFA par mois, selon le nombre de sites, d'utilisateurs et les besoins réels.

Fonctionnalités :

Gestion de plusieurs sites.

Consolidation des résultats.

Comparaison des performances entre stations.

Permissions avancées.

Rapports consolidés.

Suivi des responsables.

Historique et audit renforcés.

Outils de contrôle centralisé.

Assistance renforcée.

Fonctionnalités supplémentaires validées avec les entreprises pilotes.

Ne promets pas une gestion multi-sites complète avant de l'avoir implémentée et testée.

8.5. Architecture des droits et fonctionnalités

Crée un catalogue centralisé des fonctionnalités et une matrice d'entitlements.

Exemples de clés :

sites.multiple

reports.advanced

reports.export

employees.advanced

cash.reconciliation

audit.advanced

analytics.consolidated

Le backend Go doit vérifier les entitlements à chaque opération protégée.

L'interface peut masquer ou désactiver les fonctionnalités indisponibles et présenter une explication claire de l'offre requise.

Ne disperse pas des conditions tarifaires codées en dur dans tous les composants.

8.6. Cycle de vie de l'abonnement

Prévois :

trialing, si un essai est proposé.

active.

past_due.

cancelled.

expired.

Un historique des changements.

Des dates de début et de fin.

Une période de grâce configurable.

Des règles d'accès après expiration.

La période d'essai, les durées et les conditions de grâce doivent être configurables.

Ne bloque pas brutalement l'accès aux données historiques d'une entreprise dont l'abonnement a expiré.

8.7. Paiement initial

Pour le MVP, prévois un système simple de paiement avec validation manuelle par l'administrateur :

Moyen de paiement.

Référence de transaction.

Montant.

Période couverte.

Date de réception.

Statut de vérification.

Auteur de la validation.

Historique des changements.

Ne marque jamais un paiement comme confirmé uniquement parce que l'utilisateur a fourni une référence.

Les intégrations officielles Orange Money, MTN MoMo, Moov Money ou Wave seront une phase ultérieure. Leur faisabilité, leur coût, leurs exigences contractuelles et leurs mécanismes de vérification devront être étudiés avant toute intégration.

PARTIE 9 — DESIGN UX/UI

9.1. Direction visuelle

Utilise Gentelella comme référence visuelle, mais adapte l'interface à une application métier moderne.

Objectifs :

Interface professionnelle et rassurante.

Bonne lisibilité sur téléphone.

Navigation courte.

Contraste suffisant.

Actions principales immédiatement accessibles.

Écrans sans surcharge.

Mode clair prioritaire.

Mode sombre uniquement si sa maintenance reste simple.

Ne reproduis pas toutes les pages du template. Construis les écrans nécessaires au workflow réel de la station.

9.2. Navigation proposée

Navigation principale :

Tableau de bord.

Lavages.

Caisse.

Dépenses.

Rapports.

Équipe.

Paramètres.

Le catalogue des prestations peut se trouver dans Paramètres ou dans un sous-menu selon les tests d'utilisabilité.

Les abonnements doivent être accessibles depuis les paramètres du compte ou une page dédiée.

Les utilisateurs ayant des permissions limitées ne doivent pas voir des commandes inutilisables.

9.3. Écran mobile de nouveau lavage

Conçois un écran à action rapide :

Bouton principal bien visible.

Catégories de véhicules lisibles.

Prestations présentées en choix simples.

Total actualisé automatiquement.

Paiement facile à sélectionner.

Validation explicite.

Confirmation après enregistrement.

Retour rapide à l'écran opérationnel.

Évite les formulaires trop longs.

9.4. États d'interface

Chaque écran doit gérer :

Chargement.

Liste vide.

Erreur réseau.

Erreur de validation.

Permission insuffisante.

Fonctionnalité indisponible selon le forfait.

Succès confirmé par le backend.

Double soumission évitée.

Session expirée.

Ne laisse aucun bouton important sans action fonctionnelle.

PARTIE 10 — SÉCURITÉ ET INTÉGRITÉ FINANCIÈRE

Applique les principes suivants :

Authentification vérifiée côté backend.

Autorisation par rôle et ressource.

Isolation stricte des entreprises.

Validation des entrées.

Requêtes SQL paramétrées.

Gestion sécurisée des secrets.

HTTPS en production.

Protection contre les soumissions répétées.

Limitation de débit sur les endpoints sensibles.

Logs structurés sans secrets ni données excessives.

Journal d'audit pour les actions critiques.

Sauvegarde et stratégie de restauration documentées.

Gestion explicite des erreurs.

Politique CORS limitée aux origines autorisées.

Protection contre les injections et les accès non autorisés.

Vérification des dépendances et des vulnérabilités connues.

Pour les opérations financières :

Utilise des transactions SQL.

Empêche les doubles encaissements accidentels.

Empêche la modification silencieuse des opérations clôturées.

Enregistre l'auteur et la date de chaque action sensible.

Prévois une procédure d'annulation contrôlée.

Ne confonds jamais un paiement enregistré avec un paiement vérifié par un prestataire externe.

Les données métier ne doivent pas être supprimées en cascade si cela détruit l'historique financier. Utilise des statuts et des annulations lorsque c'est approprié.

PARTIE 11 — ROADMAP D'IMPLÉMENTATION

Respecte cet ordre. Ne commence pas par coder tous les modules en parallèle.

PHASE 0 — Audit et cadrage

Livrables :

docs/AUDIT_GENTELELLA.md

docs/ARCHITECTURE.md

docs/ROADMAP.md

Liste des fichiers à conserver, migrer, adapter, supprimer ou différer.

Diagramme des flux métier.

Liste des risques techniques.

Plan de migration.

Critère de validation : aucune suppression majeure avant validation de ses dépendances.

PHASE 1 — Fondations

Implémenter :

Structure frontend et backend.

Configuration des environnements.

Connexion Neon.

Première migration SQL.

Vérification des jetons Clerk.

Modèle utilisateur et organisation.

Isolation multi-tenant.

Gestion des rôles.

Journalisation de base.

Endpoints de santé.

Tests d'isolation.

Critère de validation : un utilisateur authentifié peut accéder uniquement aux ressources de son entreprise.

PHASE 2 — Interface et migration du template

Implémenter :

Layout principal.

Navigation.

Composants réutilisables.

Dashboard de base.

Design responsive.

États de chargement, d'erreur et de liste vide.

Pages de connexion via Clerk.

Première version du système de permissions frontend.

Critère de validation : build réussi, navigation stable, aucun lien majeur cassé.

PHASE 3 — Catalogue et lavages

Implémenter :

Catalogue des prestations.

Catégories de véhicules.

Formulaire de nouveau lavage.

Historique.

Détail d'une prestation.

Calcul du total.

Enregistrement transactionnel.

Gestion des annulations.

Protection contre les doubles soumissions.

Critère de validation : un lavage peut être enregistré, retrouvé, contrôlé et annulé sans corrompre l'historique.

PHASE 4 — Paiements et caisse

Implémenter :

Paiements multiples si nécessaire.

Sessions de caisse.

Mouvements de caisse.

Ouverture et clôture.

Écarts.

Dépenses.

Historique des opérations financières.

Critère de validation : les montants du rapport, les encaissements et le solde de caisse correspondent aux mêmes opérations sources sans double comptabilisation.

PHASE 5 — Rapports et équipe

Implémenter :

Rapports journaliers.

Rapports par période.

Répartition des prestations.

Indicateurs employés.

Filtres.

Exports autorisés.

Gestion des collaborateurs.

Critère de validation : chaque indicateur possède une définition documentée et des tests de calcul.

PHASE 6 — Abonnements et entitlements

Implémenter :

Catalogue des offres.

Abonnement par entreprise.

Vérification des fonctionnalités autorisées.

Paiement manuel.

Validation par administrateur.

Historique.

Gestion des expirations.

Interface de changement de forfait.

Critère de validation : un forfait ne peut pas être contourné en appelant directement l'API.

PHASE 7 — Pilote et production

Préparer :

Jeu de données de test.

Parcours de test complet.

Tests de permissions.

Tests de calcul financier.

Tests multi-tenant.

Tests responsive.

Tests E2E.

Configuration de production.

Gestion des secrets.

Documentation de déploiement.

Procédure de sauvegarde et restauration.

Surveillance des erreurs.

Guide utilisateur en français.

Critère de validation : le produit est utilisable par une petite station pilote, et les opérations essentielles fonctionnent sans données fictives ni contournements.

PARTIE 12 — TESTS OBLIGATOIRES

Écris des tests pour les cas suivants :

Un utilisateur non authentifié ne peut pas accéder aux données privées.

Un utilisateur de l'entreprise A ne peut pas consulter les données de l'entreprise B.

Un employé ne peut pas exécuter les opérations réservées au propriétaire.

Un prix modifié ne change pas les anciens lavages.

Un double envoi ne crée pas deux ventes accidentelles.

Un paiement électronique ne modifie pas la caisse physique.

Une dépense en espèces affecte correctement la caisse concernée.

Une clôture calcule correctement l'écart.

Une session clôturée ne peut pas être modifiée sans procédure autorisée.

Un lavage annulé est exclu des indicateurs de ventes actives.

Un abonnement expiré ne permet pas d'utiliser les fonctionnalités payantes protégées.

Un changement de forfait prend effet conformément aux règles documentées.

Un rapport respecte le filtre de période et le site sélectionné.

Les erreurs API sont affichées correctement dans l'interface.

Le build de production ne dépend pas de données de démonstration.

Les tests et les migrations fonctionnent sur un environnement vierge.

Les événements Clerk traités plusieurs fois ne créent pas de doublons métier.

Les erreurs ou interruptions de connexion ne provoquent pas de confirmations trompeuses.

Ne considère pas une phase comme terminée si ses tests critiques échouent.

PARTIE 13 — DÉPLOIEMENT ET COÛTS

L'objectif est de commencer avec une infrastructure simple, maintenable et peu coûteuse.

Prévois :

Frontend Next.js sur un hébergeur compatible.

Backend Go sur un hébergeur compatible avec un service HTTP persistant.

Base de données Neon.

Clerk pour l'authentification.

HTTPS.

Variables d'environnement séparées par environnement.

Logs et suivi des erreurs.

Sauvegardes et restauration.

Un environnement de test distinct de la production.

Vérifie les limites et conditions actuelles des offres gratuites ou peu coûteuses avant de sélectionner les services. Ne suppose pas qu'une offre restera gratuite ou qu'elle suffira en production.

Fournis un fichier .env.example sans secrets.

Documente les commandes nécessaires pour :

Installer les dépendances.

Lancer le frontend.

Lancer le backend.

Appliquer les migrations.

Exécuter les tests.

Construire le frontend.

Construire le backend.

Déployer.

Diagnostiquer les erreurs courantes.

## PARTIE 14 — MÉTHODE DE TRAVAIL DE L'AGENT IA

Tu dois travailler par étapes vérifiables.

Pour chaque phase :

Examiner l'existant.

Identifier les fichiers concernés.

Décrire brièvement la modification prévue.

Implémenter un lot cohérent.

Exécuter les tests pertinents.

Corriger les erreurs.

Vérifier le build.

Mettre à jour la documentation.

Mettre à jour la checklist de progression.

Présenter les résultats et les éventuels blocages.

Crée docs/PROGRESS.md avec les statuts :

[ ] À faire.

[-] En cours.

[x] Terminé et vérifié.

[!] Bloqué ou nécessitant une décision.

Pour chaque tâche terminée, indique la preuve de validation : test exécuté, build réussi, migration appliquée ou parcours testé.

Ne coche jamais une tâche sur la seule base de la création d'un fichier.

Si une information est incertaine :

Examine le code et la documentation disponible.

Propose une décision technique cohérente.

Documente les hypothèses.

Ne prétends pas avoir vérifié une intégration ou une règle réglementaire sans preuve.

N'effectue pas de refonte massive non nécessaire. Privilégie les changements progressifs, réversibles et testés.

Ne crée pas de fausses intégrations Mobile Money, de faux rapports ou de fausses confirmations de paiement.

PARTIE 15 — DÉFINITION DE « TERMINÉ »

Une fonctionnalité est considérée terminée seulement si :

Son parcours utilisateur est implémenté.

Son interface est responsive.

Son API est fonctionnelle.

Ses validations sont appliquées côté serveur.

Les permissions sont contrôlées.

Les données sont réellement persistées.

Les erreurs sont gérées.

Les tests critiques passent.

La documentation est mise à jour.

Les éventuels effets sur les abonnements sont appliqués côté backend.

Les données d'une autre entreprise ne sont jamais accessibles.

Aucun secret n'est exposé.

Aucun bouton essentiel ne simule une action.

Le build correspondant réussit.

INSTRUCTION DE DÉMARRAGE
Commence maintenant par la PHASE 0 : audit complet du dépôt Gentelella et cadrage du projet WashPilot CI.

Ne commence pas par générer toutes les pages de l'ERP.

Inspecte le dépôt réel, établis l'inventaire des pages et dépendances, identifie précisément ce qui peut être supprimé sans casser l'application et prépare le plan de migration vers Next.js, React, TypeScript, Go, Neon et Clerk.

Ensuite, fournis un rapport comprenant :

La structure réelle du dépôt.

Les éléments à conserver, adapter, migrer, supprimer, remplacer et différer.

Les risques de régression.

L'architecture cible.

Le plan d'implémentation ordonné.

Les critères de validation de la première phase.

Après l'audit, avance phase par phase sans sauter les étapes de validation.

Objectif final : livrer un SaaS fiable, simple à utiliser, adapté aux stations de lavage automobile ivoiriennes, sécurisé, évolutif et commercialisable.
