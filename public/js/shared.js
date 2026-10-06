'use strict';

/* Utilitaires partagés : rendu des cartes, horloge serveur, sons WebAudio. */

const RED_SUITS = new Set(['♥', '♦']);

/**
 * Construit l'élément DOM d'une carte.
 * @param {{rank?:string, suit?:string, hidden?:boolean, id:string}} card
 * @param {number} index — position dans la main (décalage d'animation)
 * @param {boolean} isNew — anime la distribution (slide + flip 3D)
 */
function renderCard(card, index, isNew) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.cardId = card.id;
  el.style.setProperty('--i', String(index));
  if (isNew) el.classList.add('dealt');
  if (card.hidden) {
    el.classList.add('facedown');
    el.innerHTML = `
      <div class="card-inner">
        <div class="card-face card-front"></div>
        <div class="card-face card-back"></div>
      </div>`;
    return el;
  }
  if (RED_SUITS.has(card.suit)) el.classList.add('red');
  const corner = `${card.rank}<br>${card.suit}`;
  el.innerHTML = `
    <div class="card-inner">
      <div class="card-face card-front">
        <span class="corner top">${corner}</span>
        <span class="pip">${card.suit}</span>
        <span class="corner bottom">${corner}</span>
      </div>
      <div class="card-face card-back"></div>
    </div>`;
  return el;
}

/**
 * Met à jour un conteneur de main en ne recréant que les nouvelles cartes,
 * pour que les animations de distribution ne rejouent pas à chaque état.
 */
function syncHand(container, cards, { animate = true } = {}) {
  const existing = new Map(
    [...container.children].map((el) => [el.dataset.cardId, el])
  );
  const wanted = new Set(cards.map((c) => c.id));
  for (const [id, el] of existing) {
    if (!wanted.has(id)) el.remove();
  }
  let added = 0;
  cards.forEach((card, i) => {
    const el = existing.get(card.id);
    if (el) {
      // La carte cachée du croupier se retourne au moment de la révélation.
      if (!card.hidden && el.classList.contains('facedown')) {
        el.replaceWith(renderCard(card, i, false));
      }
      return;
    }
    container.appendChild(renderCard(card, i, animate));
    added++;
  });
  return added;
}

/* --------- Horloge : compense l'écart entre l'horloge du serveur et la nôtre */
const clock = {
  offset: 0,
  sync(serverNow) {
    if (typeof serverNow === 'number') this.offset = serverNow - Date.now();
  },
  now() {
    return Date.now() + this.offset;
  },
  remaining(endsAt) {
    if (!endsAt) return 0;
    return Math.max(0, endsAt - this.now());
  },
};

/* ----------------------- Confettis (blackjack, victoire) ------------------ */
function burstConfetti(count = 90) {
  const colors = ['#f3d878', '#d4af37', '#fdfbf4', '#3ddc84', '#b3273a'];
  for (let i = 0; i < count; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.6 + Math.random() * 1.6 + 's';
    c.style.animationDelay = Math.random() * 0.35 + 's';
    c.style.transform = `scale(${0.6 + Math.random()})`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3800);
  }
}

/* ------------------- Feedback sonore (WebAudio, sans fichiers) ------------ */
const sfx = (() => {
  let ctx = null;
  let muted = JSON.parse(localStorage.getItem('bj_muted') || 'false');

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, { dur = 0.1, type = 'sine', gain = 0.16, when = 0, slide = 0 } = {}) {
    const ac = ensure();
    if (!ac || muted) return;
    const t = ac.currentTime + when;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  return {
    unlock: ensure,
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      localStorage.setItem('bj_muted', JSON.stringify(muted));
      return muted;
    },
    card()  { tone(2600, { dur: 0.05, type: 'triangle', gain: 0.10, slide: -1400 }); },
    chip()  { tone(1500, { dur: 0.06, type: 'square', gain: 0.07 }); tone(1900, { dur: 0.05, type: 'square', gain: 0.06, when: 0.05 }); },
    click() { tone(900, { dur: 0.05, type: 'triangle', gain: 0.09 }); },
    win()   { [523, 659, 784, 1047].forEach((f, i) => tone(f, { dur: 0.16, type: 'triangle', gain: 0.14, when: i * 0.09 })); },
    blackjack() { [659, 784, 988, 1319, 1568].forEach((f, i) => tone(f, { dur: 0.2, type: 'triangle', gain: 0.15, when: i * 0.08 })); },
    lose()  { tone(300, { dur: 0.28, type: 'sawtooth', gain: 0.08, slide: -160 }); },
    push()  { tone(600, { dur: 0.12, type: 'sine', gain: 0.1 }); },
    turn()  { tone(880, { dur: 0.09, type: 'sine', gain: 0.12 }); tone(1175, { dur: 0.12, type: 'sine', gain: 0.12, when: 0.1 }); },
  };
})();

const fmt = new Intl.NumberFormat('fr-FR');

/* ------------------- Visages : réactions et croupier ------------------- */

