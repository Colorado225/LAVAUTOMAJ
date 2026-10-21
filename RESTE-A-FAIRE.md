# Ce qui reste à implémenter — WashPilot CI

> Analyse du 20 octobre 2026, sur l'état du dépôt au commit `e14ac04`.
> 7 052 lignes de serveur (24 modules) · 24 301 lignes de front (171 fichiers)
> · 2 928 lignes de tests (16 fichiers, 189 tests) · `tsc`, lint et build verts.

Ce document ne répète pas l'analyse initiale (`ANALYSE-COMPLETE.md`) ni l'état
des promesses tarifaires (`TARIFS.md` §6). Il répond à une seule question :
**qu'est-ce qui empêche aujourd'hui de mettre ce produit entre les mains d'un
client payant, et dans quel ordre le traiter.**

---

## 0. Ce qui est solide

Pour situer le reste. Le socle métier est construit et vérifié :

- **24 modules serveur**, 74 routes, toutes consommées par l'interface.
- **RBAC à trois niveaux** (interface, serveur, base), 28 permissions, refus
  par défaut, 4 permissions non délégables, exceptions par membre.
- **Moteur de forfaits** : 12 capacités, essai de 14 jours, bascule en lecture
  seule, plafonds (utilisateurs, laveurs, stations) sous verrou consultatif,
  délai de grâce de 14 jours à la rétrogradation.
- **Idempotence** sur les écritures d'argent, **journal d'audit**, **isolation
  multi-tenant** testée, **sauvegarde/restauration**.
- **189 tests** dont l'isolation des locataires, les garde-fous de forfait et
  la matrice des rôles figée.

Ce qui suit ne remet rien de cela en cause. Ce sont les pièces manquantes.

---

## 1. ~~Bloquant~~ — RÉSOLU le 20/10/2026 : le back-office est en place

> **Résolu.** Le chemin 1 ci-dessous (activation manuelle assistée) a été
> implémenté : console `/console` (application séparée depuis le 20/10/2026),
> opérateurs de plateforme par
> `PLATFORM_ADMIN_EMAILS`, routes d'activation, de suspension, de prolongation
> et de refus de demande. Voir **`BACK-OFFICE.md`**. Le constat d'origine est
> conservé ci-dessous pour mémoire.

**C'était le point le plus grave, et il était invisible depuis l'interface.**

Trois routes seulement touchent la table `subscriptions` :

| Route | Fichier | Effet |
|---|---|---|
| Inscription | `server/onboarding.ts` | crée l'essai de 14 jours |
| Expiration | `server/entitlements.ts` | passe l'essai en `expired` |
| `POST /subscription/simulate` | `server/subscription.ts` l. 49 | change le forfait — **`if (env.NODE_ENV !== "production")`** |

Il n'existe **aucun back-office, aucun super-administrateur, aucune route
d'activation** (vérifié : `grep` sur `super_admin|back-office|is_admin` ne
retourne rien).

Le parcours réel d'un client aujourd'hui :

```
inscription → essai 14 j → expiration → lecture seule
   → « Demander l'activation » → e-mail à l'assistance + lien WhatsApp
   → … et personne ne peut activer le forfait sans écrire du SQL à la main
```

`server/support.ts` trace bien la demande et prévient l'assistance. Mais la
dernière marche n'existe pas. **Un client qui veut payer ne le peut pas.**

### Ce qu'il faut décider avant de coder

Deux chemins, et le choix n'est pas technique :

1. **Activation manuelle assistée** — une route d'administration réservée à
   l'éditeur, plus un écran minimal : liste des demandes en attente, bouton
   « activer le forfait X jusqu'au … ». Cohérent avec un encaissement par
   mobile money hors application, qui est la pratique courante à Abidjan.
   Quelques jours de travail. **C'est le minimum pour vendre.**

2. **Encaissement intégré** — CinetPay, PayDunya ou Wave Business, qui
   couvrent le XOF et le mobile money ivoirien. Webhook de confirmation,
   renouvellement, échecs de prélèvement, relances. Plusieurs semaines, et
   une relation contractuelle avec l'agrégateur.

