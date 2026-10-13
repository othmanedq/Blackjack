'use strict';

/* Vue Joueur (mobile) : lobby, mise, actions Hit / Stand / Double / Split. */

const socket = io();

const ACTION_LABELS = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split' };
const AVATARS = AVATAR_ICONS; // clés d'icônes (voir icons.js)
const COLORS = ['#f39c12', '#e74c3c', '#9b59b6', '#3498db', '#1abc9c', '#2ecc71', '#e91e8c', '#95a5a6'];

const els = {
  screenLobby: document.getElementById('screen-lobby'),
  screenGame: document.getElementById('screen-game'),
  joinForm: document.getElementById('join-form'),
  nameInput: document.getElementById('name-input'),
  avatarPicker: document.getElementById('avatar-picker'),
  colorPicker: document.getElementById('color-picker'),
  joinError: document.getElementById('join-error'),
  resumeModal: document.getElementById('resume-modal'),
  resumeAvatar: document.getElementById('resume-avatar'),
  resumeName: document.getElementById('resume-name'),
  resumeBalance: document.getElementById('resume-balance'),
  resumeYes: document.getElementById('resume-yes'),
  resumeNo: document.getElementById('resume-no'),
  meAvatar: document.getElementById('me-avatar'),
  meCrown: document.getElementById('me-crown'),
  meNameText: document.getElementById('me-name-text'),
  meBalance: document.getElementById('me-balance'),
  phoneStartLabel: document.getElementById('phone-start-label'),
  meStatus: document.getElementById('me-status'),
  meTimer: document.getElementById('me-timer'),
  meTimerFill: document.querySelector('#me-timer > i'),
  betPanel: document.getElementById('bet-panel'),
  betAmount: document.getElementById('bet-amount'),
  betSpots: document.getElementById('bet-spots'),
  sideHelp: document.getElementById('side-help'),
  reactBtn: document.getElementById('react-btn'),
  chatBtn: document.getElementById('chat-btn'),
  modBtn: document.getElementById('mod-btn'),
  menuBtn: document.getElementById('menu-btn'),
  menuBadge: document.getElementById('menu-badge'),
  headMenu: document.getElementById('head-menu'),
  menuChatCount: document.getElementById('menu-chat-count'),
  menuMod: document.getElementById('menu-mod'),
  modModal: document.getElementById('mod-modal'),
  modClose: document.getElementById('mod-close'),
  modAutoRebuy: document.getElementById('mod-auto-rebuy'),
  modRebuy: document.getElementById('mod-rebuy'),
  modSteps: document.getElementById('mod-steps'),
  modList: document.getElementById('mod-list'),
  chatBadge: document.getElementById('chat-badge'),
  chatSheet: document.getElementById('chat-sheet'),
  chatList: document.getElementById('chat-list'),
  chatEmpty: document.getElementById('chat-empty'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  chatClose: document.getElementById('chat-close'),
  chatPeek: document.getElementById('chat-peek'),
  reactTray: document.getElementById('react-tray'),
  tDealerFace: document.getElementById('t-dealer-face'),
  feltArea: document.getElementById('felt-area'),
  betConfirm: document.getElementById('bet-confirm'),
  betClear: document.getElementById('bet-clear'),
  betAllin: document.getElementById('bet-allin'),
  betAllinLabel: document.getElementById('bet-allin-label'),
  betRebet: document.getElementById('bet-rebet'),
  autoRebet: document.getElementById('auto-rebet'),
  autoRebetLabel: document.getElementById('auto-rebet-label'),
  betRebetLabel: document.getElementById('bet-rebet-label'),
  betActions: document.querySelector('.bet-actions'),
  insurancePanel: document.getElementById('insurance-panel'),
  insuranceText: document.getElementById('insurance-text'),
  insuranceActions: document.getElementById('insurance-actions'),
  insuranceNo: document.getElementById('insurance-no'),
  insuranceYes: document.getElementById('insurance-yes'),
  insuranceTimerFill: document.querySelector('#insurance-timer > i'),
  handsPanel: document.getElementById('hands-panel'),
  myHands: document.getElementById('my-hands'),
  configPanel: document.getElementById('config-panel'),
  modeOptions: document.getElementById('mode-options'),
  stakeOptions: document.getElementById('stake-options'),
  configHint: document.getElementById('config-hint'),
  rebuyPanel: document.getElementById('rebuy-panel'),
  rebuyBody: document.getElementById('rebuy-body'),
  rebuyModal: document.getElementById('rebuy-modal'),
  rebuyModalBody: document.getElementById('rebuy-modal-body'),
  rebuyClose: document.getElementById('rebuy-close'),
  rebuyTitle: document.getElementById('rebuy-title'),
  tableActions: document.getElementById('table-actions'),
  giveBtn: document.getElementById('give-btn'),
  kickBtn: document.getElementById('kick-btn'),
  leaveBtn: document.getElementById('leave-btn'),
  leaveLabel: document.getElementById('leave-label'),
  pmModal: document.getElementById('pm-modal'),
  pmTitle: document.getElementById('pm-title'),
  pmHint: document.getElementById('pm-hint'),
  pmList: document.getElementById('pm-list'),
  pmAmountBox: document.getElementById('pm-amount-box'),
  pmAmount: document.getElementById('pm-amount'),
  pmClear: document.getElementById('pm-clear'),
  pmAll: document.getElementById('pm-all'),
  pmConfirm: document.getElementById('pm-confirm'),
  pmCancel: document.getElementById('pm-cancel'),
  tablePanel: document.getElementById('table-panel'),
  tableToggle: document.getElementById('table-toggle'),
  tDealer: document.getElementById('t-dealer'),
  tDealerHand: document.getElementById('t-dealer-hand'),
  tDealerTotal: document.getElementById('t-dealer-total'),
  tOthers: document.getElementById('t-others'),
  phoneStart: document.getElementById('phone-start'),
  centerMsg: document.getElementById('center-msg'),
  actions: document.getElementById('actions'),
  presetHint: document.getElementById('preset-hint'),
  toast: document.getElementById('toast'),
};

// Identité stable pour survivre aux rafraîchissements / reconnexions.
// (let : après une exclusion de la table, on repart avec une identité neuve.)
function newToken() {
  return crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}
let token = localStorage.getItem('bj_token') || newToken();
localStorage.setItem('bj_token', token);

let profile = JSON.parse(localStorage.getItem('bj_profile') || 'null');

// Lien modérateur (?admin=code) : le code est retenu sur cet appareil puis
// retiré de l'adresse, pour qu'il ne fuite pas dans une capture ou un partage.
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
let joining = false; // une inscription est en cours (évite un faux « exclu »)
let state = null;
let prevMe = null;
// Mise en préparation : principale + paris annexes, et la case où vont les jetons.
let pending = { main: 0, pairs: 0, trio: 0 };
let betSpot = 'main';
const pendingTotal = () => pending.main + pending.pairs + pending.trio;
// Dernière mise confirmée (principale + annexes), rejouable en un tap.
let lastBet = null;
try { lastBet = JSON.parse(localStorage.getItem('bj_last_bet') || 'null'); } catch { lastBet = null; }
const betTotal = (b) => b.main + (b.pairs || 0) + (b.trio || 0);
/* Ordinateur ou tablette : la table complète s'affiche à côté des commandes
   (modes où les téléphones montrent la table). */
const wideMql = matchMedia('(min-width: 700px) and (min-height: 520px)');
const tableView = createTableView(els.feltArea, { meId: () => token, phaseMessage: playerPhaseMessage });
wideMql.addEventListener('change', () => render());

function playerPhaseMessage(s) {
  const current = s.current && s.players.find((p) => p.id === s.current.playerId);
  if (s.phase === 'playing' && current) {
    return current.id === token ? ['target', 'À toi de jouer !'] : ['clock', `Au tour de ${current.name}…`];
  }
  const msgs = {
    lobby: ['clock', 'En attente du lancement de la manche…'],
    betting: ['chips', 'Faites vos jeux !'],
    insurance: ['shield', 'Le croupier montre un As — assurance ?'],
    dealer: ['cards', 'Le croupier joue…'],
    results: ['flag', 'Manche terminée'],
  };
  return msgs[s.phase] || null;
}

const dealerFace = createDealerFace([els.tDealerFace, tableView.faceImg]);

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
      btn.className = 'avatar-choice';
      btn.innerHTML = iconHtml(v);
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

function join(opts = {}) {
  joining = true;
  socket.emit('player:join', { token, ...profile, ignoreResume: !!opts.ignoreResume, adminKey: adminKey() }, (res) => {
    joining = false;
    if (res && res.adminKeyRejected) {
      // Code périmé (changé côté serveur) : on l'oublie.
      localStorage.removeItem('bj_admin_key');
      showToast('Ton code modérateur n’est plus valable.');
    }
    if (res && res.moderator) showToast('Tu es le modérateur de la table.', 'win');
    if (res && res.resumeCandidate) {
      showResumeModal(res.resumeCandidate);
      return;
    }
    if (!res || !res.ok) {
      els.joinError.textContent = (res && res.message) || 'Connexion impossible.';
      return;
    }
    joined = true;
    els.screenLobby.hidden = true;
    els.screenGame.hidden = false;
    els.meAvatar.innerHTML = avatarHtml(profile.avatar);
    els.meAvatar.style.setProperty('--p-color', profile.color);
    els.meNameText.textContent = profile.name;
    sfx.chip();
    render();
  });
}

/** Repasse à l'écran d'accueil (sans réinscription automatique). */
function leaveToLobby(message) {
  joined = false;
  pending = { main: 0, pairs: 0, trio: 0 };
  betSpot = 'main';
  closeReactTray();
  openChat(false);
  els.screenGame.hidden = true;
  els.screenLobby.hidden = false;
  els.joinError.textContent = message || '';
}

/* --------------------- reprise après déconnexion (même IP) --------------------- */

function showResumeModal(candidate) {
  els.resumeAvatar.innerHTML = avatarHtml(candidate.avatar);
  els.resumeAvatar.style.setProperty('--p-color', candidate.color);
  els.resumeName.textContent = candidate.name;
  els.resumeBalance.textContent = fmt.format(candidate.balance);
  els.resumeModal.hidden = false;
  els.resumeYes.onclick = () => {
    sfx.click();
    token = candidate.token;
    localStorage.setItem('bj_token', token);
    profile = { name: candidate.name, avatar: candidate.avatar, color: candidate.color };
    localStorage.setItem('bj_profile', JSON.stringify(profile));
    els.resumeModal.hidden = true;
    join();
  };
  els.resumeNo.onclick = () => {
    sfx.click();
    els.resumeModal.hidden = true;
    join({ ignoreResume: true });
  };
}

// Reconnexion automatique (le serveur nous reconnaît grâce au token).
socket.on('connect', () => {
  if (joined && profile) join();
});

socket.on('state', (s) => {
  state = s;
  clock.sync(s.serverNow);
  render();
  dealerFace.update(s);
});

/* --------------------------------- mise --------------------------------- */

/* Jetons adaptés au solde : avec 20 000 jetons, personne ne veut taper
   cinquante fois sur un jeton de 10. On garde 5 valeurs consécutives de
   l'échelle classique des casinos, la plus grosse valant au plus le quart
   du solde (et jamais moins que l'échelle de base 10 → 250). */
// CHIP_LADDER et CHIP_COLORS : voir shared.js.
const CHIP_COUNT = 5;

function chipValues(balance) {
  let top = CHIP_COUNT - 1;
  while (top + 1 < CHIP_LADDER.length && CHIP_LADDER[top + 1] <= balance / 4) top++;
  return CHIP_LADDER.slice(top - CHIP_COUNT + 1, top + 1);
}

function chipLabel(v) {
  if (v >= 1e6) return `${v / 1e6}M`.replace('.', ',');
  if (v >= 1000) return `${v / 1000}k`.replace('.', ',');
  return String(v);
}

/** Met à jour les valeurs des jetons d'une rangée (attr : 'chip' ou 'pmChip'). */
function syncChips(selector, attr, balance) {
  const values = chipValues(balance);
  document.querySelectorAll(selector).forEach((chip, i) => {
    const v = values[i];
    if (Number(chip.dataset[attr]) === v) return;
    chip.dataset[attr] = String(v);
    chip.textContent = chipLabel(v);
    chip.className = 'chip';
    chip.style.setProperty('--chip-color', CHIP_COLORS[v]);
  });
}

document.querySelectorAll('.chip[data-chip]').forEach((chip) => {
  chip.addEventListener('click', () => {
    const me = findMe();
    if (!me) return;
    const val = Number(chip.dataset.chip);
    if (pendingTotal() + val > me.balance) return showToast('Solde insuffisant.');
    if (betSpot !== 'main') {
      if (pending.main === 0) return showToast('Pose d’abord ta mise principale.');
      if (pending[betSpot] + val > pending.main) {
        return showToast('Un pari annexe ne peut pas dépasser ta mise principale.');
      }
    }
    pending[betSpot] += val;
    sfx.chip();
    chip.classList.remove('chip-pop');
    void chip.offsetWidth;
    chip.classList.add('chip-pop');
    renderBet(me);
  });
});

els.betSpots.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-spot]');
  if (!btn) return;
  sfx.click();
  betSpot = btn.dataset.spot;
  renderBet(findMe());
});

