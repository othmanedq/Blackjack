'use strict';

/**
 * Texas Hold'em No Limit — logique 100 % côté serveur (état autoritaire).
 *
 * Règles implémentées :
 *  - Bouton tournant, petite et grosse blinde ; en tête-à-tête, le bouton
 *    paie la petite blinde et parle en premier avant le flop, en dernier après
 *  - 4 tours d'enchères : préflop, flop, turn, river (une carte brûlée avant chaque tirage)
 *  - No Limit : relance minimale = taille de la dernière relance complète ;
 *    un tapis inférieur à une relance complète ne rouvre pas les enchères
 *    pour ceux qui ont déjà parlé
 *  - Pots annexes quand un joueur est à tapis ; mise non suivie rendue
 *  - Abattage : meilleure main de 5 cartes parmi 7, partage en cas d'égalité
 *    (jeton indivisible au premier gagnant à gauche du bouton)
 *  - Tout le monde à tapis : les cartes restantes sont retournées une à une
 */

const { bestHand, compareHands, describeHand, RANK_VALUE } = require('./poker-hand');

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const DEFAULTS = {
  maxPlayers: 8,
  startingStack: 1000,
  startLevel: 3,        // niveau de blindes de départ (5/10)
  blindMode: 'long',    // évolution des blindes : fast | long | elimination
  turnTimeMs: 30000,
  resultsTimeMs: 7000,
  runoutDelayMs: 1100,  // pause entre deux cartes quand tout le monde est à tapis
  maxParked: 64,
  freeRebuys: 3,        // recaves automatiques par joueur ; au-delà, vote à la majorité
  rebuyRetryMs: 60000,  // délai avant de redemander une recave refusée
};

// Échelle des blindes, façon tournoi : [petite, grosse].
const BLIND_SCHEDULE = [
  [1, 2], [2, 4], [3, 6], [5, 10], [10, 20], [15, 30], [25, 50], [50, 100], [75, 150],
  [100, 200], [150, 300], [200, 400], [300, 600], [500, 1000], [750, 1500], [1000, 2000],
  [1500, 3000], [2000, 4000], [3000, 6000], [5000, 10000],
];
// Niveaux de départ proposés au chef de table (indices dans l'échelle).
const START_LEVELS = [0, 3, 4, 6, 7, 9];
// Évolution des blindes : un niveau de plus tous les N minutes, ou à chaque élimination.
const BLIND_MODES = {
  fast: { label: 'Rapide', detail: 'toutes les 5 min', minutes: 5 },
  long: { label: 'Longue', detail: 'toutes les 15 min', minutes: 15 },
  elimination: { label: 'À chaque élimination', detail: 'un joueur à zéro', minutes: null },
};

let deckSeq = 0;

/** Paquet de 52 cartes mélangé (Fisher–Yates, j tiré dans [0, i]). */
function freshDeck() {
  deckSeq += 1;
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit, id: `p${deckSeq}-${rank}${suit}` });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

class PokerGame {
  /**
   * @param {(game: PokerGame) => void} broadcast — appelé à chaque changement
   *   (l'état est construit par joueur, les cartes privées restant secrètes)
   */
  constructor(broadcast, options = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.broadcast = broadcast;
    this.phase = 'lobby'; // lobby | preflop | flop | turn | river | showdown
    this.players = new Map(); // token -> joueur
    this.parked = new Map();  // joueurs partis : leur tapis les attend
    this.seats = new Array(this.opts.maxPlayers).fill(null);
    this.handNumber = 0;
    this.dealerSeat = -1;
    this.sbSeat = -1;
    this.bbSeat = -1;
    this.board = [];
    this.deck = [];
    this.nextDeck = null; // tests : paquet imposé pour la prochaine main
    this.toAct = -1;      // siège qui doit parler
    this.currentBet = 0;  // plus grosse mise du tour en cours
    this.minRaise = 0;    // relance minimale (taille de la dernière relance complète)
    this.pots = [];       // affichage : pots formés à la fin d'un tour d'enchères
    this.results = null;  // abattage : gagnants et mains montrées
    this.turnEndsAt = null;
    this.resultsEndsAt = null;
    this.timers = { turn: null, runout: null, results: null };
    this.moderatorId = null;
    this.configured = false; // tapis et blindes verrouillés après la 1re main
    this.rebuyRequest = null; // vote de recave en cours : { playerId, pending, approved, refused }
    // Blindes progressives
    this.blindLevel = this.opts.startLevel;
    this.blindMode = this.opts.blindMode;
    this.nextLevelAt = null;      // modes chronométrés : passage au niveau suivant
    this.pausedAt = null;         // partie arrêtée faute de joueurs : le chrono s'arrête
    this.pendingLevelUps = 0;     // mode élimination : éliminations pas encore appliquées
    this.lastLevelUpHand = 0;     // main où les blindes viennent de monter (annonce)
  }

