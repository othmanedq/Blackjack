'use strict';

/**
 * La table de casino dessinée à l'écran : demi-lune de feutre bordée d'un
 * boudin en cuir, croupier côté plat (rack de jetons, sabot), inscriptions
 * imprimées sur le tapis et 7 cercles de mise le long de l'arrondi.
 *
 * Partagée par l'écran table (/host) et la vue joueur sur ordinateur ou
 * tablette. Elle ne fait que du rendu : sons et effets restent à l'appelant.
 *
 * Repère : le feutre mesure 1000 × 500 unités, centre de l'arrondi en (500, 0).
 */

const SPOT_COUNT = 7;
const SPOT_RADIUS = 405; // distance des cercles de mise au centre
// Place 0 = « première base », à gauche du croupier, donc à droite de l'écran.
const SPOT_ANGLES = Array.from({ length: SPOT_COUNT }, (_, i) => 35 + (i * 110) / (SPOT_COUNT - 1));
// Places occupées selon le nombre de joueurs : réparties pour équilibrer la table.
const SPOT_SPREAD = {
  1: [3], 2: [2, 4], 3: [1, 3, 5], 4: [0, 2, 4, 6],
  5: [0, 1, 3, 5, 6], 6: [0, 1, 2, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6],
};

// Gabarit de la plaque en cqw (doit suivre .seat-plate dans table.css).
const PLATE_HALF_W = 5.5;
const PLATE_HALF_H = 3.3;
const PLATE_GAP = 3.1; // rayon du cercle de mise + marge

function spotPoint(i) {
  const a = (SPOT_ANGLES[i] * Math.PI) / 180;
  return { x: 500 + SPOT_RADIUS * Math.cos(a), y: SPOT_RADIUS * Math.sin(a) };
}

/** Arc « sourire » de rayon r, lu de gauche à droite, entre from° et to°. */
function arcPath(r, from = 20, to = 160) {
  const p = (deg) => {
    const a = (deg * Math.PI) / 180;
    return `${(500 + r * Math.cos(a)).toFixed(1)} ${(r * Math.sin(a)).toFixed(1)}`;
  };
  return `M ${p(to)} A ${r} ${r} 0 0 0 ${p(from)}`;
}

function feltPrintSvg() {
  const rings = SPOT_ANGLES.map((_, i) => {
    const { x, y } = spotPoint(i);
    return `<circle class="spot-ring" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="27"/>`;
  }).join('');
  return `
  <svg class="felt-print" viewBox="0 0 1000 500" aria-hidden="true">
    <defs>
      <path id="arc-bj" d="${arcPath(215, 22, 158)}"/>
      <path id="arc-rule" d="${arcPath(183, 30, 150)}"/>
      <path id="arc-ins" d="${arcPath(259, 40, 140)}"/>
    </defs>
    <path class="print-line" d="${arcPath(232, 38, 142)}"/>
    <path class="print-line" d="${arcPath(266, 38, 142)}"/>
    <text class="print-bj"><textPath href="#arc-bj" startOffset="50%" text-anchor="middle">BLACKJACK PAYS 3 TO 2</textPath></text>
    <text class="print-rule"><textPath href="#arc-rule" startOffset="50%" text-anchor="middle">Dealer must draw to 16 and stand on all 17s</textPath></text>
    <text class="print-ins"><textPath href="#arc-ins" startOffset="50%" text-anchor="middle">INSURANCE PAYS 2 TO 1</textPath></text>
    ${rings}
  </svg>`;
}

/** Pile de jetons pour un montant : plus grosses valeurs en bas, 7 jetons au plus. */
function chipStackHtml(amount) {
  const chips = [];
  let rest = amount;
  for (let i = CHIP_LADDER.length - 1; i >= 0 && chips.length < 7; i--) {
    const v = CHIP_LADDER[i];
    while (rest >= v && chips.length < 7) {
      chips.push(v);
      rest -= v;
    }
  }
  return chips.map((v, i) =>
    `<i class="stack-chip" style="--chip-color:${CHIP_COLORS[v]};--n:${i}"></i>`).join('');
}

// [classe CSS, icône, libellé]
const TABLE_STATUS_LABELS = {
  waiting: ['waiting', 'clock', 'En attente'],
  playing: ['waiting', 'clock', 'En attente'],
  stand: ['stand', 'stand', 'Stand'],
  bust: ['bust', 'burst', 'Bust'],
  blackjack: ['blackjack', 'spade', 'Blackjack'],
};
const TABLE_RESULT_LABELS = {
  win: ['win', 'trophy', 'Gagné'],
  lose: ['lose', 'trendDown', 'Perdu'],
  push: ['push', 'check', 'Égalité'],
  blackjack: ['blackjack', 'spade', 'Blackjack 3:2'],
};