els.betClear.addEventListener('click', () => {
  pending = { main: 0, pairs: 0, trio: 0 };
  betSpot = 'main';
  sfx.click();
  renderBet(findMe());
});

els.betAllin.addEventListener('click', () => {
  const me = findMe();
  if (!me || me.balance < state.minBet) return;
  // All-in : tout sur la mise principale, pas de pari annexe.
  pending = { main: me.balance, pairs: 0, trio: 0 };
  betSpot = 'main';
  sfx.chip();
  renderBet(me);
});

/* ------------------------------- assurance -------------------------------- */

els.insuranceNo.addEventListener('click', () => {
  sfx.click();
  socket.emit('player:insurance', { amount: 0 }, (res) => {
    if (res && !res.ok) showToast(res.message);
  });
});

els.insuranceYes.addEventListener('click', () => {
  const me = findMe();
  if (!me) return;
  const max = Math.floor(me.hands[0].bet / 2);
  sfx.chip();
  socket.emit('player:insurance', { amount: max }, (res) => {
    if (res && !res.ok) showToast(res.message);
  });
});

function renderInsurance(me) {
  const show = state.phase === 'insurance' && me.inRound;
  els.insurancePanel.hidden = !show;
  if (!show) return;
  const max = Math.floor(me.hands[0].bet / 2);
  if (!me.insuranceDecided) {
    els.insuranceText.textContent =
      `Il peut avoir Blackjack. Assurer jusqu'à ${fmt.format(max)} jetons (payé 2:1 si c'est le cas) ?`;
    els.insuranceActions.hidden = false;
  } else {
    els.insuranceText.textContent = me.insuranceBet > 0
      ? `Assurance de ${fmt.format(me.insuranceBet)} prise. En attente des autres…`
      : 'Assurance refusée. En attente des autres…';
    els.insuranceActions.hidden = true;
  }
}

function sendBet(bet) {
  const sideBets = { pairs: bet.pairs || 0, trio: bet.trio || 0 };
  socket.emit('player:bet', { amount: bet.main, sideBets }, (res) => {
    if (!res.ok) return showToast(res.message);
    sfx.chip();
    lastBet = { main: bet.main, pairs: sideBets.pairs, trio: sideBets.trio };
    localStorage.setItem('bj_last_bet', JSON.stringify(lastBet));
    pending = { main: 0, pairs: 0, trio: 0 };
    betSpot = 'main';
  });
}

/* ---------------------------- remise automatique ---------------------------- */

