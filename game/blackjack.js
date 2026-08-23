'use strict';

/**
 * Logique de jeu Blackjack — 100 % côté serveur (état autoritaire).
 *
 * Règles implémentées :
 *  - Sabot de 6 jeux, mélangé automatiquement (re-mélange sous le seuil de pénétration)
 *  - As = 1 ou 11, figures = 10
 *  - Blackjack naturel payé 3:2
 *  - Le croupier tire jusqu'à 16 et s'arrête à 17, y compris Soft 17 (stand)
 *  - Push (égalité) : mise rendue
 *  - Double Down (2 premières cartes, solde suffisant)
 *  - Split (paire de même rang), resplit autorisé si une nouvelle paire
 *    apparaît, jusqu'à `maxSplitHands` mains au total pour ce joueur
 */

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const DEFAULTS = {
  decks: 6,
  reshuffleThreshold: 75, // cartes restantes déclenchant un re-mélange avant la manche
  startingBalance: 1000,
  minBet: 10,
  betTimeMs: 30000,
  turnTimeMs: 30000,
  insuranceTimeMs: 12000,
  resultsTimeMs: 6000,
  dealerDrawDelayMs: 900,
  maxPlayers: 7,
  maxParked: 64, // joueurs au vestiaire conservés (garde-fou mémoire)
  maxSplitHands: 4, // jusqu'à 3 splits (règle courante des casinos)
};

function rankValue(rank) {
  if (rank === 'A') return 1;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return parseInt(rank, 10);
}

/** Meilleure valeur d'une main : un As compte 11 tant que ça ne dépasse pas 21. */
function handValue(cards) {
  let total = 0;
  let hasAce = false;
  for (const c of cards) {
    total += rankValue(c.rank);
    if (c.rank === 'A') hasAce = true;
  }
  if (hasAce && total + 10 <= 21) return { total: total + 10, soft: true };
  return { total, soft: false };
}

function isNaturalBlackjack(cards) {
  return cards.length === 2 && handValue(cards).total === 21;
}

function buildShoe(decks) {
  const shoe = [];
  let uid = 0;
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        shoe.push({ rank, suit, id: `c${d}-${uid++}` });
      }
    }
  }
  // Mélange Fisher–Yates
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

class Game {
  /**
   * @param {(state: object) => void} broadcast — appelé à chaque changement d'état
   * @param {object} [options] — surcharge des DEFAULTS (utile pour les tests)
   */
  constructor(broadcast, options = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.broadcast = broadcast;
    this.phase = 'lobby'; // lobby | betting | playing | dealer | results
    this.shoe = buildShoe(this.opts.decks);
    this.dealer = { cards: [], revealed: false };
    /** @type {Map<string, object>} playerId -> player */
    this.players = new Map();
    /**
     * Vestiaire : joueurs sortis de la table parce qu'ils étaient déconnectés
     * au lancement d'une manche. On conserve leur solde et leur identité pour
     * qu'ils retrouvent tout en revenant (sinon leurs jetons seraient perdus).
     * @type {Map<string, object>}
     */
    this.parked = new Map();
    this.turnQueue = []; // [{ playerId, handIndex }]
    this.current = null; // { playerId, handIndex } | null
    this.betEndsAt = null;
    this.turnEndsAt = null;
    this.resultsEndsAt = null;
    this.insuranceEndsAt = null;
    this.roundNumber = 0;
    this.timers = { bet: null, turn: null, dealer: null, results: null, insurance: null };
    // Demande de re-cave en attente : { playerId, pending:Set, approved:Set }
    this.rebuyRequest = null;
    // Mode de jeu : 'table' (écran commun) ou 'phones' (chacun son écran).
    // Choix obligatoire avant de lancer la toute première manche.
    this.mode = null;
  }

  // ---------------------------------------------------------------- joueurs

