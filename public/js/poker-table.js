'use strict';

/**
 * Table de poker ovale : 8 places autour du tapis, tableau et pot au centre.
 * Partagée par l'écran de la table (/poker/host) et la vue joueur sur
 * ordinateur ou tablette. Rendu seulement : sons et effets restent à l'appelant.
 *
 * Positions en % du feutre : chaque place est un angle autour de l'ovale
 * (90° = en bas au centre), avec sa plaque sur le bord, ses cartes puis sa mise
 * de plus en plus vers le centre.
 */

const POKER_SEAT_ANGLES = [90, 135, 180, 225, 270, 315, 0, 45];

// Libellés des dernières actions (plaques des joueurs).
const POKER_ACTION_LABELS = {
  sb: 'Petite blinde', bb: 'Grosse blinde', check: 'Check', call: 'Suit',
  bet: 'Mise', raise: 'Relance', allin: 'Tapis', fold: 'Couché',
};

const POKER_PHASE_LABELS = {
  preflop: 'Préflop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Abattage',
};

/**
 * Blindes actuelles et prochain niveau : « 5/10 · 10/20 dans 4:12 »,
 * ou « … à la prochaine élimination ». Recalculé chaque seconde (chrono).
 */
function pokerBlindInfo(s) {
  const now = `${s.smallBlind}/${s.bigBlind}`;
  if (!s.nextBlinds) return `Blindes ${now} · niveau max`;
  const next = `${s.nextBlinds[0]}/${s.nextBlinds[1]}`;
  if (s.blindMode === 'elimination') {
    return s.pendingLevelUps > 0
      ? `Blindes ${now} · ${next} à la prochaine main`
      : `Blindes ${now} · ${next} à la prochaine élimination`;
  }
  if (!s.nextLevelAt) return `Blindes ${now} · ${next} ensuite`;
  const rem = Math.max(0, Math.ceil(clock.remaining(s.nextLevelAt) / 1000));
  if (rem === 0) return `Blindes ${now} · ${next} à la prochaine main`;
  const mm = Math.floor(rem / 60);
  const ss = String(rem % 60).padStart(2, '0');
  return `Blindes ${now} · ${next} dans ${mm}:${ss}`;
}

/** Point sur l'ovale du feutre, en % (r = 1 : le bord du tapis). */
function ovalPoint(angleDeg, r) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: 50 + 50 * r * Math.cos(a), y: 50 + 50 * r * Math.sin(a) };
}

/** Pile de jetons pour un montant (plus grosses valeurs en bas, 6 jetons au plus). */
function pokerChipStack(amount) {
  const chips = [];
  let rest = amount;
  for (let i = CHIP_LADDER.length - 1; i >= 0 && chips.length < 6; i--) {
    while (rest >= CHIP_LADDER[i] && chips.length < 6) {
      chips.push(CHIP_LADDER[i]);
      rest -= CHIP_LADDER[i];
    }
  }
  if (!chips.length && amount > 0) chips.push(10);
  return chips.map((v, i) => `<i class="stack-chip" style="--chip-color:${CHIP_COLORS[v] || '#2471a3'};--n:${i}"></i>`).join('');
}

/**
 * @param {HTMLElement} root
 * @param {object} [opts]
 * @param {() => string|null} [opts.meId] — joueur placé en bas (vue joueur)
 * @param {(state: object) => [string, string] | null} [opts.phaseMessage]
 */
