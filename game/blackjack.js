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
 *  - Double Down (2 premières cartes, solde suffisant), Split (paire de même rang, 1 split max)
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
  resultsTimeMs: 12000,
  dealerDrawDelayMs: 900,
  maxPlayers: 7,
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
    this.turnQueue = []; // [{ playerId, handIndex }]
    this.current = null; // { playerId, handIndex } | null
    this.betEndsAt = null;
    this.turnEndsAt = null;
    this.resultsEndsAt = null;
    this.roundNumber = 0;
    this.timers = { bet: null, turn: null, dealer: null, results: null };
  }

  // ---------------------------------------------------------------- joueurs

  addPlayer({ token, name, color, avatar }) {
    const existing = this.players.get(token);
    if (existing) {
      existing.connected = true;
      if (name) existing.name = String(name).slice(0, 16);
      this.push();
      return existing;
    }
    if (this.players.size >= this.opts.maxPlayers) {
      throw new Error('La table est pleine (7 joueurs max).');
    }
    const player = {
      id: token,
      name: String(name || 'Joueur').slice(0, 16) || 'Joueur',
      color: color || '#facc15',
      avatar: avatar || '🂡',
      balance: this.opts.startingBalance,
      connected: true,
      hands: [],       // [{ cards, bet, status, doubled }]
      betPlaced: false,
      inRound: false,
      lastNet: 0,      // gain/perte de la dernière manche (affichage table)
      joinedAt: Date.now(),
    };
    this.players.set(token, player);
    this.push();
    return player;
  }

  disconnectPlayer(token) {
    const p = this.players.get(token);
    if (!p) return;
    p.connected = false;
    // Hors manche : on retire le joueur tout de suite.
    if (!p.inRound || this.phase === 'lobby' || this.phase === 'results') {
      if (!p.inRound) this.players.delete(token);
    } else if (this.current && this.current.playerId === token) {
      // Son tour : on stand automatiquement pour ne pas bloquer la table.
      this.stand(token);
      return;
    }
    this.push();
  }

  removeIfGone(token) {
    const p = this.players.get(token);
    if (p && !p.connected) this.players.delete(token);
  }

  // ---------------------------------------------------------------- manche

  /** L'hôte lance une manche : phase de mises. */
  startBetting() {
    if (this.phase === 'betting' || this.phase === 'playing' || this.phase === 'dealer') return;
    this.clearTimers();
    // Purge des joueurs déconnectés et des soldes à zéro (re-crédités pour rejouer)
    for (const [id, p] of this.players) {
      if (!p.connected) { this.players.delete(id); continue; }
      p.hands = [];
      p.betPlaced = false;
      p.inRound = false;
      p.lastNet = 0;
      if (p.balance < this.opts.minBet) p.balance = this.opts.startingBalance; // re-cave automatique
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
    // Tout le monde a misé → on distribue sans attendre la fin du timer.
    const connected = [...this.players.values()].filter((x) => x.connected);
    if (connected.length > 0 && connected.every((x) => x.betPlaced)) {
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
    }

    // Blackjack du croupier : la manche se règle immédiatement.
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
    this.current = next;
    if (!next) {
      this.turnEndsAt = null;
      this.playDealer();
      return;
    }
    this.turnEndsAt = Date.now() + this.opts.turnTimeMs;
    this.timers.turn = setTimeout(() => {
      // Temps écoulé : stand automatique.
      if (this.current) this.stand(this.current.playerId, true);
    }, this.opts.turnTimeMs);
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
    if (p.hands.length !== 1) throw new Error('Un seul split par manche.');
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
      let net = 0;
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
      shoeCount: this.shoe.length,
      minBet: this.opts.minBet,
      serverNow: Date.now(),
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
                p.hands.length === 1 &&
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
