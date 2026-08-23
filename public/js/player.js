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
  betConfirm: document.getElementById('bet-confirm'),
  betClear: document.getElementById('bet-clear'),
  betAllin: document.getElementById('bet-allin'),
  betAllinLabel: document.getElementById('bet-allin-label'),
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
  tableActions: document.getElementById('table-actions'),
  giveBtn: document.getElementById('give-btn'),
  kickBtn: document.getElementById('kick-btn'),
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
let joined = false;
let joining = false; // une inscription est en cours (évite un faux « exclu »)
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
  socket.emit('player:join', { token, ...profile, ignoreResume: !!opts.ignoreResume }, (res) => {
    joining = false;
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
  pendingBet = 0;
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

els.betAllin.addEventListener('click', () => {
  const me = findMe();
  if (!me || me.balance < state.minBet) return;
  pendingBet = me.balance;
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

els.betConfirm.addEventListener('click', () => {
  if (pendingBet <= 0) return;
  socket.emit('player:bet', { amount: pendingBet }, (res) => {
    if (!res.ok) return showToast(res.message);
    sfx.chip();
    pendingBet = 0;
  });
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

els.rebuyBody.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-rebuy]');
  if (!btn) return;
  sfx.click();
  const action = btn.dataset.rebuy;
  if (action === 'request') {
    socket.emit('player:requestRebuy', (res) => {
      if (res && !res.ok) showToast(res.message);
    });
  } else {
    socket.emit('player:voteRebuy', { accept: action === 'yes' }, (res) => {
      if (res && !res.ok) showToast(res.message);
    });
  }
});

// Re-cave refusée : on quitte la table, avec une identité neuve pour revenir.
socket.on('player:kicked', ({ message } = {}) => {
  // Identité neuve : on ne doit pas pouvoir revenir avec l'ancienne place.
  token = newToken();
  localStorage.setItem('bj_token', token);
  leaveToLobby(message || 'Tu as quitté la table.');
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

function renderRebuy(me) {
  const r = state.rebuyRequest;
  const isBroke = me.balance < state.minBet;
  let html = '';
  if (r && r.playerId === me.id) {
    html = `<p class="rebuy-text">Demande envoyée.<br>
      <strong>${r.approved}/${r.total}</strong> joueur(s) ont accepté — il faut l'unanimité.<br>
      <small>Un seul refus et tu quittes la table.</small></p>`;
  } else if (r && r.awaiting.includes(me.id)) {
    html = `<p class="rebuy-text"><strong>${esc(r.playerName)}</strong> n'a plus de jetons et demande
      une re-cave de <strong>${fmt.format(r.amount)}</strong>.<br>
      <small>Unanimité requise — un refus l'exclut de la table.</small></p>
      <div class="rebuy-actions">
        <button type="button" class="rebuy-yes" data-rebuy="yes">${iconHtml('check')} Accepter</button>
        <button type="button" class="rebuy-no" data-rebuy="no">${iconHtml('cross')} Refuser</button>
      </div>`;
  } else if (r) {
    html = `<p class="rebuy-text">Re-cave de <strong>${esc(r.playerName)}</strong> :
      ${r.approved}/${r.total} ont accepté…</p>`;
  } else if (isBroke && !me.inRound) {
    html = `<p class="rebuy-text">Plus de jetons.<br>Demande une re-cave aux autres joueurs,
      ou quitte la table.</p>
      <button type="button" class="cta rebuy-request" data-rebuy="request">
        ${iconHtml('chipPlus')} Demander une re-cave (${fmt.format(state.startingBalance)})
      </button>`;
  }
  els.rebuyPanel.hidden = !html;
  els.rebuyBody.innerHTML = html;
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
  showToast(`${fromName} t’a donné ${fmt.format(amount)} jetons !`);
  sfx.win();
  burstConfetti(30);
  if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
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

  const showHands = me.inRound && me.hands.length > 0 && me.hands[0].cards.length > 0;
  els.handsPanel.hidden = !showHands;
  if (showHands) renderHands(me);

  renderTable(me);

  // Chef de table : couronne + bouton pour lancer la manche depuis le téléphone
  // (uniquement en mode « chacun son écran » — en mode table, c'est l'écran
  // commun qui lance les manches).
  const isChef = state.hostPlayerId === me.id;
  els.meCrown.hidden = !isChef;
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
  prevMe = JSON.parse(JSON.stringify(me));
}

function statusBadge(me) {
  const statuses = me.hands.map((h) => h.status);
  if (statuses.every((s) => s === 'blackjack')) return ['blackjack', 'spade', 'Blackjack !'];
  if (statuses.every((s) => s === 'bust')) return ['bust', 'burst', 'Bust'];
  if (statuses.every((s) => s === 'stand' || s === 'bust' || s === 'blackjack')) return ['stand', 'stand', 'Stand'];
  return ['waiting', 'clock', 'En attente'];
}

function overallResult(me) {
  const net = me.lastNet;
  if (me.hands.some((h) => h.result === 'blackjack')) {
    return {
      badge: ['blackjack', 'spade', 'Blackjack !'],
      msg: `BLACKJACK !\n+${fmt.format(net)} jetons (payé 3:2)`,
      cls: 'win',
    };
  }
  if (net > 0) return { badge: ['win', 'trophy', 'Gagné'], msg: `Bien joué !\n+${fmt.format(net)} jetons`, cls: 'win' };
  if (net < 0) return { badge: ['lose', 'trendDown', 'Perdu'], msg: `Perdu…\n−${fmt.format(-net)} jetons`, cls: 'lose' };
  return { badge: ['push', 'check', 'Égalité'], msg: 'Égalité (push).\nTa mise est rendue.', cls: '' };
}

function renderBet(me) {
  if (!me) return;
  els.betAmount.textContent = fmt.format(pendingBet);
  els.betConfirm.disabled = pendingBet < state.minBet;
  els.betConfirm.textContent = pendingBet >= state.minBet ? `Miser ${fmt.format(pendingBet)}` : `Min. ${state.minBet}`;
  document.querySelectorAll('.chip[data-chip]').forEach((chip) => {
    chip.disabled = pendingBet + Number(chip.dataset.chip) > me.balance;
  });
  const atMax = pendingBet === me.balance && me.balance >= state.minBet;
  els.betAllin.disabled = me.balance < state.minBet || pendingBet === me.balance;
  els.betAllinLabel.textContent = atMax ? 'All-in' : `All-in (${fmt.format(me.balance)})`;
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
function showToast(message) {
  els.toast.textContent = message || 'Action impossible.';
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 2600);
}