  // ------------------------------------------------------------------ joueurs

  addPlayer({ token, name, color, avatar }) {
    const existing = this.players.get(token);
    if (existing) {
      existing.connected = true;
      existing.disconnectedAt = null;
      if (name) existing.name = name;
      this.push();
      return existing;
    }
    const seat = this.seats.indexOf(null);
    if (seat === -1) throw new Error(`La table de poker est pleine (${this.opts.maxPlayers} joueurs max).`);
    const parked = this.parked.get(token);
    const p = parked || {
      id: token,
      name: name || 'Joueur',
      color: color || '#facc15',
      avatar: avatar || 'spade',
      stack: this.opts.startingStack,
      rebuys: 0,
      rebuyRetryAt: 0,
      ip: null,
      joinedAt: Date.now(),
    };
    this.parked.delete(token);
    Object.assign(p, {
      seat,
      connected: true,
      disconnectedAt: null,
      inHand: false,
      folded: false,
      allIn: false,
      acted: false,
      raiseLocked: false,
      bet: 0,
      totalBet: 0,
      holeCards: [],
      lastAction: null,
    });
    if (name) p.name = name;
    if (color) p.color = color;
    if (avatar) p.avatar = avatar;
    this.players.set(token, p);
    this.seats[seat] = token;
    this.push();
    return p;
  }

  /** Libère le siège ; le tapis part au vestiaire (retrouvé en revenant). */
  removePlayer(token, { keepStack = true } = {}) {
    const p = this.players.get(token);
    if (!p) return;
    this.seats[p.seat] = null;
    this.players.delete(token);
    this.cleanupRebuyAfterLeave(token);
    if (keepStack) {
      this.parked.set(token, p);
      if (this.parked.size > this.opts.maxParked) {
        const oldest = [...this.parked.values()].sort((a, b) => (a.disconnectedAt || 0) - (b.disconnectedAt || 0))[0];
        if (oldest) this.parked.delete(oldest.id);
      }
    }
  }

  disconnectPlayer(token) {
    const p = this.players.get(token);
    if (!p) return;
    p.connected = false;
    p.disconnectedAt = Date.now();
    // Un absent ne doit pas bloquer un vote de recave.
    this.cleanupRebuyAfterLeave(token);
    // Son tour : on joue pour lui (parole si possible, sinon passe) pour ne pas bloquer la table.
    if (this.isBetting() && this.seats[this.toAct] === token) {
      this.autoAct(p);
      return;
    }
    this.push();
  }

  /** Départ volontaire : interdit avec des jetons engagés dans une main en cours. */
  leaveTable(token) {
    const p = this.players.get(token);
    if (!p) throw new Error('Tu n’es pas à la table.');
    if (p.inHand && !p.folded && this.isBetting()) {
      throw new Error('Couche-toi ou termine la main avant de quitter la table.');
    }
    p.connected = false;
    p.disconnectedAt = Date.now();
    this.removePlayer(token);
    if (this.isBetting()) this.checkHandEnd();
    this.push();
  }

  findResumeCandidate(ip, excludeToken) {
    if (!ip) return null;
    const now = Date.now();
    let best = null;
    for (const p of [...this.players.values(), ...this.parked.values()]) {
      if (p.id === excludeToken || p.connected || p.ip !== ip) continue;
      if (!p.disconnectedAt || now - p.disconnectedAt > 20 * 60 * 1000) continue;
      if (!best || p.disconnectedAt > best.disconnectedAt) best = p;
    }
    return best;
  }