els.autoRebet.addEventListener('click', () => {
  const me = findMe();
  if (!me) return;
  sfx.click();
  // Activée : on coupe. Coupée : on part de la dernière mise confirmée.
  const bet = me.autoRebet ? null : lastBet;
  if (!me.autoRebet && !lastBet) return showToast('Place d’abord une mise : c’est elle qui sera remisée.');
  if (bet && betTotal(bet) > me.balance) return showToast('Solde insuffisant pour remiser automatiquement.');
  socket.emit('player:autoRebet', { bet }, (res) => {
    if (res && !res.ok) return showToast(res.message);
    if (bet) {
      pending = { main: 0, pairs: 0, trio: 0 };
      showToast(`Remise auto activée : ${fmt.format(betTotal(bet))} à chaque manche.`, 'win');
    }
  });
});

function renderAutoRebet(me) {
  const on = !!me.autoRebet;
  // La mise rejouée par le serveur devient aussi la mise du bouton « Remiser ».
  if (on && (!lastBet || betTotal(lastBet) !== betTotal(me.autoRebet) || lastBet.main !== me.autoRebet.main)) {
    lastBet = { ...me.autoRebet };
    localStorage.setItem('bj_last_bet', JSON.stringify(lastBet));
  }
  els.autoRebet.hidden = !on && !(lastBet && lastBet.main >= state.minBet);
  els.autoRebet.classList.toggle('on', on);
  els.autoRebet.setAttribute('aria-pressed', String(on));
  els.autoRebetLabel.textContent = on ? `Remise auto · ${fmt.format(betTotal(me.autoRebet))}` : 'Remise auto';
  // Coupée par le serveur faute de jetons : on prévient une fois.
  if (me.autoRebetStopped && prevMe && !prevMe.autoRebetStopped) {
    showToast('Remise auto coupée : solde insuffisant pour ta mise habituelle.');
  }
}

els.betConfirm.addEventListener('click', () => {
  if (pending.main <= 0) return;
  sendBet(pending);
});

// Remise : remplit les cases avec la mise de la manche précédente, à confirmer avec « Miser ».
els.betRebet.addEventListener('click', () => {
  const me = findMe();
  if (!me || !lastBet) return;
  if (betTotal(lastBet) > me.balance) return showToast('Solde insuffisant pour remiser.');
  pending = { main: lastBet.main, pairs: lastBet.pairs || 0, trio: lastBet.trio || 0 };
  betSpot = 'main';
  sfx.chip();
  renderBet(me);
});

/* ---------------------------------- chat ---------------------------------- */

let chatUnread = 0;
const chatTime = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

function chatIsOpen() {
  return !els.chatSheet.hidden;
}

function setChatUnread(n) {
  chatUnread = n;
  const label = n > 9 ? '9+' : String(n);
  // Même compteur sur le bouton chat (ordinateur) et sur le menu (téléphone).
  for (const el of [els.chatBadge, els.menuBadge, els.menuChatCount]) {
    el.hidden = n === 0;
    el.textContent = label;
  }
}

/* --------------------- menu de l'en-tête (téléphone) --------------------- */

function setHeadMenu(open) {
  els.headMenu.hidden = !open;
  els.menuBtn.setAttribute('aria-expanded', String(open));
}

els.menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  sfx.click();
  setHeadMenu(els.headMenu.hidden);
});

// Chaque entrée déclenche le bouton d'origine (masqué sur téléphone).
els.headMenu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-menu]');
  if (!item) return;
  e.stopPropagation();
  setHeadMenu(false);
  const target = { chat: els.chatBtn, react: els.reactBtn, mod: els.modBtn }[item.dataset.menu];
  if (target) target.click();
});

// Un tap ailleurs referme le menu.
document.addEventListener('click', (e) => {
  if (!els.headMenu.hidden && !els.headMenu.contains(e.target)) setHeadMenu(false);
});

function openChat(open) {
  els.chatSheet.hidden = !open;
  els.chatBtn.setAttribute('aria-expanded', String(open));
  renderChatPeek();
  if (open) {
    setChatUnread(0);
    closeReactTray();
    els.chatList.scrollTop = els.chatList.scrollHeight;
    // Pas de focus automatique sur téléphone : le clavier masquerait les messages.
    if (window.matchMedia('(hover: hover)').matches) els.chatInput.focus();
  }
}

/** Ajoute un message ; le texte passe par textContent, jamais par innerHTML. */
function appendChatMessage(m) {
  const nearBottom = els.chatList.scrollHeight - els.chatList.scrollTop - els.chatList.clientHeight < 60;
  els.chatEmpty.hidden = true;
  const row = document.createElement('div');
  row.className = `chat-msg${m.playerId === token ? ' mine' : ''}`;
  row.innerHTML = `
    <span class="chat-avatar" style="--p-color:${esc(m.color)}">${avatarHtml(m.avatar)}</span>
    <div class="chat-bubble">
      <div class="chat-meta"><span class="chat-name"></span><span class="chat-time"></span></div>
      <p class="chat-text"></p>
    </div>`;
  row.querySelector('.chat-name').textContent = m.name;
  row.querySelector('.chat-time').textContent = chatTime.format(new Date(m.at));
  row.querySelector('.chat-text').textContent = m.text;
  els.chatList.appendChild(row);
  // On garde les 100 derniers messages à l'écran.
  while (els.chatList.querySelectorAll('.chat-msg').length > 100) {
    els.chatList.querySelector('.chat-msg').remove();
  }
  if (nearBottom || m.playerId === token) els.chatList.scrollTop = els.chatList.scrollHeight;
}

// Historique envoyé à chaque (re)connexion : on repart de zéro pour éviter les doublons.
socket.on('chat:history', (messages = []) => {
  els.chatList.querySelectorAll('.chat-msg').forEach((el) => el.remove());
  els.chatEmpty.hidden = messages.length > 0;
  messages.forEach(appendChatMessage);
});

/* Sur ordinateur ou tablette, un nouveau message s'affiche en petit en bas à
   gauche quelques secondes, juste pour le signaler ; un clic ouvre le chat.
   Sur téléphone, la pastille suffit (la carte masquerait les boutons de jeu). */
const PEEK_MS = 5000;
let lastChatMessage = null; // message à signaler, effacé après PEEK_MS
let peekTimer = null;

function peekChatMessage(m) {
  lastChatMessage = m;
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    lastChatMessage = null;
    renderChatPeek();
  }, PEEK_MS);
  renderChatPeek();
}

function renderChatPeek() {
  const m = lastChatMessage;
  const show = !!m && joined && wideMql.matches && !chatIsOpen();
  els.chatPeek.hidden = !show;
  if (!show) return;
  if (els.chatPeek.dataset.id === String(m.id)) return;
  els.chatPeek.dataset.id = String(m.id);
  els.chatPeek.innerHTML = `
    <span class="chat-avatar" style="--p-color:${esc(m.color)}">${avatarHtml(m.avatar)}</span>
    <span class="peek-body">
      <span class="peek-meta"><span class="chat-name"></span><span class="chat-time"></span></span>
      <span class="peek-text"></span>
    </span>`;
  els.chatPeek.querySelector('.chat-name').textContent = m.name;
  els.chatPeek.querySelector('.chat-time').textContent = chatTime.format(new Date(m.at));
  els.chatPeek.querySelector('.peek-text').textContent = m.text;
  // Petite animation à chaque nouveau message.
  els.chatPeek.classList.remove('pop');
  void els.chatPeek.offsetWidth;
  els.chatPeek.classList.add('pop');
}

els.chatPeek.addEventListener('click', () => openChat(true));
wideMql.addEventListener('change', renderChatPeek);

socket.on('chat:message', (m) => {
  appendChatMessage(m);
  if (m.playerId !== token && !chatIsOpen()) {
    setChatUnread(chatUnread + 1);
    sfx.click();
    peekChatMessage(m);
  }
});

els.chatBtn.addEventListener('click', () => {
  sfx.click();
  openChat(!chatIsOpen());
});
els.chatClose.addEventListener('click', () => openChat(false));

els.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text) return;
  socket.emit('player:chat', { text }, (res) => {
    if (res && !res.ok) return showToast(res.message);
    els.chatInput.value = '';
  });
});

/* ------------------------------- réactions -------------------------------- */

