'use strict';

/* Vue Joueur (mobile) : lobby, mise, actions Hit / Stand / Double / Split. */

const socket = io();

const AVATARS = ['🦁', '🦊', '🐼', '🐸', '🦅', '🐙', '🦈', '🐯'];
const COLORS = ['#f39c12', '#e74c3c', '#9b59b6', '#3498db', '#1abc9c', '#2ecc71', '#e91e8c', '#95a5a6'];

const els = {
  screenLobby: document.getElementById('screen-lobby'),
  screenGame: document.getElementById('screen-game'),
  joinForm: document.getElementById('join-form'),
  nameInput: document.getElementById('name-input'),
  avatarPicker: document.getElementById('avatar-picker'),
  colorPicker: document.getElementById('color-picker'),
  joinError: document.getElementById('join-error'),
  meAvatar: document.getElementById('me-avatar'),
  meName: document.getElementById('me-name'),
  meBalance: document.getElementById('me-balance'),
  meStatus: document.getElementById('me-status'),
  meTimer: document.getElementById('me-timer'),
  meTimerFill: document.querySelector('#me-timer > i'),
  betPanel: document.getElementById('bet-panel'),
  betAmount: document.getElementById('bet-amount'),
  betConfirm: document.getElementById('bet-confirm'),
  betClear: document.getElementById('bet-clear'),
  handsPanel: document.getElementById('hands-panel'),
  myHands: document.getElementById('my-hands'),
  tablePanel: document.getElementById('table-panel'),
  tableToggle: document.getElementById('table-toggle'),
  tDealer: document.getElementById('t-dealer'),
  tDealerHand: document.getElementById('t-dealer-hand'),
  tDealerTotal: document.getElementById('t-dealer-total'),
  tOthers: document.getElementById('t-others'),
  phoneStart: document.getElementById('phone-start'),
  centerMsg: document.getElementById('center-msg'),
  actions: document.getElementById('actions'),
  toast: document.getElementById('toast'),
};

// Identité stable pour survivre aux rafraîchissements / reconnexions.
const token =
  localStorage.getItem('bj_token') ||
  (crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
localStorage.setItem('bj_token', token);

let profile = JSON.parse(localStorage.getItem('bj_profile') || 'null');
let joined = false;
let state = null;
let prevMe = null;
let pendingBet = 0;

/* ------------------------------ lobby / join ------------------------------ */

let chosenAvatar = (profile && profile.avatar) || AVATARS[Math.floor(Math.random() * AVATARS.length)];
let chosenColor = (profile && profile.color) || COLORS[Math.floor(Math.random() * COLORS.length)];
if (profile && profile.name) els.nameInput.value = profile.name;

function buildPicker(container, values, chosen, onPick, isColor) {
  container.innerHTML = '';
  values.forEach((v) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    if (isColor) {
      btn.className = 'swatch';
      btn.style.background = v;
    } else {
      btn.textContent = v;
    }
    if (v === chosen) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      sfx.unlock();
      sfx.click();
      container.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      onPick(v);
    });
    container.appendChild(btn);
  });
}

buildPicker(els.avatarPicker, AVATARS, chosenAvatar, (v) => (chosenAvatar = v), false);
buildPicker(els.colorPicker, COLORS, chosenColor, (v) => (chosenColor = v), true);

els.joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sfx.unlock();
  const name = els.nameInput.value.trim();
  if (!name) return;
  profile = { name, avatar: chosenAvatar, color: chosenColor };
  localStorage.setItem('bj_profile', JSON.stringify(profile));
  join();
});

function join() {
  socket.emit('player:join', { token, ...profile }, (res) => {
    if (!res || !res.ok) {
      els.joinError.textContent = (res && res.message) || 'Connexion impossible.';
      return;
    }
    joined = true;
    els.screenLobby.hidden = true;
    els.screenGame.hidden = false;
    els.meAvatar.textContent = profile.avatar;
    els.meAvatar.style.setProperty('--p-color', profile.color);
    els.meName.textContent = profile.name;
    sfx.chip();
    render();
  });
}

