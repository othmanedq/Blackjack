'use strict';

/* Vue joueur du poker : s'asseoir, voir ses cartes, parler (coucher, checker,
   suivre, relancer, tapis), chat, réactions et modération. */

const socket = io('/poker');

const $ = (id) => document.getElementById(id);
const els = {
  screenLobby: $('screen-lobby'),
  screenGame: $('screen-game'),
  joinForm: $('join-form'),
  nameInput: $('name-input'),
  avatarPicker: $('avatar-picker'),
  colorPicker: $('color-picker'),
  joinError: $('join-error'),
  resumeModal: $('resume-modal'),
  feltArea: $('felt-area'),
  meAvatar: $('me-avatar'),
  meCrown: $('me-crown'),
  meName: $('me-name-text'),
  meStack: $('me-stack'),
  meStatus: $('me-status'),
  meTimer: $('me-timer'),
  configPanel: $('config-panel'),
  stackOptions: $('stack-options'),
  blindOptions: $('blind-options'),
  configHint: $('config-hint'),
  miniTable: $('mini-table'),
  miniBoard: $('mini-board'),
  miniPot: $('mini-pot'),
  miniPlayers: $('mini-players'),
  myCardsPanel: $('my-cards-panel'),
  myCards: $('my-cards'),
  myHandLabel: $('my-hand-label'),
  centerMsg: $('center-msg'),
  startBtn: $('start-btn'),
  rebuyBtn: $('rebuy-btn'),
  kickBtn: $('kick-btn'),
  leaveBtn: $('leave-btn'),
  leaveLabel: $('leave-label'),
  raisePanel: $('raise-panel'),
  raisePresets: $('raise-presets'),
  raiseRange: $('raise-range'),
  raiseAmount: $('raise-amount'),
  actions: $('actions'),
  callBtn: $('call-btn'),
  raiseBtn: $('raise-btn'),
  rules: $('rules'),
  rulesBody: $('rules-body'),
  modBtn: $('mod-btn'),
  modModal: $('mod-modal'),
  modSteps: $('mod-steps'),
  modList: $('mod-list'),
  kickModal: $('kick-modal'),
  kickList: $('kick-list'),
  chatBtn: $('chat-btn'),
  chatBadge: $('chat-badge'),
  chatSheet: $('chat-sheet'),
  chatList: $('chat-list'),
  chatEmpty: $('chat-empty'),
  chatForm: $('chat-form'),
  chatInput: $('chat-input'),
  chatPeek: $('chat-peek'),
  reactBtn: $('react-btn'),
  reactTray: $('react-tray'),
  menuBtn: $('menu-btn'),
  menuBadge: $('menu-badge'),
  headMenu: $('head-menu'),
  menuChatCount: $('menu-chat-count'),
  menuMod: $('menu-mod'),
  toast: $('toast'),
};

/* ------------------------------- identité ------------------------------- */

