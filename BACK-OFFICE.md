# Console de l'éditeur

**Date : 20 octobre 2026 · Statut : livré**

Ce document décrit la console réservée au créateur de l'application : ce
qu'elle permet, pourquoi elle est **une application séparée** et non un écran
de plus dans le produit, et comment l'activer.

Elle répond d'abord au constat n°1 de `RESTE-A-FAIRE.md` — *« il n'existe
aucun back-office, aucun super-administrateur, aucune route d'activation »* —
puis à une exigence venue ensuite : **qu'aucune passerelle ne relie la console
à une station**, ni visible dans un menu, ni atteignable en devinant une URL.

> **Si vous ne lisez qu'un paragraphe.** La console vit sous `/console`, avec
> sa propre page de connexion, ses propres comptes et son propre cookie. Un
> compte de station ne peut pas y entrer ; un compte de console ne peut pas
> entrer dans une station. Ce ne sont pas deux rôles du même système, ce sont
> deux systèmes.

---

## 1. Ce que la console permet

Quatre familles, correspondant aux quatre raisons d'ouvrir cet écran.

### 1.1 Savoir où en est l'argent

Indicateurs du parc — stations, essais en cours, actifs, expirés, résiliés,
**échéances dépassées**, revenu mensuel récurrent — puis la file des
encaissements : intentions de paiement déclarées par les clients et en attente
de confirmation, demandes de forfait supérieur.

Et, sous **Revenus**, le registre complet : courbe sur douze mois, impayés,
produits constatés d'avance, exports comptables. Voir le §5.

### 1.2 Dépanner un client au téléphone

Fiche d'une station : forfait, échéance, jours restants, membres avec leur
dernière connexion, historique d'abonnement. De quoi répondre à « depuis quand
suis-je bloqué ? » sans ouvrir la base.

| Geste | Effet | Réversible |
|---|---|---|
| **Confirmer** un encaissement déclaré | active le forfait pour N mois | oui (suspension) |
| **Activer** un forfait directement | la station passe en `active` | oui |
| **Décliner** une demande | clôt la demande, **ne touche pas** à l'abonnement | oui |
| **Prolonger** un essai | repousse l'échéance d'un essai en cours | oui |
| **Réinitialiser** un mot de passe | produit un jeton de 60 min à dicter | sans objet |

### 1.3 Gérer finement les comptes

Retrouver une **personne** dans tout le parc à partir de son adresse, de son
nom ou de son numéro — l'entrée qui manquait, puisque le support reçoit
l'appel d'une personne et non d'une station. Puis : la retirer d'une station
sans toucher à ses autres, changer son rôle, **transférer la propriété** d'une
station dont le propriétaire est parti, bloquer un compte compromis partout à
la fois, fermer ses sessions. Le détail au §6.

Également : suspendre la station entière (lecture seule) et **supprimer une
organisation**, en deux temps, décrits au §4.

### 1.4 Surveiller

Journal de toutes les interventions de l'éditeur, filtrable par station, et
détection des stations **dormantes** (aucun lavage depuis 14 jours) — le
meilleur signal avancé d'un client qui s'en va.

### Le modèle économique que cela suppose

**Activation manuelle assistée.** Le paiement est encaissé hors application —
mobile money, virement, espèces — puis confirmé ici avec sa référence. Aucun
agrégateur n'est intégré à ce stade, et c'est volontaire : un contrat marchand
CinetPay ou Wave demande RCCM, CNI, IBAN ivoirien et trois à sept jours de
validation, et **le prélèvement récurrent sur mobile money reste l'exception**
en Afrique de l'Ouest (voir `WORKFLOW-PAIEMENT.md`). La console permet de
vendre dès maintenant sans rien jeter plus tard : `activateSubscription()`
restera le point d'entrée unique, qu'un humain l'appelle ou un webhook.

---

## 2. Activer la console

```bash
# .env
PLATFORM_ADMIN_EMAILS=vous@exemple.ci
PLATFORM_ADMIN_PASSWORD=UnMotDePasseLongEtUnique
```

Puis redémarrer. Au démarrage, `syncPlatformOperators()` **crée** les comptes
manquants, réactive ceux qui reviennent, et **désactive** tout opérateur absent
de la liste en supprimant ses sessions. Le journal l'indique :

```
[console] Operateur cree : vous@exemple.ci
```

Rendez-vous ensuite sur **`/console`** et connectez-vous. Variable vide ⇒
console entièrement fermée, y compris sa page de connexion.