Le chemin 1 n'interdit pas le chemin 2 : il le précède. Tant que le volume
tient dans un tableur, l'activation manuelle est plus sûre qu'une intégration
mal rodée qui encaisse mal.

> **Conséquence si rien n'avait été fait :** le 15ᵉ jour, chaque client
> devenait lecture seule et aucun ne pouvait payer. Le produit était une
> démonstration.

**Ce qui a été livré** (20/10/2026) : `server/platform-admin.ts`,
`server/admin.ts` (18 routes), table `platform_operators` amorcée au
démarrage depuis `PLATFORM_ADMIN_EMAILS`, écran `/admin` atteint par le menu
utilisateur, 20 tests dans `tests/platform-admin.test.ts`. Le chemin 2
(encaissement intégré) reste ouvert et n'est pas contredit : la route
d'activation deviendra le point d'entrée du webhook.

---

## 2. Bloquant — Rien n'est prêt pour un déploiement

| Manque | Constat |
|---|---|
| Conteneur / plateforme | Ni `Dockerfile`, ni `Procfile`, ni `fly.toml`, ni `render.yaml` |
| Intégration continue | Pas de `.github/workflows/` — **les 209 tests ne tournent nulle part automatiquement** |
| Documentation | `README.md` s'arrête aux « Flux métier clés », aucune section de mise en production |

La base supporte bien un PostgreSQL externe (`DATABASE_URL`, `server/db.ts`
l. 574) avec repli PGlite en développement : ce point-là est sain.

Le reste est à écrire. L'absence de CI est la plus coûteuse : 209 tests qui ne
s'exécutent qu'à la main finissent par ne plus s'exécuter du tout.

---

## 3. Bloquant terrain — Aucun mode hors ligne

Recherche sur `serviceWorker|manifest.json|workbox|indexedDB|offline` dans
`src/`, `public/` et `index.html` : **aucun résultat**.

Le contexte d'usage rend ce manque sérieux. Une station de lavage à Abidjan
travaille sous un auvent, parfois en bordure de voie, avec une connexion
mobile qui tombe. Aujourd'hui, quand le réseau coupe :

- le caissier ne peut plus enregistrer un lavage ;
- il note sur un cahier ;
- la saisie n'est jamais rattrapée, ou l'est le soir, de mémoire.

Les recettes de la journée deviennent fausses, et le produit perd exactement
ce qu'il promet. **C'est le premier risque d'abandon après l'installation.**

La bonne nouvelle : l'architecture s'y prête déjà. Les écritures d'argent
passent par `withIdempotency` et une `Idempotency-Key` — rejouer une file
d'attente locale ne créera pas de doublon. Le travail porte sur :

1. un manifeste et un *service worker* pour que l'application se lance sans
   réseau (aucune dépendance nouvelle n'est nécessaire : Vite sait générer
   l'un et l'autre, ou on les écrit à la main) ;
2. une file d'écritures en IndexedDB, rejouée à la reconnexion ;
3. un indicateur d'état franc à l'écran — « 3 lavages en attente d'envoi » —
   car un mode hors ligne silencieux inquiète plus qu'il ne rassure.

---

## 4. Manque fonctionnel — Le client n'existe pas

La table `customers` est créée (`server/db.ts`), la colonne
`washes.customer_id` existe en clé étrangère… et **rien ne les alimente** :
aucune route, aucun écran. Seul `server/backup.ts` la cite, pour l'exporter
vide.

S'y ajoutent deux absences :

- **aucune plaque d'immatriculation** nulle part dans le schéma ni l'interface ;
- **aucun reçu ni ticket** imprimable ou partageable.

Ce que cela coûte concrètement :

- impossible de retrouver « la Corolla bleue de ce matin » ;
- impossible de distinguer un client fidèle d'un passage unique, donc pas
  d'abonnement client, pas de carte de fidélité, pas de relance ;
- le client repart sans preuve de ce qu'il a payé, ce qui est le premier motif
  de contestation à la caisse.