// Identité propre au poker (une exclusion ici ne touche pas le blackjack) ;
// pseudo, avatar et couleur sont partagés avec le blackjack.
const newToken = () => (crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
let token = localStorage.getItem('pk_token') || newToken();
localStorage.setItem('pk_token', token);
let profile = JSON.parse(localStorage.getItem('bj_profile') || 'null');

(() => {
  const url = new URL(location.href);
  const key = url.searchParams.get('admin');
  if (!key) return;
  localStorage.setItem('bj_admin_key', key);
  url.searchParams.delete('admin');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
})();
const adminKey = () => localStorage.getItem('bj_admin_key') || undefined;

let joined = false;
let joining = false;
let state = null;
let prev = null;

const AVATARS = AVATAR_ICONS;
const COLORS = ['#f39c12', '#e74c3c', '#9b59b6', '#3498db', '#1abc9c', '#2ecc71', '#e91e8c', '#95a5a6'];
let chosenAvatar = (profile && profile.avatar) || AVATARS[Math.floor(Math.random() * AVATARS.length)];
let chosenColor = (profile && profile.color) || COLORS[Math.floor(Math.random() * COLORS.length)];
if (profile && profile.name) els.nameInput.value = profile.name;

function buildPicker(container, values, chosen, onPick, isColor) {
  container.innerHTML = '';
  for (const v of values) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = isColor ? 'swatch' : 'avatar-choice';
    if (isColor) b.style.background = v;
    else b.innerHTML = iconHtml(v);
    b.classList.toggle('selected', v === chosen);
    b.addEventListener('click', () => {
      sfx.unlock();
      container.querySelectorAll('button').forEach((x) => x.classList.remove('selected'));
      b.classList.add('selected');
      onPick(v);
    });
    container.appendChild(b);
  }
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

function join(opts = {}) {
  joining = true;
  socket.emit('player:join', { token, ...profile, ignoreResume: !!opts.ignoreResume, adminKey: adminKey() }, (res) => {
    joining = false;
    if (res && res.resumeCandidate) return showResume(res.resumeCandidate);
    if (!res || !res.ok) {
      els.joinError.textContent = (res && res.message) || 'Connexion impossible.';
      return;
    }
    if (res.adminKeyRejected) localStorage.removeItem('bj_admin_key');
    if (res.moderator) showToast('Tu es le modérateur de la table.', 'win');
    joined = true;
    els.screenLobby.hidden = true;
    els.screenGame.hidden = false;
    els.meAvatar.innerHTML = avatarHtml(profile.avatar);
    els.meAvatar.style.setProperty('--p-color', profile.color);
    els.meName.textContent = profile.name;
    render();
  });
}

function showResume(c) {
  $('resume-avatar').innerHTML = avatarHtml(c.avatar);
  $('resume-avatar').style.setProperty('--p-color', c.color);
  $('resume-name').textContent = c.name;
  $('resume-balance').textContent = fmt.format(c.balance);
  els.resumeModal.hidden = false;
  $('resume-yes').onclick = () => {
    token = c.token;
    localStorage.setItem('pk_token', token);
    profile = { name: c.name, avatar: c.avatar, color: c.color };
    localStorage.setItem('bj_profile', JSON.stringify(profile));
    els.resumeModal.hidden = true;
    join();
  };
  $('resume-no').onclick = () => {
    els.resumeModal.hidden = true;
    join({ ignoreResume: true });
  };
}

function leaveToLobby(message) {
  joined = false;
  els.screenGame.hidden = true;
  els.screenLobby.hidden = false;
  els.joinError.textContent = message || '';
  els.chatSheet.hidden = true;
}

socket.on('connect', () => {
  if (joined && profile) join();
});

socket.on('player:kicked', ({ message } = {}) => {
  token = newToken();
  localStorage.setItem('pk_token', token);
  leaveToLobby(message);
  sfx.lose();
});

socket.on('player:modAdjust', ({ amount } = {}) => {
  showToast(amount > 0 ? `Le modérateur t’a ajouté ${fmt.format(amount)} jetons.` : `Le modérateur t’a retiré ${fmt.format(-amount)} jetons.`, amount > 0 ? 'win' : '');
});

/* ------------------------------ table (ordi) ------------------------------ */

const wideMql = matchMedia('(min-width: 700px) and (min-height: 520px)');
wideMql.addEventListener('change', () => render());
const tableView = createPokerTableView(els.feltArea, { meId: () => token, phaseMessage: playerPhaseMessage });

function playerPhaseMessage(s) {
  if (s.phase === 'lobby') return ['clock', s.players.length < 2 ? 'En attente d’autres joueurs…' : 'En attente du lancement…'];
  const turn = s.players.find((p) => p.isTurn);
  if (turn) return turn.id === token ? ['target', 'À toi de parler !'] : ['clock', `À ${turn.name} de parler`];
  return null;
}

/* --------------------------------- état --------------------------------- */

socket.on('state', (s) => {
  prev = state;
  state = s;
  clock.sync(s.serverNow);
  render();
  feedback();
});

const findMe = () => (state ? state.players.find((p) => p.id === token) || null : null);
const isChef = () => !!(state && state.hostPlayerId === token);
const isModerator = () => !!(state && state.moderatorId && state.moderatorId === token);
const isMyTurn = () => !!(findMe() && findMe().isTurn);

/* -------------------------------- actions -------------------------------- */

let raiseOpen = false;
let raiseTo = 0;

els.actions.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  sfx.click();
  const act = btn.dataset.act;
  const you = state.you;
  if (act === 'fold') return send('fold');
  if (act === 'call') return send(you.toCall > 0 ? (you.toCall >= findMe().stack ? 'allin' : 'call') : 'check');
  if (act === 'raise') {
    // Premier tap : on ouvre le réglage ; second tap : on confirme le montant.
    if (!raiseOpen) {
      raiseOpen = true;
      raiseTo = you.minRaiseTo;
      render();
      return;
    }
    send(raiseTo >= you.maxRaiseTo ? 'allin' : 'raise', raiseTo);
  }
});