  /** Chef de table : le modérateur s'il est là, sinon le plus ancien connecté. */
  hostPlayerId() {
    const mod = this.moderatorId && this.players.get(this.moderatorId);
    if (mod && mod.connected) return mod.id;
    const first = [...this.players.values()].filter((p) => p.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    return first ? first.id : null;
  }

  setModerator(token) {
    if (!this.players.has(token)) throw new Error('Joueur inconnu.');
    this.moderatorId = token;
    this.push();
  }

  assertChef(token) {
    if (token !== this.hostPlayerId()) throw new Error('Réservé au chef de table.');
  }

  assertModerator(token) {
    if (!token || token !== this.moderatorId) throw new Error('Réservé au modérateur.');
  }

  // ------------------------------------------------------------ configuration

  /** Tapis de départ, blindes de départ et leur évolution : réglables avant la première main. */
  configure(token, { stack, blinds, mode } = {}) {
    this.assertChef(token);
    if (this.configured) throw new Error('Les réglages se font avant la première main.');
    if (stack !== undefined) {
      const v = Math.floor(Number(stack));
      if (!Number.isFinite(v) || v < 20 || v > 1000000) throw new Error('Tapis de départ invalide.');
      this.opts.startingStack = v;
      for (const p of this.players.values()) p.stack = v;
    }
    if (blinds !== undefined) {
      const level = Number(blinds);
      if (!START_LEVELS.includes(level)) throw new Error('Blindes invalides.');
      this.blindLevel = level;
    }
    if (mode !== undefined) {
      if (!BLIND_MODES[mode]) throw new Error('Évolution des blindes invalide.');
      this.blindMode = mode;
    }
    this.push();
  }

  get smallBlind() { return BLIND_SCHEDULE[this.blindLevel][0]; }
  get bigBlind() { return BLIND_SCHEDULE[this.blindLevel][1]; }

  levelMs() {
    const m = BLIND_MODES[this.blindMode].minutes;
    return m ? m * 60 * 1000 : null;
  }

  /**
   * Fait monter les blindes avant une nouvelle main (jamais pendant) :
   * selon le temps écoulé, ou selon les éliminations de la main précédente.
   */
  advanceBlinds(now) {
    const before = this.blindLevel;
    const step = this.levelMs();
    if (step) {
      if (this.nextLevelAt === null) this.nextLevelAt = now + step;
      // Le temps de pause (partie arrêtée) ne compte pas.
      if (this.pausedAt !== null) {
        this.nextLevelAt += now - this.pausedAt;
        this.pausedAt = null;
      }
      while (now >= this.nextLevelAt) {
        this.blindLevel += 1;
        this.nextLevelAt += step;
      }
    } else {
      this.blindLevel += this.pendingLevelUps;
      this.pendingLevelUps = 0;
    }
    this.blindLevel = Math.min(this.blindLevel, BLIND_SCHEDULE.length - 1);
    if (this.blindLevel !== before) this.lastLevelUpHand = this.handNumber + 1;
  }

  /**
   * Recave, seulement à sec et hors d'une main : les 3 premières sont
   * automatiques, ensuite la majorité des autres joueurs doit accepter.
   * @returns {'granted' | 'vote'}
   */
  rebuy(token) {
    const p = this.players.get(token);
    if (!p) throw new Error('Joueur inconnu.');
    if (p.stack > 0) throw new Error('Tu as encore des jetons.');
    if (p.inHand && !p.folded && this.isBetting()) throw new Error('Attends la fin de la main.');
    if (this.rebuyRequest) throw new Error('Un vote de recave est déjà en cours.');
    if (p.rebuyRetryAt && Date.now() < p.rebuyRetryAt) {
      const s = Math.ceil((p.rebuyRetryAt - Date.now()) / 1000);
      throw new Error(`Ta recave vient d’être refusée : réessaie dans ${s} s.`);
    }
    const voters = [...this.players.values()].filter((x) => x.connected && x.id !== token).map((x) => x.id);
    if (p.rebuys < this.opts.freeRebuys || token === this.moderatorId || voters.length === 0) {
      this.creditRebuy(p);
      this.push();
      this.restartIfStalled();
      return 'granted';
    }
    this.rebuyRequest = { playerId: token, pending: new Set(voters), approved: new Set(), refused: new Set() };
    this.push();
    return 'vote';
  }

  creditRebuy(p) {
    p.stack = this.opts.startingStack;
    p.rebuys += 1;
    p.rebuyRetryAt = 0;
  }

  /** Une table arrêtée faute de joueurs avec des jetons repart d'elle-même. */
  restartIfStalled() {
    if (this.phase === 'lobby' && this.configured && this.eligiblePlayers().length >= 2) this.startHand();
  }

  rebuyNeeded(r) {
    return Math.floor((r.pending.size + r.approved.size + r.refused.size) / 2) + 1;
  }

  /** Conclut le vote dès que l'issue est certaine. @returns {'granted'|'denied'|null} */
  settleRebuyVote() {
    const r = this.rebuyRequest;
    if (!r) return null;
    const needed = this.rebuyNeeded(r);
    const p = this.players.get(r.playerId);
    if (r.approved.size >= needed) {
      this.rebuyRequest = null;
      if (p) this.creditRebuy(p);
      return 'granted';
    }
    if (r.approved.size + r.pending.size < needed) {
      this.rebuyRequest = null;
      if (p) p.rebuyRetryAt = Date.now() + this.opts.rebuyRetryMs;
      return 'denied';
    }
    return null;
  }

  /** Vote d'un joueur ; un refus n'exclut personne. */
  voteRebuy(token, accept) {
    const r = this.rebuyRequest;
    if (!r) throw new Error('Aucun vote de recave en cours.');
    if (r.playerId === token) throw new Error('Tu ne peux pas voter pour ta propre recave.');
    if (!r.pending.has(token)) throw new Error('Ton vote a déjà été pris en compte.');
    r.pending.delete(token);
    (accept ? r.approved : r.refused).add(token);
    const requester = r.playerId;
    const outcome = this.settleRebuyVote();
    this.push();
    if (outcome === 'granted') this.restartIfStalled();
    return { outcome, requester };
  }

  /** Le modérateur tranche seul le vote en cours. */
  decideRebuy(modToken, accept) {
    this.assertModerator(modToken);
    const r = this.rebuyRequest;
    if (!r) throw new Error('Aucun vote de recave en cours.');
    const requester = r.playerId;
    const p = this.players.get(requester);
    this.rebuyRequest = null;
    if (p && accept) this.creditRebuy(p);
    else if (p) p.rebuyRetryAt = Date.now() + this.opts.rebuyRetryMs;
    this.push();
    if (accept) this.restartIfStalled();
    return { outcome: accept ? 'granted' : 'denied', requester };
  }

  /** Un joueur parti ne bloque pas un vote, et sa propre demande tombe. */
  cleanupRebuyAfterLeave(token) {
    const r = this.rebuyRequest;
    if (!r) return;
    if (r.playerId === token) {
      this.rebuyRequest = null;
      return;
    }
    r.pending.delete(token);
    r.approved.delete(token);
    r.refused.delete(token);
    this.settleRebuyVote();
  }

  /** Le modérateur ajoute ou retire des jetons (jamais ceux déjà misés). */
  adjustStack(modToken, targetToken, delta) {
    this.assertModerator(modToken);
    const target = this.players.get(targetToken);
    if (!target) throw new Error('Ce joueur n’est plus à la table.');
    const d = Math.trunc(Number(delta));
    if (!Number.isFinite(d) || d === 0 || Math.abs(d) > 1000000) throw new Error('Montant invalide.');
    const before = target.stack;
    target.stack = Math.min(10000000, Math.max(0, before + d));
    this.push();
    return target.stack - before;
  }

  /** Exclusion par le chef, entre deux mains : le joueur repart sans son tapis. */
  kick(chefToken, targetToken) {
    this.assertChef(chefToken);
    if (this.isBetting()) throw new Error('Exclusion possible seulement entre deux mains.');
    if (chefToken === targetToken) throw new Error('Tu ne peux pas t’exclure toi-même.');
    if (!this.players.has(targetToken)) throw new Error('Ce joueur n’est plus à la table.');
    this.removePlayer(targetToken, { keepStack: false });
    this.parked.delete(targetToken);
    this.push();
  }

  // ------------------------------------------------------------------- mains

  isBetting() {
    return ['preflop', 'flop', 'turn', 'river'].includes(this.phase);
  }

  /** Sièges occupés, dans l'ordre de la table, à partir du siège suivant `from`. */
  seatsAfter(from) {
    const n = this.seats.length;
    const out = [];
    for (let i = 1; i <= n; i++) {
      const s = (from + i + n) % n;
      if (this.seats[s]) out.push(s);
    }
    return out;
  }

  playerAt(seat) {
    const token = this.seats[seat];
    return token ? this.players.get(token) : null;
  }

  /** Le chef lance la partie ; ensuite les mains s'enchaînent seules. */
  start(token) {
    this.assertChef(token);
    if (this.isBetting()) throw new Error('Une main est déjà en cours.');
    if (this.eligiblePlayers().length < 2) throw new Error('Il faut au moins 2 joueurs avec des jetons.');
    this.startHand();
  }

  eligiblePlayers() {
    return [...this.players.values()].filter((p) => p.connected && p.stack > 0);
  }

  startHand() {
    this.clearTimers();
    // Les absents quittent la table (leur tapis les attend au vestiaire).
    for (const p of [...this.players.values()]) {
      if (!p.connected) this.removePlayer(p.id);
    }
    const eligible = this.eligiblePlayers();
    // Un joueur parti pendant la main précédente ne doit plus compter dans les pots.
    for (const p of this.parked.values()) {
      p.inHand = false;
      p.totalBet = 0;
      p.bet = 0;
    }
    for (const p of this.players.values()) {
      Object.assign(p, {
        inHand: false, folded: false, allIn: false, acted: false, raiseLocked: false,
        bet: 0, totalBet: 0, holeCards: [], lastAction: null,
      });
    }
    this.board = [];
    this.pots = [];
    this.results = null;
    if (eligible.length < 2) {
      // Pause : le chrono des blindes s'arrête jusqu'à la reprise.
      if (this.configured && this.pausedAt === null) this.pausedAt = Date.now();
      this.phase = 'lobby';
      this.toAct = -1;
      this.push();
      return;
    }
    this.advanceBlinds(Date.now());
    this.configured = true;
    this.handNumber += 1;
    for (const p of eligible) p.inHand = true;
    const inHandSeats = (from) => this.seatsAfter(from).filter((s) => this.playerAt(s).inHand);

    // Bouton : prochain joueur de la main après le précédent bouton.
    this.dealerSeat = inHandSeats(this.dealerSeat)[0];
    const order = inHandSeats(this.dealerSeat); // à gauche du bouton, bouton en dernier
    const headsUp = eligible.length === 2;
    this.sbSeat = headsUp ? this.dealerSeat : order[0];
    this.bbSeat = headsUp ? order[0] : order[1];

    this.deck = this.nextDeck ? this.nextDeck.slice() : freshDeck();
    this.nextDeck = null;
    // Distribution : une carte à chacun en partant de la gauche du bouton, deux fois.
    for (let round = 0; round < 2; round++) {
      for (const s of order) this.playerAt(s).holeCards.push(this.deck.shift());
    }

    this.phase = 'preflop';
    this.minRaise = this.bigBlind;
    this.postBlind(this.playerAt(this.sbSeat), this.smallBlind, 'sb');
    this.postBlind(this.playerAt(this.bbSeat), this.bigBlind, 'bb');
    this.currentBet = this.bigBlind;

    // Préflop : parle en premier le joueur après la grosse blinde.
    this.setTurnAfter(this.bbSeat);
  }

  postBlind(p, amount, label) {
    const paid = Math.min(amount, p.stack);
    p.stack -= paid;
    p.bet += paid;
    p.totalBet += paid;
    p.lastAction = label;
    if (p.stack === 0) p.allIn = true;
  }

  /** Joueurs encore en lice (pas couchés). */
  contenders() {
    return [...this.players.values()].filter((p) => p.inHand && !p.folded);
  }

  /** Doit encore parler : pas couché, pas à tapis, et n'a pas égalisé ou pas encore parlé. */
  needsToAct(p) {
    return p.inHand && !p.folded && !p.allIn && (!p.acted || p.bet < this.currentBet);
  }

  /** Donne la parole au prochain joueur qui doit parler après `seat`, sinon clôt le tour. */
  setTurnAfter(seat) {
    clearTimeout(this.timers.turn);
    const next = this.seatsAfter(seat).find((s) => this.needsToAct(this.playerAt(s)));
    if (next === undefined) {
      this.endBettingRound();
      return;
    }
    this.toAct = next;
    this.turnEndsAt = Date.now() + this.opts.turnTimeMs;
    this.timers.turn = setTimeout(() => {
      const p = this.playerAt(this.toAct);
      if (p) this.autoAct(p);
    }, this.opts.turnTimeMs);
    // Absent : on joue pour lui tout de suite.
    const p = this.playerAt(next);
    if (!p.connected) {
      this.autoAct(p);
      return;
    }
    this.push();
  }

  /** Temps écoulé ou joueur absent : parole si possible, sinon il se couche. */
  autoAct(p) {
    if (!this.isBetting() || this.seats[this.toAct] !== p.id) return;
    this.applyAction(p, p.bet >= this.currentBet ? 'check' : 'fold');
  }

  /**
   * Action d'un joueur.
   * @param {'fold'|'check'|'call'|'raise'|'allin'} type
   * @param {number} [amount] — pour 'raise' : montant total misé sur ce tour (« relance à »)
   */
  act(token, type, amount) {
    if (!this.isBetting()) throw new Error('Aucune main en cours.');
    const p = this.players.get(token);
    if (!p || this.seats[this.toAct] !== token) throw new Error('Ce n’est pas à toi de parler.');
    this.applyAction(p, type, amount);
  }

  applyAction(p, type, amount) {
    const toCall = this.currentBet - p.bet;
    const maxTotal = p.bet + p.stack; // tout son tapis

    if (type === 'allin') {
      type = maxTotal > this.currentBet ? 'raise' : 'call';
      amount = maxTotal;
    }

    if (type === 'fold') {
      p.folded = true;
      p.lastAction = 'fold';
    } else if (type === 'check') {
      if (toCall > 0) throw new Error('Tu ne peux pas checker : il y a une mise à suivre.');
      p.lastAction = 'check';
    } else if (type === 'call') {
      if (toCall <= 0) throw new Error('Rien à suivre : tu peux checker.');
      this.putIn(p, Math.min(toCall, p.stack));
      p.lastAction = p.allIn ? 'allin' : 'call';
    } else if (type === 'raise') {
      const target = Math.floor(Number(amount));
      if (!Number.isFinite(target)) throw new Error('Montant invalide.');
      if (p.raiseLocked) throw new Error('Tu ne peux que suivre ou te coucher (relance incomplète).');
      if (target <= this.currentBet) throw new Error('La relance doit dépasser la mise actuelle.');
      if (target > maxTotal) throw new Error('Tu n’as pas assez de jetons.');
      const increment = target - this.currentBet;
      const isAllIn = target === maxTotal;
      if (increment < this.minRaise && !isAllIn) {
        throw new Error(`Relance minimum : jusqu’à ${this.currentBet + this.minRaise}.`);
      }
      const opening = this.currentBet === 0;
      this.putIn(p, target - p.bet);
      if (increment >= this.minRaise) {
        // Relance complète : les autres doivent reparler et peuvent relancer.
        this.minRaise = increment;
        for (const o of this.contenders()) {
          if (o !== p) {
            o.acted = false;
            o.raiseLocked = false;
          }
        }
      } else {
        // Tapis inférieur à une relance complète : ceux qui ont déjà parlé
        // doivent suivre ou se coucher, sans pouvoir relancer.
        for (const o of this.contenders()) {
          if (o !== p && o.acted) {
            o.acted = false;
            o.raiseLocked = true;
          }
        }
      }
      this.currentBet = target;
      p.lastAction = p.allIn ? 'allin' : opening ? 'bet' : 'raise';
    } else {
      throw new Error('Action inconnue.');
    }

    p.acted = true;
    if (this.checkHandEnd()) return;
    this.setTurnAfter(p.seat);
  }

  putIn(p, chips) {
    p.stack -= chips;
    p.bet += chips;
    p.totalBet += chips;
    if (p.stack === 0) p.allIn = true;
  }

  /** Un seul joueur en lice : il ramasse tout, sans montrer ses cartes. */
  checkHandEnd() {
    const alive = this.contenders();
    if (alive.length > 1) return false;
    this.clearTimers();
    const winner = alive[0];
    const total = [...this.players.values(), ...this.parked.values()].reduce((n, p) => n + (p.totalBet || 0), 0);
    if (winner) winner.stack += total;
    this.finish({
      showdown: false,
      pots: [{ amount: total, winners: winner ? [{ id: winner.id, amount: total }] : [] }],
      shown: [],
    });
    return true;
  }

  endBettingRound() {
    clearTimeout(this.timers.turn);
    this.toAct = -1;
    this.turnEndsAt = null;
    this.returnUncalled();
    for (const p of this.players.values()) {
      p.bet = 0;
      p.acted = false;
      p.raiseLocked = false;
      if (p.inHand && !p.folded && p.lastAction !== 'allin') p.lastAction = null;
    }
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.pots = this.buildPots().map(({ amount, eligible }) => ({ amount, eligible: eligible.map((p) => p.id) }));

    if (this.phase === 'river') {
      this.showdown();
      return;
    }
    // Plus personne (ou un seul) ne peut miser : on retourne le reste du tableau.
    const canBet = this.contenders().filter((p) => !p.allIn);
    if (canBet.length <= 1) {
      this.dealNextStreet();
      this.push();
      this.timers.runout = setTimeout(() => this.endBettingRound(), this.opts.runoutDelayMs);
      return;
    }
    this.dealNextStreet();
    // Après le flop : parle le premier joueur en lice à gauche du bouton.
    this.setTurnAfter(this.dealerSeat);
  }

  dealNextStreet() {
    this.deck.shift(); // carte brûlée
    if (this.phase === 'preflop') {
      this.board.push(this.deck.shift(), this.deck.shift(), this.deck.shift());
      this.phase = 'flop';
    } else if (this.phase === 'flop') {
      this.board.push(this.deck.shift());
      this.phase = 'turn';
    } else if (this.phase === 'turn') {
      this.board.push(this.deck.shift());
      this.phase = 'river';
    }
  }

  /** La part d'une mise que personne n'a pu suivre revient à son auteur. */
  returnUncalled() {
    const inHand = [...this.players.values()].filter((p) => p.inHand);
    if (inHand.length < 2) return;
    const sorted = inHand.slice().sort((a, b) => b.totalBet - a.totalBet);
    const [top, second] = sorted;
    const excess = top.totalBet - second.totalBet;
    if (excess > 0) {
      top.totalBet -= excess;
      top.bet = Math.max(0, top.bet - excess);
      top.stack += excess;
      if (top.stack > 0) top.allIn = false;
    }
  }

  /**
   * Pots (principal + annexes) d'après les sommes engagées sur toute la main.
   * Les jetons des joueurs couchés comptent, mais eux ne peuvent rien gagner.
   */
  buildPots() {
    const all = [...this.players.values(), ...this.parked.values()].filter((p) => p.totalBet > 0);
    const remaining = new Map(all.map((p) => [p.id, p.totalBet]));
    const contenders = this.contenders();
    const pots = [];
    while (contenders.some((p) => remaining.get(p.id) > 0)) {
      const level = Math.min(...contenders.filter((p) => remaining.get(p.id) > 0).map((p) => remaining.get(p.id)));
      let amount = 0;
      for (const p of all) {
        const part = Math.min(remaining.get(p.id), level);
        amount += part;
        remaining.set(p.id, remaining.get(p.id) - part);
      }
      const eligible = contenders.filter((p) => p.totalBet >= this.potThreshold(pots, level));
      pots.push({ amount, eligible, level });
    }
    // Reliquat de joueurs couchés au-delà de toutes les mises en lice : au dernier pot.
    const leftover = [...remaining.values()].reduce((n, v) => n + v, 0);
    if (leftover > 0 && pots.length) pots[pots.length - 1].amount += leftover;
    return pots;
  }

  /** Mise cumulée qu'il faut avoir engagée pour disputer le pot de ce palier. */
  potThreshold(pots, level) {
    return pots.reduce((n, pot) => n + pot.level, 0) + level;
  }

  showdown() {
    this.clearTimers();
    const contenders = this.contenders();
    const hands = new Map(contenders.map((p) => [p.id, bestHand([...p.holeCards, ...this.board])]));
    // Ordre de distribution des jetons indivisibles : à gauche du bouton.
    const leftOfButton = this.seatsAfter(this.dealerSeat);
    const results = [];
    for (const pot of this.buildPots()) {
      let best = null;
      let winners = [];
      for (const p of pot.eligible) {
        const h = hands.get(p.id);
        const c = best ? compareHands(h.score, best.score) : 1;
        if (c > 0) {
          best = h;
          winners = [p];
        } else if (c === 0) {
          winners.push(p);
        }
      }
      winners.sort((a, b) => leftOfButton.indexOf(a.seat) - leftOfButton.indexOf(b.seat));
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      const paid = winners.map((w) => {
        const amount = share + (odd-- > 0 ? 1 : 0);
        w.stack += amount;
        return { id: w.id, amount };
      });
      results.push({ amount: pot.amount, winners: paid, label: best ? best.label : '' });
    }
    this.finish({
      showdown: true,
      pots: results,
      shown: contenders.map((p) => ({
        id: p.id,
        cards: p.holeCards,
        label: hands.get(p.id).label,
        best: hands.get(p.id).cards.map((c) => c.id),
      })),
    });
  }

  finish(results) {
    // Mode élimination : chaque joueur tombé à zéro fera monter les blindes d'un niveau.
    if (this.blindMode === 'elimination') {
      for (const p of this.players.values()) if (p.inHand && p.stack === 0) this.pendingLevelUps += 1;
    }
    this.phase = 'showdown';
    this.toAct = -1;
    this.turnEndsAt = null;
    this.pots = [];
    // Gain net de la main pour chacun (affichage).
    const won = new Map();
    for (const pot of results.pots) for (const w of pot.winners) won.set(w.id, (won.get(w.id) || 0) + w.amount);
    results.net = {};
    for (const p of this.players.values()) {
      if (p.inHand) results.net[p.id] = (won.get(p.id) || 0) - p.totalBet;
    }
    this.results = results;
    this.resultsEndsAt = Date.now() + this.opts.resultsTimeMs;
    this.timers.results = setTimeout(() => this.startHand(), this.opts.resultsTimeMs);
    this.push();
  }

  clearTimers() {
    for (const key of Object.keys(this.timers)) {
      clearTimeout(this.timers[key]);
      this.timers[key] = null;
    }
  }

  // ------------------------------------------------------------- état diffusé

  /** Montant total sur la table (pots formés + mises du tour en cours). */
  totalPot() {
    return [...this.players.values(), ...this.parked.values()].reduce((n, p) => n + (p.inHand ? p.totalBet : 0), 0);
  }

  /**
   * État vu par un joueur : ses propres cartes, jamais celles des autres
   * (sauf celles montrées à l'abattage).
   * @param {string|null} viewerId
   */
  stateFor(viewerId) {
    const shown = new Map((this.results && this.results.shown || []).map((s) => [s.id, s]));
    const me = viewerId && this.players.get(viewerId);
    const toCall = me && this.isBetting() ? Math.max(0, this.currentBet - me.bet) : 0;
    return {
      game: 'poker',
      phase: this.phase,
      handNumber: this.handNumber,
      serverNow: Date.now(),
      turnEndsAt: this.turnEndsAt,
      resultsEndsAt: this.resultsEndsAt,
      maxPlayers: this.opts.maxPlayers,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      blindLevel: this.blindLevel,
      blindMode: this.blindMode,
      blindModes: BLIND_MODES,
      startLevels: START_LEVELS.map((i) => ({ level: i, blinds: BLIND_SCHEDULE[i] })),
      nextBlinds: BLIND_SCHEDULE[this.blindLevel + 1] || null,
      // Chrono figé pendant une pause : on envoie le temps restant plutôt qu'une heure.
      nextLevelAt: this.levelMs() && this.nextLevelAt && this.pausedAt === null ? this.nextLevelAt : null,
      pendingLevelUps: this.pendingLevelUps,
      blindsJustRose: this.lastLevelUpHand === this.handNumber && this.handNumber > 1,
      startingStack: this.opts.startingStack,
      freeRebuys: this.opts.freeRebuys,
      rebuyRequest: this.rebuyRequest && {
        playerId: this.rebuyRequest.playerId,
        playerName: (this.players.get(this.rebuyRequest.playerId) || {}).name || '?',
        amount: this.opts.startingStack,
        approved: this.rebuyRequest.approved.size,
        refused: this.rebuyRequest.refused.size,
        needed: this.rebuyNeeded(this.rebuyRequest),
        total: this.rebuyRequest.pending.size + this.rebuyRequest.approved.size + this.rebuyRequest.refused.size,
        awaiting: [...this.rebuyRequest.pending],
      },
      canConfigure: !this.configured,
      hostPlayerId: this.hostPlayerId(),
      moderatorId: this.moderatorId,
      dealerSeat: this.dealerSeat,
      sbSeat: this.sbSeat,
      bbSeat: this.bbSeat,
      toActSeat: this.toAct,
      board: this.board,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      pot: this.totalPot(),
      pots: this.pots.map((p) => ({ amount: p.amount })),
      results: this.results && {
        showdown: this.results.showdown,
        pots: this.results.pots,
        net: this.results.net,
      },
      // Ce que le spectateur peut faire, calculé ici pour que l'interface reste simple.
      you: me
        ? {
            id: me.id,
            holeCards: me.holeCards,
            toCall,
            canCheck: toCall === 0,
            canRaise: !me.raiseLocked && me.stack > toCall,
            minRaiseTo: Math.min(me.bet + me.stack, this.currentBet + this.minRaise),
            maxRaiseTo: me.bet + me.stack,
            handLabel: this.currentHandLabel(me),
          }
        : null,
      players: [...this.players.values()]
        .sort((a, b) => a.seat - b.seat)
        .map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          avatar: p.avatar,
          seat: p.seat,
          stack: p.stack,
          rebuys: p.rebuys,
          rebuyRetryAt: p.rebuyRetryAt || 0,
          connected: p.connected,
          inHand: p.inHand,
          folded: p.folded,
          allIn: p.allIn,
          bet: p.bet,
          lastAction: p.lastAction,
          isTurn: this.isBetting() && this.seats[this.toAct] === p.id,
          // Dos de cartes pour les autres ; faces seulement pour soi ou à l'abattage.
          cardCount: p.holeCards.length,
          shownCards: shown.has(p.id) ? shown.get(p.id).cards : null,
          handLabel: shown.has(p.id) ? shown.get(p.id).label : null,
          bestCards: shown.has(p.id) ? shown.get(p.id).best : null,
        })),
    };
  }

  /** Force de la main d'un joueur avec le tableau actuel (« Paire de dames »…). */
  currentHandLabel(p) {
    if (p.holeCards.length !== 2) return null;
    if (this.board.length >= 3) return bestHand([...p.holeCards, ...this.board]).label;
    // Préflop : paire servie ou carte haute.
    const [a, b] = p.holeCards.map((c) => RANK_VALUE[c.rank]);
    return a === b ? describeHand([1, a]) : describeHand([0, Math.max(a, b)]);
  }

  push() {
    this.broadcast(this);
  }
}

module.exports = { PokerGame, BLIND_SCHEDULE, BLIND_MODES, START_LEVELS, DEFAULTS };