// Reconnexion automatique (le serveur nous reconnaît grâce au token).
socket.on('connect', () => {
  if (joined && profile) join();
});

socket.on('state', (s) => {
  state = s;
  clock.sync(s.serverNow);
  render();
});

/* --------------------------------- mise --------------------------------- */

document.querySelectorAll('.chip[data-chip]').forEach((chip) => {
  chip.addEventListener('click', () => {
    const me = findMe();
    if (!me) return;
    const val = Number(chip.dataset.chip);
    if (pendingBet + val > me.balance) return showToast('Solde insuffisant.');
    pendingBet += val;
    sfx.chip();
    chip.classList.remove('chip-pop');
    void chip.offsetWidth;
    chip.classList.add('chip-pop');
    renderBet(me);
  });
});

els.betClear.addEventListener('click', () => {
  pendingBet = 0;
  sfx.click();
  renderBet(findMe());
});

els.betConfirm.addEventListener('click', () => {
  if (pendingBet <= 0) return;
  socket.emit('player:bet', { amount: pendingBet }, (res) => {
    if (!res.ok) return showToast(res.message);
    sfx.chip();
    pendingBet = 0;
  });
});

/* -------------------- table repliable + chef de table -------------------- */

let tableCollapsed = JSON.parse(localStorage.getItem('bj_table_collapsed') || 'false');
els.tablePanel.classList.toggle('collapsed', tableCollapsed);
els.tableToggle.addEventListener('click', () => {
  tableCollapsed = !tableCollapsed;
  localStorage.setItem('bj_table_collapsed', JSON.stringify(tableCollapsed));
  els.tablePanel.classList.toggle('collapsed', tableCollapsed);
  sfx.click();
});

els.phoneStart.addEventListener('click', () => {
  sfx.unlock();
  sfx.click();
  socket.emit('player:newRound', (res) => {
    if (res && !res.ok) showToast(res.message);
  });
});

/* -------------------------------- actions -------------------------------- */

els.actions.querySelectorAll('.action-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.action;
    sfx.click();
    socket.emit('player:action', { type }, (res) => {
      if (!res.ok) showToast(res.message);
    });
  });
});

/* --------------------------------- rendu --------------------------------- */

function findMe() {
  if (!state) return null;
  return state.players.find((p) => p.id === token) || null;
}