  addPlayer({ token, name, color, avatar }) {
    const existing = this.players.get(token);
    if (existing) {
      existing.connected = true;
      existing.disconnectedAt = null;
      if (name) existing.name = String(name).slice(0, 16);
      this.push();
      return existing;
    }
    if (this.players.size >= this.opts.maxPlayers) {
      throw new Error('La table est pleine (7 joueurs max).');
    }
    // Retour d'un joueur passé au vestiaire : il reprend sa place, son solde
    // et son rang dans l'ordre du tour (joinedAt inchangé).
    const parked = this.parked.get(token);
    if (parked) {
      this.parked.delete(token);
      parked.connected = true;
      parked.disconnectedAt = null;
      if (name) parked.name = String(name).slice(0, 16);
      if (color) parked.color = color;
      if (avatar) parked.avatar = avatar;
      this.players.set(token, parked);
      this.push();
      return parked;
    }
    const player = {
      id: token,
      name: String(name || 'Joueur').slice(0, 16) || 'Joueur',
      color: color || '#facc15',
      avatar: avatar || 'spade', // clé d'icône (voir public/js/icons.js)
      balance: this.opts.startingBalance,
      connected: true,
      ip: null,             // pour reconnaître un appareil qui revient sans son token
      disconnectedAt: null,
      hands: [],       // [{ cards, bet, status, doubled }]
      betPlaced: false,
      inRound: false,
      presetAction: null, // action programmée à l'avance pour le prochain tour
      insuranceBet: 0,
      insuranceDecided: false,
      insuranceResult: null, // 'win' | 'lose' | null (affichage résultats)
      lastNet: 0,      // gain/perte de la dernière manche (affichage table)
      joinedAt: Date.now(),
    };
    this.players.set(token, player);
    this.push();
    return player;
  }

  /**
   * Sort un joueur de la table sans perdre ses jetons : son solde et son
   * identité partent au vestiaire, d'où addPlayer() les restaure s'il revient.
   * Sans cela, un joueur déconnecté au lancement d'une manche repartirait de
   * la cave de départ à son retour.
   */
  parkPlayer(token) {
    const p = this.players.get(token);
    if (!p) return;
    this.players.delete(token);
    this.cleanupRebuyAfterLeave(token);
    p.hands = [];
    p.betPlaced = false;
    p.inRound = false;
    p.lastNet = 0;
    p.presetAction = null;
    p.insuranceBet = 0;
    p.insuranceDecided = false;
    p.insuranceResult = null;
    this.parked.set(token, p);
    // Garde-fou mémoire : on ne conserve que les vestiaires les plus récents.
    if (this.parked.size > this.opts.maxParked) {
      const oldest = [...this.parked.values()]
        .sort((a, b) => (a.disconnectedAt || 0) - (b.disconnectedAt || 0))[0];
      if (oldest) this.parked.delete(oldest.id);
    }
  }

  /**
   * Un joueur déconnecté n'est jamais supprimé immédiatement — il reste visible
   * (badge « Déconnecté ») jusqu'à son retour ou jusqu'au prochain lancement de
   * manche, qui l'envoie au vestiaire (parkPlayer) en conservant ses jetons.
   */
  disconnectPlayer(token) {
    const p = this.players.get(token);
    if (!p) return;
    p.connected = false;
    p.disconnectedAt = Date.now();
    // Un absent ne doit pas bloquer un vote de re-cave en cours.
    this.cleanupRebuyAfterLeave(token);
    if (this.phase === 'playing' && this.current && this.current.playerId === token) {
      // Son tour : on stand automatiquement pour ne pas bloquer la table.
      this.stand(token, true);
      return;
    }
    this.push();
  }

  /**
   * Retrouve un joueur déconnecté récemment depuis la même adresse IP, pour
   * proposer à un nouvel onglet/appareil de reprendre sa place plutôt que
   * d'en créer une nouvelle. Cherche à la table comme au vestiaire, dans une
   * fenêtre de 20 minutes.
   */
  findResumeCandidate(ip, excludeToken) {
    if (!ip) return null;
    const RESUME_WINDOW_MS = 20 * 60 * 1000;
    const now = Date.now();
    let best = null;
    for (const p of [...this.players.values(), ...this.parked.values()]) {
      if (p.id === excludeToken || p.connected || p.ip !== ip) continue;
      if (!p.disconnectedAt || now - p.disconnectedAt > RESUME_WINDOW_MS) continue;
      if (!best || p.disconnectedAt > best.disconnectedAt) best = p;
    }
    return best;
  }

  // ---------------------------------------------------------------- manche