els.reactTray.innerHTML = FACES.map((f) =>
  `<button type="button" class="react-choice" data-face="${f}"><img class="face" src="${faceSrc(f)}" alt="" /></button>`
).join('');

function closeReactTray() {
  els.reactTray.hidden = true;
  els.reactBtn.setAttribute('aria-expanded', 'false');
}

els.reactBtn.addEventListener('click', () => {
  sfx.click();
  if (chatIsOpen()) openChat(false);
  const open = els.reactTray.hidden;
  els.reactTray.hidden = !open;
  els.reactBtn.setAttribute('aria-expanded', String(open));
});

els.reactTray.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-face]');
  if (!btn) return;
  closeReactTray();
  socket.emit('player:react', { face: btn.dataset.face }, (res) => {
    if (res && !res.ok) showToast(res.message);
  });
});

socket.on('reaction', ({ playerId, face } = {}) => {
  if (!els.feltArea.hidden) showReactionBubble(tableView.plateOf(playerId), face);
  if (playerId === token) return showReactionBubble(els.meAvatar, face);
  const row = otherEls.get(playerId);
  if (row) showReactionBubble(row.querySelector('.t-avatar'), face);
});

/* ------------------------------- mode de jeu ------------------------------ */

const MODE_LABELS = { table: 'tous sur un écran', phones: 'chacun son écran', both: 'les deux' };
// En mode 'both', les téléphones affichent la table ET l'écran commun fonctionne.
function phoneUiEnabled() {
  return state && (state.mode === 'phones' || state.mode === 'both');
}

els.modeOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  sfx.click();
  socket.emit('player:setGameMode', { mode: btn.dataset.mode }, (res) => {
    if (res && !res.ok) showToast(res.message);
  });
});

/* ---------------------- cave de départ & re-cave ------------------------- */

const STAKE_PRESETS = [100, 500, 1000, 2000, 5000, 10000];

els.stakeOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-stake]');
  if (!btn) return;
  sfx.click();
  socket.emit('player:setStartingBalance', { amount: Number(btn.dataset.stake) }, (res) => {
    if (res && !res.ok) showToast(res.message);
    else sfx.chip();
  });
});

// Le joueur à sec peut repousser la modale ; elle revient s'il retombe à sec plus tard.
let rebuyDismissed = false;
let rebuyRetryTimer = null;

// Verdict du vote, reçu tout de suite par le demandeur.
socket.on('player:rebuyResult', ({ outcome } = {}) => {
  rebuyDismissed = false;
  if (outcome === 'granted') {
    showToast('Re-cave acceptée : te revoilà dans la partie !', 'win');
    sfx.win();
    burstConfetti(40);
  } else {
    sfx.lose();
  }
  render();
});

function onRebuyClick(e) {
  const btn = e.target.closest('button[data-rebuy]');
  if (!btn) return;
  sfx.click();
  const action = btn.dataset.rebuy;
  if (action === 'close') {
    // Fin de partie pour ce joueur (re-cave refusée ou exclusion) : retour à l'accueil.
    els.rebuyModal.hidden = true;
  } else if (action === 'later') {
    rebuyDismissed = true;
    render();
  } else if (action === 'open') {
    rebuyDismissed = false;
    render();
  } else if (action === 'request') {
    socket.emit('player:requestRebuy', (res) => {
      if (res && !res.ok) showToast(res.message);
    });
  } else if (isModerator()) {
    // Le modérateur ne vote pas : sa décision est définitive.
    socket.emit('mod:decideRebuy', { accept: action === 'yes' }, (res) => {
      if (res && !res.ok) showToast(res.message);
    });
  } else {
    socket.emit('player:voteRebuy', { accept: action === 'yes' }, (res) => {
      if (res && !res.ok) showToast(res.message);
    });
  }
}
els.rebuyBody.addEventListener('click', onRebuyClick);
els.rebuyModalBody.addEventListener('click', onRebuyClick);
els.rebuyClose.addEventListener('click', onRebuyClick);

// Re-cave refusée : on quitte la table, avec une identité neuve pour revenir.
socket.on('player:kicked', ({ message } = {}) => {
  // Identité neuve : on ne doit pas pouvoir revenir avec l'ancienne place.
  token = newToken();
  localStorage.setItem('bj_token', token);
  leaveToLobby(message || 'Tu as quitté la table.');
  // La modale de re-cave pouvait être ouverte (attente du vote) : elle annonce
  // le verdict au lieu de rester bloquée, et se ferme d'un tap.
  els.rebuyTitle.textContent = 'Tu quittes la table';
  els.rebuyClose.hidden = false;
  els.rebuyClose.dataset.rebuy = 'close';
  setHtml(els.rebuyModalBody, `<p class="modal-text">${esc(message || 'Tu as quitté la table.')}</p>
    <div class="modal-actions">
      <button type="button" class="cta" data-rebuy="close">Retour à l'accueil</button>
    </div>`);
  els.rebuyModal.hidden = false;
  sfx.lose();
  if (navigator.vibrate) navigator.vibrate(300);
});

function renderConfig(me) {
  const show = state.canConfigure;
  els.configPanel.hidden = !show;
  if (!show) return;
  const isChef = state.hostPlayerId === me.id;

  els.modeOptions.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.mode === state.mode);
    btn.disabled = !isChef;
  });

  els.stakeOptions.innerHTML = STAKE_PRESETS.map(
    (v) => `<button type="button" class="stake-btn${v === state.startingBalance ? ' selected' : ''}"
      data-stake="${v}" ${isChef ? '' : 'disabled'}>${fmt.format(v)}</button>`
  ).join('');

  if (!state.mode) {
    els.configHint.textContent = isChef
      ? 'Choisis d\'abord un mode de jeu, puis la cave de chacun.'
      : 'En attente du chef de table pour choisir le mode de jeu…';
  } else {
    els.configHint.textContent = isChef
      ? 'Chef de table : ces réglages ne changeront plus après la première manche.'
      : `Mode : ${MODE_LABELS[state.mode]} — cave à ${fmt.format(state.startingBalance)} jetons.`;
  }
}

/** Remplace le contenu seulement s'il a changé (un bouton recréé à chaque état perdrait le tap). */
function setHtml(el, html) {
  if (el.innerHTML !== html) el.innerHTML = html;
}