La table `customers` ne porte que `full_name` et `phone`. Il faudra trancher
si le client est une fiche, ou si le véhicule (plaque) est l'identifiant réel
— dans un lavage, c'est souvent le véhicule qu'on reconnaît, pas la personne.

---

## 5. Exploitation et sécurité

Rien ici n'est une faille ouverte, mais chaque ligne devient un problème le
jour où l'application tourne sur plus d'une instance.

| Point | État | Risque |
|---|---|---|
| Limitation de débit | En mémoire, par processus (`server/auth-router.ts` l. 25-36) | Remise à zéro à chaque redémarrage ; inopérante avec deux instances |
| Relances d'échéance | `setInterval` dans le processus (`server/reminders.ts` l. 186) | Deux instances = deux e-mails au même client |
| Vérification d'e-mail | Absente à l'inscription | N'importe quelle adresse, y compris celle d'un tiers |
| CSRF | Pas de jeton ; `sameSite: "none"` dès que HTTPS (`server/auth.ts` l. 158) | Atténué par le CORS restrictif en production et le `Content-Type: application/json` qui force un pré-vol — **à confirmer explicitement plutôt qu'à supposer** |

Le reste du modèle de session est sain : jeton opaque, cookie `httpOnly`,
seul le SHA-256 est stocké.

---

## 6. Dette et angles morts

- **`clerk_webhook_events`** : table créée, citée nulle part ailleurs.
  Reliquat d'une authentification Clerk abandonnée. À supprimer.
- **Aucun test de rendu de composant.** Les 209 tests couvrent le serveur et
  des contrôles statiques. C'est précisément par là qu'est passé le plantage
  `MenuGroupContext is missing` (commit `dd51140`) : un menu qui ne tombe
  qu'à l'ouverture, invisible pour `tsc` comme pour le build. Sans
  `jsdom`/`@testing-library` — donc sans nouvelle dépendance, contrainte
  posée — on ne peut pas faire mieux que les contrôles statiques actuels.
  **Cette contrainte mérite d'être rediscutée**, c'est la seule qui laisse
  passer une classe entière de défauts.
- ~~**« Assistance prioritaire »** (forfait Pro) : promesse sans définition.~~
  **Tranché** : délai de première réponse par forfait (Business 4 h ouvrées,
  Pro 1 jour, Starter 3 jours), affiché au client et mesuré dans la console.
  Voir `TARIFS.md` §6 et `BACK-OFFICE.md` §7.
- **« Suivi des sessions de caisse »** vendu en Pro mais disponible en
  Starter, et **« gestion des équipes »** différenciée seulement par le
  plafond : `TARIFS.md` §7.2 propose une reformulation, non tranchée.

---

## 7. Ordre recommandé

Le critère n'est pas la difficulté, c'est **ce qui empêche d'encaisser le
premier franc, puis de garder le premier client.**

| # | Chantier | Pourquoi d'abord | Ordre de grandeur |
|---|---|---|---|
| ~~1~~ | ~~**Activation manuelle des forfaits**~~ (§1, chemin 1) | **✅ Livré le 20/10/2026 — voir `BACK-OFFICE.md`** | — |
| 2 | **Déploiement + CI** (§2) | Sans elle, rien n'arrive chez le client et les tests s'érodent | Jours |
| 3 | **Mode hors ligne** (§3) | Premier motif d'abandon en conditions réelles | Semaines |
| 4 | **Client, plaque, reçu** (§4) | Première demande d'un exploitant une fois le quotidien couvert | Semaines |
| 5 | **Robustesse multi-instance** (§5) | Au moment de passer à deux instances, pas avant | Jours |
| 6 | **Dette** (§6) | En continu | — |

Les chantiers 1 et 2 étaient les seuls qui séparaient une démonstration d'un
produit vendable. **Le premier est fait.** Le chantier 2 — déploiement et
intégration continue — devient donc le prochain, et le dernier avant qu'un
client réel puisse s'inscrire, payer et être servi.

Tout le reste peut attendre ce premier client — et sera mieux conçu une fois
qu'on l'aura écouté.