  /** L'hôte lance une manche : phase de mises. */
  startBetting() {
    if (this.phase === 'betting' || this.phase === 'playing' || this.phase === 'dealer') return;
    if (this.roundNumber === 0 && !this.mode) {
      throw new Error('Choisissez un mode de jeu avant de lancer la partie.');
    }
    this.clearTimers();
    // Les joueurs déconnectés quittent la table mais gardent leurs jetons
    // au vestiaire (ils les retrouvent en revenant).
    for (const [id, p] of this.players) {
      if (!p.connected) {
        this.parkPlayer(id);
        continue;
      }
      p.hands = [];
      p.betPlaced = false;
      p.inRound = false;
      p.lastNet = 0;
      p.presetAction = null;
      p.insuranceBet = 0;
      p.insuranceDecided = false;
      p.insuranceResult = null;
      // Pas de re-cave automatique : un joueur à sec doit la demander
      // aux autres (unanimité) ou quitter la table.
    }
    if (this.players.size === 0) {
      this.phase = 'lobby';
      this.push();
      return;
    }
    if (this.shoe.length < this.opts.reshuffleThreshold) {
      this.shoe = buildShoe(this.opts.decks);
    }
    this.roundNumber += 1;
    this.phase = 'betting';
    this.dealer = { cards: [], revealed: false };
    this.current = null;
    this.betEndsAt = Date.now() + this.opts.betTimeMs;
    this.timers.bet = setTimeout(() => this.deal(), this.opts.betTimeMs);
    this.push();
  }

  placeBet(token, amount) {
    if (this.phase !== 'betting') throw new Error('Les mises ne sont pas ouvertes.');
    const p = this.players.get(token);
    if (!p) throw new Error('Joueur inconnu.');
    if (p.betPlaced) throw new Error('Mise déjà placée.');
    const bet = Math.floor(Number(amount));
    if (!Number.isFinite(bet) || bet < this.opts.minBet) {
      throw new Error(`Mise minimum : ${this.opts.minBet} jetons.`);
    }
    if (bet > p.balance) throw new Error('Solde insuffisant.');
    p.balance -= bet;
    p.betPlaced = true;
    p.inRound = true;
    p.hands = [{ cards: [], bet, status: 'waiting', doubled: false }];
    // Tous ceux qui PEUVENT miser ont misé → on distribue sans attendre.
    // (Les joueurs à sec ne bloquent pas la table.)
    const connected = [...this.players.values()].filter((x) => x.connected);
    const allBet = connected.every((x) => x.betPlaced || x.balance < this.opts.minBet);
    if (connected.some((x) => x.betPlaced) && allBet) {
      clearTimeout(this.timers.bet);
      this.deal();
    } else {
      this.push();
    }
  }

  draw() {
    if (this.shoe.length === 0) this.shoe = buildShoe(this.opts.decks);
    return this.shoe.pop();
  }

  deal() {
    if (this.phase !== 'betting') return;
    this.clearTimers();
    const inRound = [...this.players.values()].filter((p) => p.inRound);
    if (inRound.length === 0) {
      // Personne n'a misé : retour au lobby.
      this.phase = 'lobby';
      this.push();
      return;
    }
    this.phase = 'playing';
    // Distribution classique : une carte à chacun, croupier, puis seconde carte.
    for (const p of inRound) p.hands[0].cards.push(this.draw());
    this.dealer.cards.push(this.draw());
    for (const p of inRound) p.hands[0].cards.push(this.draw());
    this.dealer.cards.push(this.draw()); // carte cachée

    for (const p of inRound) {
      const h = p.hands[0];
      h.status = isNaturalBlackjack(h.cards) ? 'blackjack' : 'playing';
      p.insuranceBet = 0;
      p.insuranceDecided = false;
      p.insuranceResult = null;
    }

    // Carte visible du croupier = As : l'assurance se propose avant de
    // regarder la carte cachée (sinon la décision ne serait plus à l'aveugle).
    if (this.dealer.cards[0].rank === 'A') {
      this.openInsurance();
      return;
    }
    this.resolveDealerBlackjackCheck(inRound);
  }

  /**
   * Vérifie le blackjack du croupier (règlement immédiat si oui, sinon
   * lancement des tours) — appelé directement si le croupier ne montre pas
   * d'As, ou après la fenêtre d'assurance sinon.
   */
  resolveDealerBlackjackCheck(inRound) {
    if (isNaturalBlackjack(this.dealer.cards)) {
      this.dealer.revealed = true;
      for (const p of inRound) {
        if (p.hands[0].status === 'playing') p.hands[0].status = 'stand';
      }
      this.push();
      this.settle();
      return;
    }
    this.buildTurnQueue();
    this.push();
    this.nextTurn();
  }

