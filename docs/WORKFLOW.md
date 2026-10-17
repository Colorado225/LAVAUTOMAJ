# MASTER PROMPT — WORKFLOW D'INSCRIPTION, ONBOARDING ET PERSONNALISATION DU DASHBOARD

## SaaS de gestion de stations de lavage automobile en Côte d'Ivoire

# NB : gader le design intcat mais adpater les contenu selon le contexte!!!!!!!!

### 1. Rôle et mission

Agis comme un architecte logiciel senior, expert en SaaS multi-tenant, Next.js, TypeScript, Prisma, PostgreSQL/Neon, UX/UI et applications de gestion métier.

Ta mission consiste à auditer l'application existante, puis à implémenter un workflow complet et robuste permettant à un propriétaire ou gérant de station de lavage automobile de créer son compte, configurer sa station étape par étape, sélectionner un forfait et accéder à un dashboard réellement personnalisé.

Ne reconstruis pas arbitrairement l'application. Commence par examiner le code, l'architecture, les routes, le schéma Prisma, l'authentification, les composants et les fonctionnalités existantes.

### 2. Workflow obligatoire

Implémente exactement le parcours suivant :

1. Landing page.
2. Inscription ou connexion.
3. Vérification des données et création sécurisée du compte.
4. Détection de l'état de configuration.
5. Onboarding multi-étapes.
6. Récapitulatif et confirmation.
7. Enregistrement transactionnel de la configuration.
8. Animation de succès.
9. Redirection vers le dashboard personnalisé.

Aucun utilisateur dont la configuration initiale est incomplète ne doit accéder au dashboard opérationnel. Il doit pouvoir quitter le parcours et le reprendre ultérieurement.

### 3. Authentification et redirections

Après inscription ou connexion, détermine la destination côté serveur :

- Compte sans station configurée : démarrer l'onboarding.
- Configuration en cours : reprendre à l'étape sauvegardée.
- Configuration terminée : ouvrir le dashboard autorisé.
- Utilisateur membre de plusieurs stations : sélectionner une station autorisée lorsque nécessaire.

Ne te fie jamais uniquement à une variable frontend, au localStorage ou à une URL pour déterminer les droits d'accès.

### 4. Onboarding — Étape 1 : identité de la station

Collecter :

- Nom de la station.
- Téléphone professionnel.
- E-mail professionnel facultatif.
- Adresse ou quartier.
- Ville ou commune.
- Description facultative.
- Logo ou photo facultatif.

Préremplir les données disponibles du propriétaire sans confondre son identité avec celle de la station.

Valider les champs côté client et côté serveur. Générer un identifiant unique de station.

### 5. Onboarding — Étape 2 : catalogue de services

Créer un catalogue administrable de prestations courantes :

- Lavage automobile extérieur, intérieur et complet.
- Aspiration, nettoyage des tapis et des sièges.
- Lavage de motos et autres deux-roues.
- Nettoyage approfondi, detailing et finition.
- Prestations pour véhicules utilitaires et flottes.
- Catégories complémentaires administrables.

Prévoir les entités `ServiceCategory`, `ServiceCatalog` et `StationService`, ou leur équivalent adapté au modèle existant.

Afficher les prestations standard sous forme de liste sélectionnable.

Ajouter une fonction « Autre service » permettant de créer une prestation personnalisée avec nom, catégorie et prix indicatif facultatif.

Un service personnalisé doit être rattaché exclusivement à la station qui le crée. Ne jamais modifier automatiquement le catalogue global lors de cette opération.

Prévenir les doublons et permettre l'activation, la désactivation et la modification des services.

### 6. Onboarding — Étape 3 : travailleurs

Permettre l'ajout, la modification et la suppression de plusieurs travailleurs.

Champs : nom, prénom, téléphone, quartier ou lieu d'habitation, fonction, statut et date d'entrée facultative.

Prévoir les fonctions laveur automobile, laveur moto, laveur polyvalent et chef d'équipe, avec possibilité d'ajouter des fonctions personnalisées si cela correspond à l'architecture existante.

Autoriser la création d'une station sans travailleur si le propriétaire exerce seul.

Ne pas imposer un compte de connexion à chaque travailleur.

### 7. Onboarding — Étape 4 : abonnement

Créer ou réutiliser un catalogue de forfaits géré en base de données :

- Free.
- Pro.
- Business.

Chaque plan doit définir ses fonctionnalités et ses limites. Les prix et les droits ne doivent pas être dispersés dans les composants frontend.

La sélection d'un forfait payant ne constitue pas un paiement. Utiliser des états explicites : sélectionné, en attente, actif, échoué, expiré ou annulé selon les besoins du système.

