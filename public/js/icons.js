'use strict';

/**
 * Jeu d'icônes SVG inline — aucune dépendance, aucun chargement réseau,
 * rendu identique sur tous les appareils (contrairement aux emojis, dont le
 * dessin change d'un téléphone à l'autre).
 *
 * Usage :
 *  - HTML statique : <i data-icon="crown"></i> puis hydrateIcons() au chargement
 *  - Chaînes JS    : iconHtml('crown')
 *  - Élément vivant : setIcon(el, 'crown')
 *
 * Les icônes héritent de la couleur du texte (currentColor) et de sa taille
 * (1em), elles s'intègrent donc partout où un emoji se trouvait.
 */

const ICONS = {
  // --- actions de jeu
  hit: '<rect x="2.5" y="3.5" width="12" height="17" rx="2.5"/><path d="M18.5 12.5v7M15 16h7"/>',
  stand: '<path d="M8.6 2.8h6.8l5.8 5.8v6.8l-5.8 5.8H8.6l-5.8-5.8V8.6z"/><path d="M8 12h8"/>',
  double: '<circle cx="12" cy="12" r="8.5"/><path d="M12 16.5v-9M8.5 11l3.5-3.5 3.5 3.5"/>',
  split: '<rect x="2" y="5.5" width="8" height="13" rx="1.5"/><rect x="14" y="5.5" width="8" height="13" rx="1.5"/><path d="M12 2.5v19" stroke-dasharray="2.5 2.5"/>',
  allIn: '<path d="M5.5 15.5L12 9l6.5 6.5M5.5 10L12 3.5 18.5 10"/><path d="M5.5 20.5h13"/>',

  // --- jetons & argent
  chip: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2"/>',
  chips: '<ellipse cx="12" cy="6.5" rx="7.5" ry="3"/><path d="M4.5 6.5v5.2c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6.5"/><path d="M4.5 11.7v5.2c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-5.2"/>',
  chipPlus: '<circle cx="10" cy="11.5" r="7"/><circle cx="10" cy="11.5" r="2.4"/><path d="M18.8 15.6v6.2M15.7 18.7h6.2"/>',
  gift: '<rect x="3" y="8.6" width="18" height="12.4" rx="2"/><path d="M12 8.6V21M3 13.6h18"/><path d="M12 8.6S10.6 3 7.9 3a2.4 2.4 0 0 0 0 5.6zM12 8.6S13.4 3 16.1 3a2.4 2.4 0 0 1 0 5.6z"/>',
  userX: '<circle cx="9.5" cy="7.4" r="4"/><path d="M2.5 20.8c0-4 3.2-6.4 7-6.4.9 0 1.7.13 2.5.37"/><path d="M16.2 15.4l5.3 5.3M21.5 15.4l-5.3 5.3"/>',
  trendDown: '<path d="M3 7l6.6 6.6 3.6-3.6L21 17.6"/><path d="M14.6 17.6H21V11"/>',

  // --- cartes & croupier
  cards: '<rect x="2.6" y="6.6" width="9.6" height="13.8" rx="1.8" transform="rotate(-10 7.4 13.5)"/><rect x="11.8" y="3.6" width="9.6" height="13.8" rx="1.8" transform="rotate(9 16.6 10.5)"/>',
  shield: '<path d="M12 2.6l7.8 2.9v5.9c0 4.9-3.3 8.2-7.8 9.7-4.5-1.5-7.8-4.8-7.8-9.7V5.5z"/><path d="M8.8 11.9l2.4 2.4 4.2-4.6"/>',

  // --- états
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.4" class="i-solid"/>',
  burst: '<path d="M12 2l2.3 4.9 5-1.8-1.8 5 4.9 2.3-4.9 2.3 1.8 5-5-1.8L12 22l-2.3-4.9-5 1.8 1.8-5L1.8 12.4l4.9-2.3-1.8-5 5 1.8z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.6 2.1"/>',
  flag: '<path d="M5.5 21.5V3M5.5 3.8h13l-3 5.2 3 5.2h-13"/>',
  trophy: '<path d="M7 3.8h10v5.4a5 5 0 0 1-10 0z"/><path d="M7 5.8H4.4v2.1a3.1 3.1 0 0 0 3.1 3.1M17 5.8h2.6v2.1a3.1 3.1 0 0 1-3.1 3.1"/><path d="M12 14.2v4M8.4 20.6h7.2"/>',
  sparkle: '<path d="M10 2.6l1.7 4.8 4.8 1.7-4.8 1.7L10 15.6l-1.7-4.8L3.5 9.1l4.8-1.7z"/><path d="M17.8 14.2l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z"/>',
  seated: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.4l2.9 2.9 5.1-5.6"/>',
  check: '<path d="M4.5 12.5l5.5 5.5L19.5 6.5"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  eye: '<path d="M2 12s3.6-6.8 10-6.8S22 12 22 12s-3.6 6.8-10 6.8S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  arrowUp: '<path d="M12 20V5M5.6 11.4L12 5l6.4 6.4"/>',
  play: '<circle cx="12" cy="12" r="8.5"/><path d="M10 8.2l6 3.8-6 3.8z"/>',
  unplug: '<path d="M3 21l4.5-4.5M21 3l-4.5 4.5"/><path d="M9.5 9.5l5 5M12.7 6.3l5 5-2.5 2.5-5-5z" /><path d="M6.3 12.7l5 5-2.5 2.5-5-5z"/>',

  // --- écrans & réglages
  monitor: '<rect x="2.5" y="3.8" width="19" height="12.6" rx="2"/><path d="M8.5 20.4h7M12 16.4v4"/>',
  phone: '<rect x="6.8" y="2.5" width="10.4" height="19" rx="2.6"/><path d="M10.4 5.6h3.2"/><circle cx="12" cy="18" r="1.1" class="i-solid"/>',
  both: '<rect x="1.4" y="4.2" width="12.8" height="9.4" rx="1.8"/><path d="M5.2 17.6h5M7.8 13.6v4"/><rect x="16.4" y="9.4" width="6.2" height="12.2" rx="1.8"/>',
  soundOn: '<path d="M4 9.4h3.4L12.8 5v14l-5.4-4.4H4z"/><path d="M16.4 9.2a4 4 0 0 1 0 5.6M19.2 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  soundOff: '<path d="M4 9.4h3.4L12.8 5v14l-5.4-4.4H4z"/><path d="M16.6 9.6l5.4 5.4M22 9.6l-5.4 5.4"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><path d="M14 14h3v3h-3zM20 14h1M14 20h3M20 17v4"/>',

  // --- enseignes (avatars) : remplies, colorables
  spade: '<path class="i-solid" d="M12 2.6C9 6.7 4.4 9.2 4.4 13.3a4.6 4.6 0 0 0 6.7 4.1c-.3 1.8-1.2 2.9-2.6 3.6h7c-1.4-.7-2.3-1.8-2.6-3.6a4.6 4.6 0 0 0 6.7-4.1c0-4.1-4.6-6.6-7.6-10.7z"/>',
  heart: '<path class="i-solid" d="M12 21S3.4 15.2 3.4 9.3A4.8 4.8 0 0 1 12 6.4a4.8 4.8 0 0 1 8.6 2.9C20.6 15.2 12 21 12 21z"/>',
  diamond: '<path class="i-solid" d="M12 2.2L19.8 12 12 21.8 4.2 12z"/>',
  club: '<path class="i-solid" d="M12 3a3.9 3.9 0 0 1 2.9 6.5 3.9 3.9 0 1 1 2.2 6.9 3.9 3.9 0 0 1-3.6-2.4c.1 3.2.9 5 2.4 6H8.1c1.5-1 2.3-2.8 2.4-6a3.9 3.9 0 0 1-3.6 2.4 3.9 3.9 0 1 1 2.2-6.9A3.9 3.9 0 0 1 12 3z"/>',
  crown: '<path class="i-solid" d="M2.8 7.5l4.4 3.2L12 4.2l4.8 6.5 4.4-3.2-2 11.3H4.8z"/>',
  star: '<path class="i-solid" d="M12 2.8l2.8 6.1 6.7.7-5 4.5 1.4 6.5L12 17.3l-5.9 3.3 1.4-6.5-5-4.5 6.7-.7z"/>',
  bolt: '<path class="i-solid" d="M13.8 2L4 14.2h5.9L8.2 22 20 9.4h-6.4z"/>',
  gem: '<path class="i-solid" d="M6.4 3h11.2l4 6.2L12 21.6 2.4 9.2z"/>',
};