function send(type, amount) {
  socket.emit('player:act', { type, amount }, (res) => {
    if (res && !res.ok) return showToast(res.message);
    raiseOpen = false;
  });
}

/** Montants de relance proposés : minimum, ½ pot, pot, tapis (bornés). */
function raisePresets() {
  const you = state.you;
  const me = findMe();
  const potAfterCall = state.pot + you.toCall;
  const clamp = (v) => Math.max(you.minRaiseTo, Math.min(you.maxRaiseTo, Math.round(v)));
  const base = me.bet + you.toCall;
  const list = [
    ['Min', you.minRaiseTo],
    ['½ pot', clamp(base + potAfterCall / 2)],
    ['Pot', clamp(base + potAfterCall)],
    ['Tapis', you.maxRaiseTo],
  ];
  // Pas de doublon (petits tapis : plusieurs montants identiques).
  return list.filter(([, v], i) => list.findIndex(([, w]) => w === v) === i);
}

els.raisePresets.addEventListener('click', (e) => {
  const b = e.target.closest('[data-to]');
  if (!b) return;
  sfx.chip();
  raiseTo = Number(b.dataset.to);
  render();
});

els.raiseRange.addEventListener('input', () => {
  const you = state.you;
  const v = Number(els.raiseRange.value);
  // Arrondi à la grosse blinde, sauf le tapis.
  raiseTo = v >= you.maxRaiseTo ? you.maxRaiseTo : Math.max(you.minRaiseTo, Math.round(v / state.bigBlind) * state.bigBlind);
  renderRaise();
});

/* ------------------------- démarrage, recave, départ ------------------------- */

els.startBtn.addEventListener('click', () => {
  sfx.unlock();
  socket.emit('player:start', (res) => res && !res.ok && showToast(res.message));
});

els.stackOptions.addEventListener('click', (e) => {
  const b = e.target.closest('[data-stack]');
  if (!b) return;
  socket.emit('player:configure', { stack: Number(b.dataset.stack) }, (res) => res && !res.ok && showToast(res.message));
});
els.blindOptions.addEventListener('click', (e) => {
  const b = e.target.closest('[data-blinds]');
  if (!b) return;
  socket.emit('player:configure', { blinds: Number(b.dataset.blinds) }, (res) => res && !res.ok && showToast(res.message));
});

els.rebuyBtn.addEventListener('click', () => {
  socket.emit('player:rebuy', (res) => {
    if (res && !res.ok) return showToast(res.message);
    sfx.chip();
  });
});

let leaveArmedUntil = 0;
els.leaveBtn.addEventListener('click', () => {
  if (Date.now() > leaveArmedUntil) {
    leaveArmedUntil = Date.now() + 3000;
    els.leaveBtn.classList.add('armed');
    els.leaveLabel.textContent = 'Touche encore pour confirmer';
    setTimeout(() => {
      els.leaveBtn.classList.remove('armed');
      els.leaveLabel.textContent = 'Quitter la table';
    }, 3000);
    return;
  }
  socket.emit('player:leave', (res) => {
    if (res && !res.ok) return showToast(res.message);
    leaveToLobby('Tu as quitté la table. Ton tapis t’attend si tu reviens avec cet appareil.');
  });
});