  // ---------------------------------------------------------------- assurance

  openInsurance() {
    this.phase = 'insurance';
    this.insuranceEndsAt = Date.now() + this.opts.insuranceTimeMs;
    this.push();
    this.timers.insurance = setTimeout(() => this.closeInsurance(), this.opts.insuranceTimeMs);
  }

  /** Mise d'assurance entre 0 et la moitié de la mise initiale du joueur. */
  placeInsurance(token, amount) {
    if (this.phase !== 'insurance') throw new Error('Les assurances ne sont pas ouvertes.');
    const p = this.players.get(token);
    if (!p || !p.inRound) throw new Error('Tu ne joues pas cette manche.');
    if (p.insuranceDecided) throw new Error('Décision déjà prise.');
    const maxInsurance = Math.floor(p.hands[0].bet / 2);
    const bet = Math.floor(Number(amount));
    if (!Number.isFinite(bet) || bet < 0 || bet > maxInsurance) {
      throw new Error(`Assurance entre 0 et ${maxInsurance} jetons.`);
    }
    if (bet > p.balance) throw new Error('Solde insuffisant.');
    p.balance -= bet;
    p.insuranceBet = bet;
    p.insuranceDecided = true;
    const deciding = [...this.players.values()].filter((x) => x.inRound && x.connected);
    if (deciding.length > 0 && deciding.every((x) => x.insuranceDecided)) {
      clearTimeout(this.timers.insurance);
      this.closeInsurance();
    } else {
      this.push();
    }
  }

  closeInsurance() {
    if (this.phase !== 'insurance') return;
    this.insuranceEndsAt = null;
    const inRound = [...this.players.values()].filter((p) => p.inRound);
    for (const p of inRound) p.insuranceDecided = true; // indécis = assurance refusée
    this.phase = 'playing';

    if (isNaturalBlackjack(this.dealer.cards)) {
      for (const p of inRound) {
        if (p.insuranceBet > 0) {
          p.balance += p.insuranceBet * 3; // mise rendue + gain payé 2:1
          p.insuranceResult = 'win';
        }
      }
    } else {
      for (const p of inRound) {
        if (p.insuranceBet > 0) p.insuranceResult = 'lose'; // mise déjà déduite, perdue
      }
    }
    this.resolveDealerBlackjackCheck(inRound);
  }

  buildTurnQueue() {
    this.turnQueue = [];
    const ordered = [...this.players.values()]
      .filter((p) => p.inRound)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    for (const p of ordered) {
      for (let i = 0; i < p.hands.length; i++) {
        if (p.hands[i].status === 'playing') this.turnQueue.push({ playerId: p.id, handIndex: i });
      }
    }
  }

  // ---------------------------------------------------------------- tours

  nextTurn() {
    clearTimeout(this.timers.turn);
    // Prochaine main encore en jeu (les splits ajoutent des entrées à la volée).
    this.buildTurnQueue();
    const next = this.turnQueue[0] || null;
    if (!next) {
      this.current = null;
      this.turnEndsAt = null;
      this.playDealer();
      return;
    }
    // Un pré-choix ne s'applique qu'à la toute première décision du joueur
    // ce tour-ci (main d'index 0) — les mains issues d'un split restent
    // toujours manuelles.
    const p = this.players.get(next.playerId);
    if (next.handIndex === 0 && p && p.presetAction) {
      const action = p.presetAction;
      p.presetAction = null;
      this.current = next;
      this.runPresetAction(next.playerId, action);
      return;
    }
    this.current = next;
    this.turnEndsAt = Date.now() + this.opts.turnTimeMs;
    this.timers.turn = setTimeout(() => {
      // Temps écoulé : stand automatique.
      if (this.current) this.stand(this.current.playerId, true);
    }, this.opts.turnTimeMs);
    this.push();
  }

