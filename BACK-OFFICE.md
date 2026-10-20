# Back-office de l'éditeur

**Date : 20 octobre 2026 · Statut : livré**

Ce document décrit l'écran d'administration réservé au créateur de
l'application, les décisions qui l'ont façonné, et la façon de l'activer.

Il répond au constat n°1 de `RESTE-A-FAIRE.md` : *« il n'existe aucun
back-office, aucun super-administrateur, aucune route d'activation »*. Un
client qui voulait payer ne le pouvait pas — la dernière marche du parcours
n'existait pas, et seul un `UPDATE` SQL manuel pouvait activer un forfait.

---

## 1. Ce que l'écran permet

Deux gestes, exactement ceux demandés : **valider** et **exclure**.

| Geste | Effet | Réversible |
|---|---|---|
| **Valider** une demande / activer un forfait | la station passe en `active` pour N mois | oui (suspension) |
| **Décliner** une demande | clôt la demande, **ne touche pas** à l'abonnement | oui (nouvelle demande) |
| **Suspendre** une station | passage en lecture seule (`cancelled`) | oui (réactivation) |
| **Prolonger** un essai | repousse l'échéance d'un essai en cours | oui |

Et de quoi décider : indicateurs du parc (stations, essais, actifs, expirés,
échéances dépassées, revenu mensuel), liste filtrable et recherche par nom ou
e-mail du propriétaire, fiche détaillée avec membres et historique.

### Le modèle économique qu'il suppose

**Activation manuelle assistée.** Le paiement est encaissé hors application
— mobile money, virement, espèces — puis l'activation est saisie ici avec sa
référence de paiement. Aucun agrégateur de paiement n'est intégré à ce stade,
et c'est volontaire : brancher Wave ou Orange Money demande un contrat
marchand, une vérification d'identité d'entreprise et des semaines de
validation. Le back-office permet de vendre **dès maintenant**, et de brancher
un agrégateur plus tard sans rien jeter — la route d'activation restera le
point d'entrée, qu'elle soit appelée par un humain ou par un webhook.

---

## 2. Activer le back-office

```bash
# .env
PLATFORM_ADMIN_EMAILS=votre.adresse@exemple.ci
```

Puis redémarrer le serveur. Au démarrage, `syncPlatformAdmins()` pose le
drapeau `platform_admin` sur les comptes listés et le **retire de tous les
autres**. Le journal l'indique :

```
[admin] Administrateurs de plateforme promus : 1
```

