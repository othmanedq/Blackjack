'use strict';

/* Vue Table (hôte) : affichage principal, croupier, sièges, QR code, timers. */

const socket = io();

const els = {
  dealerHand: document.getElementById('dealer-hand'),
  dealerTotal: document.getElementById('dealer-total'),
  dealerBadge: document.getElementById('dealer-badge'),
  phaseMsg: document.getElementById('phase-msg'),
  phaseTimer: document.getElementById('phase-timer'),
  phaseTimerFill: document.querySelector('#phase-timer > i'),
  seats: document.getElementById('seats'),
  roundMeta: document.getElementById('round-meta'),
  shoeMeta: document.getElementById('shoe-meta'),
  joinPanel: document.getElementById('join-panel'),
  qrImg: document.getElementById('qr-img'),
  joinUrl: document.getElementById('join-url'),
  startBtn: document.getElementById('start-btn'),
  collapseBtn: document.getElementById('collapse-btn'),
  expandBtn: document.getElementById('expand-btn'),
  muteBtn: document.getElementById('mute-btn'),
  table: document.getElementById('table'),
};

let state = null;
let prevState = null;
const seatEls = new Map(); // playerId -> seat element

socket.on('connect', () => socket.emit('host:register'));

socket.on('host:info', ({ url, qrDataUrl }) => {
  els.joinUrl.textContent = url;
  if (qrDataUrl) els.qrImg.src = qrDataUrl;
});

socket.on('state', (s) => {
  prevState = state;
  state = s;
  clock.sync(s.serverNow);
  render();
  playTransitionEffects();
});

els.startBtn.addEventListener('click', () => {
  sfx.unlock();
  sfx.click();
  socket.emit('host:newRound');
});
els.collapseBtn.addEventListener('click', () => setPanel('hidden'));
els.expandBtn.addEventListener('click', () => setPanel('visible'));
els.muteBtn.addEventListener('click', () => {
  const muted = sfx.toggleMute();
  els.muteBtn.textContent = muted ? '🔇' : '🔊';
});
els.muteBtn.textContent = sfx.muted ? '🔇' : '🔊';
document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

let panelMode = 'auto'; // auto | hidden | visible
function setPanel(mode) {
  panelMode = mode;
  render();
}

const PHASE_MSGS = {
  lobby: 'En attente de joueurs… Scannez le QR code pour rejoindre 📱',
  betting: '💰 Faites vos jeux !',
  dealer: '🂠 Le croupier joue…',
};

function render() {
  if (!state) return;

  els.roundMeta.textContent = state.roundNumber ? `Manche ${state.roundNumber}` : 'Manche —';
  els.shoeMeta.textContent = `Sabot : ${state.shoeCount} cartes`;

  // --- croupier
  syncHand(els.dealerHand, state.dealer.cards);
  const hasDealer = state.dealer.cards.length > 0;
  els.dealerTotal.hidden = !hasDealer;
  els.dealerTotal.textContent = state.dealer.total || '';
  els.dealerTotal.classList.toggle('bust', state.dealer.bust);
  els.dealerTotal.classList.toggle('bj', state.dealer.blackjack);
  if (state.dealer.blackjack) {
    showBadge(els.dealerBadge, 'blackjack', 'Blackjack');
  } else if (state.dealer.bust) {
    showBadge(els.dealerBadge, 'bust', 'Bust');
  } else {
    els.dealerBadge.hidden = true;
  }

  // --- message de phase
  const current = currentPlayer();
  if (state.phase === 'playing' && current) {
    const handNote = current.hands.length > 1 ? ` (main ${state.current.handIndex + 1})` : '';
    els.phaseMsg.textContent = `🎯 ${current.name}${handNote}, à toi de jouer !`;
  } else if (state.phase === 'results') {
    els.phaseMsg.textContent = '🏁 Manche terminée — les mises rouvrent dans un instant…';
  } else {
    els.phaseMsg.textContent = PHASE_MSGS[state.phase] || '';
  }

  // --- sièges
  const ids = new Set(state.players.map((p) => p.id));
  for (const [id, el] of seatEls) {
    if (!ids.has(id)) { el.remove(); seatEls.delete(id); }
  }
  state.players.forEach((p) => renderSeat(p));

  // --- panneau rejoindre / bouton manche
  const canStart =
    state.players.length > 0 && (state.phase === 'lobby' || state.phase === 'results');
  els.startBtn.disabled = !canStart;
  els.startBtn.textContent = state.roundNumber ? 'Nouvelle manche' : 'Lancer la manche';

  const isLobby = state.phase === 'lobby';
  let show;
  if (panelMode === 'visible') show = true;
  else if (panelMode === 'hidden') show = false;
  else show = isLobby; // auto : visible tant qu'on attend des joueurs
  els.joinPanel.classList.toggle('centered', show && isLobby && state.players.length === 0);
  els.joinPanel.classList.toggle('hidden', !show);
  els.expandBtn.hidden = show;
}

