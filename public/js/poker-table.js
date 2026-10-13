'use strict';

/**
 * Table de poker, façon client en ligne : ovale de feutre, 8 places autour,
 * tableau et pot au centre. Partagée par l'écran de la table (/poker/host)
 * et la vue joueur (paysage sur ordinateur, ovale vertical sur téléphone).
 *
 * Chaque place : avatar rond cerclé d'un anneau de temps, plaque nom + tapis,
 * petites cartes contre l'avatar, dernière action en étiquette, mise en jetons
 * vers le centre. Les mises glissent vers le pot à la fin d'un tour d'enchères,
 * le pot glisse vers le(s) gagnant(s) à l'abattage.
 *
 * Positions en % du feutre : chaque place est un angle autour de l'ovale
 * (90° = en bas au centre). Tailles en var(--u) : 1cqw en paysage, plus en portrait.
 */

const POKER_SEAT_ANGLES = [90, 135, 180, 225, 270, 315, 0, 45];
// Ovale vertical (téléphone) : pas de place pile sur les côtés, pour laisser
// le tableau au centre libre de toute mise.
const POKER_SEAT_ANGLES_PORTRAIT = [90, 145, 195, 235, 270, 305, 345, 35];

// Libellés des dernières actions.
const POKER_ACTION_LABELS = {
  sb: 'Petite blinde', bb: 'Grosse blinde', check: 'Check', call: 'Suit',
  bet: 'Mise', raise: 'Relance', allin: 'Tapis', fold: 'Couché',
};
// Étiquettes courtes au-dessus des avatars, colorées comme sur les clients en ligne.
const POKER_ACTION_TAGS = {
  sb: ['PB', 'blind'], bb: ['GB', 'blind'], check: ['Check', 'check'], call: ['Suit', 'call'],
  bet: ['Mise', 'raise'], raise: ['Relance', 'raise'], allin: ['Tapis', 'allin'], fold: ['Couché', 'fold'],
};

const POKER_PHASE_LABELS = {
  preflop: 'Préflop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Abattage',
};

/**
 * Blindes actuelles et prochain niveau : « 5/10 · 10/20 dans 4:12 »,
 * ou « … à la prochaine élimination ». Recalculé chaque seconde (chrono).
 */