function render() {
  if (!state || !joined) return;
  const me = findMe();
  if (!me) {
    // Expulsé (ex : serveur relancé) → retour au lobby pour re-rejoindre.
    if (profile) join();
    return;
  }

  els.meBalance.textContent = `🪙 ${fmt.format(me.balance)}`;

  const myTurn = me.isTurn;
  const activeHand = myTurn && me.hands[me.turnHandIndex] ? me.hands[me.turnHandIndex] : null;
  const isBetting = state.phase === 'betting';
  const showBetPanel = isBetting && !me.betPlaced && me.connected;

  els.betPanel.hidden = !showBetPanel;
  if (showBetPanel) renderBet(me);

  const showHands = me.inRound && me.hands.length > 0 && me.hands[0].cards.length > 0;
  els.handsPanel.hidden = !showHands;
  if (showHands) renderHands(me);

  renderTable(me);

  // Chef de table : couronne + bouton pour lancer la manche depuis le téléphone
  const isChef = state.hostPlayerId === me.id;
  els.meName.textContent = (isChef ? '👑 ' : '') + profile.name;
  const canStart = isChef && (state.phase === 'lobby' || state.phase === 'results');
  els.phoneStart.hidden = !canStart;
  els.phoneStart.textContent = state.roundNumber ? 'Nouvelle manche 🎰' : 'Lancer la manche 🎰';

  // Statut + message central
  let badge = ['waiting', 'En attente'];
  let msg = '';
  let msgCls = '';
  if (state.phase === 'lobby') {
    msg = isChef
      ? 'Tu es le chef de table 👑\nLance la manche quand tout le monde a rejoint !'
      : 'Bien installé ! 🛋️\nEn attente du lancement de la manche…';
  } else if (isBetting) {
    badge = me.betPlaced ? ['betting', 'Mise placée ✓'] : ['betting', 'Fais ton jeu 💰'];
    if (me.betPlaced) msg = 'Mise placée.\nEn attente des autres joueurs…';
  } else if (state.phase === 'playing') {
    if (!me.inRound) {
      msg = 'Tu ne joues pas cette manche.\nTu pourras miser à la prochaine !';
    } else if (myTurn) {
      badge = ['turn', '🎯 À toi de jouer !'];
    } else {
      const cur = state.players.find((p) => p.id === (state.current && state.current.playerId));
      badge = statusBadge(me);
      msg = cur ? `Au tour de ${cur.name}…` : '';
    }
  } else if (state.phase === 'dealer') {
    badge = statusBadge(me);
    msg = 'Le croupier joue… 🂠';
  } else if (state.phase === 'results') {
    if (me.inRound) {
      const r = overallResult(me);
      badge = r.badge;
      msg = r.msg;
      msgCls = r.cls;
    } else {
      msg = 'Manche terminée.\nPrépare tes jetons pour la prochaine !';
    }
  }
  els.meStatus.className = `badge ${badge[0]}`;
  els.meStatus.textContent = badge[1];
  els.centerMsg.textContent = msg;
  els.centerMsg.className = `center-msg ${msgCls}`;

  // Boutons actifs uniquement à mon tour
  const canAct = !!activeHand;
  els.actions.querySelector('[data-action="hit"]').disabled = !canAct;
  els.actions.querySelector('[data-action="stand"]').disabled = !canAct;
  els.actions.querySelector('[data-action="double"]').disabled = !canAct || !activeHand.canDouble;
  els.actions.querySelector('[data-action="split"]').disabled = !canAct || !activeHand.canSplit;

  playFeedback(me, myTurn);
  prevMe = JSON.parse(JSON.stringify(me));
}

function statusBadge(me) {
  const statuses = me.hands.map((h) => h.status);
  if (statuses.every((s) => s === 'blackjack')) return ['blackjack', '♠ Blackjack !'];
  if (statuses.every((s) => s === 'bust')) return ['bust', '💥 Bust'];
  if (statuses.every((s) => s === 'stand' || s === 'bust' || s === 'blackjack')) return ['stand', 'Stand'];
  return ['waiting', 'En attente'];
}

function overallResult(me) {
  const net = me.lastNet;
  if (me.hands.some((h) => h.result === 'blackjack')) {
    return { badge: ['blackjack', '♠ Blackjack !'], msg: `BLACKJACK ! 🎉\n+${fmt.format(net)} jetons (payé 3:2)`, cls: 'win' };
  }
  if (net > 0) return { badge: ['win', 'Gagné'], msg: `Bien joué ! 🏆\n+${fmt.format(net)} jetons`, cls: 'win' };
  if (net < 0) return { badge: ['lose', 'Perdu'], msg: `Perdu… 💸\n−${fmt.format(-net)} jetons`, cls: 'lose' };
  return { badge: ['push', 'Égalité'], msg: 'Égalité (push).\nTa mise est rendue.', cls: '' };
}

function renderBet(me) {
  if (!me) return;
  els.betAmount.textContent = fmt.format(pendingBet);
  els.betConfirm.disabled = pendingBet < state.minBet;
  els.betConfirm.textContent = pendingBet >= state.minBet ? `Miser ${fmt.format(pendingBet)} ✓` : `Min. ${state.minBet}`;
  document.querySelectorAll('.chip[data-chip]').forEach((chip) => {
    chip.disabled = pendingBet + Number(chip.dataset.chip) > me.balance;
  });
}

