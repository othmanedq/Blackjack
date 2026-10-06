'use strict';

/* Vue Table (hôte) : affichage principal, croupier, sièges, QR code, timers. */

const socket = io();

const els = {
  roundMeta: document.getElementById('round-meta'),
  shoeMeta: document.getElementById('shoe-meta'),
  joinPanel: document.getElementById('join-panel'),
  qrImg: document.getElementById('qr-img'),
  joinUrl: document.getElementById('join-url'),
  startBtn: document.getElementById('start-btn'),
  modeBox: document.getElementById('mode-box'),
  hostModeOptions: document.getElementById('host-mode-options'),
  stakeBox: document.getElementById('stake-box'),
  stakeSelect: document.getElementById('stake-select'),
  toast: document.getElementById('toast'),
  collapseBtn: document.getElementById('collapse-btn'),
  expandBtn: document.getElementById('expand-btn'),
  muteBtn: document.getElementById('mute-btn'),
  muteIcon: document.getElementById('mute-icon'),
  startBtnLabel: document.getElementById('start-btn-label'),
  table: document.getElementById('table'),
};

let state = null;
let prevState = null;

const tableView = createTableView(els.table, { phaseMessage });
const dealerFace = createDealerFace([tableView.faceImg]);

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
  dealerFace.update(s);
  playTransitionEffects();
});

socket.on('reaction', ({ playerId, face } = {}) => {
  showReactionBubble(tableView.plateOf(playerId), face);
});

els.startBtn.addEventListener('click', () => {
  sfx.unlock();
  sfx.click();
  socket.emit('host:newRound');
});
els.stakeSelect.addEventListener('change', () => {
  sfx.chip();
  socket.emit('host:setStartingBalance', { amount: Number(els.stakeSelect.value) });
});
els.hostModeOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  sfx.click();
  socket.emit('host:setGameMode', { mode: btn.dataset.mode });
});
socket.on('game:error', ({ message }) => {
  console.warn('Erreur de jeu :', message);
  showToast(message);
});

let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message || 'Action impossible.';
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 3200);
}
els.collapseBtn.addEventListener('click', () => setPanel('hidden'));
els.expandBtn.addEventListener('click', () => setPanel('visible'));
function renderMuteIcon() {
  setIcon(els.muteIcon, sfx.muted ? 'soundOff' : 'soundOn');
  els.muteBtn.setAttribute('aria-label', sfx.muted ? 'Rétablir le son' : 'Couper le son');
}
els.muteBtn.addEventListener('click', () => {
  sfx.toggleMute();
  renderMuteIcon();
});
renderMuteIcon();
document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

let panelMode = 'auto'; // auto | hidden | visible
function setPanel(mode) {
  panelMode = mode;
  render();
}

// [icône, texte] — l'icône est rendue en SVG devant le message.
const PHASE_MSGS = {
  lobby: ['qr', 'En attente de joueurs… Scannez le QR code pour rejoindre'],
  betting: ['chips', 'Faites vos jeux !'],
  dealer: ['cards', 'Le croupier joue…'],
};

/** Message imprimé au centre de la table : [icône, texte]. */
function phaseMessage(s) {
  const current = s.current && s.players.find((p) => p.id === s.current.playerId);
  if (s.phase === 'playing' && current) {
    const handNote = current.hands.length > 1 ? ` (main ${s.current.handIndex + 1})` : '';
    return ['target', `${current.name}${handNote}, à toi de jouer !`];
  }
  if (s.phase === 'insurance') {
    const inRound = s.players.filter((p) => p.inRound);
    const decided = inRound.filter((p) => p.insuranceDecided).length;
    return ['shield', `Le croupier montre un As — assurance (${decided}/${inRound.length})`];
  }
  if (s.rebuyRequest) {
    const r = s.rebuyRequest;
    return ['chipPlus', `${r.playerName} demande une re-cave — ${r.approved}/${r.total} ont accepté`];
  }
  if (s.phase === 'results') return ['flag', 'Manche terminée — les mises rouvrent dans un instant…'];
  return PHASE_MSGS[s.phase] || null;
}

function render() {
  if (!state) return;

  els.roundMeta.textContent = state.roundNumber ? `Manche ${state.roundNumber}` : 'Manche —';
  els.shoeMeta.textContent = `Sabot : ${state.shoeCount} cartes`;

  tableView.render(state);

  // --- panneau rejoindre / bouton manche
  const needsMode = state.roundNumber === 0 && !state.mode;
  const canStart =
    state.players.length > 0 && !needsMode &&
    (state.phase === 'lobby' || state.phase === 'results');
  els.startBtn.disabled = !canStart;
  els.startBtnLabel.textContent = state.roundNumber ? 'Nouvelle manche' : 'Lancer la manche';

  // Mode de jeu + cave de départ : réglables uniquement avant la 1ère manche.
  els.modeBox.hidden = !state.canConfigure;
  if (state.canConfigure) {
    els.hostModeOptions.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.classList.toggle('selected', btn.dataset.mode === state.mode);
    });
  }
  els.stakeBox.hidden = !state.canConfigure;
  if (state.canConfigure && document.activeElement !== els.stakeSelect) {
    els.stakeSelect.value = String(state.startingBalance);
  }

  const isLobby = state.phase === 'lobby';
  let show;
  if (panelMode === 'visible') show = true;
  else if (panelMode === 'hidden') show = false;
  else show = isLobby; // auto : visible tant qu'on attend des joueurs
  els.joinPanel.classList.toggle('centered', show && isLobby && state.players.length === 0);
  els.joinPanel.classList.toggle('hidden', !show);
  els.expandBtn.hidden = show;
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
  tableView.glow(playerId);
}

function wompWomp(playerId, sound = true) {
  if (sound) sfx.lose();
  tableView.shake(playerId);
}