function currentPlayer() {
  if (!state || !state.current) return null;
  return state.players.find((p) => p.id === state.current.playerId) || null;
}

function showBadge(el, cls, text) {
  el.hidden = false;
  el.className = `badge ${cls}`;
  el.textContent = text;
}

const STATUS_LABELS = {
  waiting: ['waiting', 'En attente'],
  playing: ['waiting', 'En attente'],
  stand: ['stand', 'Stand'],
  bust: ['bust', '💥 Bust'],
  blackjack: ['blackjack', '♠ Blackjack'],
};
const RESULT_LABELS = {
  win: ['win', 'Gagné'],
  lose: ['lose', 'Perdu'],
  push: ['push', 'Égalité'],
  blackjack: ['blackjack', '♠ Blackjack 3:2'],
};

function renderSeat(p) {
  let seat = seatEls.get(p.id);
  if (!seat) {
    seat = document.createElement('article');
    seat.className = 'seat';
    seat.innerHTML = `
      <div class="seat-head">
        <span class="seat-avatar"></span>
        <span class="seat-name"></span>
        <span class="seat-balance"></span>
      </div>
      <div class="seat-status"></div>
      <div class="seat-hands"></div>
      <div class="seat-timer timerbar" hidden><i></i></div>`;
    els.seats.appendChild(seat);
    seatEls.set(p.id, seat);
  }

  seat.classList.toggle('is-turn', p.isTurn);
  seat.classList.toggle('disconnected', !p.connected);
  seat.className = seat.className.replace(/\bresult-\w+/g, '').trim();

  seat.querySelector('.seat-avatar').textContent = p.avatar;
  seat.querySelector('.seat-avatar').style.setProperty('--p-color', p.color);
  seat.querySelector('.seat-name').textContent = p.name;

  const bal = seat.querySelector('.seat-balance');
  let deltaHtml = '';
  if (state.phase === 'results' && p.inRound && p.lastNet !== 0) {
    const cls = p.lastNet > 0 ? 'up' : 'down';
    const sign = p.lastNet > 0 ? '+' : '−';
    deltaHtml = ` <span class="delta ${cls}">${sign}${fmt.format(Math.abs(p.lastNet))}</span>`;
  }
  bal.innerHTML = `🪙 ${fmt.format(p.balance)}${deltaHtml}`;

  // Statut global du joueur
  const statusEl = seat.querySelector('.seat-status');
  let badge;
  if (!p.connected) {
    badge = ['waiting', 'Déconnecté'];
  } else if (state.phase === 'betting') {
    badge = p.betPlaced ? ['betting', 'Mise placée ✓'] : ['betting', 'Choisit sa mise…'];
  } else if (p.isTurn) {
    badge = ['turn', '🎯 Tour en cours'];
  } else if (state.phase === 'results' && p.inRound) {
    const r = p.hands[0] && p.hands[0].result;
    badge = RESULT_LABELS[r] || ['push', '—'];
    if (r) seat.classList.add(`result-${r === 'blackjack' ? 'blackjack' : r}`);
  } else if (p.inRound && p.hands[0]) {
    const merged = p.hands.every((h) => h.status === p.hands[0].status)
      ? p.hands[0].status
      : 'playing';
    badge = STATUS_LABELS[merged] || ['waiting', 'En attente'];
  } else {
    badge = ['waiting', 'En attente'];
  }
  statusEl.innerHTML = '';
  const b = document.createElement('span');
  b.className = `badge ${badge[0]}`;
  b.textContent = badge[1];
  statusEl.appendChild(b);

  // Mains
  const handsEl = seat.querySelector('.seat-hands');
  while (handsEl.children.length > p.hands.length) handsEl.lastChild.remove();
  p.hands.forEach((h, i) => {
    let row = handsEl.children[i];
    if (!row) {
      row = document.createElement('div');
      row.className = 'seat-hand-row';
      row.innerHTML = `
        <div class="seat-hand-meta">
          <span class="total-pill">0</span>
          <span class="seat-bet"></span>
          <span class="badge hand-result" hidden></span>
        </div>
        <div class="hand"></div>`;
      handsEl.appendChild(row);
    }
    const pill = row.querySelector('.total-pill');
    pill.textContent = h.cards.length ? (h.soft ? `${h.total}s` : h.total) : '—';
    pill.classList.toggle('bust', h.status === 'bust');
    pill.classList.toggle('bj', h.status === 'blackjack');
    row.querySelector('.seat-bet').textContent = h.bet
      ? `Mise ${fmt.format(h.bet)}${h.doubled ? ' ×2' : ''}`
      : '';
    const resBadge = row.querySelector('.hand-result');
    if (state.phase === 'results' && h.result && p.hands.length > 1) {
      const [cls, txt] = RESULT_LABELS[h.result];
      resBadge.hidden = false;
      resBadge.className = `badge hand-result ${cls}`;
      resBadge.textContent = txt;
    } else {
      resBadge.hidden = true;
    }
    syncHand(row.querySelector('.hand'), h.cards);
  });

  seat.querySelector('.seat-timer').hidden = !p.isTurn;
}