function renderRebuy(me) {
  const r = state.rebuyRequest;
  const isBroke = me.balance < state.minBet;
  if (!isBroke) rebuyDismissed = false;
  const requester = r && state.players.find((p) => p.id === r.playerId);
  // Barre de progression vers la majorité : il faut `needed` acceptations.
  const progress = r
    ? `<div class="rebuy-progress"><i style="width:${Math.min(100, (r.approved / r.needed) * 100)}%"></i></div>
       <p class="rebuy-count">${r.approved}/${r.needed} acceptation${r.needed > 1 ? 's' : ''} nécessaire${r.needed > 1 ? 's' : ''}
         · ${r.refused} refus · majorité des ${r.total} joueurs</p>`
    : '';
  // Re-cave refusée récemment : nouvelle demande possible après un délai.
  const retryMs = Math.max(0, (me.rebuyRetryAt || 0) - clock.now());
  if (retryMs > 0) {
    clearTimeout(rebuyRetryTimer);
    rebuyRetryTimer = setTimeout(render, retryMs + 200);
  }

  let modal = '';
  let panel = '';
  if (r && r.playerId === me.id && rebuyDismissed) {
    panel = `<p class="rebuy-text">${iconHtml('chipPlus')} Ta demande de re-cave :
      ${r.approved}/${r.needed} acceptations…</p>
      <button type="button" class="ghost-btn rebuy-see" data-rebuy="open">Voir</button>`;
  } else if (r && r.playerId === me.id) {
    modal = `<p class="modal-text">Demande envoyée aux autres joueurs pour
      <strong>${fmt.format(r.amount)}</strong> jetons.</p>
      ${progress}
      <p class="rebuy-note">La majorité décide. En cas de refus, tu restes à la table.</p>`;
  } else if (r && r.awaiting.includes(me.id)) {
    const who = requester
      ? `<div class="resume-identity">
          <span class="resume-avatar" style="--p-color:${esc(requester.color)}">${avatarHtml(requester.avatar)}</span>
          <span class="resume-name">${esc(requester.name)}</span>
        </div>`
      : '';
    modal = `${who}
      <p class="modal-text"><strong>${esc(r.playerName)}</strong> n'a plus de jetons et demande
        une re-cave de <strong>${fmt.format(r.amount)}</strong>.</p>
      ${progress}
      <p class="rebuy-note">${isModerator()
        ? 'Tu es modérateur : ta décision est définitive, sans attendre les autres.'
        : 'La majorité décide. Un refus ne l\'exclut pas : il reste à la table.'}</p>
      <div class="rebuy-actions">
        <button type="button" class="rebuy-yes" data-rebuy="yes">${iconHtml('check')} Accepter</button>
        <button type="button" class="rebuy-no" data-rebuy="no">${iconHtml('cross')} Refuser</button>
      </div>`;
  } else if (r) {
    panel = `<p class="rebuy-text">${iconHtml('chipPlus')} Re-cave de <strong>${esc(r.playerName)}</strong> :
      ${r.approved}/${r.needed} acceptations…</p>`;
  } else if (isBroke && !me.inRound && retryMs > 0 && !rebuyDismissed) {
    modal = `<p class="modal-text">La majorité a refusé ta re-cave.<br>Tu restes à la table.</p>
      <p class="rebuy-note">Tu pourras redemander dans ${Math.ceil(retryMs / 1000)} s.</p>
      <div class="modal-actions">
        <button type="button" class="cta" data-rebuy="later">D'accord</button>
      </div>`;
  } else if (isBroke && !me.inRound && retryMs > 0) {
    panel = `<p class="rebuy-text">${iconHtml('clock')} Re-cave refusée : nouvelle demande possible
      dans ${Math.ceil(retryMs / 1000)} s.</p>`;
  } else if (isBroke && !me.inRound && (me.rebuys || 0) >= state.maxRebuys && !rebuyDismissed) {
    // Plus de re-cave possible : on le dit clairement, sans bouton de demande.
    modal = `<p class="modal-text">Tu as utilisé tes <strong>${state.maxRebuys} re-caves</strong>.</p>
      <p class="rebuy-note">Tu peux rester à la table et recevoir des jetons d'un autre joueur, ou la quitter.</p>
      <div class="modal-actions">
        <button type="button" class="cta" data-rebuy="later">D'accord</button>
      </div>`;
  } else if (isBroke && !me.inRound && (me.rebuys || 0) >= state.maxRebuys) {
    panel = `<p class="rebuy-text">${iconHtml('cross')} Plus de re-cave possible (${state.maxRebuys}/${state.maxRebuys}).</p>`;
  } else if (isBroke && !me.inRound && !rebuyDismissed) {
    modal = `<p class="modal-text">Tu n'as plus assez de jetons pour miser.<br>
        Demande une re-cave de <strong>${fmt.format(state.startingBalance)}</strong> aux autres joueurs.</p>
      <p class="rebuy-note">La majorité des autres joueurs doit accepter. En cas de refus, tu restes à la table.</p>
      <div class="modal-actions">
        <button type="button" class="cta rebuy-request" data-rebuy="request">
          ${iconHtml('chipPlus')} Demander une re-cave (${(me.rebuys || 0) + 1}/${state.maxRebuys})
        </button>
        <button type="button" class="ghost-btn" data-rebuy="later">Pas maintenant</button>
      </div>`;
  } else if (isBroke && !me.inRound) {
    panel = `<button type="button" class="cta rebuy-request" data-rebuy="open">
      ${iconHtml('chipPlus')} Demander une re-cave (${(me.rebuys || 0) + 1}/${state.maxRebuys})
    </button>`;
  }

  // Croix de fermeture : partout sauf pour un votant (fermer sans voter bloquerait la table).
  const isVoter = !!(r && r.awaiting.includes(me.id));
  els.rebuyTitle.textContent = 'Re-cave';
  els.rebuyClose.hidden = isVoter;
  els.rebuyClose.dataset.rebuy = 'later';

  // Une modale qui s'ouvre pour voter doit se remarquer.
  if (modal && els.rebuyModal.hidden && r && r.awaiting.includes(me.id)) {
    sfx.turn();
    if (navigator.vibrate) navigator.vibrate([80, 50, 80]);
  }
  els.rebuyModal.hidden = !modal;
  setHtml(els.rebuyModalBody, modal);
  els.rebuyPanel.hidden = !panel;
  setHtml(els.rebuyBody, panel);
}

/* ------------------- don de jetons & exclusion (modale) ------------------- */

// { mode: 'give' | 'kick', target: playerId|null, amount: number }
let pm = { mode: null, target: null, amount: 0 };

function openPlayerModal(mode) {
  const me = findMe();
  if (!me) return;
  pm = { mode, target: null, amount: 0 };
  els.pmTitle.textContent = mode === 'give' ? 'Donner des jetons' : 'Exclure un joueur';
  els.pmHint.textContent = mode === 'give'
    ? 'Choisis à qui donner, puis le montant. Le transfert est immédiat et définitif.'
    : 'Choisis le joueur à exclure. Il pourra revenir, mais comme un nouveau joueur.';
  els.pmAmountBox.hidden = mode !== 'give';
  els.pmModal.hidden = false;
  renderPlayerModal();
}

function closePlayerModal() {
  els.pmModal.hidden = true;
  pm = { mode: null, target: null, amount: 0 };
}

function renderPlayerModal() {
  if (els.pmModal.hidden) return;
  const me = findMe();
  if (!me) return closePlayerModal();

  const others = state.players.filter((p) => p.id !== me.id);
  if (others.length === 0) {
    els.pmList.innerHTML = '<div class="t-empty">Personne d’autre à la table.</div>';
  } else {
    els.pmList.innerHTML = others.map((p) => `
      <button type="button" class="pm-row${p.id === pm.target ? ' selected' : ''}" data-pm-target="${esc(p.id)}">
        <span class="pm-avatar" style="--p-color:${esc(p.color)}">${avatarHtml(p.avatar)}</span>
        <span class="pm-name">${esc(p.name)}</span>
        <span class="pm-bal">${iconHtml('chip')} ${fmt.format(p.balance)}</span>
      </button>`).join('');
  }
  // Une cible qui a quitté la table entre-temps ne reste pas sélectionnée.
  if (pm.target && !others.some((p) => p.id === pm.target)) pm.target = null;

  if (pm.mode === 'give') {
    els.pmAmount.textContent = fmt.format(pm.amount);
    syncChips('[data-pm-chip]', 'pmChip', me.balance);
    document.querySelectorAll('[data-pm-chip]').forEach((chip) => {
      chip.disabled = pm.amount + Number(chip.dataset.pmChip) > me.balance;
    });
    els.pmConfirm.disabled = !pm.target || pm.amount <= 0 || pm.amount > me.balance;
    els.pmConfirm.textContent = pm.amount > 0 ? `Donner ${fmt.format(pm.amount)}` : 'Donner';
  } else {
    els.pmConfirm.disabled = !pm.target;
    els.pmConfirm.textContent = 'Exclure';
  }
}

els.giveBtn.addEventListener('click', () => { sfx.click(); openPlayerModal('give'); });
els.kickBtn.addEventListener('click', () => { sfx.click(); openPlayerModal('kick'); });
els.pmCancel.addEventListener('click', () => { sfx.click(); closePlayerModal(); });

els.pmList.addEventListener('click', (e) => {
  const row = e.target.closest('[data-pm-target]');
  if (!row) return;
  sfx.click();
  pm.target = row.dataset.pmTarget;
  renderPlayerModal();
});

document.querySelectorAll('[data-pm-chip]').forEach((chip) => {
  chip.addEventListener('click', () => {
    const me = findMe();
    if (!me) return;
    const val = Number(chip.dataset.pmChip);
    if (pm.amount + val > me.balance) return showToast('Solde insuffisant.');
    pm.amount += val;
    sfx.chip();
    renderPlayerModal();
  });
});