els.kickBtn.addEventListener('click', () => {
  els.kickList.innerHTML = state.players.filter((p) => p.id !== token).map((p) => `
    <button type="button" class="pm-row" data-kick="${esc(p.id)}">
      <span class="pm-avatar" style="--p-color:${esc(p.color)}">${avatarHtml(p.avatar)}</span>
      <span class="pm-name">${esc(p.name)}</span>
      <span class="pm-bal">${fmt.format(p.stack)}</span>
    </button>`).join('') || '<p class="t-empty">Personne d’autre à la table.</p>';
  els.kickModal.hidden = false;
});
els.kickList.addEventListener('click', (e) => {
  const b = e.target.closest('[data-kick]');
  if (!b) return;
  socket.emit('player:kick', { target: b.dataset.kick }, (res) => {
    if (res && !res.ok) return showToast(res.message);
    els.kickModal.hidden = true;
  });
});
$('kick-close').addEventListener('click', () => { els.kickModal.hidden = true; });

/* ------------------------------ aide « ? » ------------------------------ */

els.rulesBody.innerHTML = pokerRankingHtml();
$('rules-btn').addEventListener('click', () => { els.rules.hidden = false; });
$('rules-close').addEventListener('click', () => { els.rules.hidden = true; });
els.rules.addEventListener('click', (e) => { if (e.target === els.rules) els.rules.hidden = true; });

/* ------------------------------- modération ------------------------------- */

const MOD_STEPS = [100, 500, 1000, 5000];
let modStep = 500;
els.modSteps.innerHTML = MOD_STEPS.map((v) => `<button type="button" class="stake-btn" data-step="${v}">${fmt.format(v)}</button>`).join('');
els.modBtn.addEventListener('click', () => { els.modModal.hidden = false; renderModeration(); });
$('mod-close').addEventListener('click', () => { els.modModal.hidden = true; });
els.modSteps.addEventListener('click', (e) => {
  const b = e.target.closest('[data-step]');
  if (!b) return;
  modStep = Number(b.dataset.step);
  renderModeration();
});
els.modList.addEventListener('click', (e) => {
  const b = e.target.closest('[data-adjust]');
  if (!b) return;
  socket.emit('mod:adjust', { target: b.dataset.target, delta: Number(b.dataset.adjust) * modStep }, (res) => {
    if (res && !res.ok) return showToast(res.message);
    sfx.chip();
  });
});

function renderModeration() {
  const mod = isModerator();
  els.modBtn.hidden = !mod;
  els.menuMod.hidden = !mod;
  if (!mod) { els.modModal.hidden = true; return; }
  if (els.modModal.hidden) return;
  els.modSteps.querySelectorAll('[data-step]').forEach((b) => b.classList.toggle('selected', Number(b.dataset.step) === modStep));
  const html = state.players.map((p) => `
    <div class="mod-row">
      <span class="pm-avatar" style="--p-color:${esc(p.color)}">${avatarHtml(p.avatar)}</span>
      <span class="pm-name">${esc(p.name)}${p.id === token ? ' <small>(toi)</small>' : ''}</span>
      <span class="pm-bal">${fmt.format(p.stack)}</span>
      <button type="button" class="mod-adj minus" data-adjust="-1" data-target="${esc(p.id)}" ${p.stack === 0 ? 'disabled' : ''} aria-label="Retirer">−</button>
      <button type="button" class="mod-adj plus" data-adjust="1" data-target="${esc(p.id)}" aria-label="Ajouter">+</button>
    </div>`).join('');
  if (els.modList.innerHTML !== html) els.modList.innerHTML = html;
}

/* --------------------------------- rendu --------------------------------- */

const STACK_PRESETS = [500, 1000, 2000, 5000, 10000];

