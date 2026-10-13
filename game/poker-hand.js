'use strict';

/**
 * Évaluation des mains de poker : meilleure combinaison de 5 cartes parmi
 * 5 à 7 (Texas Hold'em : 2 cartes privées + 5 communes).
 *
 * Une main évaluée est un tableau de nombres comparable dans l'ordre
 * lexicographique : [catégorie, départage 1, départage 2, …].
 * Plus grand = meilleur.
 */

const CATEGORY = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
};

const CATEGORY_LABELS = [
  'Carte haute', 'Paire', 'Double paire', 'Brelan', 'Quinte',
  'Couleur', 'Full', 'Carré', 'Quinte flush',
];

const RANK_VALUE = {
  2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14,
};

const RANK_NAMES = {
  2: 'deux', 3: 'trois', 4: 'quatre', 5: 'cinq', 6: 'six', 7: 'sept', 8: 'huit',
  9: 'neuf', 10: 'dix', 11: 'valet', 12: 'dame', 13: 'roi', 14: 'as',
};

/** Hauteur d'une quinte (5 pour A-2-3-4-5), ou 0 si ce n'est pas une quinte. */
function straightHigh(values) {
  const uniq = [...new Set(values)].sort((a, b) => b - a);
  if (uniq.length !== 5) return 0;
  if (uniq[0] - uniq[4] === 4) return uniq[0];
  // La « roue » : l'As compte pour 1.
  if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) return 5;
  return 0;
}

/** Évalue exactement 5 cartes. */
function evaluateFive(cards) {
  const values = cards.map((c) => RANK_VALUE[c.rank]);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const high = straightHigh(values);

  // Groupes de valeurs, triés par taille puis par valeur (ex. full : brelan d'abord).
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const ordered = groups.map(([v]) => v);
  const sizes = groups.map(([, n]) => n);

  if (high && flush) return [CATEGORY.STRAIGHT_FLUSH, high];
  if (sizes[0] === 4) return [CATEGORY.QUADS, ...ordered];
  if (sizes[0] === 3 && sizes[1] === 2) return [CATEGORY.FULL_HOUSE, ...ordered];
  if (flush) return [CATEGORY.FLUSH, ...values.slice().sort((a, b) => b - a)];
  if (high) return [CATEGORY.STRAIGHT, high];
  if (sizes[0] === 3) return [CATEGORY.TRIPS, ...ordered];
  if (sizes[0] === 2 && sizes[1] === 2) return [CATEGORY.TWO_PAIR, ...ordered];
  if (sizes[0] === 2) return [CATEGORY.PAIR, ...ordered];
  return [CATEGORY.HIGH_CARD, ...ordered];
}

/** Compare deux mains évaluées : > 0 si a gagne, < 0 si b gagne, 0 si égalité. */
function compareHands(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Toutes les combinaisons de k éléments (21 pour 5 parmi 7). */
function combinations(items, k) {
  const out = [];
  const pick = (start, acc) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i <= items.length - (k - acc.length); i++) {
      acc.push(items[i]);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}

/**
 * Meilleure main de 5 cartes parmi celles fournies (5 à 7).
 * @returns {{ score: number[], cards: object[], label: string }}
 */
function bestHand(cards) {
  if (cards.length < 5) throw new Error('Il faut au moins 5 cartes.');
  let best = null;
  for (const five of combinations(cards, 5)) {
    const score = evaluateFive(five);
    if (!best || compareHands(score, best.score) > 0) best = { score, cards: five };
  }
  best.label = describeHand(best.score);
  return best;
}

/** Libellé lisible : « Full aux dames par les huit », « Quinte au valet »… */
function describeHand(score) {
  const [cat, a, b] = score;
  const n = (v) => RANK_NAMES[v];
  // Pluriel : les chiffres sont invariables (« par les huit »), l'as aussi ;
  // seules les figures prennent un s (valets, dames, rois).
  const plural = (v) => (v >= 11 && v <= 13 ? `${n(v)}s` : n(v));
  switch (cat) {
    case CATEGORY.STRAIGHT_FLUSH: return a === 14 ? 'Quinte flush royale' : `Quinte flush au ${n(a)}`;
    case CATEGORY.QUADS: return `Carré de ${plural(a)}`;
    case CATEGORY.FULL_HOUSE: return `Full aux ${plural(a)} par les ${plural(b)}`;
    case CATEGORY.FLUSH: return `Couleur au ${n(a)}`;
    case CATEGORY.STRAIGHT: return `Quinte au ${n(a)}`;
    case CATEGORY.TRIPS: return `Brelan de ${plural(a)}`;
    case CATEGORY.TWO_PAIR: return `Double paire ${plural(a)} et ${plural(b)}`;
    case CATEGORY.PAIR: return `Paire de ${plural(a)}`;
    default: return `Carte haute ${n(a)}`;
  }
}

module.exports = {
  CATEGORY, CATEGORY_LABELS, RANK_VALUE, evaluateFive, compareHands, bestHand, describeHand, combinations,
};