els.pmClear.addEventListener('click', () => { pm.amount = 0; sfx.click(); renderPlayerModal(); });
els.pmAll.addEventListener('click', () => {
  const me = findMe();
  if (!me) return;
  pm.amount = me.balance;
  sfx.chip();
  renderPlayerModal();
});

els.pmConfirm.addEventListener('click', () => {
  if (!pm.target) return;
  sfx.click();
  if (pm.mode === 'give') {
    socket.emit('player:give', { to: pm.target, amount: pm.amount }, (res) => {
      if (res && !res.ok) return showToast(res.message);
      sfx.chip();
      showToast('Jetons envoyés.');
      closePlayerModal();
    });
  } else {
    socket.emit('player:kick', { target: pm.target }, (res) => {
      if (res && !res.ok) return showToast(res.message);
      closePlayerModal();
    });
  }
});

// Un don reçu : petit retour visible et sonore.
socket.on('player:gift', ({ fromName, amount } = {}) => {
  showToast(`${fromName} t’a donné ${fmt.format(amount)} jetons !`, 'win');
  sfx.win();
  burstConfetti(30);
  if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
});

/* ---------------------------- quitter la table ---------------------------- */

// Premier tap : demande de confirmation (3 s) ; second tap : on part vraiment.
let leaveArmedUntil = 0;
let leaveTimer = null;

function resetLeaveBtn() {
  leaveArmedUntil = 0;
  clearTimeout(leaveTimer);
  els.leaveBtn.classList.remove('armed');
  els.leaveLabel.textContent = 'Quitter la table';
}

els.leaveBtn.addEventListener('click', () => {
  sfx.click();
  if (Date.now() > leaveArmedUntil) {
    leaveArmedUntil = Date.now() + 3000;
    els.leaveBtn.classList.add('armed');
    els.leaveLabel.textContent = 'Touche encore pour confirmer';
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(resetLeaveBtn, 3000);
    return;
  }
  resetLeaveBtn();
  socket.emit('player:leave', (res) => {
    if (res && !res.ok) return showToast(res.message);
    // Même identité conservée : en revenant, il retrouve ses jetons.
    leaveToLobby('Tu as quitté la table. Tes jetons t’attendent si tu reviens avec cet appareil.');
  });
});

/* ------------------------------- modération ------------------------------- */

const MOD_STEPS = [100, 500, 1000, 5000];
let modStep = 500;

function isModerator() {
  return !!(state && state.moderatorId && state.moderatorId === token);
}

els.modSteps.innerHTML = MOD_STEPS.map((v) =>
  `<button type="button" class="stake-btn" data-step="${v}">${fmt.format(v)}</button>`).join('');

els.modBtn.addEventListener('click', () => {
  sfx.click();
  els.modModal.hidden = false;
  renderModeration();
});
els.modClose.addEventListener('click', () => { sfx.click(); els.modModal.hidden = true; });

els.modSteps.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-step]');
  if (!btn) return;
  sfx.click();
  modStep = Number(btn.dataset.step);
  renderModeration();
});

els.modAutoRebuy.addEventListener('change', () => {
  socket.emit('mod:autoRebuy', { on: els.modAutoRebuy.checked }, (res) => {
    if (res && !res.ok) showToast(res.message);
  });
});

els.modRebuy.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-decide]');
  if (!btn) return;
  sfx.click();
  socket.emit('mod:decideRebuy', { accept: btn.dataset.decide === 'yes' }, (res) => {
    if (res && !res.ok) showToast(res.message);
  });
});

els.modList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-adjust]');
  if (!btn) return;
  const delta = Number(btn.dataset.adjust) * modStep;
  socket.emit('mod:adjust', { target: btn.dataset.target, delta }, (res) => {
    if (res && !res.ok) return showToast(res.message);
    sfx.chip();
  });
});

function renderModeration() {
  const mod = isModerator();
  els.modBtn.hidden = !mod;
  els.menuMod.hidden = !mod;
  if (!mod) {
    els.modModal.hidden = true;
    return;
  }
  if (els.modModal.hidden) return;
  els.modAutoRebuy.checked = !!state.autoRebuy;
  els.modSteps.querySelectorAll('[data-step]').forEach((b) => {
    b.classList.toggle('selected', Number(b.dataset.step) === modStep);
  });

  const r = state.rebuyRequest;
  els.modRebuy.hidden = !r;
  setHtml(els.modRebuy, r
    ? `<p>${iconHtml('chipPlus')} Re-cave demandée par <strong>${esc(r.playerName)}</strong>
        (${r.approved}/${r.needed} acceptations)</p>
       <div class="rebuy-actions">
         <button type="button" class="rebuy-yes" data-decide="yes">${iconHtml('check')} Accorder</button>
         <button type="button" class="rebuy-no" data-decide="no">${iconHtml('cross')} Refuser</button>
       </div>`
    : '');

  setHtml(els.modList, state.players.map((p) => `
    <div class="mod-row">
      <span class="pm-avatar" style="--p-color:${esc(p.color)}">${avatarHtml(p.avatar)}</span>
      <span class="pm-name">${esc(p.name)}${p.id === token ? ' <small>(toi)</small>' : ''}</span>
      <span class="pm-bal">${fmt.format(p.balance)}</span>
      <button type="button" class="mod-adj minus" data-adjust="-1" data-target="${esc(p.id)}"
        aria-label="Retirer ${fmt.format(modStep)} à ${esc(p.name)}" ${p.balance === 0 ? 'disabled' : ''}>−</button>
      <button type="button" class="mod-adj plus" data-adjust="1" data-target="${esc(p.id)}"
        aria-label="Ajouter ${fmt.format(modStep)} à ${esc(p.name)}">+</button>
    </div>`).join(''));
}