function render() {
  if (!state || !joined) return;
  const me = findMe();
  if (!me) {
    if (!joining) leaveToLobby('Tu n’es plus à la table. Reprends une place quand tu veux.');
    return;
  }
  const you = state.you;
  els.meStack.textContent = fmt.format(me.stack);
  els.meCrown.hidden = !isChef();

  // Ordinateur / tablette : la table ovale remplace la version compacte.
  const felt = wideMql.matches;
  els.screenGame.classList.toggle('has-felt', felt);
  els.feltArea.hidden = !felt;
  if (felt) tableView.render(state);
  els.miniTable.hidden = felt;
  if (!felt) renderMiniTable();

  // Mes cartes en grand, avec la force de ma main (aussi sur ordinateur, à côté de la table).
  const hasCards = you && you.holeCards.length > 0;
  els.myCardsPanel.hidden = !hasCards;
  if (hasCards) {
    syncHand(els.myCards, you.holeCards);
    els.myCardsPanel.classList.toggle('folded', me.folded);
  }
  els.myHandLabel.textContent = hasCards && !me.folded ? you.handLabel || '' : me.folded ? 'Couché' : '';

  renderConfig();
  renderStatus(me);
  renderActions(me);
  renderModeration();

  const canStart = isChef() && state.phase === 'lobby' && state.players.filter((p) => p.connected && p.stack > 0).length >= 2;
  els.startBtn.hidden = !canStart;
  els.startBtn.innerHTML = `${iconHtml('play')} ${state.handNumber ? 'Relancer la partie' : 'Lancer la partie'}`;

  const betweenHands = !['preflop', 'flop', 'turn', 'river'].includes(state.phase);
  els.rebuyBtn.hidden = !(me.stack === 0 && (betweenHands || !me.inHand || me.folded));
  const left = state.maxRebuys - me.rebuys;
  els.rebuyBtn.disabled = left <= 0;
  els.rebuyBtn.innerHTML = left > 0
    ? `${iconHtml('chipPlus')} Se recaver — ${fmt.format(state.startingStack)} (${me.rebuys + 1}/${state.maxRebuys})`
    : `Plus de recave (${state.maxRebuys}/${state.maxRebuys})`;
  els.kickBtn.hidden = !(isChef() && betweenHands && state.players.length > 1);
  renderChatPeek();
}

function renderConfig() {
  const show = state.canConfigure;
  els.configPanel.hidden = !show;
  if (!show) return;
  const chef = isChef();
  els.stackOptions.innerHTML = STACK_PRESETS.map((v) =>
    `<button type="button" class="stake-btn${v === state.startingStack ? ' selected' : ''}" data-stack="${v}" ${chef ? '' : 'disabled'}>${fmt.format(v)}</button>`).join('');
  els.blindOptions.innerHTML = state.blindLevels.map(([sb, bb], i) =>
    `<button type="button" class="stake-btn${sb === state.smallBlind && bb === state.bigBlind ? ' selected' : ''}" data-blinds="${i}" ${chef ? '' : 'disabled'}>${sb}/${bb}</button>`).join('');
  els.configHint.textContent = chef
    ? 'Chef de table : ces réglages se figent au lancement de la partie.'
    : `En attente du chef de table — tapis ${fmt.format(state.startingStack)}, blindes ${state.smallBlind}/${state.bigBlind}.`;
}

const ACTION_TXT = POKER_ACTION_LABELS;