function createPokerTableView(root, opts = {}) {
  root.classList.add('ptable-root');
  root.innerHTML = `
    <div class="ptable-wrap">
      <div class="prail">
        <div class="pfelt">
          <div class="pcenter">
            <div class="pphase"></div>
            <div class="hand pboard"></div>
            <div class="ppot" hidden></div>
            <div class="pmsg"></div>
            <div class="timerbar presults-timer" hidden><i></i></div>
          </div>
          <div class="pseats"></div>
          <div class="pdealer" hidden>D</div>
        </div>
      </div>
    </div>`;

  const q = (sel) => root.querySelector(sel);
  const els = {
    seats: q('.pseats'),
    board: q('.pboard'),
    pot: q('.ppot'),
    phase: q('.pphase'),
    msg: q('.pmsg'),
    dealer: q('.pdealer'),
    resultsTimer: q('.presults-timer'),
  };
  const seatEls = []; // index : siège du serveur
  let state = null;
  const meId = () => (opts.meId ? opts.meId() : null);

  /** Siège affiché : la vue joueur tourne la table pour se placer en bas. */
  function displayAngle(seat) {
    const me = state && state.players.find((p) => p.id === meId());
    const shift = me ? me.seat : 0;
    const n = POKER_SEAT_ANGLES.length;
    return POKER_SEAT_ANGLES[(seat - shift + n) % n];
  }

  function place(el, angle, r) {
    const { x, y } = ovalPoint(angle, r);
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
  }

  function seatEl(seat) {
    if (seatEls[seat]) return seatEls[seat];
    const el = document.createElement('div');
    el.className = 'pseat empty';
    el.innerHTML = `
      <div class="pseat-cards"></div>
      <div class="pseat-bet" hidden><div class="chip-stack mini"></div><span class="pbet-amount"></span></div>
      <div class="pseat-plate">
        <span class="seat-me" hidden>Toi</span>
        <span class="pblind" hidden></span>
        <div class="seat-head"><span class="seat-avatar"></span><span class="seat-name"></span></div>
        <div class="seat-balance"></div>
        <div class="pseat-action"></div>
        <div class="seat-timer timerbar" hidden><i></i></div>
      </div>
      <div class="pseat-empty">Place libre</div>`;
    els.seats.appendChild(el);
    seatEls[seat] = el;
    return el;
  }

  function renderSeat(seat) {
    const el = seatEl(seat);
    const p = state.players.find((x) => x.seat === seat);
    const angle = displayAngle(seat);
    place(el.querySelector('.pseat-plate'), angle, 1.09);
    place(el.querySelector('.pseat-empty'), angle, 1.0);
    place(el.querySelector('.pseat-cards'), angle, 0.76);
    place(el.querySelector('.pseat-bet'), angle, 0.55);
    el.classList.toggle('empty', !p);
    if (!p) return;

    const mine = p.id === meId();
    const res = state.results;
    const net = res && res.net && res.net[p.id];
    el.classList.toggle('is-turn', p.isTurn);
    el.classList.toggle('is-me', mine);
    el.classList.toggle('folded', p.folded);
    el.classList.toggle('out', !p.inHand);
    el.classList.toggle('disconnected', !p.connected);
    el.classList.toggle('winner', !!(net && net > 0));

    const av = el.querySelector('.seat-avatar');
    av.innerHTML = avatarHtml(p.avatar);
    av.style.setProperty('--p-color', p.color);
    const name = el.querySelector('.seat-name');
    name.textContent = p.name;
    name.title = p.name;
    el.querySelector('.pseat-plate').style.setProperty('--p-color', p.color);
    el.querySelector('.seat-me').hidden = !mine;

    const blind = el.querySelector('.pblind');
    const blindTxt = seat === state.sbSeat && state.phase !== 'lobby' ? 'PB' : seat === state.bbSeat && state.phase !== 'lobby' ? 'GB' : '';
    blind.hidden = !blindTxt || !p.inHand;
    blind.textContent = blindTxt;

    const delta = state.phase === 'showdown' && net ? ` <span class="delta ${net > 0 ? 'up' : 'down'}">${net > 0 ? '+' : '−'}${fmt.format(Math.abs(net))}</span>` : '';
    const rebuys = p.rebuys ? ` <span class="prebuys" title="Recaves">↻${p.rebuys}</span>` : '';
    const bal = `${iconHtml('chip')} ${fmt.format(p.stack)}${delta}${rebuys}`;
    const balEl = el.querySelector('.seat-balance');
    if (balEl.innerHTML !== bal) balEl.innerHTML = bal;

    // Statut : main gagnante à l'abattage, sinon dernière action.
    const action = el.querySelector('.pseat-action');
    let txt = '';
    let cls = '';
    if (!p.connected) txt = 'Déconnecté';
    else if (p.handLabel && state.phase === 'showdown') { txt = p.handLabel; cls = net > 0 ? 'win' : ''; }
    else if (p.isTurn) { txt = 'Réfléchit…'; cls = 'turn'; }
    else if (p.allIn) { txt = 'Tapis'; cls = 'allin'; }
    else if (p.lastAction) txt = POKER_ACTION_LABELS[p.lastAction] || '';
    else if (!p.inHand && state.phase !== 'lobby') txt = p.stack > 0 ? 'Prochaine main' : 'À sec';
    action.textContent = txt;
    action.className = `pseat-action ${cls}`;
    action.hidden = !txt;

    // Cartes : les miennes face visible, celles montrées à l'abattage, sinon des dos.
    let cards = [];
    if (mine && state.you && state.you.holeCards.length) cards = state.you.holeCards;
    else if (p.shownCards) cards = p.shownCards;
    else if (p.cardCount && !p.folded) {
      cards = Array.from({ length: p.cardCount }, (_, i) => ({ hidden: true, id: `back-${state.handNumber}-${p.id}-${i}` }));
    }
    const cardsEl = el.querySelector('.pseat-cards');
    syncHand(cardsEl, cards);
    // Cartes de la combinaison gagnante mises en valeur.
    const best = new Set(p.bestCards || []);
    cardsEl.querySelectorAll('.card').forEach((c) => c.classList.toggle('in-best', best.has(c.dataset.cardId)));

    const betEl = el.querySelector('.pseat-bet');
    betEl.hidden = !p.bet;
    if (p.bet) {
      const stack = betEl.querySelector('.chip-stack');
      if (stack.dataset.amount !== String(p.bet)) {
        stack.dataset.amount = String(p.bet);
        stack.innerHTML = pokerChipStack(p.bet);
      }
      betEl.querySelector('.pbet-amount').textContent = fmt.format(p.bet);
    }
    el.querySelector('.seat-timer').hidden = !p.isTurn;
  }

  function render(s) {
    state = s;
    for (let seat = 0; seat < s.maxPlayers; seat++) renderSeat(seat);

    // Tableau : 5 emplacements, les cartes arrivent au fil des tours.
    syncHand(els.board, s.board);
    const winningIds = new Set((s.players.find((p) => p.bestCards && s.results && s.results.net[p.id] > 0) || {}).bestCards || []);
    els.board.querySelectorAll('.card').forEach((c) => c.classList.toggle('in-best', winningIds.has(c.dataset.cardId)));
    els.board.classList.toggle('empty', s.board.length === 0);

    els.pot.hidden = !s.pot;
    els.pot.innerHTML = `${iconHtml('chips')} Pot ${fmt.format(s.pot)}`;
    els.phase.textContent = s.phase === 'lobby' ? '' : `${POKER_PHASE_LABELS[s.phase] || ''} · ${pokerBlindInfo(s)}`;

    const msg = opts.phaseMessage ? opts.phaseMessage(s) : null;
    if (msg) setLabel(els.msg, msg[0], msg[1]);
    else els.msg.textContent = '';

    // Bouton du donneur, posé entre la plaque et les cartes de son siège.
    const dealerShown = s.phase !== 'lobby' && s.dealerSeat >= 0;
    els.dealer.hidden = !dealerShown;
    if (dealerShown) place(els.dealer, displayAngle(s.dealerSeat) + 14, 0.86);
  }

  function tick() {
    if (state) {
      const turn = state.players.find((p) => p.isTurn);
      if (turn && state.turnEndsAt) {
        const bar = seatEl(turn.seat).querySelector('.seat-timer');
        const rem = clock.remaining(state.turnEndsAt);
        bar.firstElementChild.style.width = `${(rem / 30000) * 100}%`;
        bar.classList.toggle('urgent', rem < 8000);
      }
      // Compte à rebours du prochain niveau de blindes.
      if (state.phase !== 'lobby') {
        const txt = `${POKER_PHASE_LABELS[state.phase] || ''} · ${pokerBlindInfo(state)}`;
        if (els.phase.textContent !== txt) els.phase.textContent = txt;
      }
      const showResults = state.phase === 'showdown' && state.resultsEndsAt;
      els.resultsTimer.hidden = !showResults;
      if (showResults) {
        els.resultsTimer.firstElementChild.style.width = `${(clock.remaining(state.resultsEndsAt) / 7000) * 100}%`;
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    render,
    plateOf: (id) => {
      const p = state && state.players.find((x) => x.id === id);
      return p ? seatEl(p.seat).querySelector('.pseat-plate') : null;
    },
  };
}

/** Classement des mains (aide « ? »), de la plus forte à la plus faible. */
const POKER_HAND_RANKING = [
  ['Quinte flush royale', 'A K Q J 10 de la même couleur', 'A♠ K♠ Q♠ J♠ 10♠'],
  ['Quinte flush', '5 cartes qui se suivent, même couleur', '9♥ 8♥ 7♥ 6♥ 5♥'],
  ['Carré', '4 cartes de même valeur', 'Q♠ Q♥ Q♦ Q♣ 7♠'],
  ['Full', 'Un brelan et une paire', 'K♠ K♥ K♦ 4♣ 4♠'],
  ['Couleur', '5 cartes de la même couleur', 'A♦ J♦ 9♦ 6♦ 3♦'],
  ['Quinte', '5 cartes qui se suivent (l’As peut finir A-2-3-4-5)', '10♠ 9♥ 8♦ 7♣ 6♠'],
  ['Brelan', '3 cartes de même valeur', '8♠ 8♥ 8♦ K♣ 3♠'],
  ['Double paire', 'Deux paires', 'J♠ J♥ 5♦ 5♣ A♠'],
  ['Paire', '2 cartes de même valeur', '10♠ 10♥ K♦ 7♣ 2♠'],
  ['Carte haute', 'Rien : la plus haute carte compte', 'A♠ Q♥ 9♦ 6♣ 3♠'],
];

/** HTML de l'aide « ? » ; les couleurs rouges (♥ ♦) sont colorées. */
function pokerRankingHtml() {
  const color = (txt) => txt.split(' ').map((c) =>
    `<span class="rk-card${/[♥♦]/.test(c) ? ' red' : ''}">${c}</span>`).join('');
  return `<ol class="rk-list">${POKER_HAND_RANKING.map(([name, desc, ex], i) => `
    <li><span class="rk-rank">${i + 1}</span>
      <span class="rk-body"><strong>${name}</strong><small>${desc}</small><span class="rk-ex">${color(ex)}</span></span>
    </li>`).join('')}</ol>
    <p class="rk-note">À égalité de combinaison, les cartes restantes départagent. Mains identiques : le pot est partagé.</p>`;
}