Le compte doit déjà exister (inscrivez-vous normalement d'abord). Une fois
connecté, l'entrée **« Administration »** apparaît dans le menu de votre
avatar, en haut à droite. Variable vide ⇒ back-office entièrement fermé.

Plusieurs adresses se séparent par des virgules.

---

## 3. Les cinq décisions structurantes

### 3.1 Le droit ne s'accorde que par variable d'environnement

Aucune route n'attribue `platform_admin` — ni `/access`, ni `/auth/profile`,
ni le back-office lui-même. Le droit vient du fichier `.env`, au démarrage.

La raison : ce drapeau est le seul du système qui **franchit l'isolation entre
clients**. S'il devenait délégable depuis l'interface, le premier propriétaire
curieux qui trouverait la faille lirait les chiffres d'affaires de tous les
autres lavages de la ville. Un droit pareil n'a pas sa place dans une matrice
de permissions ; il appartient à la configuration du serveur.

C'est aussi pourquoi `platform_admin` **ne figure pas dans
`server/permissions.ts`** : il n'est pas un rôle de locataire, il est hors du
modèle de locataire.

Un test vérifie cette garantie à la source : une seule fonction écrit cette
colonne, et aucune requête HTTP ne l'atteint.

### 3.2 Le refus est un 404, jamais un 403

Un `403 forbidden` confirmerait qu'il y a quelque chose à cette adresse. Pour
tout compte ordinaire, le back-office **n'existe pas** : `404 not_found`, le
même message que n'importe quelle URL inventée.

Un gérant qui tape `/api/v1/admin/metrics` par curiosité n'apprend rien. Il ne
saura même pas qu'il existe une surface à attaquer.

### 3.3 Toute intervention est inscrite chez le client

`auditPlatformAction()` écrit dans les `audit_logs` **de la station
concernée**, pas dans un registre séparé de l'éditeur. Le propriétaire voit
donc, dans son propre historique :

> **Forfait activé** — Système · réf. WAVE-884213

Une action de l'éditeur invisible de celui qui la subit serait une porte
dérobée, pas une administration. Si vous suspendez une station, son
propriétaire doit pouvoir lire pourquoi — c'est d'ailleurs la première chose
qu'il cherchera en appelant l'assistance.

Les cinq actions sont traduites en français dans `server/audit-log.ts`, et
`subscription.suspended` est classée en *Vigilance* pour qu'elle se repère
d'un coup d'œil.

### 3.4 Aucune coupure automatique

Un forfait payant dont l'échéance est passée **n'est pas coupé**. Il apparaît
en « Échéance dépassée » avec le nombre de jours de retard, et c'est tout.

`computeSubscriptionState` ne fait expirer que les essais ; `active` ne
s'éteint jamais tout seul. Couper automatiquement le service d'un client qui a
payé onze mois parce qu'un virement a trois jours de retard, c'est perdre le
client. Le back-office rend le retard **visible**, et la suspension reste un
geste humain, pris en connaissance de cause.

Le filtre « Échéance dépassée » de la liste sert exactement à cela : votre
liste d'appels du lundi matin.

### 3.5 Prolonger un forfait payant est refusé

`POST /extend-trial` sur une station en `active` répond **409
`subscription_active`**.

Ce garde-fou vient d'un test manuel qui a révélé le défaut : prolonger un
abonnement payant le repassait en `trialing`, remplaçant trois mois payés par
sept jours d'essai. La bonne action pour un client payant est l'activation
(qui renouvelle), pas le geste commercial.

Dans le même esprit, la prolongation ne part de l'échéance existante que s'il
s'agit d'un **essai encore en cours**. Essai échu ou abonnement résilié : on
repart d'aujourd'hui, sinon hériter de l'échéance d'un forfait payé offrirait
des mois d'essai par accident.

---

## 4. Les routes

Toutes sous `/api/v1/admin`, montées **avant** `requireTenantContext` — le
back-office ne parle pas d'une station, il parle du parc.

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/metrics` | indicateurs du parc |
| `GET` | `/organizations?q=&status=&limit=&offset=` | liste filtrable |
| `GET` | `/organizations/:id` | fiche + membres + historique |
| `GET` | `/upgrade-requests?pending=` | demandes des clients |
| `GET` | `/plans` | forfaits disponibles |
| `POST` | `/organizations/:id/activate` | `{plan_code, months≤36, payment_reference?, note?}` |
| `POST` | `/organizations/:id/suspend` | `{reason}` → lecture seule |
| `POST` | `/organizations/:id/extend-trial` | `{days≤90, reason}` |
| `POST` | `/upgrade-requests/:id/decline` | `{reason}` → clôt la demande |

### Deux subtilités qui comptent

**Le statut affiché est l'état effectif, pas le statut stocké.** Un essai dont
l'échéance est passée est stocké `trialing` mais vaut `expired` pour
l'application. Le back-office affiche `expired` et conserve `stored_status`
pour le diagnostic. Deux vérités divergentes entre l'écran d'administration et
le comportement réel seraient pires que pas d'écran du tout.

**Une demande cesse d'être en attente dès qu'elle a reçu une réponse** — un
oui (activation) comme un non (refus). La règle est écrite une seule fois
(`PENDING_CLAUSE`) pour que le compteur du tableau de bord et la liste
comptent la même chose.

---

## 5. Ce que le back-office ne fait pas, volontairement

| Absent | Pourquoi |
|---|---|
| Supprimer une station | la suspension suffit ; détruire les données d'un client n'est jamais un geste d'administration courante |
| Se connecter à la place d'un client | fonction la plus pratique et la plus dangereuse ; à n'ajouter qu'avec consentement explicite et traçabilité renforcée |
| Modifier les tarifs | les prix vivent en base (`plans`) ; les changer à chaud sans versionner casserait la facturation des abonnements en cours |
| Créer un compte | l'inscription reste publique |
| Encaisser un paiement | aucun agrégateur intégré (voir §1) |

---

## 6. Vérification

`tests/platform-admin.test.ts` — **20 tests**, le refus d'abord :

- le back-office est invisible pour un gérant et un caissier (404 sur quatre routes) ;
- un propriétaire ne peut pas s'offrir le forfait Business ;
- sans session : 401 ;
- aucune route n'accorde `platform_admin` (vérifié à la source) ;
- activation → `audit.read` passe de 402 à 200, l'effet est réel côté client ;
- l'activation figure dans l'historique **du client** avec sa référence ;
- un renouvellement anticipé ne fait pas perdre les jours payés ;
- suspension → lecture seule, mais lecture et export toujours ouverts ;
- prolongation d'un essai échu → 7 jours pleins, pas 2 ;
- prolongation d'un payant → 409 ;
- la liste montre l'état effectif, pas le statut stocké ;
- une échéance dépassée est signalée sans couper ;
- le revenu mensuel ignore les essais ;
- une demande déclinée cesse d'être en attente, sans toucher à l'abonnement.

Ces tests ont été vérifiés par mutation : altérer le code de production
(404 → 403, suppression du garde-fou 409, perte des jours payés, refus qui ne
clôt pas la demande) les fait échouer à chaque fois.

```bash
NODE_ENV=test npx tsx --test tests/platform-admin.test.ts
```

---

## 7. Prochaines marches

Par ordre d'utilité décroissante :

1. **Relances automatiques des échéances dépassées** — la liste existe, l'envoi
   reste manuel.
2. **Export CSV du parc** — pour la comptabilité et le suivi commercial.
3. **Intégration d'un agrégateur** (Wave, Orange Money) — la route d'activation
   devient alors un webhook ; rien d'autre ne bouge.
4. **Historique des activations par station** — aujourd'hui lisible dans les
   `audit_logs`, pas encore présenté comme un échéancier.