function renderHands(me) {
  while (els.myHands.children.length > me.hands.length) els.myHands.lastChild.remove();
  me.hands.forEach((h, i) => {
    let box = els.myHands.children[i];
    if (!box) {
      box = document.createElement('div');
      box.className = 'my-hand';
      box.innerHTML = `
        <div class="hand"></div>
        <div class="my-hand-meta">
          <span class="total-pill">0</span>
          <span class="hand-bet"></span>
          <span class="badge hand-status" hidden></span>
        </div>`;
      els.myHands.appendChild(box);
    }
    box.classList.toggle('active-hand', me.isTurn && me.turnHandIndex === i && me.hands.length > 1);
    syncHand(box.querySelector('.hand'), h.cards);
    const pill = box.querySelector('.total-pill');
    pill.textContent = h.soft ? `${h.total} souple` : h.total;
    pill.classList.toggle('bust', h.status === 'bust');
    pill.classList.toggle('bj', h.status === 'blackjack');
    box.querySelector('.hand-bet').textContent = `Mise ${fmt.format(h.bet)}${h.doubled ? ' ×2' : ''}`;
    const sb = box.querySelector('.hand-status');
    if (h.status === 'bust' || h.status === 'blackjack' || (state.phase === 'results' && h.result)) {
      const map = {
        bust: ['bust', 'Bust'],
        blackjack: ['blackjack', 'BJ'],
        win: ['win', 'Gagné'],
        lose: ['lose', 'Perdu'],
        push: ['push', 'Push'],
      };
      const key = state.phase === 'results' && h.result ? h.result : h.status;
      const [cls, txt] = map[key] || ['waiting', ''];
      sb.hidden = false;
      sb.className = `badge hand-status ${cls}`;
      sb.textContent = txt;
    } else {
      sb.hidden = true;
    }
  });

}

/* ------------------ la table : croupier + autres joueurs ------------------ */

const otherEls = new Map(); // playerId -> élément de rangée

function otherStatusBadge(p) {
  if (!p.connected) return ['waiting', 'Déco.'];
  if (state.phase === 'betting') return p.betPlaced ? ['betting', 'A misé ✓'] : ['betting', 'Mise…'];
  if (p.isTurn) return ['turn', '🎯 Joue'];
  if (state.phase === 'results' && p.inRound) {
    const map = { win: ['win', 'Gagné'], lose: ['lose', 'Perdu'], push: ['push', 'Push'], blackjack: ['blackjack', 'BJ 3:2'] };
    return map[p.hands[0] && p.hands[0].result] || ['push', '—'];
  }
  if (!p.inRound) return ['waiting', 'Attend'];
  const st = p.hands.map((h) => h.status);
  if (st.every((s) => s === 'blackjack')) return ['blackjack', 'BJ'];
  if (st.every((s) => s === 'bust')) return ['bust', 'Bust'];
  if (st.every((s) => s !== 'playing' && s !== 'waiting')) return ['stand', 'Stand'];
  return ['waiting', 'Attend'];
}

