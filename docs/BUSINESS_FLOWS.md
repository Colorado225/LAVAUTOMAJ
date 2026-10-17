# Flux Métier de WashPilot_CI

Ce document décrit les principaux flux de travail (workflows) des utilisateurs de l'application.

## 1. Flux d'Inscription et d'Onboarding

**Acteur :** Nouveau gérant (Propriétaire)

1.  **Inscription :** Le gérant s'inscrit via un formulaire géré par Clerk (email, mot de passe, ou social login).
2.  **Création de l'organisation :** Après sa première connexion, il est redirigé vers un assistant d'onboarding (`/onboarding`).
3.  **Saisie des informations :** Il saisit les informations de base de son entreprise (nom, téléphone, adresse).
4.  **Configuration initiale :** Il configure ses premières prestations et leurs prix.
5.  **Invitation (Optionnel) :** Il peut inviter un ou plusieurs collaborateurs.
6.  **Finalisation :** L'assistant se termine, et le gérant est redirigé vers le tableau de bord principal.

## 2. Flux d'Enregistrement d'un Lavage

**Acteur :** Caissier ou Manager

1.  **Démarrage :** L'utilisateur clique sur "Nouveau Lavage" depuis le tableau de bord ou la page des lavages.
2.  **Sélection :** Il choisit la catégorie du véhicule et une ou plusieurs prestations dans le catalogue.
3.  **Calcul :** Le montant total est calculé et affiché automatiquement.
4.  **Attribution (Optionnel) :** Il assigne le lavage à un ou plusieurs laveurs.
5.  **Paiement :** Il sélectionne le moyen de paiement (Espèces, Mobile Money, etc.).
6.  **Validation :** Il valide l'opération. Le système enregistre le lavage, crée une transaction de paiement et met à jour les indicateurs.
7.  **Confirmation :** Une confirmation s'affiche, et l'utilisateur est prêt à enregistrer un nouveau lavage.

## 3. Flux de Clôture de Caisse Journalière

**Acteur :** Manager ou Caissier autorisé

1.  **Ouverture :** En début de journée, l'utilisateur ouvre une nouvelle session de caisse avec un montant initial (fond de caisse).
2.  **Opérations :** Tout au long de la journée, les encaissements en espèces et les dépenses payées en espèces sont automatiquement ajoutés ou retirés de la session de caisse active.
3.  **Consultation :** À tout moment, l'utilisateur peut consulter le solde théorique calculé par le système.
4.  **Démarrage de la clôture :** En fin de journée, il lance la procédure de clôture.
5.  **Comptage physique :** Il compte l'argent réellement présent dans le tiroir-caisse et saisit ce montant dans l'application.
6.  **Calcul de l'écart :** Le système compare le solde théorique et le montant compté, puis affiche l'écart (positif, négatif ou nul).
7.  **Justification :** Si l'écart n'est pas nul, l'utilisateur doit saisir un motif.
8.  **Clôture :** Il confirme la clôture. La session est archivée et ne peut plus être modifiée. Un rapport de clôture est généré.

## 4. Flux de Gestion des Dépenses

**Acteur :** Manager ou Propriétaire

1.  **Création :** L'utilisateur accède à la section "Dépenses" et clique sur "Nouvelle Dépense".
2.  **Saisie :** Il remplit le formulaire : catégorie de la dépense (eau, électricité, salaire...), montant, date, et moyen de paiement.
3.  **Validation :** Il enregistre la dépense.
4.  **Impact sur la caisse :** Si la dépense a été payée en "Espèces" et qu'une session de caisse est ouverte, une sortie de caisse correspondante est automatiquement créée.
5.  **Historique :** La dépense apparaît dans l'historique des dépenses et sera incluse dans les rapports financiers.
