'use strict';

/* Écran de la table de poker : la table, le QR code, les réglages et le fil du chat. */

const socket = io('/poker');

const els = {
  table: document.getElementById('table'),
  handMeta: document.getElementById('hand-meta'),
  blindsMeta: document.getElementById('blinds-meta'),
  joinPanel: document.getElementById('join-panel'),
  qrImg: document.getElementById('qr-img'),
  joinUrl: document.getElementById('join-url'),
  configBox: document.getElementById('config-box'),
  stackSelect: document.getElementById('stack-select'),
  blindsSelect: document.getElementById('blinds-select'),
  startBtn: document.getElementById('start-btn'),
  startLabel: document.getElementById('start-label'),
  collapseBtn: document.getElementById('collapse-btn'),
  expandBtn: document.getElementById('expand-btn'),
  muteBtn: document.getElementById('mute-btn'),
  muteIcon: document.getElementById('mute-icon'),
  rulesBtn: document.getElementById('rules-btn'),
  rules: document.getElementById('rules'),
  rulesBody: document.getElementById('rules-body'),
  rulesClose: document.getElementById('rules-close'),
  chatFeed: document.getElementById('chat-feed'),
  toast: document.getElementById('toast'),
};

let state = null;
let prev = null;
let panelMode = 'auto'; // auto | hidden | visible

const tableView = createPokerTableView(els.table, { phaseMessage });
els.table.style.setProperty('--table-max-h', 'calc(100vh - 78px)');

function phaseMessage(s) {
  if (s.phase === 'lobby') {
    return s.players.length < 2
      ? ['qr', 'En attente de joueurs… Scannez le QR code']
      : ['play', s.canConfigure ? 'Prêts ? Le chef de table lance la partie' : 'Il faut au moins 2 joueurs avec des jetons'];
  }
  const turn = s.players.find((p) => p.isTurn);
  if (turn) return ['target', `À ${turn.name} de parler`];
  if (s.phase === 'showdown' && s.results) {
    const winners = s.results.pots.flatMap((pot) => pot.winners.map((w) => w.id));
    const names = [...new Set(winners)].map((id) => (s.players.find((p) => p.id === id) || {}).name).filter(Boolean);
    const label = s.results.showdown && s.results.pots[0] ? ` — ${s.results.pots[0].label}` : '';
    return ['trophy', names.length ? `${names.join(' et ')} remporte${names.length > 1 ? 'nt' : ''} le pot${label}` : 'Main terminée'];
  }
  return null;
}

/* ------------------------------- connexion ------------------------------- */

socket.on('connect', () => socket.emit('host:register'));
socket.on('host:info', ({ url, qrDataUrl }) => {
  els.joinUrl.textContent = url;
  if (qrDataUrl) els.qrImg.src = qrDataUrl;
});

socket.on('state', (s) => {
  prev = state;
  state = s;
  clock.sync(s.serverNow);
  render();
  effects();
});

/* -------------------------------- réglages ------------------------------- */

els.startBtn.addEventListener('click', () => {
  sfx.unlock();
  sfx.click();
  socket.emit('host:start', (res) => res && !res.ok && showToast(res.message));
});
els.stackSelect.addEventListener('change', () => {
  socket.emit('host:configure', { stack: Number(els.stackSelect.value) }, (res) => res && !res.ok && showToast(res.message));
});
els.blindsSelect.addEventListener('change', () => {
  socket.emit('host:configure', { blinds: Number(els.blindsSelect.value) }, (res) => res && !res.ok && showToast(res.message));
});

els.collapseBtn.addEventListener('click', () => { panelMode = 'hidden'; render(); });
els.expandBtn.addEventListener('click', () => { panelMode = 'visible'; render(); });

function renderMuteIcon() {
  setIcon(els.muteIcon, sfx.muted ? 'soundOff' : 'soundOn');
}
els.muteBtn.addEventListener('click', () => { sfx.toggleMute(); renderMuteIcon(); });
renderMuteIcon();
document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

els.rulesBody.innerHTML = pokerRankingHtml();
els.rulesBtn.addEventListener('click', () => { els.rules.hidden = false; });
els.rulesClose.addEventListener('click', () => { els.rules.hidden = true; });
els.rules.addEventListener('click', (e) => { if (e.target === els.rules) els.rules.hidden = true; });

/* --------------------------------- rendu --------------------------------- */

function render() {
  if (!state) return;
  tableView.render(state);
  els.handMeta.textContent = state.handNumber ? `Main ${state.handNumber}` : 'Main —';
  els.blindsMeta.textContent = `Blindes ${state.smallBlind}/${state.bigBlind}`;

  els.configBox.hidden = !state.canConfigure;
  if (state.canConfigure) {
    if (!els.blindsSelect.options.length) {
      els.blindsSelect.innerHTML = state.blindLevels.map(([sb, bb], i) => `<option value="${i}">${sb} / ${bb}</option>`).join('');
    }
    if (document.activeElement !== els.stackSelect) els.stackSelect.value = String(state.startingStack);
    const level = state.blindLevels.findIndex(([sb, bb]) => sb === state.smallBlind && bb === state.bigBlind);
    if (document.activeElement !== els.blindsSelect && level >= 0) els.blindsSelect.value = String(level);
  }
  const seated = state.players.filter((p) => p.connected && p.stack > 0).length;
  els.startBtn.disabled = !(state.phase === 'lobby' && seated >= 2);
  els.startLabel.textContent = state.handNumber ? 'Relancer la partie' : 'Lancer la partie';

  const isLobby = state.phase === 'lobby';
  const show = panelMode === 'visible' || (panelMode === 'auto' && isLobby);
  els.joinPanel.classList.toggle('centered', show && isLobby && state.players.length === 0);
  els.joinPanel.classList.toggle('hidden', !show);
  els.expandBtn.hidden = show;
}

/* ------------------------------ sons, effets ------------------------------ */

function effects() {
  if (!prev) return;
  if (state.board.length > prev.board.length || state.handNumber !== prev.handNumber) sfx.card();
  const turn = state.players.find((p) => p.isTurn);
  const turnBefore = prev.players.find((p) => p.isTurn);
  if (turn && (!turnBefore || turn.id !== turnBefore.id)) sfx.turn();
  for (const p of state.players) {
    const b = prev.players.find((x) => x.id === p.id);
    if (b && p.bet > b.bet) sfx.chip();
  }
  if (state.phase === 'showdown' && prev.phase !== 'showdown') {
    sfx.win();
    if (state.results && state.results.showdown) burstConfetti(60);
  }
}

/* ------------------------------ chat, réactions ------------------------------ */

socket.on('chat:message', (m) => {
  const line = document.createElement('div');
  line.className = 'chat-line';
  line.innerHTML = `
    <span class="chat-avatar" style="--p-color:${esc(m.color)}">${avatarHtml(m.avatar)}</span>
    <span class="chat-name"></span><span class="chat-text"></span>`;
  line.querySelector('.chat-name').textContent = m.name;
  line.querySelector('.chat-text').textContent = m.text;
  els.chatFeed.appendChild(line);
  while (els.chatFeed.children.length > 6) els.chatFeed.firstElementChild.remove();
  setTimeout(() => line.classList.add('fade'), 14000);
  setTimeout(() => line.remove(), 14800);
  sfx.click();
});

socket.on('reaction', ({ playerId, face } = {}) => {
  showReactionBubble(tableView.plateOf(playerId), face);
});

let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message || 'Action impossible.';
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 3200);
}