// Le joueur dont le solde a été modifié en est prévenu.
socket.on('player:modAdjust', ({ amount } = {}) => {
  if (amount > 0) {
    showToast(`Le modérateur t’a ajouté ${fmt.format(amount)} jetons.`, 'win');
    sfx.win();
  } else {
    showToast(`Le modérateur t’a retiré ${fmt.format(-amount)} jetons.`);
  }
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

/* Pendant l'attente, une main encore jouable peut se piloter à l'avance :
   l'action choisie s'exécute d'elle-même dès que le tour arrive vraiment. */
function isPresetMode(me) {
  return !!(
    state && me && !me.isTurn && state.phase === 'playing' &&
    me.inRound && me.hands[0] && me.hands[0].status === 'playing'
  );
}

els.actions.querySelectorAll('.action-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.action;
    sfx.click();
    const me = findMe();
    if (isPresetMode(me)) {
      const next = me.presetAction === type ? null : type; // re-cliquer annule
      socket.emit('player:setPreset', { action: next }, (res) => {
        if (res && !res.ok) showToast(res.message);
      });
      return;
    }
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
    // On n'est plus à la table (exclusion, ou serveur redémarré). On repasse au
    // lobby SANS se réinscrire tout seul : une réinscription automatique
    // recréerait aussitôt un joueur exclu, en plusieurs exemplaires.
    if (!joining) leaveToLobby('Tu n\'es plus à la table. Reprends une place quand tu veux.');
    return;
  }

  els.meBalance.textContent = fmt.format(me.balance);

  const myTurn = me.isTurn;
  const activeHand = myTurn && me.hands[me.turnHandIndex] ? me.hands[me.turnHandIndex] : null;
  const isBetting = state.phase === 'betting';
  const isBroke = me.balance < state.minBet;
  const showBetPanel = isBetting && !me.betPlaced && me.connected && !isBroke;

  els.betPanel.hidden = !showBetPanel;
  if (showBetPanel) renderBet(me);

  renderConfig(me);
  renderRebuy(me);
  renderInsurance(me);

  // Grand écran : la table complète remplace le panneau « La table » et mes mains.
  const felt = wideMql.matches && phoneUiEnabled();
  els.screenGame.classList.toggle('has-felt', felt);
  els.feltArea.hidden = !felt;
  if (felt) tableView.render(state);

  const showHands = !felt && me.inRound && me.hands.length > 0 && me.hands[0].cards.length > 0;
  els.handsPanel.hidden = !showHands;
  if (showHands) renderHands(me);

  if (felt) els.tablePanel.hidden = true;
  else renderTable(me);

  // Chef de table : couronne + bouton pour lancer la manche depuis le téléphone
  // (uniquement en mode « chacun son écran » — en mode table, c'est l'écran
  // commun qui lance les manches).
  const isChef = state.hostPlayerId === me.id;
  els.meCrown.hidden = !isChef;
  renderModeration();
  renderChatPeek();
  els.meNameText.textContent = profile.name;
  const canStart = isChef && phoneUiEnabled() && (state.phase === 'lobby' || state.phase === 'results');
  els.phoneStart.hidden = !canStart;
  els.phoneStartLabel.textContent = state.roundNumber ? 'Nouvelle manche' : 'Lancer la manche';

  // Don de jetons et exclusion : uniquement entre deux manches, et s'il y a
  // au moins un autre joueur à la table.
  const betweenRounds = state.phase === 'lobby' || state.phase === 'results';
  const hasOthers = state.players.length > 1;
  const canGive = betweenRounds && hasOthers && me.balance > 0;
  els.kickBtn.hidden = !(isChef && betweenRounds && hasOthers);
  els.giveBtn.hidden = !canGive;
  els.tableActions.hidden = els.kickBtn.hidden && els.giveBtn.hidden;
  // Quitter : jamais avec une main engagée (la mise est sur le tapis).
  const roundOn = ['betting', 'insurance', 'playing', 'dealer'].includes(state.phase);
  els.leaveBtn.hidden = roundOn && me.inRound;
  if (els.leaveBtn.hidden) resetLeaveBtn();
  renderPlayerModal();

  // Statut + message central — badge = [classe, icône, libellé]
  let badge = ['waiting', 'clock', 'En attente'];
  let msg = '';
  let msgCls = '';
  if (state.phase === 'lobby') {
    if (!state.mode) {
      msg = isChef
        ? 'Choisis le mode de jeu ci-dessus.'
        : 'En attente du chef de table pour configurer la partie…';
    } else if (state.mode === 'table') {
      msg = isChef
        ? 'Mode « tous sur un écran ».\nLance la manche depuis l\'écran de la table.'
        : 'Bien installé !\nRegarde l\'écran de la table pour suivre la partie.';
    } else {
      msg = isChef
        ? 'Tu es le chef de table.\nLance la manche quand tout le monde a rejoint !'
        : 'Bien installé !\nEn attente du lancement de la manche…';
    }
  } else if (isBetting) {
    if (me.betPlaced) {
      badge = ['betting', 'check', 'Mise placée'];
      msg = 'Mise placée.\nEn attente des autres joueurs…';
    } else if (isBroke) {
      badge = ['lose', 'chip', 'À sec'];
    } else {
      badge = ['betting', 'chips', 'Fais ton jeu'];
    }
  } else if (state.phase === 'insurance') {
    badge = me.inRound ? ['betting', 'shield', 'Assurance'] : ['waiting', 'clock', 'En attente'];
  } else if (state.phase === 'playing') {
    if (!me.inRound) {
      msg = 'Tu ne joues pas cette manche.\nTu pourras miser à la prochaine !';
    } else if (myTurn) {
      badge = ['turn', 'target', 'À toi de jouer !'];
    } else {
      const cur = state.players.find((p) => p.id === (state.current && state.current.playerId));
      badge = statusBadge(me);
      msg = cur ? `Au tour de ${cur.name}…` : '';
    }
  } else if (state.phase === 'dealer') {
    badge = statusBadge(me);
    msg = 'Le croupier joue…';
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
  setLabel(els.meStatus, badge[1], badge[2]);
  els.centerMsg.textContent = msg;
  els.centerMsg.className = `center-msg ${msgCls}`;

  // Boutons actifs à mon tour — ou en pré-choix pendant que j'attends.
  const canAct = !!activeHand;
  const presetMode = !canAct && isPresetMode(me);
  const presetHand = presetMode ? me.hands[0] : null;
  const btnHit = els.actions.querySelector('[data-action="hit"]');
  const btnStand = els.actions.querySelector('[data-action="stand"]');
  const btnDouble = els.actions.querySelector('[data-action="double"]');
  const btnSplit = els.actions.querySelector('[data-action="split"]');

  btnHit.disabled = !canAct && !presetMode;
  btnStand.disabled = !canAct && !presetMode;
  btnDouble.disabled = canAct ? !activeHand.canDouble : !presetMode || !presetHand.canDouble;
  btnSplit.disabled = canAct ? !activeHand.canSplit : !presetMode || !presetHand.canSplit;

  els.actions.classList.toggle('preset-mode', presetMode);
  els.actions.querySelectorAll('.action-btn').forEach((btn) => {
    btn.classList.toggle('armed', presetMode && me.presetAction === btn.dataset.action);
  });
  els.presetHint.hidden = !presetMode;
  setLabel(els.presetHint, 'clock', me.presetAction
    ? `Programmé : ${ACTION_LABELS[me.presetAction]} — retape pour annuler`
    : 'Pré-choisis ton coup, il s\'exécutera dès ton tour');

  playFeedback(me, myTurn);
  renderAutoRebet(me);
  prevMe = JSON.parse(JSON.stringify(me));
}

function statusBadge(me) {
  const statuses = me.hands.map((h) => h.status);
  if (statuses.every((s) => s === 'blackjack')) return ['blackjack', 'spade', 'Blackjack !'];
  if (statuses.every((s) => s === 'bust')) return ['bust', 'burst', 'Bust'];
  if (statuses.every((s) => s === 'stand' || s === 'bust' || s === 'blackjack')) return ['stand', 'stand', 'Stand'];
  return ['waiting', 'clock', 'En attente'];
}

/**
 * Gain ou perte des seules mains jouées, sans paris annexes ni assurance :
 * c'est lui qui dit si la main est gagnée, perdue ou à égalité. Sinon un push
 * accompagné d'un pari annexe perdu s'affichait « Perdu ».
 */
function mainHandsNet(me) {
  return me.hands.reduce((n, h) => {
    if (h.result === 'win') return n + h.bet;
    if (h.result === 'blackjack') return n + Math.floor(h.bet * 1.5);
    if (h.result === 'lose') return n - h.bet;
    return n;
  }, 0);
}

const signed = (v) => (v >= 0 ? `+${fmt.format(v)}` : `−${fmt.format(-v)}`);

function overallResult(me) {
  const main = mainHandsNet(me);
  const net = me.lastNet;
  // Les paris annexes et l'assurance n'ont qu'une ligne de bilan à part.
  const extra = net !== main ? `\nBilan de la manche : ${signed(net)} jetons` : '';
  if (me.hands.some((h) => h.result === 'blackjack')) {
    return {
      badge: ['blackjack', 'spade', 'Blackjack !'],
      msg: `BLACKJACK !\n${signed(main)} jetons (payé 3:2)${extra}`,
      cls: 'win',
    };
  }
  if (main > 0) return { badge: ['win', 'trophy', 'Gagné'], msg: `Bien joué !\n${signed(main)} jetons${extra}`, cls: 'win' };
  if (main < 0) return { badge: ['lose', 'trendDown', 'Perdu'], msg: `Perdu…\n${signed(main)} jetons${extra}`, cls: 'lose' };
  return { badge: ['push', 'check', 'Égalité'], msg: `Égalité (push).\nTa mise est rendue.${extra}`, cls: '' };
}

const SIDE_HELP = {
  pairs: 'Tes 2 premières cartes font une paire : mixte 6:1 · même couleur 12:1 · parfaite 25:1.',
  trio: 'Tes 2 cartes + la carte visible du croupier : couleur 5:1 · suite 10:1 · brelan 30:1 · quinte flush 40:1 · brelan couleur 100:1.',
};

function renderBet(me) {
  if (!me) return;
  const total = pendingTotal();
  els.betSpots.querySelectorAll('[data-spot]').forEach((btn) => {
    const key = btn.dataset.spot;
    btn.classList.toggle('selected', key === betSpot);
    btn.classList.toggle('filled', pending[key] > 0);
    btn.querySelector('.spot-amount').textContent = fmt.format(pending[key]);
  });
  els.sideHelp.hidden = betSpot === 'main';
  if (betSpot !== 'main') els.sideHelp.textContent = SIDE_HELP[betSpot];
  els.betAmount.textContent = fmt.format(total);
  els.betConfirm.disabled = pending.main < state.minBet;
  els.betConfirm.textContent = pending.main >= state.minBet ? `Miser ${fmt.format(total)}` : `Min. ${state.minBet}`;
  // Le solde ne bouge pas pendant qu'on prépare sa mise : les jetons restent stables.
  syncChips('.chip[data-chip]', 'chip', me.balance);
  document.querySelectorAll('.chip[data-chip]').forEach((chip) => {
    const val = Number(chip.dataset.chip);
    chip.disabled = total + val > me.balance ||
      (betSpot !== 'main' && pending[betSpot] + val > pending.main);
  });
  const atMax = pending.main === me.balance && me.balance >= state.minBet;
  els.betAllin.disabled = me.balance < state.minBet || pending.main === me.balance;
  els.betAllinLabel.textContent = atMax ? 'All-in' : `All-in (${fmt.format(me.balance)})`;

  const canRebet = !!lastBet && lastBet.main >= state.minBet;
  els.betRebet.hidden = !canRebet;
  els.betActions.classList.toggle('with-rebet', canRebet);
  if (canRebet) {
    els.betRebet.disabled = betTotal(lastBet) > me.balance;
    els.betRebetLabel.textContent = `Remiser ${fmt.format(betTotal(lastBet))}`;
  }
}

function renderHands(me) {
  // Paris annexes affichés à côté de la mise de la première main.
  const sideHtml = sideTagsHtml(me);
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
          <span class="hand-side"></span>
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
    const sideEl = box.querySelector('.hand-side');
    const sideFor = i === 0 ? sideHtml : '';
    sideEl.hidden = !sideFor;
    if (sideEl.innerHTML !== sideFor) sideEl.innerHTML = sideFor;
    const sb = box.querySelector('.hand-status');
    if (h.status === 'bust' || h.status === 'blackjack' || (state.phase === 'results' && h.result)) {
      const map = {
        bust: ['bust', 'burst', 'Bust'],
        blackjack: ['blackjack', 'spade', 'BJ'],
        win: ['win', 'trophy', 'Gagné'],
        lose: ['lose', 'trendDown', 'Perdu'],
        push: ['push', 'check', 'Push'],
      };
      const key = state.phase === 'results' && h.result ? h.result : h.status;
      const [cls, ico, txt] = map[key] || ['waiting', 'clock', ''];
      sb.hidden = false;
      sb.className = `badge hand-status ${cls}`;
      setLabel(sb, ico, txt);
    } else {
      sb.hidden = true;
    }
  });

}