/** Avatars proposés dans le lobby (clés de ICONS). */
const AVATAR_ICONS = ['spade', 'heart', 'diamond', 'club', 'crown', 'star', 'bolt', 'gem'];

/** Balise <svg> complète pour une icône. Nom inconnu → chaîne vide. */
function iconHtml(name, extraClass = '') {
  const body = ICONS[name];
  if (!body) return '';
  const cls = extraClass ? `icon ${extraClass}` : 'icon';
  return (
    `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" ` +
    `fill="none" stroke="currentColor" stroke-width="1.7" ` +
    `stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  );
}

/**
 * Icône d'avatar. La clé vient du réseau : on ne rend que des icônes connues
 * (jamais la chaîne brute), donc aucune injection possible.
 */
function avatarHtml(key) {
  return iconHtml(AVATAR_ICONS.includes(key) ? key : 'spade', 'avatar-icon');
}

/** Remplace le contenu d'un élément par une icône. */
function setIcon(el, name, extraClass = '') {
  if (el) el.innerHTML = iconHtml(name, extraClass);
}

/** Icône + libellé texte, sans risque d'injection (le texte reste un nœud texte). */
function setLabel(el, name, text) {
  if (!el) return;
  el.innerHTML = iconHtml(name);
  if (text) el.appendChild(document.createTextNode(' ' + text));
}

/** Hydrate tous les <i data-icon="..."> présents dans le DOM. */
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const name = el.dataset.icon;
    if (el.dataset.iconDone === name) return; // déjà à jour
    el.innerHTML = iconHtml(name);
    el.dataset.iconDone = name;
  });
}

/** Échappe du texte destiné à innerHTML (pseudos venant du réseau). */
function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

document.addEventListener('DOMContentLoaded', () => hydrateIcons());
