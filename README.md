# ♠ Blackjack Royale ♥

Jeu de **Blackjack multijoueur local en temps réel** : l'ordinateur est la table de casino, les smartphones sont les manettes. Tout se joue sur le même réseau Wi-Fi, sans internet.

## 🚀 Démarrage rapide

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

> 💡 `npm run dev` relance automatiquement le serveur à chaque modification (`node --watch`).
> 💡 Port personnalisé : `PORT=8080 npm start`.
> 🧪 Test de la logique de jeu : `npm test`.

## 🎮 Fonctionnement

### L'hôte (ordinateur — écran de la table)
- Main du **croupier** avec animations de distribution (la 2ᵉ carte reste cachée jusqu'au tour du croupier).
- Plateau complet en direct : chaque joueur avec pseudo, avatar, main, score, mise, statut (*En attente, Tour en cours, Stand, Bust, Blackjack*) et gains/pertes de la manche.
- **QR code + adresse IP locale** affichés pour rejoindre instantanément.
- **Timers** de mise et de tour, bouton **Nouvelle manche**, effets sonores et visuels (confettis sur Blackjack, secousse sur Bust).

### Les joueurs (smartphones — manettes)
- Interface **mobile-first**, sans scroll parasite.
- Lobby : pseudo + avatar + couleur.
- Mise avec des **jetons tactiles** (10 / 25 / 50 / 100 / 500).
- Gros boutons **Hit / Stand / Double / Split**, actifs uniquement à son tour (vibration du téléphone quand c'est à soi).
- Reconnexion automatique : en cas de rafraîchissement, le joueur retrouve sa place et son solde.

## 🃏 Règles implémentées

| Règle | Détail |
|---|---|
| Sabot | **6 jeux** de 52 cartes, mélange automatique (re-mélange sous 75 cartes) |
| Valeurs | As = 1 ou 11, figures = 10 |
| Blackjack naturel | payé **3:2** |
| Croupier | tire à 16, **s'arrête à 17 (Soft 17 : stand)** |
| Égalité | **Push** — la mise est rendue |
| Double Down | sur les 2 premières cartes, si le solde le permet |
| Split | sur une paire de même rang (1 split max par manche) |
| Timers | 30 s pour miser, 30 s par tour (stand automatique) |
| Jetons | cave de départ **1 000**, re-cave automatique à sec |

## 🗂️ Structure du projet

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

## 🔧 Notes techniques

- **État 100 % côté serveur** : les clients n'envoient que des intentions (`hit`, `stand`, `bet`…), le serveur valide tout et diffuse un état public — la carte cachée du croupier n'est jamais transmise avant sa révélation.
- **Temps réel** : Socket.io (WebSocket) ; l'horloge des timers est synchronisée sur celle du serveur.
- **Sons** générés en WebAudio (aucun fichier audio à charger) — bouton 🔊/🔇 sur la table.
- **Zéro build** : vanilla JS + CSS, aucune étape de compilation. Les polices Google Fonts sont optionnelles (fallback système hors ligne).

## 🛜 Dépannage

- **Le téléphone n'arrive pas à se connecter** : vérifier que le téléphone et l'ordinateur sont sur le même Wi-Fi, et que le pare-feu de l'ordinateur autorise le port 3000 (ou celui choisi).
- **Le QR code pointe vers la mauvaise IP** : si la machine a plusieurs interfaces réseau, le serveur prend la première IPv4 non interne — l'adresse exacte est aussi affichée dans le terminal au démarrage.