  /**
   * Exécute le pré-choix d'un joueur dès que son tour arrive. Chaque action
   * (hit/stand/double/split) gère déjà son propre enchaînement (nextTurn,
   * ou un nouveau timer si la main reste jouable) — on ne fait que la
   * déclencher à sa place. Si elle n'est plus valide (cas rare), on retombe
   * simplement sur un tour manuel normal plutôt que de bloquer la table.
   */
  runPresetAction(token, action) {
    try {
      if (action === 'hit') this.hit(token);
      else if (action === 'stand') this.stand(token);
      else if (action === 'double') this.double(token);
      else if (action === 'split') this.split(token);
      else throw new Error('Pré-choix invalide.');
    } catch {
      this.turnEndsAt = Date.now() + this.opts.turnTimeMs;
      clearTimeout(this.timers.turn);
      this.timers.turn = setTimeout(() => {
        if (this.current) this.stand(this.current.playerId, true);
      }, this.opts.turnTimeMs);
      this.push();
    }
  }

  /**
   * Programme (ou annule, avec action=null) l'action que ce joueur veut
   * jouer dès que son tour arrivera, pendant qu'il patiente. Uniquement
   * avant que ce ne soit effectivement son tour.
   */
  setPresetAction(token, action) {
    const p = this.players.get(token);
    if (!p) throw new Error('Joueur inconnu.');
    if (action !== null && !['hit', 'stand', 'double', 'split'].includes(action)) {
      throw new Error('Action invalide.');
    }
    if (this.phase !== 'playing') {
      throw new Error('Le pré-choix n\'est possible que pendant une manche en cours.');
    }
    if (!p.inRound || !p.hands[0] || p.hands[0].status !== 'playing') {
      throw new Error('Aucune main en attente pour ce joueur.');
    }
    if (this.current && this.current.playerId === token) {
      throw new Error('C\'est ton tour : joue directement.');
    }
    p.presetAction = action;
    this.push();
  }

  currentHand(token) {
    if (this.phase !== 'playing' || !this.current || this.current.playerId !== token) {
      throw new Error("Ce n'est pas ton tour.");
    }
    const p = this.players.get(token);
    const h = p && p.hands[this.current.handIndex];
    if (!h || h.status !== 'playing') throw new Error('Main non jouable.');
    return { p, h };
  }

  hit(token) {
    const { h } = this.currentHand(token);
    h.cards.push(this.draw());
    const { total } = handValue(h.cards);
    if (total > 21) {
      h.status = 'bust';
      this.nextTurn();
    } else if (total === 21) {
      h.status = 'stand';
      this.nextTurn();
    } else {
      // Le joueur peut continuer : on relance son timer.
      this.turnEndsAt = Date.now() + this.opts.turnTimeMs;
      clearTimeout(this.timers.turn);
      this.timers.turn = setTimeout(() => {
        if (this.current) this.stand(this.current.playerId, true);
      }, this.opts.turnTimeMs);
      this.push();
    }
  }

  stand(token, auto = false) {
    let h;
    try {
      ({ h } = this.currentHand(token));
    } catch (e) {
      if (auto) return; // le timer a pu se déclencher juste après une action
      throw e;
    }
    h.status = 'stand';
    this.nextTurn();
  }

  double(token) {
    const { p, h } = this.currentHand(token);
    if (h.cards.length !== 2) throw new Error('Double possible uniquement sur les 2 premières cartes.');
    if (p.balance < h.bet) throw new Error('Solde insuffisant pour doubler.');
    p.balance -= h.bet;
    h.bet *= 2;
    h.doubled = true;
    h.cards.push(this.draw());
    h.status = handValue(h.cards).total > 21 ? 'bust' : 'stand';
    this.nextTurn();
  }

  split(token) {
    const { p, h } = this.currentHand(token);
    if (p.hands.length >= this.opts.maxSplitHands) {
      throw new Error(`Maximum ${this.opts.maxSplitHands} mains après split.`);
    }
    if (h.cards.length !== 2 || h.cards[0].rank !== h.cards[1].rank) {
      throw new Error('Split possible uniquement avec une paire.');
    }
    if (p.balance < h.bet) throw new Error('Solde insuffisant pour splitter.');
    p.balance -= h.bet;
    const second = { cards: [h.cards.pop()], bet: h.bet, status: 'playing', doubled: false };
    p.hands.push(second);
    h.cards.push(this.draw());
    second.cards.push(this.draw());
    // Un 21 après split n'est pas un blackjack naturel, mais la main est terminée.
    if (handValue(h.cards).total === 21) h.status = 'stand';
    if (handValue(second.cards).total === 21) second.status = 'stand';
    if (h.status === 'playing') {
      // On rejoue la première main avec un timer frais.
      this.turnEndsAt = Date.now() + this.opts.turnTimeMs;
      clearTimeout(this.timers.turn);
      this.timers.turn = setTimeout(() => {
        if (this.current) this.stand(this.current.playerId, true);
      }, this.opts.turnTimeMs);
      this.push();
    } else {
      this.nextTurn();
    }
  }