/* ------------------------- effets de transition ------------------------- */

function playTransitionEffects() {
  if (!state) return;
  const prevCards = countCards(prevState);
  const nowCards = countCards(state);
  if (nowCards > prevCards) sfx.card();

  if (!prevState) return;
  const prevPlayers = new Map(prevState.players.map((p) => [p.id, p]));

  for (const p of state.players) {
    const before = prevPlayers.get(p.id);
    p.hands.forEach((h, i) => {
      const beforeStatus = before && before.hands[i] ? before.hands[i].status : null;
      if (h.status === 'blackjack' && beforeStatus !== 'blackjack') {
        celebrate(p.id);
      } else if (h.status === 'bust' && beforeStatus !== 'bust') {
        wompWomp(p.id);
      }
    });
  }

  if (state.phase === 'betting' && prevState.phase !== 'betting') sfx.chip();
  if (state.phase === 'results' && prevState.phase !== 'results') {
    const anyWin = state.players.some((p) => p.inRound && p.lastNet > 0);
    if (state.dealer.bust) wompWomp(null, false);
    anyWin ? sfx.win() : sfx.push();
  }
  const turnNow = state.current && state.current.playerId;
  const turnBefore = prevState.current && prevState.current.playerId;
  if (turnNow && turnNow !== turnBefore) sfx.turn();
}

function countCards(s) {
  if (!s) return 0;
  return (
    s.dealer.cards.length +
    s.players.reduce((n, p) => n + p.hands.reduce((m, h) => m + h.cards.length, 0), 0)
  );
}

function celebrate(playerId) {
  sfx.blackjack();
  burstConfetti(110);
  const seat = seatEls.get(playerId);
  if (seat) {
    seat.classList.remove('golden-glow');
    void seat.offsetWidth;
    seat.classList.add('golden-glow');
  }
}

function wompWomp(playerId, sound = true) {
  if (sound) sfx.lose();
  const target = playerId ? seatEls.get(playerId) : els.table;
  if (target) {
    target.classList.remove('shake');
    void target.offsetWidth;
    target.classList.add('shake');
  }
}

/* ------------------------------ timers (rAF) ----------------------------- */

function tick() {
  if (state) {
    let endsAt = null;
    let duration = 1;
    if (state.phase === 'betting' && state.betEndsAt) {
      endsAt = state.betEndsAt;
      duration = 30000;
    } else if (state.phase === 'results' && state.resultsEndsAt) {
      endsAt = state.resultsEndsAt;
      duration = 12000;
    }
    if (endsAt) {
      const rem = clock.remaining(endsAt);
      els.phaseTimer.hidden = false;
      els.phaseTimerFill.style.width = `${(rem / duration) * 100}%`;
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
        bar.querySelector('i').style.width = `${(rem / 30000) * 100}%`;
        bar.classList.toggle('urgent', rem < 8000);
      }
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