function renderMiniTable() {
  syncHand(els.miniBoard, state.board);
  els.miniPot.hidden = !state.pot;
  els.miniPot.innerHTML = `${iconHtml('chips')} ${fmt.format(state.pot)}`;
  const rows = state.players.filter((p) => p.id !== token).map((p) => {
    const tags = [
      p.seat === state.dealerSeat && state.phase !== 'lobby' ? '<span class="tag dealer">D</span>' : '',
      p.seat === state.sbSeat && p.inHand ? '<span class="tag">PB</span>' : '',
      p.seat === state.bbSeat && p.inHand ? '<span class="tag">GB</span>' : '',
    ].join('');
    const status = p.handLabel && state.phase === 'showdown' ? p.handLabel
      : p.isTurn ? 'Réfléchit…' : p.allIn ? 'Tapis' : p.lastAction ? ACTION_TXT[p.lastAction] : !p.inHand && state.phase !== 'lobby' ? 'Attend' : '';
    const net = state.results && state.results.net && state.results.net[p.id];
    const cards = p.shownCards
      ? p.shownCards.map((c) => `<span class="rk-card${/[♥♦]/.test(c.suit) ? ' red' : ''}">${c.rank}${c.suit}</span>`).join('')
      : p.cardCount && !p.folded ? '<span class="card-backs"><i></i><i></i></span>' : '';
    return `<div class="mini-row${p.isTurn ? ' turn' : ''}${p.folded ? ' folded' : ''}">
      <span class="t-avatar" style="--p-color:${esc(p.color)}">${avatarHtml(p.avatar)}</span>
      <span class="mini-name">${esc(p.name)}${tags}</span>
      <span class="mini-cards">${cards}</span>
      <span class="mini-status">${esc(status || '')}${net ? ` <b class="${net > 0 ? 'up' : 'down'}">${net > 0 ? '+' : '−'}${fmt.format(Math.abs(net))}</b>` : ''}</span>
      <span class="mini-stack">${fmt.format(p.stack)}${p.bet ? ` <b class="mini-bet">${fmt.format(p.bet)}</b>` : ''}</span>
    </div>`;
  }).join('') || '<p class="t-empty">En attente d’autres joueurs…</p>';
  if (els.miniPlayers.innerHTML !== rows) els.miniPlayers.innerHTML = rows;
}

function renderStatus(me) {
  let badge = ['waiting', 'clock', 'En attente'];
  let msg = '';
  let cls = '';
  const res = state.results;
  if (state.phase === 'lobby') {
    msg = state.players.length < 2 ? 'En attente d’autres joueurs…' : isChef() ? 'Tu es le chef de table.\nLance la partie quand tout le monde est assis !' : 'En attente du lancement…';
  } else if (state.phase === 'showdown' && res) {
    const net = res.net[me.id];
    if (net > 0) { badge = ['win', 'trophy', 'Gagné']; msg = `+${fmt.format(net)} jetons !`; cls = 'win'; }
    else if (net < 0) { badge = ['lose', 'trendDown', 'Perdu']; msg = `−${fmt.format(-net)} jetons`; cls = 'lose'; }
    else if (me.inHand) { badge = ['push', 'check', 'Égalité']; msg = 'Pot partagé.'; }
    else msg = 'Main terminée.';
    if (res.showdown && res.pots[0]) msg += `\n${res.pots[0].label}`;
  } else if (!me.inHand) {
    msg = me.stack > 0 ? 'Tu joueras la prochaine main.' : 'Plus de jetons.';
  } else if (me.folded) {
    badge = ['lose', 'cross', 'Couché'];
  } else if (me.allIn) {
    badge = ['blackjack', 'allIn', 'Tapis'];
  } else if (me.isTurn) {
    badge = ['turn', 'target', 'À toi de parler !'];
  } else {
    const turn = state.players.find((p) => p.isTurn);
    msg = turn ? `À ${turn.name} de parler…` : '';
  }
  els.meStatus.className = `badge ${badge[0]}`;
  setLabel(els.meStatus, badge[1], badge[2]);
  els.centerMsg.textContent = msg;
  els.centerMsg.className = `center-msg ${cls}`;
}

function renderActions(me) {
  const you = state.you;
  const myTurn = !!(you && me.isTurn);
  const [foldBtn] = els.actions.querySelectorAll('[data-act="fold"]');
  foldBtn.disabled = !myTurn;
  els.callBtn.disabled = !myTurn;
  els.raiseBtn.disabled = !myTurn || !you.canRaise;
  if (!myTurn) raiseOpen = false;

  if (you) {
    const allInCall = you.toCall > 0 && you.toCall >= me.stack;
    els.callBtn.textContent = you.toCall === 0 ? 'Checker' : allInCall ? `Tapis (${fmt.format(me.stack)})` : `Suivre ${fmt.format(you.toCall)}`;
    const verb = state.currentBet === 0 ? 'Miser' : 'Relancer';
    els.raiseBtn.textContent = raiseOpen
      ? (raiseTo >= you.maxRaiseTo ? `Tapis ${fmt.format(raiseTo)}` : `${verb} à ${fmt.format(raiseTo)}`)
      : verb;
    // Pas de « Se coucher » quand on peut checker gratuitement : on le grise.
    foldBtn.classList.toggle('discouraged', myTurn && you.toCall === 0);
  }
  els.raisePanel.hidden = !(myTurn && raiseOpen);
  if (myTurn && raiseOpen) renderRaise();
}