  // ---------------------------------------------------------------- croupier

  playDealer() {
    this.phase = 'dealer';
    this.current = null;
    this.turnEndsAt = null;
    this.dealer.revealed = true;
    this.push();

    const someoneStanding = [...this.players.values()].some(
      (p) => p.inRound && p.hands.some((h) => h.status === 'stand' || h.status === 'blackjack')
    );

    const step = () => {
      const { total } = handValue(this.dealer.cards);
      // Tire à 16, s'arrête à 17 (Soft 17 : stand). Inutile de tirer si tout le monde a sauté.
      if (someoneStanding && total < 17) {
        this.dealer.cards.push(this.draw());
        this.push();
        this.timers.dealer = setTimeout(step, this.opts.dealerDrawDelayMs);
      } else {
        this.settle();
      }
    };
    this.timers.dealer = setTimeout(step, this.opts.dealerDrawDelayMs);
  }

  // ---------------------------------------------------------------- règlement

  settle() {
    this.clearTimers();
    this.phase = 'results';
    this.dealer.revealed = true;
    const dealerBJ = isNaturalBlackjack(this.dealer.cards);
    const dealerTotal = handValue(this.dealer.cards).total;
    const dealerBust = dealerTotal > 21;

    for (const p of this.players.values()) {
      if (!p.inRound) continue;
      // L'assurance a déjà été réglée pendant la phase dédiée (balance mise
      // à jour) — on l'ajoute simplement au net affiché de la manche.
      let net = 0;
      if (p.insuranceResult === 'win') net += p.insuranceBet * 2;
      else if (p.insuranceResult === 'lose') net -= p.insuranceBet;
      for (const h of p.hands) {
        const total = handValue(h.cards).total;
        if (h.status === 'blackjack') {
          if (dealerBJ) {
            h.result = 'push';
            p.balance += h.bet;
          } else {
            h.result = 'blackjack'; // payé 3:2
            const payout = h.bet + Math.floor(h.bet * 1.5);
            p.balance += payout;
            net += payout - h.bet;
          }
          continue;
        }
        if (h.status === 'bust') {
          h.result = 'lose';
          net -= h.bet;
        } else if (dealerBust || total > dealerTotal) {
          h.result = 'win';
          p.balance += h.bet * 2;
          net += h.bet;
        } else if (total === dealerTotal) {
          h.result = 'push';
          p.balance += h.bet;
        } else {
          h.result = 'lose';
          net -= h.bet;
        }
      }
      p.lastNet = net;
    }

    this.resultsEndsAt = Date.now() + this.opts.resultsTimeMs;
    this.timers.results = setTimeout(() => this.startBetting(), this.opts.resultsTimeMs);
    this.push();
  }

  clearTimers() {
    for (const key of Object.keys(this.timers)) {
      clearTimeout(this.timers[key]);
      this.timers[key] = null;
    }
    this.betEndsAt = null;
    this.turnEndsAt = null;
    this.resultsEndsAt = null;
    this.insuranceEndsAt = null;
  }

  // ---------------------------------------------------------------- mode de jeu

  /**
   * Choisit le mode de jeu, obligatoire avant la toute première manche :
   * 'table' (un écran commun affiche le croupier et le plateau, les
   * téléphones ne sont que des manettes) ou 'phones' (chacun son écran,
   * chaque téléphone affiche aussi le croupier et les autres joueurs).
   */
  setGameMode(mode) {
    if (this.roundNumber > 0 || this.phase !== 'lobby') {
      throw new Error('Le mode de jeu se choisit avant la première manche.');
    }
    if (mode !== 'table' && mode !== 'phones' && mode !== 'both') {
      throw new Error('Mode de jeu invalide.');
    }
    this.mode = mode;
    this.push();
  }

  // ---------------------------------------------------------------- cave & re-cave

