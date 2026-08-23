# ♠ Blackjack Royale ♥

Jeu de **Blackjack multijoueur local en temps réel** : l'ordinateur est la table de casino, les smartphones sont les manettes. Tout se joue sur le même réseau Wi-Fi, sans internet.

## Démarrage rapide

```bash
# 1. Installer les dépendances
npm install

# 2. Lancer le serveur
npm start
```

Puis :

1. **Sur l'ordinateur** (la table) : ouvrir **http://localhost:3000/host** — idéalement en plein écran (F11).
2. **Sur les téléphones** : scanner le **QR code** affiché à l'écran (ou taper l'adresse `http://<IP-locale>:3000/` indiquée). Les téléphones doivent être sur le **même réseau Wi-Fi** que l'ordinateur.
3. Chaque joueur choisit un **pseudo, un avatar et une couleur**, puis prend place.
4. L'hôte clique sur **« Lancer la manche »** : les joueurs misent depuis leur téléphone, les cartes sont distribuées, et c'est parti !

> `npm run dev` relance automatiquement le serveur à chaque modification (`node --watch`).
> Port personnalisé : `PORT=8080 npm start`. Adresse forcée : `HOST_IP=192.168.1.42 npm start`.
> Test de la logique de jeu : `npm test`.

## Deux façons de jouer — un choix obligatoire avant de commencer

Avant de lancer la toute première manche, le **chef de table** (le premier joueur connecté) doit choisir un mode sur son téléphone — ou l'écran table s'il est ouvert. Ce choix ne peut plus être changé une fois la partie commencée.

**Tous sur un écran** : un ordinateur affiche la table (`/host`) — croupier, mains de tous les joueurs, QR code — et chaque téléphone sert uniquement de manette (pas de panneau croupier/autres joueurs sur mobile). C'est l'écran de la table qui a le bouton « Lancer la manche ».

**Chacun son écran** : aucun ordinateur nécessaire, personne n'a besoin de le regarder. Chaque téléphone affiche, en plus de sa propre main, le panneau **« La table »** : les cartes du croupier (la 2ᵉ reste face cachée jusqu'à son tour) et les mains, scores et statuts de tous les autres joueurs — repliable d'un tap pour une manette plus compacte. Le chef de table a le bouton « Lancer la manche » directement sur son téléphone.

**Les deux** : l'écran de la table fonctionne normalement ET chaque téléphone affiche en plus le panneau « La table » — le meilleur des deux mondes si un grand écran est disponible mais que tout le monde veut aussi suivre sur son téléphone.

Tant qu'aucun mode n'est choisi, le bouton de lancement reste verrouillé sur les deux écrans — impossible de démarrer sans que la table se soit mise d'accord.

## Reconnexion & reprise après déconnexion

Un joueur qui recharge la page ou perd le réseau quelques instants **retrouve automatiquement sa place** (même solde, même main en cours) dès que sa connexion revient — aucune action nécessaire.

Si son navigateur perd sa session (stockage effacé, autre onglet, changement de navigateur) mais qu'il se reconnecte **depuis le même appareil** (même adresse réseau), une fenêtre lui propose :

- **« Reprendre cette partie »** : il retrouve exactement son identité (pseudo, avatar, solde, main en cours).
- **« Non, nouveau joueur »** : il rejoint avec une toute nouvelle identité, cave de départ standard.

Cette proposition n'est offerte que dans les 20 minutes suivant la déconnexion, et un joueur déconnecté trop longtemps est de toute façon écarté de la table au lancement de la manche suivante.

## Fonctionnement