/* ------------------ la table : croupier + autres joueurs ------------------ */

const otherEls = new Map(); // playerId -> élément de rangée

/** @returns {[string, string, string]} [classe CSS, icône, libellé] */
function otherStatusBadge(p) {
  if (!p.connected) return ['waiting', 'unplug', 'Déco.'];
  if (state.phase === 'betting') {
    if (p.betPlaced) return ['betting', 'check', 'A misé'];
    return p.balance < state.minBet ? ['lose', 'chip', 'À sec'] : ['betting', 'chips', 'Mise…'];
  }
  if (p.isTurn) return ['turn', 'target', 'Joue'];
  if (state.phase === 'insurance' && p.inRound) {
    if (!p.insuranceDecided) return ['betting', 'shield', 'Décide…'];
    return p.insuranceBet > 0 ? ['betting', 'shield', 'Assuré'] : ['waiting', 'cross', 'Non assuré'];
  }
  if (state.phase === 'results' && p.inRound) {
    const map = {
      win: ['win', 'trophy', 'Gagné'],
      lose: ['lose', 'trendDown', 'Perdu'],
      push: ['push', 'check', 'Push'],
      blackjack: ['blackjack', 'spade', 'BJ 3:2'],
    };
    return map[p.hands[0] && p.hands[0].result] || ['push', 'check', '—'];
  }
  if (!p.inRound) return ['waiting', 'clock', 'Attend'];
  const st = p.hands.map((h) => h.status);
  if (st.every((s) => s === 'blackjack')) return ['blackjack', 'spade', 'BJ'];
  if (st.every((s) => s === 'bust')) return ['bust', 'burst', 'Bust'];
  if (st.every((s) => s !== 'playing' && s !== 'waiting')) return ['stand', 'stand', 'Stand'];
  return ['waiting', 'clock', 'Attend'];
}

function renderTable(me) {
  // En mode « tous sur un écran », l'écran commun affiche déjà le croupier
  // et les autres joueurs — pas besoin de dupliquer sur les téléphones.
  const show = phoneUiEnabled() &&
    (state.dealer.cards.length > 0 || state.players.length > 1);
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
          <i class="chef-crown t-crown" data-icon="crown" hidden></i>
          <span class="t-name"></span>
          <span class="total-pill" hidden></span>
          <span class="badge"></span>
        </div>
        <div class="hand mini"></div>`;
      els.tOthers.appendChild(row);
      otherEls.set(p.id, row);
      hydrateIcons(row);
    }
    const av = row.querySelector('.t-avatar');
    av.innerHTML = avatarHtml(p.avatar);
    av.style.setProperty('--p-color', p.color);
    row.querySelector('.t-crown').hidden = p.id !== state.hostPlayerId;
    row.querySelector('.t-name').textContent = p.name;

    // Le pré-choix des autres joueurs n'est volontairement pas affiché :
    // le serveur ne le transmet qu'à son auteur.
    const [cls, ico, txt] = otherStatusBadge(p);
    const badge = row.querySelector('.badge');
    badge.className = `badge ${cls}`;
    setLabel(badge, ico, txt);

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

  // Paris annexes réglés à la distribution.
  if (me.sideResults && !prevMe.sideResults) {
    const won = Object.entries(me.sideResults).filter(([, r]) => r.win > 0);
    if (won.length) {
      const gain = won.reduce((n, [, r]) => n + r.win, 0);
      showToast(`${won.map(([, r]) => `${r.label} ×${r.mult}`).join(' + ')} : +${fmt.format(gain)} jetons !`, 'win');
      sfx.blackjack();
      burstConfetti(60);
      if (navigator.vibrate) navigator.vibrate([60, 40, 60, 40, 120]);
    }
  }

  const hadResult = prevMe.hands.some((h) => h.result);
  const hasResult = me.hands.some((h) => h.result);
  if (hasResult && !hadResult) {
    const main = mainHandsNet(me);
    if (main > 0) {
      me.hands.some((h) => h.result === 'blackjack') ? null : sfx.win();
      burstConfetti(45);
    } else if (main < 0) {
      sfx.lose();
    } else {
      sfx.push();
    }
  }
}

/* ------------------------------ timer (rAF) ------------------------------ */

const INSURANCE_DURATION_MS = 12000;

function tick() {
  const me = findMe();
  let endsAt = null;
  let duration = 30000;
  if (state && me) {
    if (state.phase === 'betting' && !me.betPlaced && state.betEndsAt &&
        me.balance >= (state.minBet || 10)) endsAt = state.betEndsAt;
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

  if (state && me && state.phase === 'insurance' && me.inRound && state.insuranceEndsAt) {
    const rem = clock.remaining(state.insuranceEndsAt);
    els.insuranceTimerFill.style.width = `${(rem / INSURANCE_DURATION_MS) * 100}%`;
  }

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* --------------------------------- toast --------------------------------- */

let toastTimer = null;
function showToast(message, kind = '') {
  els.toast.textContent = message || 'Action impossible.';
  els.toast.className = `toast ${kind}`;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 2600);
}