function pokerBlindInfo(s, short = false) {
  const now = `${s.smallBlind}/${s.bigBlind}`;
  if (short) {
    // Version courte (téléphone) : « 5/10 → 10/20 · 4:12 ».
    if (!s.nextBlinds) return `Blindes ${now}`;
    const nx = `${s.nextBlinds[0]}/${s.nextBlinds[1]}`;
    if (s.blindMode === 'elimination') return `Blindes ${now} → ${nx} à la prochaine élimination`;
    if (!s.nextLevelAt) return `Blindes ${now}`;
    const r = Math.max(0, Math.ceil(clock.remaining(s.nextLevelAt) / 1000));
    return `Blindes ${now} → ${nx} · ${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
  }
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

/** Pile de jetons pour un montant (plus grosses valeurs en bas, 5 jetons au plus). */
function pokerChipStack(amount, max = 5) {
  const chips = [];
  let rest = amount;
  for (let i = CHIP_LADDER.length - 1; i >= 0 && chips.length < max; i--) {
    while (rest >= CHIP_LADDER[i] && chips.length < max) {
      chips.push(CHIP_LADDER[i]);
      rest -= CHIP_LADDER[i];
    }
  }
  if (!chips.length && amount > 0) chips.push(10);
  return chips.map((v, i) => `<i class="stack-chip" style="--chip-color:${CHIP_COLORS[v] || '#2471a3'};--n:${i}"></i>`).join('');
}

const RING_LEN = 2 * Math.PI * 46; // périmètre du cercle de l'anneau de temps (r = 46)

/**
 * @param {HTMLElement} root
 * @param {object} [opts]
 * @param {() => string|null} [opts.meId] — joueur placé en bas (vue joueur)
 * @param {() => boolean} [opts.portrait] — ovale vertical (téléphone)
 * @param {(state: object) => [string, string] | null} [opts.phaseMessage]
 * @param {() => boolean} [opts.hideMine] — mes cartes face cachée (écran partagé)
 * @param {() => void} [opts.onToggleMine] — clic sur mes cartes : les montrer / cacher
 */
function createPokerTableView(root, opts = {}) {
  root.classList.add('ptable-root');
  root.innerHTML = `
    <div class="ptable-wrap">
      <div class="ptable-inner">
        <div class="prail">
          <div class="pfelt">
            <div class="pcenter">
              <div class="pphase"></div>
              <div class="ppot" hidden></div>
              <div class="hand pboard"></div>
              <div class="pmsg"></div>
              <div class="timerbar presults-timer" hidden><i></i></div>
            </div>
            <div class="pseats"></div>
            <div class="pdealer" hidden>D</div>
            <div class="pfly"></div>
          </div>
        </div>
      </div>
    </div>`;

  const q = (sel) => root.querySelector(sel);
  const els = {
    wrap: q('.ptable-wrap'),
    felt: q('.pfelt'),
    seats: q('.pseats'),
    board: q('.pboard'),
    pot: q('.ppot'),
    phase: q('.pphase'),
    msg: q('.pmsg'),
    dealer: q('.pdealer'),
    fly: q('.pfly'),
    resultsTimer: q('.presults-timer'),
  };
  const seatEls = [];
  let state = null;
  let prev = null;
  const meId = () => (opts.meId ? opts.meId() : null);

  // Clic sur mes propres cartes (écran partagé) : les retourner.
  els.seats.addEventListener('click', (e) => {
    if (opts.onToggleMine && e.target.closest('.pseat.is-me .ps-cards')) opts.onToggleMine();
  });

  /** La vue joueur tourne la table pour se placer en bas. */
  function displayAngle(seat) {
    const me = state && state.players.find((p) => p.id === meId());
    const angles = opts.portrait && opts.portrait() ? POKER_SEAT_ANGLES_PORTRAIT : POKER_SEAT_ANGLES;
    return angles[(seat - (me ? me.seat : 0) + angles.length) % angles.length];
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
      <div class="ps-bet" hidden><span class="ps-chips"></span><span class="ps-bet-amount"></span></div>
      <div class="ps-body">
        <div class="ps-cards"></div>
        <div class="ps-avatar">
          <svg class="ps-ring" viewBox="0 0 100 100" aria-hidden="true">
            <circle class="ps-ring-track" cx="50" cy="50" r="46"></circle>
            <circle class="ps-ring-time" cx="50" cy="50" r="46" stroke-dasharray="${RING_LEN}" stroke-dashoffset="0"></circle>
          </svg>
          <span class="ps-icon"></span>
        </div>
        <div class="ps-plate">
          <span class="ps-name"></span>
          <span class="ps-stack"></span>
        </div>
        <span class="ps-tag" hidden></span>
        <span class="ps-me" hidden>Toi</span>
        <span class="ps-hand" hidden></span>
      </div>
      <div class="ps-empty"><span>Libre</span></div>`;
    els.seats.appendChild(el);
    seatEls[seat] = el;
    return el;
  }

  function renderSeat(seat) {
    const el = seatEl(seat);
    const p = state.players.find((x) => x.seat === seat);
    const angle = displayAngle(seat);
    el.dataset.angle = String(angle);
    el.classList.toggle('bottom', angle === 90);
    el.classList.toggle('top', angle === 270);
    // Côté droit du tapis : les cartes se posent à gauche de l'avatar (vers le centre).
    el.classList.toggle('right-side', angle < 90 || angle > 270);
    place(el.querySelector('.ps-body'), angle, 1.0);
    place(el.querySelector('.ps-empty'), angle, 1.0);
    place(el.querySelector('.ps-bet'), angle, opts.portrait && opts.portrait() ? 0.6 : 0.64);
    el.classList.toggle('empty', !p);
    if (!p) return;

    const mine = p.id === meId();
    const res = state.results;
    const net = res && res.net ? res.net[p.id] : 0;
    const showdown = state.phase === 'showdown';
    el.classList.toggle('is-turn', p.isTurn);
    el.classList.toggle('is-me', mine);
    el.classList.toggle('folded', p.folded);
    el.classList.toggle('out', !p.inHand && state.phase !== 'lobby');
    el.classList.toggle('disconnected', !p.connected);
    el.classList.toggle('winner', showdown && net > 0);
    el.classList.toggle('loser', showdown && p.inHand && !(net > 0));
    el.classList.toggle('allin', p.allIn && !showdown);

    const icon = el.querySelector('.ps-icon');
    if (icon.dataset.avatar !== p.avatar) {
      icon.dataset.avatar = p.avatar;
      icon.innerHTML = avatarHtml(p.avatar);
    }
    el.querySelector('.ps-avatar').style.setProperty('--p-color', p.color);
    const name = el.querySelector('.ps-name');
    name.textContent = p.name;
    name.title = p.name;
    el.querySelector('.ps-me').hidden = !mine;

    // Tapis ; à l'abattage, le gain ou la perte de la main.
    const stackEl = el.querySelector('.ps-stack');
    const stackTxt = !p.connected ? 'Absent' : p.allIn && !showdown ? 'Tapis' : fmt.format(p.stack);
    stackEl.textContent = stackTxt;
    stackEl.classList.toggle('allin-txt', p.allIn && !showdown);
    if (p.rebuys) stackEl.title = `${p.rebuys} recave${p.rebuys > 1 ? 's' : ''}`;

    // Étiquette au-dessus de l'avatar : dernière action, ou gain à l'abattage.
    const tag = el.querySelector('.ps-tag');
    let tagTxt = '';
    let tagCls = '';
    if (showdown && net > 0) { tagTxt = `+${fmt.format(net)}`; tagCls = 'win'; }
    else if (!showdown && p.lastAction && POKER_ACTION_TAGS[p.lastAction]) {
      [tagTxt, tagCls] = POKER_ACTION_TAGS[p.lastAction];
    } else if (!p.inHand && state.phase !== 'lobby') {
      tagTxt = p.stack > 0 ? 'Prochaine main' : 'À sec';
      tagCls = 'fold';
    }
    tag.hidden = !tagTxt;
    tag.textContent = tagTxt;
    tag.className = `ps-tag ${tagCls}`;

    // Nom de la main à l'abattage.
    const hand = el.querySelector('.ps-hand');
    hand.hidden = !(showdown && p.handLabel);
    hand.textContent = p.handLabel || '';
    hand.classList.toggle('win', net > 0);

    // Cartes : les miennes face visible (ou cachées sur un écran partagé),
    // celles montrées à l'abattage, sinon des dos.
    let cards = [];
    const hidden = mine && !p.shownCards && opts.hideMine && opts.hideMine();
    if (mine && state.you && state.you.holeCards.length) {
      cards = hidden ? state.you.holeCards.map((c) => ({ hidden: true, id: `${c.id}-cache` })) : state.you.holeCards;
    } else if (p.shownCards) {
      cards = p.shownCards;
    } else if (p.cardCount && !p.folded) {
      cards = Array.from({ length: p.cardCount }, (_, i) => ({ hidden: true, id: `back-${state.handNumber}-${p.id}-${i}` }));
    }
    const cardsEl = el.querySelector('.ps-cards');
    const animate = cardsEl.dataset.hand !== String(state.handNumber);
    cardsEl.dataset.hand = String(state.handNumber);
    syncHand(cardsEl, cards, { animate });
    cardsEl.classList.toggle('shown', !!p.shownCards || (mine && !hidden));
    const best = new Set(p.bestCards || []);
    cardsEl.querySelectorAll('.card').forEach((c) => c.classList.toggle('in-best', best.has(c.dataset.cardId)));
    cardsEl.classList.toggle('peekable', mine && !!opts.hideMine && !p.shownCards && cards.length > 0);
    cardsEl.title = mine && opts.hideMine && !p.shownCards ? (hidden ? 'Clique pour voir tes cartes' : 'Clique pour les cacher') : '';

    // Mise du tour en cours, en jetons, vers le centre.
    const betEl = el.querySelector('.ps-bet');
    betEl.hidden = !p.bet;
    if (p.bet) {
      const chips = betEl.querySelector('.ps-chips');
      if (chips.dataset.amount !== String(p.bet)) {
        chips.dataset.amount = String(p.bet);
        chips.innerHTML = pokerChipStack(p.bet, 4);
      }
      betEl.querySelector('.ps-bet-amount').textContent = fmt.format(p.bet);
    }
  }

  /* ------------------------------ animations ------------------------------ */

  /** Position (px) d'un élément dans le feutre. */
  function centerOf(target) {
    const f = els.felt.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    return { x: r.left + r.width / 2 - f.left, y: r.top + r.height / 2 - f.top };
  }

  /** Une pile de jetons qui glisse d'un point à un autre du feutre. */
  function flyChips(from, to, amount, delay = 0) {
    if (!amount || !from || !to) return;
    const chip = document.createElement('div');
    chip.className = 'fly-chips';
    chip.innerHTML = pokerChipStack(amount, 3);
    chip.style.left = `${from.x}px`;
    chip.style.top = `${from.y}px`;
    els.fly.appendChild(chip);
    const anim = chip.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(0.85)`, opacity: 1, offset: 0.85 },
      { transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(0.7)`, opacity: 0 },
    ], { duration: 650, delay, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)', fill: 'backwards' });
    anim.onfinish = () => chip.remove();
  }

  /** Avant de redessiner : les mises qui disparaissent partent vers le pot. */
  function animateBetsToPot(s) {
    if (!prev || prev.handNumber !== s.handNumber) return;
    const potPos = centerOf(els.pot.hidden ? els.board : els.pot);
    for (const p of prev.players) {
      const now = s.players.find((x) => x.id === p.id);
      if (p.bet > 0 && (!now || now.bet === 0)) {
        const betEl = seatEls[p.seat] && seatEls[p.seat].querySelector('.ps-bet');
        if (betEl && !betEl.hidden) flyChips(centerOf(betEl), potPos, p.bet);
      }
    }
  }

  /** Après l'abattage : le pot part vers le(s) gagnant(s). */
  function animatePotToWinners(s) {
    if (!prev || prev.phase === 'showdown' || s.phase !== 'showdown' || !s.results) return;
    const from = centerOf(els.pot.hidden ? els.board : els.pot);
    const won = new Map();
    for (const pot of s.results.pots) for (const w of pot.winners) won.set(w.id, (won.get(w.id) || 0) + w.amount);
    for (const [id, amount] of won) {
      const p = s.players.find((x) => x.id === id);
      const target = p && seatEls[p.seat] && seatEls[p.seat].querySelector('.ps-avatar');
      if (target) flyChips(from, centerOf(target), amount, 450);
    }
  }

  /* --------------------------------- rendu --------------------------------- */

  /** Ligne du haut du tapis : tour d'enchères et blindes (courte sur téléphone). */
  function phaseText(s) {
    return opts.portrait && opts.portrait()
      ? pokerBlindInfo(s, true)
      : `${POKER_PHASE_LABELS[s.phase] || ''} · ${pokerBlindInfo(s)}`;
  }

  function render(s) {
    const portrait = !!(opts.portrait && opts.portrait());
    els.wrap.classList.toggle('portrait', portrait);
    els.wrap.classList.toggle('landscape', !portrait);
    animateBetsToPot(s);
    state = s;
    for (let seat = 0; seat < s.maxPlayers; seat++) renderSeat(seat);

    // Tableau : 5 emplacements, les cartes arrivent au fil des tours.
    syncHand(els.board, s.board);
    const winner = s.players.find((p) => p.bestCards && s.results && s.results.net[p.id] > 0);
    const winningIds = new Set((winner && winner.bestCards) || []);
    els.board.querySelectorAll('.card').forEach((c) => c.classList.toggle('in-best', winningIds.has(c.dataset.cardId)));
    els.board.classList.toggle('empty', s.board.length === 0);
    els.board.classList.toggle('dim', !!winner);

    els.pot.hidden = !s.pot && !(s.phase === 'showdown' && s.results);
    const shownPot = s.phase === 'showdown' && s.results ? s.results.pots.reduce((n, p) => n + p.amount, 0) : s.pot;
    els.pot.innerHTML = `<span class="ppot-label">Pot</span> ${fmt.format(shownPot)}`;

    const msg = opts.phaseMessage ? opts.phaseMessage(s) : null;
    if (msg) setLabel(els.msg, msg[0], msg[1]);
    else els.msg.textContent = '';
    els.phase.textContent = s.phase === 'lobby' ? '' : phaseText(s);

    // Bouton du donneur, posé sur le tapis juste devant son siège.
    const dealerShown = s.phase !== 'lobby' && s.dealerSeat >= 0;
    els.dealer.hidden = !dealerShown;
    if (dealerShown) place(els.dealer, displayAngle(s.dealerSeat) + (portrait ? 16 : 10), 0.74);

    animatePotToWinners(s);
    prev = s;
  }

  function tick() {
    if (state) {
      // Anneau de temps autour de l'avatar du joueur qui parle.
      for (const p of state.players) {
        const ring = seatEl(p.seat).querySelector('.ps-ring-time');
        if (p.isTurn && state.turnEndsAt) {
          const frac = Math.max(0, Math.min(1, clock.remaining(state.turnEndsAt) / 30000));
          ring.style.strokeDashoffset = String(RING_LEN * (1 - frac));
          ring.classList.toggle('urgent', frac < 0.27);
        } else if (ring.style.strokeDashoffset !== String(RING_LEN)) {
          ring.style.strokeDashoffset = String(RING_LEN);
        }
      }
      if (state.phase !== 'lobby') {
        const txt = phaseText(state);
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
      return p ? seatEl(p.seat).querySelector('.ps-avatar') : null;
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