### Ces comptes n'ont rien à voir avec les comptes de station

C'est le changement de fond de cette version. Auparavant, le droit
d'administration était un drapeau `platform_admin` posé sur un compte
ordinaire : la même personne, le même mot de passe, la même session servaient à
exploiter une station et à administrer la plateforme. Désormais les opérateurs
vivent dans leur propre table, `platform_operators`, sans lien avec `users`.

`PLATFORM_ADMIN_PASSWORD` ne sert **qu'à l'amorçage** : il pose le mot de passe
des comptes créés au démarrage. Il ne réécrit jamais un mot de passe existant,
et peut être retiré du fichier une fois les comptes en place.

Les installations antérieures sont reprises automatiquement :
`migrateLegacyPlatformAdmins()` recopie les anciens porteurs du drapeau dans la
nouvelle table, conserve leur mot de passe, puis éteint la colonne. Personne ne
perd son accès, mais plus personne ne l'obtient par ce chemin.

### Vous n'avez pas besoin d'exploiter une station

La console ne demande ni organisation, ni abonnement, ni parcours de mise en
service. Elle est montée **avant** la garde de session des stations dans
`server/app.ts`, et déclarée comme branche sœur de `RootLayout` dans
`App.tsx` — l'imbriquer dedans lui aurait imposé cette garde.

---

## 3. Les décisions structurantes

### 3.1 Deux applications, pas deux rôles

Pile complète et distincte à chaque étage :

| | Station | Console |
|---|---|---|
| URL | `/` | `/console` |
| Cookie | `washpilot_session` | `washpilot_console` |
| En-tête | `Bearer` | `Console` |
| Durée de session | 30 jours | **2 jours** |
| Table des comptes | `users` | `platform_operators` |
| Préfixe d'API | `/api/v1/...` | `/api/v1/console/...` |
| Garde | `requireSession` + `requireTenantContext` | `requireOperator` |

Les deux cookies ne se croisent jamais. Prouvé en conditions réelles : une
session de station appelant `/api/v1/console/metrics` reçoit **404** ; un
cookie de console appelant `/api/v1/subscription` reçoit **401**.

La session courte est délibérée : un poste de console ouvert chez un
partenaire est un risque bien plus lourd qu'une caisse ouverte en station.

### 3.2 Aucune passerelle depuis le produit

Rien dans l'application station ne mentionne la console : ni entrée de menu,
ni lien dans l'avatar, ni redirection après connexion. Un test parcourt `src/`
et **échoue si `/console` apparaît ailleurs que dans `src/console/` et la
déclaration de route d'`App.tsx`**. L'ancienne page `/admin` et son client API
ont été supprimés du dépôt, pas seulement masqués.

### 3.3 Le refus est un 404, jamais un 403

Un 403 confirme l'existence de ce qu'il protège. Toute requête de console sans
opérateur valide reçoit `404 not_found`, le corps exact d'une route inexistante.
Pour qui sonde l'application, la console n'existe pas.

### 3.4 Toute intervention est inscrite chez le client