Pour une intégration de paiement non encore disponible, prévoir une interface de service dédiée et un état en attente. Ne jamais simuler un paiement réussi.

### 8. Persistance et reprise

Créer ou adapter un modèle `OnboardingProgress`.

Persister la progression, l'étape courante et les validations côté serveur.

Permettre à l'utilisateur de quitter le parcours et de reprendre ultérieurement.

Ne pas perdre les données lors d'un rafraîchissement ou d'une déconnexion.

Ne jamais marquer le parcours comme terminé avant la validation serveur de toutes les conditions obligatoires.

### 9. Confirmation finale

Afficher un récapitulatif de la station, des services, des travailleurs et du forfait sélectionné.

Au clic sur « Confirmer et créer ma station » :

1. Vérifier les droits de l'utilisateur.
2. Valider les données.
3. Contrôler les conditions de l'abonnement.
4. Enregistrer les données nécessaires dans une transaction Prisma.
5. Rendre l'opération idempotente.
6. Marquer l'onboarding comme terminé uniquement lorsque toutes les conditions sont satisfaites.
7. Retourner un résultat explicite au frontend.
8. Afficher une animation de succès uniquement après confirmation serveur.
9. Rediriger vers le dashboard autorisé.

Prévoir une gestion propre des erreurs, des nouvelles tentatives et des doubles soumissions.

### 10. Dashboard dynamique

Personnaliser le dashboard selon la station active.

Afficher le nom de la station, son logo ou ses initiales, ses coordonnées, les services activés, les travailleurs et le forfait.

Calculer les indicateurs opérationnels à partir des données réelles : lavages, recettes, dépenses et autres métriques disponibles.

Ne pas inventer de chiffres lorsqu'aucune opération n'a encore été enregistrée.

Adapter le menu aux modules disponibles, au rôle de l'utilisateur et aux droits du forfait.

Afficher les fonctionnalités premium verrouillées de manière explicite si cela améliore la conversion, tout en bloquant leur utilisation côté serveur.

### 11. Architecture et sécurité

Réutiliser les conventions et composants existants.

Respecter les bonnes pratiques Next.js, TypeScript, Prisma et PostgreSQL/Neon.

Garantir l'isolation multi-tenant pour toutes les données métier. Vérifier la station et les autorisations côté serveur à chaque requête.

Prévoir les contraintes de clés étrangères, les index utiles, les migrations et les validations de données.

Ne jamais exposer les secrets ou les opérations sensibles au client.

Ne pas supprimer de données existantes ni effectuer de migration destructive sans justification et procédure de sauvegarde.

### 12. UX/UI

Créer une interface professionnelle, mobile-first, cohérente avec le design system existant et les composants shadcn/ui/ReUI utilisés par le projet.

Prévoir :

- Une barre de progression claire.
- Des étapes courtes et compréhensibles.
- Les actions Précédent, Continuer et Enregistrer et quitter.
- Les erreurs de validation près des champs concernés.
- Des états de chargement.
- Des animations sobres.
- Un récapitulatif final.
- Des états vides utiles.
- Une navigation clavier accessible.

Éviter les formulaires surchargés et les paramètres inutiles.

### 13. Tests obligatoires

Ajouter ou adapter les tests pour vérifier :

- Inscription et connexion.
- Redirection des comptes non configurés.
- Reprise d'un onboarding interrompu.
- Validation de chaque étape.
- Création d'un service personnalisé isolé par station.
- Ajout de plusieurs travailleurs.
- Choix d'un forfait.
- Refus d'un accès au dashboard avant la fin du parcours.
- Absence de double création lors d'une double soumission.
- Gestion des erreurs de transaction.
- Isolation des données entre stations.
- Contrôle des fonctionnalités selon les forfaits.
- Responsive design et principaux états de l'interface.

Exécuter les tests, le lint, la vérification TypeScript et les contrôles de build disponibles.

### 14. Méthode d'exécution

Procéder dans cet ordre :

Phase A — Audit de l'existant et rapport des écarts.

Phase B — Proposition d'architecture cible, schéma des données et plan de migration.

Phase C — Implémentation du workflow et de la persistance.

Phase D — Implémentation du catalogue, des travailleurs et des abonnements.

Phase E — Confirmation finale et dashboard dynamique.

Phase F — Tests, corrections, validation de sécurité et documentation.

Ne prétends jamais qu'une fonctionnalité est terminée si elle n'a pas été implémentée et vérifiée.

À chaque phase, fournis les fichiers modifiés, les migrations nécessaires, les tests exécutés, les résultats obtenus, les problèmes restants et les prochaines tâches.

Commence maintenant par l'audit de l'application existante. Ne modifie pas le code avant d'avoir identifié les composants, modèles et routes qui doivent être réutilisés.