### L'hôte (ordinateur — écran de la table)
- Main du **croupier** avec animations de distribution (la 2ᵉ carte reste cachée jusqu'au tour du croupier).
- Plateau complet en direct : chaque joueur avec pseudo, avatar, main, score, mise, statut (*En attente, Tour en cours, Stand, Bust, Blackjack*) et gains/pertes de la manche.
- **QR code + adresse IP locale** affichés pour rejoindre instantanément.
- **Timers** de mise et de tour, bouton **Nouvelle manche**, effets sonores et visuels (confettis sur Blackjack, secousse sur Bust).

### Les joueurs (smartphones — manettes)
- Interface **mobile-first**, sans scroll parasite.
- Lobby : pseudo + avatar + couleur.
- Mise avec des **jetons tactiles** (10 / 25 / 50 / 100 / 500) ou en un tap avec **All-in** (tout le solde).
- **Assurance** proposée automatiquement quand le croupier montre un As, jusqu'à la moitié de la mise.
- Gros boutons **Hit / Stand / Double / Split**, actifs à son tour (vibration du téléphone quand c'est à soi).
- **Pré-choix** : en attendant son tour, on peut déjà taper l'action voulue (ex. Stand sur une main forte) — elle se joue automatiquement dès que le tour arrive vraiment, sans avoir à surveiller l'écran. Retaper le même bouton annule le pré-choix. **Ton intention reste secrète** : le serveur ne la transmet qu'à toi, elle n'apparaît ni sur les autres téléphones ni sur l'écran de la table.
- **Donner des jetons** : entre deux manches, on peut transférer des jetons à un autre joueur de la table (choix du joueur, puis du montant).
- Reconnexion automatique : en cas de rafraîchissement, le joueur retrouve sa place et son solde.

### Icônes plutôt qu'emojis

Toute l'interface utilise des **icônes SVG dessinées à la main** (`public/js/icons.js`), pas d'emojis : le rendu est identique sur tous les téléphones et systèmes, alors qu'un emoji change de dessin d'un appareil à l'autre. Les avatars sont eux aussi des icônes (piques, cœur, carreau, trèfle, couronne, étoile, éclair, gemme), colorées avec la couleur choisie par le joueur. Seules les enseignes imprimées **sur les cartes** (♠ ♥ ♦ ♣) restent des caractères, puisque ce sont les cartes elles-mêmes.

### Gestion de la table

- **Exclure un joueur** : le **chef de table** peut exclure quelqu'un, uniquement entre deux manches (jamais en pleine main). Le joueur exclu peut revenir, mais comme un nouveau joueur — il ne récupère pas son ancien solde.
- **Déconnexion** : un joueur déconnecté garde ses jetons. Au lancement de la manche suivante il quitte la table, mais son solde et son identité sont conservés « au vestiaire » : s'il revient, il retrouve **exactement ses jetons** (aucune remise à la cave de départ).

## Règles implémentées

| Règle | Détail |
|---|---|
| Sabot | **6 jeux** de 52 cartes, mélange Fisher–Yates, re-mélange sous 75 cartes restantes |
| Valeurs | As = 1 ou 11, figures = 10 |
| Blackjack naturel | payé **3:2** |
| Croupier | tire à 16, **s'arrête à 17 (Soft 17 : stand)** |
| Égalité | **Push** — la mise est rendue |
| Double Down | sur les 2 premières cartes, si le solde le permet |
| Split | sur une paire de même rang ; **resplit autorisé** si une nouvelle paire apparaît, jusqu'à 4 mains au total |
| Assurance | proposée quand le croupier montre un **As**, jusqu'à la moitié de la mise, payée **2:1** si le croupier a effectivement blackjack |
| Timers | 30 s pour miser, 30 s par tour, 12 s pour l'assurance (refus par défaut) |
| Jetons | cave de départ choisie par le chef de table avant la 1ère manche, **pas de reset automatique** |

## Cave de départ & re-cave

Avant de lancer la toute première manche, le **chef de table** (ou l'écran table) choisit la cave de départ (100 à 10 000 jetons) — elle s'applique à tous les joueurs présents. Une fois la première manche lancée, ce réglage est **verrouillé** : les soldes vivent leur vie, sans reset automatique entre les manches.

Si un joueur se retrouve à sec (solde sous la mise minimum) :

- Il peut **demander une re-cave** depuis son téléphone.
- Tous les **autres** joueurs votent **Accepter / Refuser**.
- **Unanimité requise** : si tout le monde accepte, il est recrédité de la cave de départ.
- **Un seul refus** : il est **exclu de la table**. Pour rejouer, il doit revenir comme un **nouveau joueur** (nouveau pseudo/avatar possible, cave de départ standard).

Un joueur qui se déconnecte pendant un vote ne le bloque pas — l'unanimité ne porte que sur les votants restants.

## Structure du projet

```
Blackjack/
├── server.js              # Serveur Express + Socket.io, IP locale, QR code
├── game/
│   └── blackjack.js       # Logique de jeu autoritaire (état, tours, paiements)
├── public/
│   ├── host.html          # Vue Table (ordinateur / croupier)
│   ├── player.html        # Vue Joueur (smartphone)
│   ├── css/
│   │   ├── shared.css     # Thème casino, cartes (flip 3D), jetons, effets
│   │   ├── host.css       # Mise en page de la table
│   │   └── player.css     # Mise en page mobile
│   └── js/
│       ├── shared.js      # Rendu des cartes, horloge serveur, sons WebAudio, confettis
│       ├── host.js        # Logique d'affichage de la table
│       └── player.js      # Logique de la manette mobile
├── test/
│   └── smoke.js           # Test de fumée (valeurs de mains + manche complète)
└── package.json
```

## Héberger en ligne (jouer sans être sur le même Wi-Fi)

Le serveur se déploie tel quel sur n'importe quel hébergeur Node.js (Render, Railway, Fly.io…). Exemple avec le plan gratuit de [Render](https://render.com) :

1. **New → Web Service**, connectez votre dépôt GitHub et choisissez la branche du jeu.
2. Build command : `npm install` — Start command : `npm start`.
3. Dans **Environment**, ajoutez `PUBLIC_URL` = l'URL de votre service (ex. `https://blackjack-royale.onrender.com`) pour que le QR code et les liens pointent vers la bonne adresse.
4. Déployez, puis partagez l'URL : les joueurs la rejoignent depuis n'importe où (4G comprise), et `/host` reste la vue table.

À savoir : il n'y a **qu'une seule table** par serveur — toute personne ayant l'URL rejoint la même partie, ne la partagez qu'à vos amis. Sur le plan gratuit de Render, le serveur s'endort après ~15 min d'inactivité (première connexion un peu lente, puis tout est normal) et la partie en cours est remise à zéro s'il s'endort.

## L'aléatoire du tirage

Le sabot est mélangé par un **Fisher–Yates** correct (`j` tiré dans `[0, i]`, borne incluse — pas la variante biaisée qu'on croise souvent), et vérifié par des tests statistiques : sur 200 000 mélanges, la distribution des positions donne un χ² de 42,5 pour 51 degrés de liberté (p = 0,80), et sur 4,7 millions de tirages la répartition des rangs donne χ² = 2,63 pour 12 degrés de liberté (p = 0,997). Aucun biais de première ou dernière position. Les mêmes tests détectent sans peine les deux erreurs classiques d'implémentation, ce qui confirme qu'ils ont le pouvoir de repérer un vrai défaut.

`Math.random()` est utilisé plutôt que `crypto`. C'est un générateur non cryptographique : sa suite serait théoriquement prédictible pour qui observerait assez de tirages. Pour une table entre amis sans argent réel, seule compte la qualité de la distribution — irréprochable ici. Une source cryptographique n'aurait de sens qu'avec un enjeu réel.

## Notes techniques

- **État 100 % côté serveur** : les clients n'envoient que des intentions (`hit`, `stand`, `bet`…), le serveur valide tout et diffuse un état public — la carte cachée du croupier n'est jamais transmise avant sa révélation.
- **Temps réel** : Socket.io (WebSocket) ; l'horloge des timers est synchronisée sur celle du serveur.
- **Sons** générés en WebAudio (aucun fichier audio à charger) — bouton de coupure du son sur la table.
- **Zéro build** : vanilla JS + CSS, aucune étape de compilation. Les polices Google Fonts sont optionnelles (fallback système hors ligne).

## Dépannage

- **Le téléphone n'arrive pas à se connecter** : vérifier que le téléphone et l'ordinateur sont sur le même Wi-Fi, et que le pare-feu de l'ordinateur autorise le port 3000 (ou celui choisi).
- **Le QR code pointe vers la mauvaise IP** : si la machine a plusieurs interfaces réseau, le serveur prend la première IPv4 non interne — l'adresse exacte est aussi affichée dans le terminal au démarrage.