Chaque action écrit **deux** traces : une dans `platform_audit_logs` (vue de
l'éditeur) et une dans les `audit_logs` **de la station concernée**, visible du
propriétaire dans son journal. Si l'éditeur intervient sur des données, le
client doit pouvoir le lire chez lui. C'est la règle « on délègue
l'enregistrement, jamais la réécriture » appliquée à l'éditeur lui-même.

### 3.5 Aucune coupure automatique

Un abonnement `active` dont l'échéance est passée **n'est jamais coupé par le
système**. Il est signalé `past_due` dans les indicateurs, et un humain décide.
Un virement peut avoir deux jours de retard ; couper la caisse d'un client en
plein samedi après-midi pour cela serait indéfendable.

### 3.6 Prolonger un forfait payant est refusé

`extend-trial` sur un abonnement actif renvoie **409 `subscription_active`**.
Prolonger « l'essai » d'un client qui paie est une façon déguisée d'offrir des
jours sans trace comptable. Le geste légitime est une activation avec sa
référence.

---

## 4. La suppression d'organisation, en deux temps

Le non-but « la console ne supprime pas » est **levé** : un client a le droit
de partir, et de voir ses données disparaître. Mais une suppression immédiate
est irréparable, et une suppression différée sans coupure laisse un client
convaincu d'être parti continuer à travailler.

D'où deux temps :

| Temps | Route | Effet |
|---|---|---|
| **1. Programmer** | `POST /organizations/:id/schedule-deletion` | accès **coupé immédiatement**, purge datée à +30 jours |
| **1 bis. Annuler** | `POST /organizations/:id/cancel-deletion` | données intactes, accès rétabli |
| **2. Purger** | `POST /organizations/:id/purge` | effacement définitif, 22 tables |

Points décidés :

- **La coupure est immédiate, pas différée.** Programmer la suspension
  résilie l'abonnement et efface les sessions ouvertes. `requireTenantContext`
  refuse alors toute requête avec `403 organization_deleted`. Un délai de grâce
  protège les données, pas l'usage.
- **Annuler ne rend pas l'abonnement.** La station retrouve ses données et sa
  connexion, pas son forfait : il faut le réactiver explicitement. Une
  annulation de suppression n'est pas un cadeau commercial.
- **La purge exige le nom exact** de la station dans `confirm_name`, comparé
  après `trim()`. Sinon `400 confirmation_mismatch`.
- **Un utilisateur membre d'une autre station survit** à la purge. Seuls les
  comptes dont c'était la seule appartenance disparaissent.
- **Les écritures de l'éditeur survivent.** `platform_audit_logs` est écrit
  *après* la purge, avec `organization_id` à `null` : la trace de la
  suppression ne peut pas être effacée par la suppression elle-même.
- Les purges échues s'exécutent dans le même `tick()` que les relances
  (`server/reminders.ts`), une fois par heure.

**Si vous ajoutez une table portant `organization_id`**, ajoutez-la à
`PURGE_ORDER` dans `server/organization-deletion.ts`, ou à `PURGE_EXEMPT` si
elle doit survivre. Un test compare ces deux listes au schéma réel via
`information_schema` et **échoue** si une table n'est dans ni l'une ni l'autre.
C'est le garde-fou qui évite qu'une purge laisse des orphelins six mois après.

---

## 5. Les revenus

### 5.1 Un registre, parce qu'il n'y en avait pas

Avant cette version, **aucune table ne contenait l'argent encaissé**. Les
paiements passés par le parcours client vivaient dans `payment_intents` ;
ceux saisis directement dans la console — un virement, des espèces — ne
laissaient qu'une ligne d'audit, le montant enfoui dans du JSON. Toute courbe
bâtie là-dessus aurait sous-estimé les recettes sans prévenir.

`subscription_payments` est désormais la seule source de vérité du chiffre
d'affaires, et elle est écrite **à un seul endroit** :
`activateSubscription()`. C'est le même point de passage unique que pour
l'activation, et pour la même raison — le jour où un webhook d'agrégateur
activera des forfaits, il alimentera le registre sans qu'on y pense.

Une intention de paiement n'y entre pas : elle peut échouer ou rester en
attente. **Déclarer n'est pas payer.**

### 5.2 Deux lectures du même argent

Un client qui règle six mois d'avance verse tout en une fois. Le lire comme
un seul mois donne une pointe suivie de cinq mois morts ; on en conclut que
l'activité s'effondre. La console affiche donc les deux ensemble :

| Lecture | Ce qu'elle répond | Sur le graphique |
|---|---|---|
| **Encaissement** | de quoi je paie mes factures | les barres |
| **Revenu reconnu** | est-ce que ça croît vraiment | la ligne |

L'étalement se fait **au prorata des jours**, pas par mois entier : une
période du 15 mars au 15 juin couvre quatre mois civils, et un découpage en
tiers décalerait la courbe d'une quinzaine. Le dernier mois absorbe
l'arrondi, de sorte que la somme des parts égale toujours le montant exact.
Un test de propriété le vérifie sur deux mille montants — quelques cas
choisis à la main passent même avec un arrondi faux, c'est l'erreur qui a
d'abord échappé à la suite.

S'y ajoute une troisième grandeur, **l'encaissé d'avance** : la part des
périodes qui courent encore. Ce n'est pas du bénéfice, c'est une dette — si
le client part demain, elle lui est due.

### 5.3 Impayés

Deux natures, délibérément séparées :

- **à risque** — des stations `active` dont l'échéance est passée. Elles
  travaillent toujours, puisque rien n'est coupé automatiquement, mais ne
  paient plus. Une station programmée pour suppression en sort : on ne lui
  réclamera rien.
- **en attente** — le client affirme avoir payé, l'éditeur n'a pas vérifié.

### 5.4 Exports

Deux formats, même registre, exportant **tout** l'historique et non la page
affichée. CSV à point-virgule avec BOM UTF-8, faute de quoi Excel en français
affiche « StÃ©phane ».

**Détaillé** — une ligne par encaissement, avec les dates de début et de fin
de période.

**Journal SYSCOHADA** — écritures équilibrées, sur la base de l'encaissement
(celle du Système Minimal de Trésorerie, que retiennent la plupart des très
petites entités). Un cabinet tenant une comptabilité d'engagement voudra en
plus constater les produits d'avance : l'export détaillé porte pour cela les
périodes que le journal n'exprime pas.

| Canal | Compte débité |
|---|---|
| Espèces | **571** Caisse siège social |
| Virement | **521** Banques locales |
| Orange Money, MTN, Moov, Wave | **552** Monnaie électronique, téléphone portable |
| *(contrepartie)* | **7065** Services vendus sur internet |

Le compte 552 n'est pas un détail. Le SYSCOHADA révisé a créé la classe 55
précisément pour que le mobile money cesse d'être rangé en caisse ou en
banque par approximation : un encaissement Wave n'est ni l'un ni l'autre, et
tout mettre en 571 rendrait le rapprochement du portefeuille impossible.

Les comptes sont regroupés dans `SYSCOHADA_ACCOUNTS`
(`server/revenue.ts`) : un cabinet qui tient un plan différent n'a qu'un seul
endroit à corriger. `VAT_RATE` vaut `0` — l'éditeur n'est pas assujetti à ce
stade — et le compte **4431** est déjà déclaré pour le jour où il le sera.

### 5.5 Corriger une erreur

Une ligne de registre ne se modifie ni ne se supprime : on écrit son
inverse, avec un motif. C'est la règle « annulation tracée plutôt que
suppression », qui n'est plus ici une préférence mais une obligation — un
journal dont on peut retirer une ligne ne prouve rien. Dans l'export, une
contrepassation s'écrit en **sens inversé** et non en montant négatif : un
journal ne contient pas de nombres négatifs.

Elle touche l'argent, **pas le droit d'accès** : l'abonnement reste actif.
Si l'activation était une erreur, il faut aussi suspendre, et c'est un geste
distinct.

### 5.6 Le registre survit à la suppression du client

`subscription_payments` figure dans `PURGE_EXEMPT`. Purger une station
efface ses données mais pas le chiffre d'affaires qu'elle a payé : l'argent
a bien été reçu, il reste au bilan. La ligne est conservée, son
`organization_id` passé à `null`, et le nom recopié à l'écriture la garde
lisible dans un export.

---

## 6. Les comptes

Le reste de la console est organisé par station. Cette famille existe parce que
**le support reçoit l'appel d'une personne, pas d'une station** : « bonjour, je
n'arrive plus à me connecter », sans nom de station et souvent sans savoir quel
rôle elle occupe.

### 6.1 Deux états qu'il ne faut pas confondre

C'est la distinction qui structure toute la famille, et l'avoir manquée a
produit un défaut livré en production (§6.5).

| | Porté par | Dit quoi | Portée |
|---|---|---|---|
| **Appartenance** | `organization_members.status` | travaille-t-elle encore dans *cette* station ? | une station |
| **Compte** | `users.status` | peut-elle se connecter, *où que ce soit* ? | tout le parc |

Quelqu'un qui travaille sur deux stations peut quitter l'une sans perdre
l'autre. Un compte compromis doit pouvoir être coupé partout d'un seul geste.
Ce sont deux besoins réels, donc **deux gestes distincts** — jamais une case
unique « désactiver ».

Vérifié de bout en bout : un caissier retiré de sa station **se connecte
toujours** (son compte est vivant) mais reçoit `403 membership_disabled` sur la
station. `requireTenantContext` relit l'appartenance à chaque requête, donc le
retrait est immédiat — et aucune session n'est supprimée, sans quoi la personne
serait déconnectée de ses autres stations, où elle n'a rien fait.

### 6.2 Les gestes

| Geste | Route | Portée | Garde-fou |
|---|---|---|---|
| Retirer de cette station | `POST /organizations/:id/members/:userId/status` | une station | — |
| Changer le rôle | `POST /organizations/:id/members/:userId/role` | une station | `last_owner`, `role_unchanged` |
| Bloquer le compte partout | `POST /accounts/:userId/status` | tout le parc | `last_owner` sur **toutes** ses stations |
| Déconnecter tous les appareils | `POST /accounts/:userId/revoke-sessions` | tout le parc | — |
| Réinitialiser le mot de passe | `POST /organizations/:id/members/:userId/reset-password` | le compte | lien valable 1 h |

Tous exigent un **motif d'au moins cinq caractères**, inscrit dans le journal du
client *et* dans celui de l'éditeur.

### 6.3 Pourquoi l'éditeur peut changer un rôle

La question se pose : toucher à la hiérarchie d'un client, est-ce légitime ?

Le cas qui tranche est celui du **propriétaire parti sans successeur**. Plus
personne ne peut inviter, facturer ni gérer l'équipe, et le client ne peut pas
s'en sortir seul — c'est précisément le moment où il appelle. Refuser serait
d'ailleurs incohérent : l'opérateur peut déjà suspendre l'abonnement et
programmer la suppression de la station entière.

Le **transfert de propriété se fait en deux temps**, et l'ordre est imposé par
le garde-fou lui-même : nommer d'abord le nouveau propriétaire, rétrograder
l'ancien ensuite. Tenter l'inverse renvoie `409 last_owner`. Il n'y a donc
aucun instant où la station se retrouve sans administrateur.

Un changement de rôle **efface les permissions accordées à titre exceptionnel**
à cette personne dans cette station. Elles avaient été consenties pour l'ancien
périmètre ; les conserver donnerait au nouveau rôle des droits que personne n'a
décidés — un gérant rétrogradé caissier garderait l'accès au journal d'audit.
La réponse indique combien ont été retirées, et l'écran le dit à l'opérateur.

### 6.4 Le garde-fou du dernier propriétaire

Bloquer un compte ou retirer un rôle est refusé (`409 last_owner`) si la
personne est le **dernier propriétaire actif** d'au moins une station. Le
contrôle porte sur **toutes** ses stations, pas seulement celle qu'on regarde :
quelqu'un peut être second propriétaire ici et seul propriétaire ailleurs. Le
message nomme les stations bloquantes.

Les stations déjà programmées pour suppression sont exclues du contrôle — y
préserver un propriétaire n'a plus d'objet.

La fiche d'une personne affiche cet avertissement **avant** qu'on essaie, et le
bouton de blocage est désactivé tant que la situation dure.

### 6.5 Le défaut corrigé au passage

`POST /organizations/:id/members/:userId/status` répondait **500** depuis sa
mise en service. Elle écrivait `users.status = 'disabled'`, valeur que la
contrainte `users_status_check` refuse — cette colonne n'accepte que `active`
ou `inactive`. La route confondait les deux états du §6.1 : elle prétendait
retirer quelqu'un d'une station et bloquait son compte partout.

Les 265 tests passaient. **Aucun ne l'exerçait** : la route avait été livrée
sans jamais être appelée de bout en bout. C'est la leçon retenue — une suite
verte ne dit rien d'un chemin que personne n'a parcouru. Les 20 tests de
`tests/console-accounts.test.ts` commencent par cette régression.

### 6.6 Ce que cette famille ne fait pas

- **Changer l'adresse e-mail d'un compte.** L'adresse est l'identifiant de
  connexion ; la modifier depuis la console permettrait de rediriger un compte
  vers une boîte que l'opérateur contrôle. Le client la change lui-même.
- **Se connecter à la place d'un client.** Décision de la §3, inchangée.
- **Supprimer un compte.** Un compte n'est purgé que lorsque sa dernière
  station l'est (§4).

## 7. Les routes

Toutes sous `/api/v1/console`, toutes derrière `requireOperator`.

**Identité** — `POST /auth/login` · `POST /auth/logout` · `GET /auth/me`

**Lecture** — `GET /metrics` · `GET /organizations?q=&status=&limit=&offset=` ·
`GET /organizations/:id` · `GET /organizations/:id/members` ·
`GET /upgrade-requests?pending=` · `GET /plans` ·
`GET /payment-intents?status=&declared=` · `GET /audit?organization_id=&limit=` ·
`GET /revenue?months=` · `GET /revenue/export?format=detail|journal&from=&to=` ·
`GET /accounts?q=&limit=` · `GET /accounts/:userId`

**Écriture** — `POST /organizations/:id/activate {plan_code, months≤36,
payment_reference?, note?}` · `/suspend {reason}` · `/extend-trial {days≤90,
reason}` · `/schedule-deletion {reason≥10, grace_days?}` · `/cancel-deletion` ·
`/purge {confirm_name}` · `POST /members/:userId/reset-password` ·
`POST /members/:userId/status {status: active|disabled, reason≥3}` ·
`POST /members/:userId/role {role, reason≥5}` ·
`POST /accounts/:userId/status {status: active|inactive, reason≥5}` ·
`POST /accounts/:userId/revoke-sessions {reason≥5}` ·
`POST /upgrade-requests/:id/decline {reason 3-300}` ·
`POST /payment-intents/:reference/confirm {note?, channel?}` ·
`POST /revenue/:id/reverse {reason≥10}`

### Deux subtilités qui comptent

**Toute activation converge vers `activateSubscription()`**, dans
`server/subscription-service.ts`. Confirmation d'encaissement, activation
directe, futur webhook : un seul endroit calcule les dates, purge le cache et
écrit la trace. C'est ce qui permettra de brancher un agrégateur sans
réécrire la console.

**`actorUserId` est nullable.** Un opérateur de console n'est pas un
utilisateur de station : il ne peut pas être l'auteur d'une ligne d'audit
`audit_logs` au sens habituel. L'auteur est alors `null`, et le libellé porte
l'adresse de l'opérateur.

---

## 8. Ce que la console ne fait pas, volontairement

- **Pas d'usurpation d'identité.** Aucun « se connecter en tant que ». Voir
  les données d'un client est une chose, agir en son nom une autre.
- **Pas d'édition des tarifs.** Les forfaits et leurs limites restent dans le
  code et les migrations. Un prix modifié à chaud, sans trace ni revue, est
  une source de litige.
- **Pas de modification des données d'exploitation.** La console ne corrige
  pas un lavage, ne touche pas une caisse. Elle administre des abonnements et
  des comptes.
- **Pas de changement d'adresse e-mail.** L'adresse est l'identifiant de
  connexion : la modifier depuis la console permettrait de rediriger un compte
  vers une boîte que l'opérateur contrôle.
- **Pas de notification automatique au client.** Les gestes de l'éditeur ne
  déclenchent pas d'e-mail ; seules les relances d'échéance en envoient.

---

## 9. Vérification

```bash
# Suite complète (285 tests)
NODE_ENV=test npm test

# Ciblé
NODE_ENV=test npx tsx --test tests/platform-admin.test.ts    # 26 tests
NODE_ENV=test npx tsx --test tests/console-deletion.test.ts  # 12 tests
NODE_ENV=test npx tsx --test tests/revenue.test.ts           # 23 tests
NODE_ENV=test npx tsx --test tests/console-accounts.test.ts  # 20 tests
```

Parcours manuel utile, serveur lancé :

```bash
# 1. Entrer dans la console
curl -s -c /tmp/c.txt -X POST localhost:3000/api/v1/console/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@washpilot.ci","password":"ConsoleWashPilot2026!"}'

# 2. Vérifier l'étanchéité : une session de station doit recevoir 404
curl -s -b /tmp/station.txt localhost:3000/api/v1/console/metrics

# 3. Vérifier l'étanchéité inverse : le cookie de console doit recevoir 401
curl -s -b /tmp/c.txt localhost:3000/api/v1/subscription
```

Les quatre comportements de la suppression sont couverts par un **test par
mutation** : neutraliser la coupure immédiate, autoriser une purge non
programmée, retirer une table de `PURGE_ORDER` ou supprimer la clause
protégeant les comptes multi-stations font chacun échouer la suite.

La famille « comptes » l'est aussi : réécrire `users.status` depuis la route
d'appartenance (le défaut du §6.5), retirer le garde-fou du dernier
propriétaire, conserver les permissions exceptionnelles lors d'un changement de
rôle, ou ignorer les stations en suppression dans le garde-fou — les quatre
sont détectés.

---

## 10. Prochaines marches

1. **Brancher un agrégateur** (CinetPay couvre Wave, Orange, MTN et Moov en
   une intégration) : le webhook appellera `activateSubscription()`, la file de
   confirmation deviendra le mode dégradé plutôt que le mode normal.
2. **Réconciliation** entre le registre et le relevé de l'agrégateur, une fois
   celui-ci branché : comparer chaque jour ce qu'on croit avoir encaissé et ce
   que le prestataire a réellement versé.
3. **Supervision technique** — la famille qui reste : santé du service,
   erreurs, lenteurs, alerte quand une station cesse d'émettre. Aujourd'hui un
   incident se découvre par l'appel d'un client.
4. **Second opérateur avec droits restreints** — lecture seule pour une
   personne au support, écriture réservée au créateur. Aujourd'hui tous les
   opérateurs sont égaux ; il faudrait ajouter une colonne `role` à
   `platform_operators` et la lire dans `requireOperator`.
