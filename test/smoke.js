'use strict';

/* Test de fumée : valeurs de mains + déroulé complet d'une manche à 2 joueurs. */

const assert = require('assert');
const { Game, handValue, isNaturalBlackjack, buildShoe } = require('../game/blackjack');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = (rank, suit = '♠') => ({ rank, suit, id: `t-${rank}${suit}-${Math.random()}` });

// ---------------------------------------------------------------- valeurs

assert.deepStrictEqual(handValue([c('A'), c('K')]), { total: 21, soft: true });
assert.deepStrictEqual(handValue([c('A'), c('A')]), { total: 12, soft: true });
assert.deepStrictEqual(handValue([c('A'), c('A'), c('9')]), { total: 21, soft: true });
assert.deepStrictEqual(handValue([c('K'), c('Q'), c('2')]), { total: 22, soft: false });
assert.deepStrictEqual(handValue([c('A'), c('6')]), { total: 17, soft: true });
assert.deepStrictEqual(handValue([c('7'), c('8')]), { total: 15, soft: false });
assert.strictEqual(isNaturalBlackjack([c('A'), c('J')]), true);
assert.strictEqual(isNaturalBlackjack([c('7'), c('7'), c('7')]), false);
assert.strictEqual(buildShoe(6).length, 312);
console.log('✓ valeurs de mains, blackjack naturel, sabot 6 jeux');

// ------------------------------------------------- cave de départ & re-cave

(() => {
  const game = new Game(() => {}, { betTimeMs: 100000, turnTimeMs: 100000 });
  const alice = game.addPlayer({ token: 'a', name: 'Alice' });
  const bob = game.addPlayer({ token: 'b', name: 'Bob' });
  const carl = game.addPlayer({ token: 'c', name: 'Carl' });

  // La cave ne se règle qu'avant la première manche.
  game.setStartingBalance(500);
  assert.strictEqual(alice.balance, 500);
  assert.strictEqual(bob.balance, 500);
  assert.strictEqual(carl.balance, 500);

  game.startBetting();
  assert.throws(() => game.setStartingBalance(2000), /avant la première manche/i);

  game.clearTimers();
  alice.balance = 0; // simule un joueur qui a tout perdu

  assert.throws(() => game.requestRebuy('b'), /encore des jetons/i);

  game.requestRebuy('a');
  assert.ok(game.rebuyRequest, 'une demande de re-cave doit exister');
  assert.deepStrictEqual([...game.rebuyRequest.pending].sort(), ['b', 'c']);

  assert.throws(() => game.voteRebuy('a', true), /propre demande/i);

  // Bob accepte, la demande reste en attente de Carl.
  game.voteRebuy('b', true);
  assert.ok(game.rebuyRequest, 'toujours en attente de Carl');
  assert.strictEqual(alice.balance, 0, 'pas de re-cave avant unanimité');

  // Carl refuse : Alice est exclue de la table.
  const result = game.voteRebuy('c', false);
  assert.strictEqual(result.kicked, 'a');
  assert.strictEqual(game.players.has('a'), false, 'Alice doit avoir quitté la table');
  assert.strictEqual(game.rebuyRequest, null);
  console.log('✓ re-cave refusée → le demandeur est exclu de la table');

  // Nouveau scénario : re-cave acceptée à l'unanimité.
  const dan = game.addPlayer({ token: 'd', name: 'Dan' });
  dan.balance = 0;
  game.requestRebuy('d');
  game.voteRebuy('b', true);
  game.voteRebuy('c', true);
  assert.strictEqual(dan.balance, 500, 'la re-cave doit créditer la cave de départ');
  assert.strictEqual(game.rebuyRequest, null);
  console.log('✓ re-cave acceptée à l’unanimité → le joueur est recrédité');

  // Un joueur qui se déconnecte pendant un vote ne doit pas le bloquer :
  // l'unanimité ne porte plus que sur les votants restants.
  const eve = game.addPlayer({ token: 'e', name: 'Eve' });
  eve.balance = 0;
  game.requestRebuy('e');
  assert.deepStrictEqual([...game.rebuyRequest.pending].sort(), ['b', 'c', 'd']);
  game.disconnectPlayer('c'); // Carl part avant de voter
  game.voteRebuy('b', true);
  game.voteRebuy('d', true);
  assert.strictEqual(eve.balance, 500, 're-cave conclue sans le votant parti');
  console.log('✓ un joueur parti ne bloque pas un vote de re-cave en cours');
})();