/**
 * @param {HTMLElement} root — conteneur de la table
 * @param {object} [opts]
 * @param {string | (() => string)} [opts.meId] — joueur à mettre en avant (vue joueur)
 * @param {(state: object) => [string, string] | null} [opts.phaseMessage] — [icône, texte]
 */
function createTableView(root, opts = {}) {
  root.classList.add('table-root');
  root.innerHTML = `
    <div class="table-wrap">
      <div class="dealer-station">
        <img class="face dealer-face" alt="Le croupier" />
        <span class="dealer-tag">Croupier</span>
      </div>
      <div class="rail">
        <div class="felt">
          ${feltPrintSvg()}
          <div class="chip-tray" aria-hidden="true">${Array.from({ length: 9 }, (_, i) =>
            `<i style="--chip-color:${CHIP_COLORS[CHIP_LADDER[8 - i]]}"></i>`).join('')}</div>
          <div class="discard" aria-hidden="true"></div>
          <div class="shoe" aria-hidden="true"><span class="shoe-count"></span></div>
          <div class="dealer-zone">
            <div class="hand dealer-hand"></div>
            <div class="dealer-meta">
              <span class="total-pill" hidden></span>
              <span class="badge" hidden></span>
            </div>
          </div>
          <div class="phase-strip">
            <div class="phase-msg"></div>
            <div class="timerbar phase-timer" hidden><i></i></div>
          </div>
          <div class="seats"></div>
        </div>
      </div>
    </div>`;

  const q = (sel) => root.querySelector(sel);
  const els = {
    felt: q('.felt'),
    faceImg: q('.dealer-face'),
    dealerHand: q('.dealer-hand'),
    dealerTotal: q('.dealer-meta .total-pill'),
    dealerBadge: q('.dealer-meta .badge'),
    shoeCount: q('.shoe-count'),
    phaseMsg: q('.phase-msg'),
    phaseTimer: q('.phase-timer'),
    seats: q('.seats'),
  };
  const seatEls = new Map(); // playerId -> élément de place
  let state = null;

  function showBadge(el, cls, iconName, text) {
    el.hidden = false;
    el.className = `badge ${cls}`;
    setLabel(el, iconName, text);
  }

  function seatBadge(p, seat) {
    if (!p.connected) return ['waiting', 'unplug', 'Déconnecté'];
    if (state.phase === 'betting') {
      if (p.betPlaced) return ['betting', 'check', 'Mise placée'];
      if (p.balance < state.minBet) return ['lose', 'chip', 'À sec'];
      return ['betting', 'chips', 'Mise…'];
    }
    if (state.phase === 'insurance' && p.inRound) {
      if (!p.insuranceDecided) return ['betting', 'shield', 'Décide…'];
      if (p.insuranceBet > 0) return ['betting', 'shield', `Assuré ${fmt.format(p.insuranceBet)}`];
      return ['waiting', 'cross', 'Sans assurance'];
    }
    if (p.isTurn) return ['turn', 'target', 'À lui de jouer'];
    if (state.phase === 'results' && p.inRound) {
      const r = p.hands[0] && p.hands[0].result;
      if (r) seat.classList.add(`result-${r}`);
      return TABLE_RESULT_LABELS[r] || ['push', 'check', '—'];
    }
    if (p.inRound && p.hands[0]) {
      const merged = p.hands.every((h) => h.status === p.hands[0].status) ? p.hands[0].status : 'playing';
      return TABLE_STATUS_LABELS[merged] || ['waiting', 'clock', 'En attente'];
    }
    return ['waiting', 'clock', 'En attente'];
  }

  const meId = () => (typeof opts.meId === 'function' ? opts.meId() : opts.meId);

  function renderSeat(p, spot) {
    let seat = seatEls.get(p.id);
    if (!seat) {
      seat = document.createElement('article');
      seat.className = 'seat';
      seat.innerHTML = `
        <div class="seat-hands"></div>
        <div class="bet-circle">
          <div class="chip-stack"></div>
          <span class="bet-label" hidden></span>
        </div>
        <div class="seat-plate">
          <span class="seat-me" hidden>Toi</span>
          <div class="seat-head">
            <span class="seat-avatar"></span>
            <span class="seat-name"></span>
          </div>
          <div class="seat-balance"></div>
          <div class="seat-status"></div>
          <div class="seat-side" hidden></div>
          <div class="seat-timer timerbar" hidden><i></i></div>
        </div>`;
      els.seats.appendChild(seat);
      seatEls.set(p.id, seat);
    }
    const { x, y } = spotPoint(spot);
    seat.style.left = `${x / 10}%`;
    seat.style.top = `${y / 5}%`;
    // Les cartes se posent vers le centre de la table, comme devant un vrai joueur.
    const a = (SPOT_ANGLES[spot] * Math.PI) / 180;
    seat.style.setProperty('--ux', (-Math.cos(a)).toFixed(3));
    seat.style.setProperty('--uy', (-Math.sin(a)).toFixed(3));
    // La plaque part vers l'extérieur (côté joueur), juste assez loin pour ne
    // pas toucher le cercle : distance = rayon + marge + demi-plaque dans cet axe.
    const ox = Math.cos(a);
    const oy = Math.sin(a);
    const d = PLATE_GAP + Math.abs(ox) * PLATE_HALF_W + oy * PLATE_HALF_H;
    seat.style.setProperty('--px', `${(ox * d).toFixed(2)}cqw`);
    seat.style.setProperty('--py', `${(oy * d - PLATE_HALF_H).toFixed(2)}cqw`);

    seat.className = 'seat';
    seat.classList.toggle('is-turn', p.isTurn);
    seat.classList.toggle('disconnected', !p.connected);
    seat.classList.toggle('is-me', p.id === meId());

    const avatarEl = seat.querySelector('.seat-avatar');
    avatarEl.innerHTML = avatarHtml(p.avatar);
    avatarEl.style.setProperty('--p-color', p.color);
    // « Toi » dans une étiquette à part : le pseudo garde toute la largeur.
    const nameEl = seat.querySelector('.seat-name');
    nameEl.textContent = p.name;
    nameEl.title = p.name;
    nameEl.classList.toggle('long', [...p.name].length > 8);
    seat.querySelector('.seat-me').hidden = p.id !== meId();
    seat.querySelector('.seat-plate').style.setProperty('--p-color', p.color);

    let deltaHtml = '';
    if (state.phase === 'results' && p.inRound && p.lastNet !== 0) {
      const cls = p.lastNet > 0 ? 'up' : 'down';
      const sign = p.lastNet > 0 ? '+' : '−';
      deltaHtml = ` <span class="delta ${cls}">${sign}${fmt.format(Math.abs(p.lastNet))}</span>`;
    }
    const balHtml = `${iconHtml('chip')} ${fmt.format(p.balance)}${deltaHtml}`;
    const bal = seat.querySelector('.seat-balance');
    if (bal.innerHTML !== balHtml) bal.innerHTML = balHtml;

    // Pas de pré-choix affiché : l'intention d'un joueur reste secrète.
    const [cls, ico, txt] = seatBadge(p, seat);
    const statusEl = seat.querySelector('.seat-status');
    statusEl.innerHTML = '';
    const b = document.createElement('span');
    b.className = `badge ${cls}`;
    setLabel(b, ico, txt);
    statusEl.appendChild(b);

    const sideEl = seat.querySelector('.seat-side');
    const sideHtml = sideTagsHtml(p);
    sideEl.hidden = !sideHtml;
    if (sideEl.innerHTML !== sideHtml) sideEl.innerHTML = sideHtml;

    // Jetons dans le cercle de mise : toutes les mains (doubles et splits compris).
    const staked = p.hands.reduce((n, h) => n + (h.bet || 0), 0);
    const stack = seat.querySelector('.chip-stack');
    const stackHtml = staked ? chipStackHtml(staked) : '';
    if (stack.dataset.amount !== String(staked)) {
      stack.dataset.amount = String(staked);
      stack.innerHTML = stackHtml;
    }
    const label = seat.querySelector('.bet-label');
    label.hidden = !staked;
    label.textContent = fmt.format(staked);

    // Cartes posées devant le cercle, côté croupier.
    const handsEl = seat.querySelector('.seat-hands');
    while (handsEl.children.length > p.hands.length) handsEl.lastChild.remove();
    p.hands.forEach((h, i) => {
      let group = handsEl.children[i];
      if (!group) {
        group = document.createElement('div');
        group.className = 'seat-hand';
        group.innerHTML = `
          <div class="seat-hand-meta">
            <span class="total-pill"></span>
            <span class="badge hand-result" hidden></span>
          </div>
          <div class="hand"></div>`;
        handsEl.appendChild(group);
      }
      group.classList.toggle('active', p.isTurn && p.turnHandIndex === i && p.hands.length > 1);
      const pill = group.querySelector('.total-pill');
      pill.hidden = !h.cards.length;
      pill.textContent = `${h.soft ? `${h.total}s` : h.total}${h.doubled ? ' ×2' : ''}`;
      pill.classList.toggle('bust', h.status === 'bust');
      pill.classList.toggle('bj', h.status === 'blackjack');
      const resBadge = group.querySelector('.hand-result');
      if (state.phase === 'results' && h.result && p.hands.length > 1) {
        const [rc, ri, rt] = TABLE_RESULT_LABELS[h.result];
        resBadge.hidden = false;
        resBadge.className = `badge hand-result ${rc}`;
        setLabel(resBadge, ri, rt);
      } else {
        resBadge.hidden = true;
      }
      syncHand(group.querySelector('.hand'), h.cards);
    });

    seat.querySelector('.seat-timer').hidden = !p.isTurn;
  }

  function render(s) {
    state = s;

    // --- croupier
    syncHand(els.dealerHand, s.dealer.cards);
    const hasDealer = s.dealer.cards.length > 0;
    els.dealerTotal.hidden = !hasDealer;
    els.dealerTotal.textContent = s.dealer.revealed ? s.dealer.total : `${s.dealer.total} + ?`;
    els.dealerTotal.classList.toggle('bust', s.dealer.bust);
    els.dealerTotal.classList.toggle('bj', s.dealer.blackjack);
    if (s.dealer.blackjack) showBadge(els.dealerBadge, 'blackjack', 'spade', 'Blackjack');
    else if (s.dealer.bust) showBadge(els.dealerBadge, 'bust', 'burst', 'Bust');
    else els.dealerBadge.hidden = true;
    els.shoeCount.textContent = s.shoeCount;

    // --- message de phase
    const msg = opts.phaseMessage ? opts.phaseMessage(s) : null;
    if (msg) setLabel(els.phaseMsg, msg[0], msg[1]);
    else els.phaseMsg.textContent = '';

    // --- places
    const ids = new Set(s.players.map((p) => p.id));
    for (const [id, el] of seatEls) {
      if (!ids.has(id)) { el.remove(); seatEls.delete(id); }
    }
    const players = s.players.slice(0, SPOT_COUNT);
    const spots = SPOT_SPREAD[players.length] || [];
    players.forEach((p, i) => renderSeat(p, spots[i]));
  }

  function replay(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  // Minuteries : phase (mises, assurance, résultats) et tour du joueur courant.
  function tick() {
    if (state) {
      let endsAt = null;
      let duration = 1;
      if (state.phase === 'betting' && state.betEndsAt) {
        endsAt = state.betEndsAt;
        duration = 30000;
      } else if (state.phase === 'results' && state.resultsEndsAt) {
        endsAt = state.resultsEndsAt;
        duration = 6000;
      } else if (state.phase === 'insurance' && state.insuranceEndsAt) {
        endsAt = state.insuranceEndsAt;
        duration = 12000;
      }
      if (endsAt) {
        const rem = clock.remaining(endsAt);
        els.phaseTimer.hidden = false;
        els.phaseTimer.firstElementChild.style.width = `${(rem / duration) * 100}%`;
        els.phaseTimer.classList.toggle('urgent', rem < duration * 0.25);
      } else {
        els.phaseTimer.hidden = true;
      }
      if (state.phase === 'playing' && state.current && state.turnEndsAt) {
        const seat = seatEls.get(state.current.playerId);
        if (seat) {
          const bar = seat.querySelector('.seat-timer');
          const rem = clock.remaining(state.turnEndsAt);
          bar.hidden = false;
          bar.firstElementChild.style.width = `${(rem / 30000) * 100}%`;
          bar.classList.toggle('urgent', rem < 8000);
        }
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    render,
    faceImg: els.faceImg,
    /** Plaque d'un joueur (ancre des bulles de réaction). */
    plateOf: (id) => {
      const seat = seatEls.get(id);
      return seat ? seat.querySelector('.seat-plate') : null;
    },
    glow: (id) => {
      const seat = seatEls.get(id);
      replay(seat && seat.querySelector('.bet-circle'), 'golden-glow');
    },
    shake: (id) => {
      const seat = id && seatEls.get(id);
      replay(id ? seat && seat.querySelector('.seat-plate') : els.felt, 'shake');
    },
  };
}