function renderRaise() {
  const you = state.you;
  raiseTo = Math.max(you.minRaiseTo, Math.min(you.maxRaiseTo, raiseTo));
  els.raiseRange.min = String(you.minRaiseTo);
  els.raiseRange.max = String(you.maxRaiseTo);
  els.raiseRange.value = String(raiseTo);
  els.raiseAmount.textContent = fmt.format(raiseTo);
  const html = raisePresets().map(([label, v]) =>
    `<button type="button" class="stake-btn${v === raiseTo ? ' selected' : ''}" data-to="${v}">${label}</button>`).join('');
  if (els.raisePresets.innerHTML !== html) els.raisePresets.innerHTML = html;
  const verb = state.currentBet === 0 ? 'Miser' : 'Relancer';
  els.raiseBtn.textContent = raiseTo >= you.maxRaiseTo ? `Tapis ${fmt.format(raiseTo)}` : `${verb} à ${fmt.format(raiseTo)}`;
}

/* ------------------------- sons, vibreur, minuterie ------------------------- */

function feedback() {
  if (!prev || !joined) return;
  const me = findMe();
  const before = prev.players.find((p) => p.id === token);
  if (!me || !before) return;
  if (me.isTurn && !before.isTurn) {
    sfx.turn();
    if (navigator.vibrate) navigator.vibrate([90, 40, 90]);
  }
  if (state.board.length > prev.board.length || state.handNumber !== prev.handNumber) sfx.card();
  if (state.phase === 'showdown' && prev.phase !== 'showdown' && state.results) {
    const net = state.results.net[token];
    if (net > 0) { sfx.win(); burstConfetti(50); }
    else if (net < 0) sfx.lose();
  }
}

