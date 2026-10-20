# Grille tarifaire — hypothèses, écarts et marche à suivre

Date : 20 octobre 2026. Monnaie : franc CFA (XOF), par station et par mois.

Ce document contient le **raisonnement commercial**, qui n'a pas sa place sur
la page publique. La page affiche les prix ; ce fichier explique pourquoi.

---

## 1. Les trois forfaits

| Forfait | Positionnement | Prix mensuel | Pour qui |
|---|---|---|---|
| **Starter** | Entrée de gamme | **10 000 FCFA** | Petites stations qui veulent abandonner le cahier de caisse |
| **Pro** | Offre principale | **20 000 FCFA** | Stations à plusieurs laveurs, besoin de contrôle opérationnel |
| **Business** | Stations structurées | **35 000 FCFA** | Grosses stations, propriétaires multi-sites |

Trois forfaits, pas davantage : au-delà, le gérant compare au lieu de choisir.

### Contenu

**Starter** — Enregistrement des lavages et des prestations · Catalogue de
services et prix · Recettes par mode de paiement · Suivi simple des dépenses ·
Rapport quotidien.

**Pro** — Tout Starter, plus : Gestion des équipes et des attributions · Suivi
des sessions de caisse · Suivi des dépenses et des marges opérationnelles ·
Rapports détaillés et exports · Historique des opérations et traçabilité ·
Assistance prioritaire.

**Business** — Tout Pro, plus : Gestion multi-sites selon les limites du
forfait · Vue consolidée du propriétaire · Permissions avancées · Rapports
consolidés · Accompagnement à la mise en service.

---

## 2. Pourquoi ces prix — et pourquoi ce n'est pas sur la page

> Ces prix sont des **hypothèses commerciales à tester** auprès des gérants
> ivoiriens, pas des tarifs validés par le marché. Ils restent dans une gamme
> qui mérite d'être testée pour un SaaS professionnel.
>
> À titre de comparaison indicative, AutoAfrique, fournisseur de logiciels de
> gestion automobile en Afrique de l'Ouest, affiche des forfaits de 15 000 et
> 45 000 FCFA par mois pour des activités voisines. Ce n'est **pas** une
> preuve que les gérants de stations de lavage accepteront ces prix : l'activité
> diffère, la capacité à payer aussi.

Ce paragraphe est resté hors de la page vitrine, pour deux raisons :

1. **Annoncer à un prospect que vos prix sont des hypothèses non validées
   détruit la vente.** Une page tarifaire doit affirmer un prix ; le doute se
   teste par les conversions et les entretiens, pas en l'écrivant au visiteur.
2. **Citer un concurrent nommément sur sa propre page tarifaire se retourne
   contre soi** : cela installe la comparaison sur le terrain du prix, envoie
   le lecteur chercher l'autre offre, et expose à une contestation si le tarif
   cité évolue.

La page porte à la place une phrase sobre et vérifiable : prix en francs CFA,
par station et par mois, sans engagement caché.

**Comment tester réellement les prix** : faire varier le prix affiché par
cohortes, mesurer le taux de passage essai → abonnement, et surtout mener des
entretiens avec une dizaine de gérants. Trois forfaits affichés ne valident
rien à eux seuls.

---

## 3. Essai gratuit

**14 jours, sans carte bancaire**, puis conversion vers un abonnement payant.

Cette durée est dans la fourchette de 7 à 14 jours recommandée, et elle est
**déjà en place** : `TRIAL_DAYS = 14` dans `server/entitlements.ts`, avec
compte à rebours, bandeau d'alerte et bascule en lecture seule à l'échéance
(voir `ESSAI-GRATUIT.md`).

À l'échéance, l'espace reste **consultable** : les données ne sont ni bloquées
ni supprimées, seuls les nouveaux enregistrements exigent un forfait. C'est ce
qui distingue une restriction d'une prise d'otage, et c'est ce qui permet de
reconquérir un gérant parti trois mois.

Le principe « ne pas laisser toutes les fonctionnalités gratuites
indéfiniment » est respecté par la bascule en lecture seule — à une réserve
près, traitée ci-dessous.

---

## 4. ⚠️ Écart entre la vitrine et le produit

La page vitrine annonce désormais la grille ci-dessus. **Le catalogue
réellement servi par l'application est différent.**

| Rang | Vitrine (`src/config/pricing.ts`) | Catalogue applicatif (`server/db.ts`) |
|---|---|---|
| 1 | Starter — **10 000 F** | `free` « Gratuit » — **0 F** |
| 2 | Pro — **20 000 F** | `pro` — **10 000 F** |
| 3 | Business — **35 000 F** | `business` — **25 000 F** |

Conséquences actuelles :

- un visiteur lit « Pro 20 000 F », s'inscrit, et voit « Pro 10 000 F » dans
  l'onboarding ;
- le forfait `free` est **gratuit en permanence**, ce qui contredit
  directement la consigne de ne pas tout laisser gratuit indéfiniment. Seul le
  forfait gratuit déclenche aujourd'hui l'essai de 14 jours, après quoi
  l'espace passe en lecture seule — mais le forfait lui-même reste à 0 F.