  /**
   * Fixe la cave de départ de tous les joueurs. Uniquement avant la toute
   * première manche — ensuite les soldes vivent leur vie, sans reset.
   */
  setStartingBalance(amount) {
    if (this.roundNumber > 0 || this.phase !== 'lobby') {
      throw new Error('La cave de départ se règle avant la première manche.');
    }
    const value = Math.floor(Number(amount));
    if (!Number.isFinite(value) || value < this.opts.minBet || value > 1000000) {
      throw new Error(`Cave invalide (minimum ${this.opts.minBet} jetons).`);
    }
    this.opts.startingBalance = value;
    for (const p of this.players.values()) p.balance = value;
    this.push();
  }

  /** Un joueur à sec demande une re-cave : tous les autres doivent accepter. */
  requestRebuy(token) {
    const p = this.players.get(token);
    if (!p) throw new Error('Joueur inconnu.');
    if (p.balance >= this.opts.minBet) throw new Error('Tu as encore des jetons.');
    if (this.rebuyRequest) throw new Error('Une demande de re-cave est déjà en cours.');
    const voters = [...this.players.values()]
      .filter((x) => x.connected && x.id !== token)
      .map((x) => x.id);
    if (voters.length === 0) {
      // Seul à la table : rien à voter.
      p.balance = this.opts.startingBalance;
      this.push();
      return;
    }
    this.rebuyRequest = { playerId: token, pending: new Set(voters), approved: new Set() };
    this.push();
  }

  /**
   * Vote sur la re-cave en cours. Unanimité requise : un seul refus et le
   * demandeur quitte la table (il pourra revenir comme nouveau joueur).
   * @returns {{ kicked: string|null }}
   */
  voteRebuy(token, accept) {
    const r = this.rebuyRequest;
    if (!r) throw new Error('Aucune demande de re-cave en cours.');
    if (r.playerId === token) throw new Error('Tu ne peux pas voter pour ta propre demande.');
    if (!r.pending.has(token)) throw new Error('Ton vote a déjà été pris en compte.');
    if (!accept) {
      const requester = r.playerId;
      this.rebuyRequest = null;
      this.kickPlayer(requester);
      return { kicked: requester };
    }
    r.pending.delete(token);
    r.approved.add(token);
    if (r.pending.size === 0) this.grantRebuy();
    this.push();
    return { kicked: null };
  }

  grantRebuy() {
    const r = this.rebuyRequest;
    if (!r) return;
    const p = this.players.get(r.playerId);
    if (p) p.balance = this.opts.startingBalance;
    this.rebuyRequest = null;
  }

  /** Retire un joueur de la table (un joueur à sec n'est jamais en cours de manche). */
  kickPlayer(token) {
    this.players.delete(token);
    // Une exclusion est définitive : pas de vestiaire, donc pas de retour
    // avec l'ancien solde — il faudra revenir comme nouveau joueur.
    this.parked.delete(token);
    this.cleanupRebuyAfterLeave(token);
    this.push();
  }

  /** Un joueur parti ne doit ni bloquer un vote, ni laisser une demande orpheline. */
  cleanupRebuyAfterLeave(token) {
    const r = this.rebuyRequest;
    if (!r) return;
    if (r.playerId === token) {
      this.rebuyRequest = null;
      return;
    }
    r.pending.delete(token);
    r.approved.delete(token);
    if (r.pending.size === 0) this.grantRebuy();
  }

  // ------------------------------------------------- dons & exclusion

