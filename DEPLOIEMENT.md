# Mettre WashPilot CI en production

> Écrit le 21 octobre 2026. Ce document s'adresse à celui qui installe, pas à
> celui qui développe.

## Le point à comprendre avant tout le reste

**L'application refuse désormais de démarrer en production sans base de
données externe.** Ce n'est pas une limitation, c'est une protection, et elle
a été ajoutée après avoir constaté le contraire sur le code tel qu'il était.

Jusqu'ici, lancée en production sans `DATABASE_URL`, l'application démarrait
très bien — sur sa base embarquée, écrite dans le système de fichiers du
serveur. Tout fonctionnait. On pouvait encaisser pendant des semaines. Puis,
à la première mise à jour du conteneur, ce système de fichiers disparaissait,
et avec lui les lavages, les caisses et les abonnements.

Pire : si `DATABASE_URL` était renseignée mais momentanément injoignable au
démarrage, l'application basculait **silencieusement** sur une base vide. La
station repartait de zéro sans qu'aucune alerte ne soit levée.

Les deux cas se soldent maintenant par un refus net, avec un message qui dit
quoi faire. Un service qui ne démarre pas se remarque ; une base vide, non.

---

## 1. Ce qu'il faut avoir

| | |
| --- | --- |
| Un PostgreSQL | version 14 ou plus, accessible et sauvegardé |
| Un endroit où faire tourner un conteneur | une machine, ou un hébergeur qui accepte une image |
| Un nom de domaine en HTTPS | les cookies de session l'exigent en production |

L'application ne stocke aucun fichier : tout vit dans la base. Il n'y a donc
pas de disque à prévoir pour le conteneur, et on peut en lancer plusieurs
derrière un répartiteur — sous une réserve, décrite au §6.

---

## 2. Les variables d'environnement

### Indispensables

| Variable | Rôle |
| --- | --- |
| `NODE_ENV=production` | active le service de l'interface construite et les règles strictes |
| `DATABASE_URL` | `postgres://utilisateur:motdepasse@hôte:5432/base` |
| `APP_URL` | adresse publique, pour les liens des e-mails |
| `CORS_ORIGINS` | la même adresse ; sans elle, le navigateur refusera les appels |

### Pour accéder à la console de l'éditeur

| Variable | Rôle |
| --- | --- |
| `PLATFORM_ADMIN_EMAILS` | adresses des opérateurs, séparées par des virgules |
| `PLATFORM_ADMIN_PASSWORD` | mot de passe initial, lu à la création seulement |

C'est **volontairement** la seule façon de nommer un administrateur de
plateforme : aucune route de l'application ne l'accorde, parce que ce droit
traverse l'isolation entre clients.

### Facultatives

`RESEND_API_KEY` et `MAIL_FROM` pour l'envoi réel des e-mails — sans clé, les
liens sont seulement écrits dans les journaux, ce qui suffit pour une mise en
route. `SUPPORT_WHATSAPP`, `SUPPORT_EMAIL`, `PAYMENT_MERCHANT_NUMBER` et
`PAYMENT_MERCHANT_NAME` alimentent les écrans d'assistance et de paiement.

> **Les secrets s'injectent au démarrage, jamais à la construction.** Un mot
> de passe recopié dans une image se retrouve dans chaque registre, chaque
> sauvegarde et chaque machine qui la télécharge. `.env` est exclu de l'image
> par `.dockerignore`.

---

## 3. Déploiement sur une seule machine

Le chemin le plus court, et celui qui convient à l'éditeur hébergeant
lui-même quelques stations.

```bash
cp .env.example .env
#   renseigner au minimum POSTGRES_PASSWORD, APP_URL et CORS_ORIGINS
docker compose up -d
docker compose logs -f app
```

La base vit dans un volume nommé, indépendant des conteneurs. On peut
reconstruire l'application autant qu'on veut sans y toucher.