Le catalogue applicatif n'a **pas** été modifié : ces prix sont présentés
comme des hypothèses à tester, et réécrire le catalogue de facturation sur des
hypothèses non validées engage bien plus que la page vitrine.

### Marche à suivre pour aligner

Quand les prix seront confirmés, l'alignement touche :

1. **`server/db.ts`** — le `INSERT INTO plans … ON CONFLICT DO UPDATE` : passer
   `free` → code `starter`, nom « Starter », `price_cents` 1000000 ; `pro` →
   2000000 ; `business` → 3500000. Le `ON CONFLICT` met déjà à jour les prix au
   redémarrage ; **changer un `code` demande en revanche une migration**, car
   `subscriptions.plan_id` référence la ligne existante.
2. **`server/entitlements.ts`** — la logique d'essai s'appuie sur
   `price_cents === 0` pour reconnaître le forfait gratuit
   (`const isFree = Number(plan.price_cents) === 0` dans `server/onboarding.ts`).
   Sans forfait à 0 F, l'essai doit être déclenché par le code du forfait ou un
   drapeau dédié, sinon **plus aucun compte n'obtient d'essai**.
3. **`src/config/pricing.ts`** — ajuster le champ `code` de chaque forfait.
4. **`tests/entitlements.test.ts`** — les cas qui dépendent du forfait gratuit.
5. **`ESSAI-GRATUIT.md`** et ce fichier.

Le point 2 est le piège : c'est une bascule silencieuse, pas une erreur de
compilation. Toute modification des prix doit être accompagnée d'un test qui
vérifie qu'un nouveau compte reçoit bien `trialing` et 14 jours.

---

## 5. Où vivent les prix

`src/config/pricing.ts` est la **source unique** de la section tarifaire :
noms, positionnements, prix, listes de fonctionnalités et durée d'essai
annoncée. La section `src/app/landing/components/pricing-section.tsx` ne fait
que la mettre en forme — aucun prix n'est écrit en dur dans le JSX.

---

## 6. État de couverture des promesses (20 octobre 2026)

Les seize fonctionnalités annoncées sont désormais **toutes construites**, à
deux exceptions documentées. Elles sont en revanche **accessibles à tout le
monde** : aucune n'est encore réservée au forfait qui la vend.

| Forfait | Promesse | État |
| --- | --- | --- |
| Starter | Enregistrement des lavages et prestations | ✅ |
| Starter | Catalogue de services et prix | ✅ |
| Starter | Recettes par mode de paiement | ✅ |
| Starter | Suivi simple des dépenses | ✅ |
| Starter | Rapport quotidien | ✅ |
| Pro | Gestion des équipes et attributions | ✅ |
| Pro | Suivi des sessions de caisse | ✅ |
| Pro | Suivi des dépenses et marges opérationnelles | ✅ |
| Pro | Rapports détaillés et exports | ✅ |
| Pro | Historique des opérations et traçabilité | ✅ *(ajouté)* |
| Pro | Assistance prioritaire | ⚠️ à arbitrer |
| Business | Gestion multi-sites selon les limites du forfait | ✅ *(écran ajouté)* |
| Business | Vue consolidée du propriétaire | ✅ *(ajouté)* |
| Business | Permissions avancées | ✅ |
| Business | Rapports consolidés | ✅ *(ajouté)* |
| Business | Accompagnement à la mise en service | 🤝 service humain |

**« Assistance prioritaire ».** `server/support.ts` rattache déjà chaque ticket
au forfait et au statut d'abonnement, mais ne connaît aucune notion de
priorité. Avant d'écrire une ligne de code, il faut décider ce que le mot
engage : un délai de première réponse affiché ? un canal distinct ? un simple
tri de file ? Promettre « prioritaire » sans délai mesurable est une promesse
que l'on ne peut ni tenir ni démentir. Tant que l'arbitrage n'est pas fait,
mieux vaut l'absence de code qu'un badge décoratif.

### Ce qu'il reste à faire : les garde-fous

Trois décisions à prendre avant de restreindre, dans cet ordre :

1. **Résoudre l'écart de la section 4.** Les codes de forfait en base
   (`free` / `pro` / `business`) ne correspondent pas à la vitrine
   (Starter / Pro / Business). Poser des garde-fous sur des codes que l'on
   s'apprête à renommer reviendrait à les écrire deux fois.
2. **Choisir le point de blocage pour chaque fonction.** Masquer l'entrée de
   menu ne protège rien : la restriction doit vivre côté serveur, comme les
   permissions. Et la règle de cumul avec le RBAC doit être explicite — un
   gérant en forfait Starter, que voit-il de l'historique ?
3. **Décider du sort des données déjà saisies** en cas de rétrogradation. Une
   organisation Business qui repasse en Pro garde trois stations : lecture
   seule, blocage des nouveaux enregistrements, ou avertissement ? Couper
   l'accès à des données déjà saisies est le moyen le plus sûr de perdre un
   client — c'est une décision commerciale, pas technique.