  /**
   * Transfert de jetons d'un joueur vers un autre. Les mises en cours sont
   * déjà déduites du solde, donc `balance` correspond bien aux jetons
   * réellement disponibles — pas de double dépense possible.
   * Interdit pendant une main en cours, pour ne pas fausser les calculs
   * d'assurance ou de double en plein tour.
   */
  giveChips(fromToken, toToken, amount) {
    if (this.phase === 'playing' || this.phase === 'dealer' || this.phase === 'insurance') {
      throw new Error('Attends la fin de la manche pour donner des jetons.');
    }
    const from = this.players.get(fromToken);
    if (!from) throw new Error('Joueur inconnu.');
    const to = this.players.get(toToken);
    if (!to) throw new Error('Ce joueur n’est plus à la table.');
    if (from.id === to.id) throw new Error('Tu ne peux pas te donner des jetons à toi-même.');
    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0) throw new Error('Montant invalide.');
    if (amt > from.balance) throw new Error('Solde insuffisant.');
    from.balance -= amt;
    to.balance += amt;
    this.push();
    return { from, to, amount: amt };
  }

  /**
   * Exclusion décidée par le chef de table, uniquement entre deux manches
   * (jamais en pleine main : cela casserait l'ordre des tours).
   */
  kickByHost(hostToken, targetToken) {
    if (hostToken !== this.hostPlayerId()) {
      throw new Error('Seul le chef de table peut exclure un joueur.');
    }
    if (this.phase !== 'lobby' && this.phase !== 'results') {
      throw new Error('Exclusion possible seulement entre deux manches.');
    }
    if (hostToken === targetToken) throw new Error('Tu ne peux pas t’exclure toi-même.');
    const target = this.players.get(targetToken);
    if (!target) throw new Error('Ce joueur n’est plus à la table.');
    const name = target.name;
    this.kickPlayer(targetToken);
    return { name };
  }

  /**
   * Chef de table : le joueur connecté le plus ancien. En mode « chacun son
   * écran » (sans ordinateur-table), c'est lui qui lance les manches.
   */
  hostPlayerId() {
    const first = [...this.players.values()]
      .filter((p) => p.connected)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    return first ? first.id : null;
  }

  // ---------------------------------------------------------------- état public

  /** État diffusé à tous les écrans (la carte cachée du croupier est masquée). */
  publicState() {
    const revealed = this.dealer.revealed;
    const dealerCards = this.dealer.cards.map((c, i) =>
      !revealed && i === 1 ? { hidden: true, id: 'hole' } : c
    );
    const visible = revealed ? this.dealer.cards : this.dealer.cards.slice(0, 1);
    const dealerVal = visible.length ? handValue(visible) : { total: 0, soft: false };
    return {
      phase: this.phase,
      roundNumber: this.roundNumber,
      betEndsAt: this.betEndsAt,
      turnEndsAt: this.turnEndsAt,
      resultsEndsAt: this.resultsEndsAt,
      insuranceEndsAt: this.insuranceEndsAt,
      shoeCount: this.shoe.length,
      minBet: this.opts.minBet,
      serverNow: Date.now(),
      hostPlayerId: this.hostPlayerId(),
      mode: this.mode,
      startingBalance: this.opts.startingBalance,
      canConfigure: this.phase === 'lobby' && this.roundNumber === 0,
      rebuyRequest: this.rebuyRequest
        ? {
            playerId: this.rebuyRequest.playerId,
            playerName: (this.players.get(this.rebuyRequest.playerId) || {}).name || '?',
            amount: this.opts.startingBalance,
            approved: this.rebuyRequest.approved.size,
            total: this.rebuyRequest.approved.size + this.rebuyRequest.pending.size,
            awaiting: [...this.rebuyRequest.pending],
          }
        : null,
      dealer: {
        cards: dealerCards,
        revealed,
        total: dealerVal.total,
        soft: dealerVal.soft,
        bust: revealed && dealerVal.total > 21,
        blackjack: revealed && isNaturalBlackjack(this.dealer.cards),
      },
      current: this.current,
      players: [...this.players.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          avatar: p.avatar,
          balance: p.balance,
          connected: p.connected,
          inRound: p.inRound,
          betPlaced: p.betPlaced,
          // Le pré-choix est une information privée : il n'est jamais diffusé
          // ici. Le serveur le réinjecte uniquement dans l'état envoyé à son
          // auteur (voir broadcastState dans server.js).
          presetAction: null,
          insuranceBet: p.insuranceBet,
          insuranceDecided: p.insuranceDecided,
          insuranceResult: p.insuranceResult,
          lastNet: p.lastNet,
          isTurn: !!(this.current && this.current.playerId === p.id),
          turnHandIndex: this.current && this.current.playerId === p.id ? this.current.handIndex : null,
          hands: p.hands.map((h) => {
            const v = handValue(h.cards);
            return {
              cards: h.cards,
              bet: h.bet,
              status: h.status,
              result: h.result || null,
              doubled: h.doubled,
              total: v.total,
              soft: v.soft,
              canDouble: h.cards.length === 2 && h.status === 'playing' && p.balance >= h.bet,
              canSplit:
                p.hands.length < this.opts.maxSplitHands &&
                h.cards.length === 2 &&
                h.status === 'playing' &&
                h.cards[0].rank === h.cards[1].rank &&
                p.balance >= h.bet,
            };
          }),
        })),
    };
  }

  push() {
    this.broadcast(this.publicState());
  }
}

module.exports = { Game, handValue, isNaturalBlackjack, buildShoe, DEFAULTS };
