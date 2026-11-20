# Neon Arcade

Mini-arcade de jeux HTML avec page d'accueil, identification par nom de joueur et tableau des records partagé (SQLite).

```
public/                 fichiers statiques servis par Nginx
  index.html, home.js   page d'accueil (connexion + liste des jeux + records)
  home.css              styles de la page d'accueil
  shared/arcade.js      module commun (liste des jeux, appels à l'API)
  shared/arcade.css     thème commun (couleurs, police, boutons) à inclure avant le CSS du jeu
  space-invaders/       jeu Neon Invaders (html + game.js + game.css)
  neon-maze/            jeu Neon Maze (neon-maze.html, moteur et rendu séparés)
api/                    API Python (stdlib uniquement) + SQLite
nginx/                  configuration Nginx (sécurité, proxy /api/)
docker-compose.yml
```

## Déploiement (Docker)

```sh
docker compose up -d --build
```

L'arcade est disponible sur `http://localhost:8080` (ou via un reverse proxy pour HTTPS).
La base SQLite (`/data/arcade.db`) est conservée dans le volume Docker `arcade-data`.

Sauvegarde de la base :

```sh
docker compose exec api python -c "import sqlite3; s=sqlite3.connect('/data/arcade.db'); s.backup(sqlite3.connect('/data/backup.db'))"
docker compose cp api:/data/backup.db ./arcade-backup.db
```

## Développement local (sans Docker)

L'API peut aussi servir les fichiers statiques :

```powershell
$env:ARCADE_STATIC="public"; python api\server.py   # http://localhost:8000
```

La base est alors créée dans `api/data/arcade.db`.

Sur mobile, Neon Invaders utilise toute la fenêtre disponible et place le joystick et le bouton de tir
hors du terrain. Le paysage est conseillé : en portrait, le terrain conserve ses proportions et
des espaces restent visibles autour de celui-ci. Les barres du navigateur restent gérées par iOS.

## Neon Maze

Jeu de chasse dans un labyrinthe original, dans le thème graphique de Neon Invaders :
collecter tous les orbes ouvre le niveau suivant, avec des sentinelles de plus en plus rapides.
Les super-orbes permettent temporairement de capturer les sentinelles (bonus de captures en chaîne).
Trois vies par partie ; les scores et niveaux sont enregistrés dans le classement partagé à la fin
de la partie ou via **Terminer et enregistrer** dans le menu.

- **Clavier** : flèches, ZQSD ou WASD ; **P / Échap** pour ouvrir / fermer la pause.
- **Mobile** : joystick à quatre directions, en dehors du labyrinthe. Glisser pour choisir une
  direction, puis relâcher : le déplacement continue. Les virages sont mémorisés jusqu'au prochain
  passage disponible ; le demi-tour est immédiat.
- **Affichage** : portrait et paysage, zones de sécurité iOS, aucune commande ne masque le terrain.
  La partie se met automatiquement en pause en quittant la fenêtre ou l'onglet.
- Aucun téléchargement de police, image ou bibliothèque ; décor précalculé, densité du canvas
  plafonnée à 2 et simulation à pas fixe pour conserver des déplacements fiables sur mobile.

Tests du moteur (sans dépendance) : `node tests\neon-maze.test.js`.
Sans Node, lancer `python -m http.server 8018 --bind 127.0.0.1` depuis la racine du projet,
puis ouvrir `http://localhost:8018/tests/neon-maze.html`.

## Ajouter un jeu

1. Placer le jeu dans `public/<dossier>/`.
2. Ajouter une entrée dans `GAMES` de `public/shared/arcade.js` (`id` en minuscules/chiffres/tirets).
3. Dans la page du jeu : inclure `<link rel="stylesheet" href="../shared/arcade.css">` (avant le CSS
   du jeu) et `<script src="../shared/arcade.js"></script>`, appeler
   `Arcade.requireUser()` au démarrage et `Arcade.submitScore('<id>', score, { level })` en fin de partie.
4. **Pas de `<script>` ni de `<style>` en ligne, ni d'attributs `onclick=` / `style=`** : la politique
   CSP (`script-src 'self'; style-src 'self'`) les bloque. Mettre le code dans des fichiers `.js` et
   `.css` séparés et utiliser des classes CSS (en JS, `el.style.…` / `el.classList` restent autorisés).
   Pour afficher un texte venant d'un joueur, utiliser
   `textContent` (jamais `innerHTML` sans échappement).

Les fichiers de `public/` sont montés dans Nginx : pas besoin de reconstruire, un simple rechargement de la page suffit.

## API

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/health` | état du service |
| POST | `/api/login` `{name}` | crée le joueur s'il n'existe pas |
| POST | `/api/scores` `{game, name, score, level}` | enregistre un score → `{record, best, rank}` |
| GET | `/api/leaderboard?game=<id>&limit=10` | meilleur score par joueur |
| GET | `/api/stats?name=<joueur>` | record et rang du joueur pour chaque jeu |

## Sécurité (exposition sur Internet)

Protections en place :

| Menace | Protection |
|---|---|
| Injection SQL | requêtes SQL paramétrées uniquement |
| Injection de code (XSS) via un nom | noms filtrés côté serveur (lettres, chiffres, `- _ . '`, normalisés NFKC) ; échappement systématique à l'affichage ; CSP `script-src 'self'; style-src 'self'` qui bloque tout script ou style injecté |
| Clickjacking, sniffing MIME | `frame-ancestors 'none'`, `X-Frame-Options`, `X-Content-Type-Options` |
| Soumission depuis un autre site (CSRF) | l'API n'accepte que `Content-Type: application/json` |
| Spam / déni de service | limites Nginx par IP (10 écritures/min, 10 lectures/s, 20 connexions), corps limité à 4 Ko, délais courts, 10 s minimum entre deux scores d'un même joueur, 20 scores conservés par joueur et par jeu |
| Compromission d'un conteneur | Nginx non-root, API non-root, systèmes de fichiers en lecture seule, capacités Linux supprimées, API sur réseau interne sans accès Internet, mémoire limitée |
| Fuite d'informations | versions Nginx/Python masquées, fichiers cachés (`.git`, `.env`) inaccessibles |

### Modération

```sh
docker compose exec api python server.py list-players
docker compose exec api python server.py ban "NomDuTricheur"     # supprime ses scores et bloque le nom
docker compose exec api python server.py unban "NomDuTricheur"
```

### À faire avant d'exposer le serveur sur Internet

- **HTTPS obligatoire** : configurer un reverse proxy (Traefik, Nginx, etc.) avec certificat TLS, puis activer la ligne
  `Strict-Transport-Security` dans `nginx/default.conf`.
- Configurer le proxy pour faire confiance uniquement aux adresses IP autorisées et configurer
  `set_real_ip_from` / `real_ip_header` dans Nginx ; sinon tous les visiteurs partagent la même limite.
- N'ouvrir que le port HTTPS sur le pare-feu / la box ; ne jamais exposer le port de l'API.
- Mettre à jour les images régulièrement : `docker compose pull && docker compose up -d --build`.
- Sauvegarder la base régulièrement (voir plus haut).

### Limite connue : la triche

Le jeu s'exécute dans le navigateur, donc un joueur déterminé peut toujours envoyer un faux score
(outils de développement, requête manuelle). Les protections ci-dessus limitent les abus
(score maximum `ARCADE_MAX_SCORE`, fréquence, bannissement) mais ne peuvent pas les empêcher totalement.
Pour aller plus loin : mot de passe/PIN par joueur, jeton de partie signé par le serveur avec contrôle
de durée minimale, ou validation de la partie côté serveur (rejouer les actions).
