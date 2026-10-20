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

Suspendre ou réactiver un membre d'une station sans toucher aux autres ;
suspendre la station entière (lecture seule) ; et, nouveauté de cette version,
**supprimer une organisation** — en deux temps, décrits au §4.

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

## 5. Les routes

Toutes sous `/api/v1/console`, toutes derrière `requireOperator`.

**Identité** — `POST /auth/login` · `POST /auth/logout` · `GET /auth/me`

**Lecture** — `GET /metrics` · `GET /organizations?q=&status=&limit=&offset=` ·
`GET /organizations/:id` · `GET /organizations/:id/members` ·
`GET /upgrade-requests?pending=` · `GET /plans` ·
`GET /payment-intents?status=&declared=` · `GET /audit?organization_id=&limit=`

**Écriture** — `POST /organizations/:id/activate {plan_code, months≤36,
payment_reference?, note?}` · `/suspend {reason}` · `/extend-trial {days≤90,
reason}` · `/schedule-deletion {reason≥10, grace_days?}` · `/cancel-deletion` ·
`/purge {confirm_name}` · `POST /members/:userId/reset-password` ·
`POST /members/:userId/status {status, reason}` ·
`POST /upgrade-requests/:id/decline {reason 3-300}` ·
`POST /payment-intents/:reference/confirm {note?}`

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

## 6. Ce que la console ne fait pas, volontairement

- **Pas d'usurpation d'identité.** Aucun « se connecter en tant que ». Voir
  les données d'un client est une chose, agir en son nom une autre.
- **Pas d'édition des tarifs.** Les forfaits et leurs limites restent dans le
  code et les migrations. Un prix modifié à chaud, sans trace ni revue, est
  une source de litige.
- **Pas de modification des données d'exploitation.** La console ne corrige
  pas un lavage, ne touche pas une caisse. Elle administre des abonnements et
  des comptes.
- **Pas de notification automatique au client.** Les gestes de l'éditeur ne
  déclenchent pas d'e-mail ; seules les relances d'échéance en envoient.

---

## 7. Vérification

```bash
# Suite complète (242 tests)
NODE_ENV=test npm test

# Ciblé
NODE_ENV=test npx tsx --test tests/platform-admin.test.ts    # 26 tests
NODE_ENV=test npx tsx --test tests/console-deletion.test.ts  # 12 tests
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

---

## 8. Prochaines marches

1. **Brancher un agrégateur** (CinetPay couvre Wave, Orange, MTN et Moov en
   une intégration) : le webhook appellera `activateSubscription()`, la file de
   confirmation deviendra le mode dégradé plutôt que le mode normal.
2. **Export comptable** des encaissements confirmés, au format attendu par un
   cabinet ivoirien.
3. **Second opérateur avec droits restreints** — lecture seule pour une
   personne au support, écriture réservée au créateur. Aujourd'hui tous les
   opérateurs sont égaux ; il faudrait ajouter une colonne `role` à
   `platform_operators` et la lire dans `requireOperator`.