function tick() {
  if (state && joined) {
    const me = findMe();
    if (me && me.isTurn && state.turnEndsAt) {
      const rem = clock.remaining(state.turnEndsAt);
      els.meTimer.hidden = false;
      els.meTimer.firstElementChild.style.width = `${(rem / 30000) * 100}%`;
      els.meTimer.classList.toggle('urgent', rem < 8000);
    } else {
      els.meTimer.hidden = true;
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* ------------------------------ chat, réactions ------------------------------ */

let chatUnread = 0;
const chatTime = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

function setChatUnread(n) {
  chatUnread = n;
  const label = n > 9 ? '9+' : String(n);
  for (const el of [els.chatBadge, els.menuBadge, els.menuChatCount]) {
    el.hidden = n === 0;
    el.textContent = label;
  }
}

function openChat(open) {
  els.chatSheet.hidden = !open;
  if (open) {
    setChatUnread(0);
    els.reactTray.hidden = true;
    els.chatList.scrollTop = els.chatList.scrollHeight;
    if (matchMedia('(hover: hover)').matches) els.chatInput.focus();
  }
  renderChatPeek();
}

function appendChat(m) {
  const near = els.chatList.scrollHeight - els.chatList.scrollTop - els.chatList.clientHeight < 60;
  els.chatEmpty.hidden = true;
  const row = document.createElement('div');
  row.className = `chat-msg${m.playerId === token ? ' mine' : ''}`;
  row.innerHTML = `
    <span class="chat-avatar" style="--p-color:${esc(m.color)}">${avatarHtml(m.avatar)}</span>
    <div class="chat-bubble"><div class="chat-meta"><span class="chat-name"></span><span class="chat-time"></span></div><p class="chat-text"></p></div>`;
  row.querySelector('.chat-name').textContent = m.name;
  row.querySelector('.chat-time').textContent = chatTime.format(new Date(m.at));
  row.querySelector('.chat-text').textContent = m.text;
  els.chatList.appendChild(row);
  while (els.chatList.querySelectorAll('.chat-msg').length > 100) els.chatList.querySelector('.chat-msg').remove();
  if (near || m.playerId === token) els.chatList.scrollTop = els.chatList.scrollHeight;
}

// Sur ordinateur, un nouveau message s'affiche 5 s en bas à gauche.
let peekMessage = null;
let peekTimer = null;
function renderChatPeek() {
  const m = peekMessage;
  const show = !!m && joined && wideMql.matches && els.chatSheet.hidden;
  els.chatPeek.hidden = !show;
  if (!show || els.chatPeek.dataset.id === String(m.id)) return;
  els.chatPeek.dataset.id = String(m.id);
  els.chatPeek.innerHTML = `
    <span class="chat-avatar" style="--p-color:${esc(m.color)}">${avatarHtml(m.avatar)}</span>
    <span class="peek-body"><span class="peek-meta"><span class="chat-name"></span></span><span class="peek-text"></span></span>`;
  els.chatPeek.querySelector('.chat-name').textContent = m.name;
  els.chatPeek.querySelector('.peek-text').textContent = m.text;
  els.chatPeek.classList.remove('pop');
  void els.chatPeek.offsetWidth;
  els.chatPeek.classList.add('pop');
}
els.chatPeek.addEventListener('click', () => openChat(true));

socket.on('chat:history', (messages = []) => {
  els.chatList.querySelectorAll('.chat-msg').forEach((el) => el.remove());
  els.chatEmpty.hidden = messages.length > 0;
  messages.forEach(appendChat);
});
socket.on('chat:message', (m) => {
  appendChat(m);
  if (m.playerId !== token && els.chatSheet.hidden) {
    setChatUnread(chatUnread + 1);
    sfx.click();
    peekMessage = m;
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => { peekMessage = null; renderChatPeek(); }, 5000);
    renderChatPeek();
  }
});
els.chatBtn.addEventListener('click', () => openChat(els.chatSheet.hidden));
$('chat-close').addEventListener('click', () => openChat(false));
els.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text) return;
  socket.emit('player:chat', { text }, (res) => {
    if (res && !res.ok) return showToast(res.message);
    els.chatInput.value = '';
  });
});

els.reactTray.innerHTML = FACES.map((f) =>
  `<button type="button" class="react-choice" data-face="${f}"><img class="face" src="${faceSrc(f)}" alt="" /></button>`).join('');
els.reactBtn.addEventListener('click', () => {
  if (!els.chatSheet.hidden) openChat(false);
  els.reactTray.hidden = !els.reactTray.hidden;
});
els.reactTray.addEventListener('click', (e) => {
  const b = e.target.closest('[data-face]');
  if (!b) return;
  els.reactTray.hidden = true;
  socket.emit('player:react', { face: b.dataset.face }, (res) => res && !res.ok && showToast(res.message));
});
socket.on('reaction', ({ playerId, face } = {}) => {
  if (!els.feltArea.hidden) showReactionBubble(tableView.plateOf(playerId), face);
  if (playerId === token) showReactionBubble(els.meAvatar, face);
});

// Menu « ⋯ » (téléphone) : chaque entrée déclenche le bouton d'origine.
els.menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  els.headMenu.hidden = !els.headMenu.hidden;
});
els.headMenu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-menu]');
  if (!item) return;
  e.stopPropagation();
  els.headMenu.hidden = true;
  ({ chat: els.chatBtn, react: els.reactBtn, rules: $('rules-btn'), mod: els.modBtn })[item.dataset.menu].click();
});
document.addEventListener('click', (e) => {
  if (!els.headMenu.hidden && !els.headMenu.contains(e.target)) els.headMenu.hidden = true;
});

/* --------------------------------- toast --------------------------------- */

let toastTimer = null;
function showToast(message, kind = '') {
  els.toast.textContent = message || 'Action impossible.';
  els.toast.className = `toast ${kind}`;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 2600);
}