function renderTable(me) {
  const show = state.dealer.cards.length > 0 || state.players.length > 1;
  els.tablePanel.hidden = !show;
  if (!show) return;

  // Croupier avec ses vraies cartes (la 2ᵉ reste face cachée jusqu'à son tour)
  const showDealer = state.dealer.cards.length > 0;
  els.tDealer.hidden = !showDealer;
  if (showDealer) {
    syncHand(els.tDealerHand, state.dealer.cards);
    els.tDealerTotal.textContent = state.dealer.revealed
      ? state.dealer.total
      : `${state.dealer.total} + ?`;
    els.tDealerTotal.classList.toggle('bust', state.dealer.bust);
    els.tDealerTotal.classList.toggle('bj', state.dealer.blackjack);
  }

  // Les autres joueurs
  const others = state.players.filter((p) => p.id !== me.id);
  const ids = new Set(others.map((p) => p.id));
  for (const [id, el] of otherEls) {
    if (!ids.has(id)) { el.remove(); otherEls.delete(id); }
  }
  let empty = els.tOthers.querySelector('.t-empty');
  if (others.length === 0) {
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 't-empty';
      empty.textContent = 'En attente d’autres joueurs…';
      els.tOthers.appendChild(empty);
    }
    return;
  }
  if (empty) empty.remove();

  others.forEach((p) => {
    let row = otherEls.get(p.id);
    if (!row) {
      row = document.createElement('div');
      row.className = 't-other';
      row.innerHTML = `
        <div class="t-head">
          <span class="t-avatar"></span>
          <span class="t-name"></span>
          <span class="total-pill" hidden></span>
          <span class="badge"></span>
        </div>
        <div class="hand mini"></div>`;
      els.tOthers.appendChild(row);
      otherEls.set(p.id, row);
    }
    row.querySelector('.t-avatar').textContent = p.avatar;
    row.querySelector('.t-avatar').style.setProperty('--p-color', p.color);
    row.querySelector('.t-name').textContent =
      (p.id === state.hostPlayerId ? '👑 ' : '') + p.name;

    const [cls, txt] = otherStatusBadge(p);
    const badge = row.querySelector('.badge');
    badge.className = `badge ${cls}`;
    badge.textContent = txt;

    // Toutes les mains à plat (les ids de cartes restent uniques après split)
    const cards = p.hands.flatMap((h) => h.cards);
    const pill = row.querySelector('.total-pill');
    if (cards.length > 0) {
      pill.hidden = false;
      pill.textContent = p.hands.map((h) => h.total).join(' / ');
      pill.classList.toggle('bust', p.hands.every((h) => h.status === 'bust'));
      pill.classList.toggle('bj', p.hands.some((h) => h.status === 'blackjack'));
    } else {
      pill.hidden = true;
    }
    const handEl = row.querySelector('.hand');
    handEl.style.display = cards.length ? '' : 'none';
    syncHand(handEl, cards);
  });
}

/* ------------------------- sons, vibreur, effets ------------------------- */

function playFeedback(me, myTurn) {
  if (!prevMe) return;
  const cardsBefore = prevMe.hands.reduce((n, h) => n + h.cards.length, 0);
  const cardsNow = me.hands.reduce((n, h) => n + h.cards.length, 0);
  if (cardsNow > cardsBefore) sfx.card();

  const wasTurn = prevMe.isTurn;
  if (myTurn && !wasTurn) {
    sfx.turn();
    if (navigator.vibrate) navigator.vibrate([90, 40, 90]);
  }

  me.hands.forEach((h, i) => {
    const before = prevMe.hands[i];
    if (h.status === 'bust' && (!before || before.status !== 'bust')) {
      sfx.lose();
      document.body.classList.remove('shake');
      void document.body.offsetWidth;
      document.body.classList.add('shake');
      if (navigator.vibrate) navigator.vibrate(220);
    }
    if (h.status === 'blackjack' && (!before || before.status !== 'blackjack')) {
      sfx.blackjack();
      burstConfetti(70);
    }
  });

  const hadResult = prevMe.hands.some((h) => h.result);
  const hasResult = me.hands.some((h) => h.result);
  if (hasResult && !hadResult) {
    if (me.lastNet > 0) {
      me.hands.some((h) => h.result === 'blackjack') ? null : sfx.win();
      burstConfetti(45);
    } else if (me.lastNet < 0) {
      sfx.lose();
    } else {
      sfx.push();
    }
  }
}

/* ------------------------------ timer (rAF) ------------------------------ */

function tick() {
  const me = findMe();
  let endsAt = null;
  let duration = 30000;
  if (state && me) {
    if (state.phase === 'betting' && !me.betPlaced && state.betEndsAt) endsAt = state.betEndsAt;
    else if (me.isTurn && state.turnEndsAt) endsAt = state.turnEndsAt;
  }
  if (endsAt) {
    const rem = clock.remaining(endsAt);
    els.meTimer.hidden = false;
    els.meTimerFill.style.width = `${(rem / duration) * 100}%`;
    els.meTimer.classList.toggle('urgent', rem < 8000);
  } else {
    els.meTimer.hidden = true;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* --------------------------------- toast --------------------------------- */

let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message || 'Action impossible.';
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 2600);
}