// Même liste que REACTIONS dans server.js (ordre d'affichage du sélecteur).
const FACES = ['laughing', 'cool', 'smirk', 'shocked', 'crossed', 'sad', 'angry', 'neutral'];
const faceSrc = (face) => `/asset/face-${face}.webp`;
// Préchargement : un changement d'humeur ne doit pas clignoter.
FACES.forEach((f) => { new Image().src = faceSrc(f); });

/**
 * Bulle de réaction posée sur `anchor` (qui doit être en position relative).
 * Une nouvelle réaction remplace la précédente au lieu de s'empiler.
 */
function showReactionBubble(anchor, face) {
  if (!anchor || !FACES.includes(face)) return;
  const old = anchor.querySelector(':scope > .reaction-bubble');
  if (old) old.remove();
  const b = document.createElement('img');
  b.className = 'reaction-bubble';
  b.src = faceSrc(face);
  b.alt = '';
  anchor.appendChild(b);
  setTimeout(() => b.remove(), 2800);
}

/** Humeur de fond du croupier, déduite de l'état de la manche. */
function dealerBaseMood(s) {
  switch (s.phase) {
    case 'betting':
    case 'insurance':
      return 'smirk';
    case 'playing':
      return 'crossed';
    case 'dealer':
      return s.dealer.total >= 17 && !s.dealer.bust ? 'cool' : 'neutral';
    case 'results': {
      if (s.dealer.blackjack) return 'cool';
      if (s.dealer.bust) return 'angry';
      // Bilan de la maison : ce que les joueurs ont gagné, elle l'a perdu.
      const playersNet = s.players.reduce((n, p) => n + (p.inRound ? p.lastNet : 0), 0);
      if (playersNet > 0) return 'sad';
      if (playersNet < 0) return 'laughing';
      return 'neutral';
    }
    default:
      return 'neutral';
  }
}

/**
 * Visage du croupier : humeur de fond + réactions brèves aux coups marquants
 * (un joueur saute → il rit, un blackjack ou un pari annexe gagnant → il est choqué).
 * @param {HTMLImageElement[]} imgs — toutes les images à tenir à jour
 */
function createDealerFace(imgs) {
  let flash = null;
  let flashTimer = null;
  let current = null;
  let last = null;

  function show(face) {
    if (face === current) return;
    current = face;
    for (const img of imgs) {
      if (!img) continue;
      img.src = faceSrc(face);
      img.classList.remove('face-pop');
      void img.offsetWidth;
      img.classList.add('face-pop');
    }
  }

  function detectFlash(s, prev) {
    if (!prev || prev.roundNumber !== s.roundNumber) return null;
    const before = new Map(prev.players.map((p) => [p.id, p]));
    let face = null;
    for (const p of s.players) {
      const b = before.get(p.id);
      if (!b) continue;
      p.hands.forEach((h, i) => {
        const was = b.hands[i] && b.hands[i].status;
        if (h.status === 'bust' && was !== 'bust') face = face || 'laughing';
        if (h.status === 'blackjack' && was !== 'blackjack') face = 'shocked';
      });
      const sideWin = p.sideResults && Object.values(p.sideResults).some((r) => r.win > 0);
      if (sideWin && !b.sideResults) face = 'shocked';
    }
    return face;
  }

  return {
    update(s) {
      const f = detectFlash(s, last);
      last = s;
      if (f) {
        flash = f;
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { flash = null; if (last) show(dealerBaseMood(last)); }, 2200);
      }
      show(flash || dealerBaseMood(s));
    },
  };
}

/** Badges des paris annexes réglés d'un joueur (HTML sûr : libellés fixes). */
const SIDE_NAMES = { pairs: 'Paires', trio: '21+3' };
function sideTagsHtml(p) {
  if (!p.sideResults) {
    // Pas encore distribué : on montre simplement les paris posés.
    return Object.entries(p.sideBets || {}).filter(([, v]) => v > 0)
      .map(([key, v]) => `<span class="side-tag">${SIDE_NAMES[key]} ${fmt.format(v)}</span>`).join('');
  }
  return Object.entries(p.sideResults).map(([key, r]) => (r.win > 0
    ? `<span class="side-tag won" title="${r.label}">${iconHtml('sparkle')} ${SIDE_NAMES[key]} ×${r.mult} +${fmt.format(r.win)}</span>`
    : `<span class="side-tag lost">${SIDE_NAMES[key]} −${fmt.format(-r.win)}</span>`)).join('');
}

/* -------------------- Jetons : valeurs et couleurs de casino -------------------- */
const CHIP_LADDER = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000];
const CHIP_COLORS = {
  10: '#2471a3', 25: '#1e8449', 50: '#b03a2e', 100: '#1c2833', 250: '#c2185b',
  500: '#7d3c98', 1000: '#b7950b', 2500: '#d35400', 5000: '#5d6d7e', 10000: '#117a65',
  25000: '#922b21', 50000: '#1a5276', 100000: '#6c3483', 250000: '#9a7d0a', 500000: '#212f3c',
};
