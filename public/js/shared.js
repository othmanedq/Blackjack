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