// ---------------------------------------------------------------- manche

(async () => {
  const states = [];
  const game = new Game((s) => states.push(s), {
    betTimeMs: 1000,
    turnTimeMs: 150,
    resultsTimeMs: 200,
    dealerDrawDelayMs: 5,
  });

  const alice = game.addPlayer({ token: 'tok-alice', name: 'Alice', color: '#f00', avatar: '🦊' });
  const bob = game.addPlayer({ token: 'tok-bob', name: 'Bob', color: '#0f0', avatar: '🐼' });
  assert.strictEqual(game.players.size, 2);

  game.startBetting();
  assert.strictEqual(game.phase, 'betting');

  game.placeBet('tok-alice', 100);
  assert.strictEqual(alice.balance, 900);
  assert.throws(() => game.placeBet('tok-alice', 50), /déjà placée/i);
  assert.throws(() => game.placeBet('tok-bob', 5), /minimum/i);
  assert.throws(() => game.placeBet('tok-bob', 99999), /insuffisant/i);

  game.placeBet('tok-bob', 50);
  // Tout le monde a misé → distribution immédiate.
  assert.ok(['playing', 'results'].includes(game.phase), `phase inattendue : ${game.phase}`);
  assert.strictEqual(alice.hands[0].cards.length, 2);
  assert.strictEqual(game.dealer.cards.length, 2);

  // La carte cachée du croupier ne fuit pas dans l'état public.
  if (!game.dealer.revealed) {
    const pub = game.publicState();
    assert.strictEqual(pub.dealer.cards[1].hidden, true);
    assert.strictEqual(pub.dealer.cards[1].rank, undefined);
  }

  // On joue : chaque main courante stand (le hit est testé au passage si possible).
  let guard = 0;
  while (game.phase === 'playing' && game.current && guard++ < 20) {
    const { playerId } = game.current;
    const hand = game.players.get(playerId).hands[game.current.handIndex];
    if (handValue(hand.cards).total <= 11) {
      game.hit(playerId); // ne peut pas buster à ≤ 11
    } else {
      game.stand(playerId);
    }
  }
  assert.ok(['dealer', 'results'].includes(game.phase), `phase inattendue : ${game.phase}`);
  assert.throws(() => game.hit('tok-alice'), /tour/i);

  // Le croupier tire toutes les 5 ms → on attend le règlement.
  for (let i = 0; i < 100 && game.phase !== 'results'; i++) await sleep(10);
  assert.strictEqual(game.phase, 'results');
  assert.ok(game.dealer.revealed);

  const dealerTotal = handValue(game.dealer.cards).total;
  assert.ok(dealerTotal >= 17, `le croupier doit s'arrêter à 17+ (obtenu : ${dealerTotal})`);

  // Cohérence comptable : solde final = solde après mise + règlement de chaque main.
  for (const p of [alice, bob]) {
    for (const h of p.hands) {
      assert.ok(['win', 'lose', 'push', 'blackjack'].includes(h.result), `résultat manquant`);
      if (h.result === 'blackjack') assert.strictEqual(p.lastNet >= Math.floor(h.bet * 1.5), true);
    }
  }
  const totalStart = 2 * 1000;
  const totalNow = alice.balance + bob.balance;
  const totalNet = alice.lastNet + bob.lastNet;
  assert.strictEqual(totalNow, totalStart + totalNet, 'les jetons doivent être conservés');

  // La manche suivante repart automatiquement après l'écran de résultats.
  await sleep(300);
  assert.strictEqual(game.phase, 'betting');
  assert.strictEqual(game.roundNumber, 2);

  game.clearTimers();
  assert.ok(states.length > 5, 'des états doivent avoir été diffusés');
  console.log(`✓ manche complète jouée (croupier : ${dealerTotal}, états diffusés : ${states.length})`);
  console.log('✓ tous les tests passent');
  process.exit(0);
})().catch((err) => {
  console.error('✗ échec du test :', err);
  process.exit(1);
});
