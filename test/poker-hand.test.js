'use strict';

/* Tests de l'évaluation des mains de poker. */

const assert = require('assert');
const { bestHand, compareHands, CATEGORY, evaluateFive } = require('../game/poker-hand');

// « Ah Kd 10c » → cartes ; S = ♠, H = ♥, D = ♦, C = ♣.
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const cards = (str) => str.split(/\s+/).map((t, i) => ({
  rank: t.slice(0, -1).toUpperCase().replace('T', '10'),
  suit: SUIT[t.slice(-1).toUpperCase()],
  id: `t${i}-${t}`,
}));
const best = (str) => bestHand(cards(str));
const cmp = (a, b) => Math.sign(compareHands(best(a).score, best(b).score));

// Catégories
assert.strictEqual(best('Ah Kh Qh Jh Th 2c 3d').score[0], CATEGORY.STRAIGHT_FLUSH);
assert.strictEqual(best('Ah Kh Qh Jh Th 2c 3d').label, 'Quinte flush royale');
assert.strictEqual(best('9s 9h 9d 9c 2h 3d 4c').label, 'Carré de neuf');
assert.strictEqual(best('Qs Qh Qd 8c 8h 2d 3c').label, 'Full aux dames par les huit');
assert.strictEqual(best('2h 7h 9h Jh Kh 3c 4d').score[0], CATEGORY.FLUSH);
assert.strictEqual(best('5s 6h 7d 8c 9h 2d 2c').label, 'Quinte au neuf');
assert.strictEqual(best('As 2h 3d 4c 5h Kd Qc').label, 'Quinte au cinq', 'la roue : As compte pour 1');
assert.strictEqual(best('As Kh Qd Jc Th 2d 3c').label, 'Quinte au as');
assert.strictEqual(best('Ks Ah 2d 3c 4h 9d 8c').score[0], CATEGORY.HIGH_CARD, 'pas de quinte « tournante » K-A-2-3-4');
assert.strictEqual(best('7s 7h 7d Kc 2h 4d 9c').label, 'Brelan de sept');
assert.strictEqual(best('As Ah 6d 6c 2h 4d 9c').label, 'Double paire as et six');
assert.strictEqual(best('3s 3h Kd 9c 7h 4d 2c').label, 'Paire de trois');
assert.strictEqual(best('As Jh 9d 7c 5h 3d 2c').label, 'Carte haute as');
console.log('✓ poker : catégories et libellés');

// Départages
assert.strictEqual(cmp('As Ah Kd 7c 5h 3d 2c', 'Ad Ac Qd 7s 5c 3h 2d'), 1, 'paire d’as : le kicker roi bat la dame');
assert.strictEqual(cmp('Ks Kh 9d 9c 2h 3d 4c', 'Kd Kc 9s 9h 5d 3h 4d'), -1, 'double paire identique : la 5e carte (5 > 4) départage');
assert.strictEqual(cmp('6s 7h 8d 9c Th 2d 2c', '5s 6h 7d 8c 9h Ad Ac'), 1, 'quinte au 10 > quinte au 9');
assert.strictEqual(cmp('As 2h 3d 4c 5h Kd Kc', '2s 3h 4d 5c 6h Ad Ac'), -1, 'la roue est la plus petite quinte');
assert.strictEqual(cmp('Ah 9h 7h 5h 3h Kc Qd', 'Ad 9d 7d 5d 2d Kh Qc'), 1, 'couleur : on compare carte par carte');
assert.strictEqual(cmp('Qs Qh Qd 2c 2h 9d 8c', 'Js Jh Jd Ac Ah 9h 8d'), 1, 'full : le brelan décide d’abord');
assert.strictEqual(cmp('Ts Th 5d 5c Kh Qd 2c', 'Td Tc 5s 5h Kd Qh 3c'), 0, 'même main jouée : partage');
// Board qui joue : les deux joueurs partagent.
assert.strictEqual(cmp('2c 3d As Ks Qs Js Ts', '4h 5h As Ks Qs Js Ts'), 0, 'quinte flush royale au tableau : partage');
console.log('✓ poker : départages et partages');

// La meilleure combinaison est bien trouvée parmi 7 cartes
const r = best('2h 2d 2s Kh Kd 9h 3h');
assert.strictEqual(r.score[0], CATEGORY.FULL_HOUSE);
assert.strictEqual(r.cards.length, 5);
assert.strictEqual(evaluateFive(cards('2h 3h 4h 5h 6h'))[0], CATEGORY.STRAIGHT_FLUSH);
console.log('✓ poker : meilleure main parmi 7 cartes');

// Contrôle de cohérence : fréquences des catégories sur 5 cartes (dénombrement exact).
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const deck = [];
for (const s of Object.values(SUIT)) for (const rk of RANKS) deck.push({ rank: rk, suit: s });
const freq = new Array(9).fill(0);
const n = deck.length;
for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
  for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++)
    freq[evaluateFive([deck[a], deck[b], deck[c], deck[d], deck[e]])[0]]++;
// Valeurs de référence : 2 598 960 mains de 5 cartes.
assert.deepStrictEqual(freq, [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
console.log('✓ poker : fréquences exactes des 2 598 960 mains de 5 cartes');