```bash
docker compose down      # arrête, conserve les données
docker compose down -v   # DÉTRUIT les données
```

**C'est ce volume qu'il faut sauvegarder.** Rien d'autre sur la machine ne
contient de données clients.

---

## 4. Déploiement chez un hébergeur

L'image se construit et se lance sans la composition :

```bash
docker build -t washpilot-ci .
docker run -d --name washpilot \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgres://…" \
  -e APP_URL="https://app.exemple.ci" \
  -e CORS_ORIGINS="https://app.exemple.ci" \
  -p 3000:3000 washpilot-ci
```

L'image écoute sur le port 3000 et ne tourne pas en administrateur.

### Les deux adresses de surveillance

| Adresse | Répond | À utiliser pour |
| --- | --- | --- |
| `/healthz` | dès que le serveur écoute | savoir si le conteneur est vivant |
| `/readyz` | quand la base répond aussi | savoir s'il peut recevoir du trafic |

Un répartiteur doit interroger **`/readyz`**. `/healthz` répondrait « tout va
bien » pour un serveur incapable de servir une seule page.

### Le schéma se crée tout seul

Au démarrage, l'application crée les tables manquantes et ajoute les colonnes
nouvelles. Il n'y a pas d'étape de migration à lancer à la main, et une mise à
jour ne demande rien de particulier : on remplace l'image, on redémarre.

Corollaire à connaître : **deux versions différentes ne doivent pas démarrer
en même temps sur la même base.** Lors d'un déploiement progressif, laissez
l'ancienne version s'arrêter avant de lancer la nouvelle.

---

## 5. Mise en route de la première station

1. Ouvrir l'adresse publique, créer le compte — l'essai de 14 jours démarre.
2. Se connecter à `/console` avec une adresse déclarée dans
   `PLATFORM_ADMIN_EMAILS`, pour activer l'abonnement quand le client paie.

Le mot de passe de la console n'est lu qu'à la création de l'opérateur :
le changer ensuite dans l'environnement ne change pas le mot de passe réel.

---

## 6. Ce qui n'est pas encore prêt pour plusieurs instances

Honnêtement, et parce que cela se découvre mal en production :

| Point | Conséquence avec deux instances |
| --- | --- |
| Limitation des tentatives de connexion | comptée dans la mémoire de chaque serveur : la protection est divisée par le nombre d'instances |
| Relances d'échéance d'abonnement | chaque instance a son propre minuteur : le client reçoit l'e-mail en double |

**Une seule instance ne pose aucun problème**, et c'est amplement suffisant
pour les volumes visés. Avant de passer à plusieurs, il faudra déplacer ces
deux mécanismes hors de la mémoire du processus.

---

## 7. Le contrôle automatique

`.github/workflows/ci.yml` s'exécute à chaque envoi et à chaque demande de
fusion :

1. vérification des types ;
2. vérification du style ;
3. construction de l'interface ;
4. **toute la suite de tests** ;
5. construction de l'image de production ;
6. vérification que le conteneur **refuse** de démarrer sans base.

La dernière étape mérite son existence : c'est exactement le genre de
protection qu'on ajoute un jour et qu'on désactive six mois plus tard sans
s'en apercevoir. Si elle saute, le contrôle échoue.

La suite de tests n'a besoin d'aucun service externe : en mode test, la base
vit en mémoire et chaque fichier repart d'une base vierge.

---

## 8. Sauvegarde

L'application expose déjà un export complet par organisation (voir
`server/backup.ts`), utile pour remettre un client ses données. **Ce n'est pas
une sauvegarde d'exploitation.** Celle-ci se fait au niveau de PostgreSQL :

```bash
# avec docker compose
docker compose exec db pg_dump -U washpilot washpilot | gzip > sauvegarde-$(date +%F).sql.gz
```

À automatiser et à **tester en restaurant**, une sauvegarde jamais restaurée
n'étant qu'une hypothèse.
