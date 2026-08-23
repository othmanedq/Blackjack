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

  // Le mode de jeu est obligatoire avant de lancer la 1ère manche.
  assert.throws(() => game.startBetting(), /mode de jeu/i);
  assert.throws(() => game.setGameMode('poker'), /invalide/i);
  game.setGameMode('table');
  game.setGameMode('phones'); // reste modifiable tant que la partie n'a pas commencé
  game.setGameMode('both'); // les deux écrans à la fois restent une option valide
  assert.strictEqual(game.mode, 'both');

  // La cave ne se règle qu'avant la première manche.
  game.setStartingBalance(500);
  assert.strictEqual(alice.balance, 500);
  assert.strictEqual(bob.balance, 500);
  assert.strictEqual(carl.balance, 500);

  game.startBetting();
  assert.throws(() => game.setStartingBalance(2000), /avant la première manche/i);
  assert.throws(() => game.setGameMode('table'), /avant la première manche/i);

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

// ---------------------------------------------------------- reprise (même IP)

(() => {
  const game = new Game(() => {}, { betTimeMs: 100000, turnTimeMs: 100000 });
  const alice = game.addPlayer({ token: 'old-tok', name: 'Alice' });
  alice.ip = '10.0.0.5';

  // Toujours là juste après une déconnexion, jamais supprimée immédiatement.
  game.disconnectPlayer('old-tok');
  assert.strictEqual(game.players.has('old-tok'), true, 'un déconnecté doit rester visible');
  assert.strictEqual(alice.connected, false);
  assert.ok(alice.disconnectedAt, 'la date de déconnexion doit être enregistrée');

  // Un nouvel onglet depuis la même IP la retrouve.
  const found = game.findResumeCandidate('10.0.0.5', 'new-tok');
  assert.strictEqual(found, alice, 'doit retrouver Alice par IP');
  assert.strictEqual(game.findResumeCandidate('10.0.0.9', 'new-tok'), null, 'IP différente → rien');
  assert.strictEqual(game.findResumeCandidate('10.0.0.5', 'old-tok'), null, 'exclut le token de la requête elle-même');

  // Passé la fenêtre de reprise (20 min), on ne propose plus rien.
  alice.disconnectedAt = Date.now() - 25 * 60 * 1000;
  assert.strictEqual(game.findResumeCandidate('10.0.0.5', 'new-tok'), null, 'trop ancien → plus de proposition');
  alice.disconnectedAt = Date.now();

  // Reprendre = rejoindre avec l'ancien token : addPlayer reconnecte la même entrée.
  const resumed = game.addPlayer({ token: 'old-tok', name: 'Alice' });
  assert.strictEqual(resumed, alice, 'même joueur, pas une nouvelle entrée');
  assert.strictEqual(resumed.connected, true);
  assert.strictEqual(resumed.disconnectedAt, null);

  // Le prochain lancement de manche purge quand même les déconnectés restants.
  const bob = game.addPlayer({ token: 'bob', name: 'Bob' });
  bob.ip = '10.0.0.6';
  game.disconnectPlayer('bob');
  game.setGameMode('table');
  game.startBetting();
  assert.strictEqual(game.players.has('bob'), false, 'un déconnecté non repris est purgé à la manche suivante');
  console.log('✓ un joueur déconnecté reste identifiable par IP pour proposer une reprise');
})();

// ------------------------------------------------------------- pré-choix

(() => {
  // Alice (main déjà forte) programme "stand" pendant que c'est au tour de Bob.
  const game = new Game(() => {}, { betTimeMs: 100000, turnTimeMs: 100000 });
  const alice = game.addPlayer({ token: 'a', name: 'Alice' });
  const bob = game.addPlayer({ token: 'b', name: 'Bob' });
  game.phase = 'playing';
  alice.inRound = true;
  alice.hands = [{ cards: [c('K'), c('9')], bet: 100, status: 'playing', doubled: false }];
  bob.inRound = true;
  bob.hands = [{ cards: [c('5'), c('4')], bet: 100, status: 'playing', doubled: false }];
  game.current = { playerId: 'b', handIndex: 0 };

  assert.throws(() => game.setPresetAction('b', 'stand'), /ton tour/i, 'pas de pré-choix pendant son propre tour');
  game.setPresetAction('a', 'stand');
  assert.strictEqual(alice.presetAction, 'stand');

  const pub = game.publicState();
  assert.strictEqual(pub.players.find((p) => p.id === 'a').presetAction, 'stand', 'visible dans l\'état public');

  // Bob termine son tour → le pré-choix d'Alice s'exécute automatiquement.
  game.stand('b');
  assert.strictEqual(alice.hands[0].status, 'stand', 'le stand programmé s\'est exécuté sans intervention');
  assert.strictEqual(alice.presetAction, null, 'le pré-choix est consommé après exécution');
  console.log('✓ un stand programmé s\'exécute automatiquement dès que le tour arrive');

  // Un "hit" programmé s'exécute une fois, puis rend la main au joueur.
  const game2 = new Game(() => {}, { betTimeMs: 100000, turnTimeMs: 100000 });
  const carl = game2.addPlayer({ token: 'c', name: 'Carl' });
  const dan = game2.addPlayer({ token: 'd', name: 'Dan' });
  game2.phase = 'playing';
  carl.inRound = true;
  carl.hands = [{ cards: [c('5'), c('4')], bet: 100, status: 'playing', doubled: false }]; // total 9
  dan.inRound = true;
  dan.hands = [{ cards: [c('9'), c('8')], bet: 100, status: 'playing', doubled: false }];
  game2.current = { playerId: 'd', handIndex: 0 };
  game2.shoe = [c('2')]; // carte tirée par le hit programmé de Carl
  game2.setPresetAction('c', 'hit');

  game2.stand('d');
  assert.strictEqual(carl.hands[0].cards.length, 3, 'le hit programmé a bien tiré une carte');
  assert.strictEqual(carl.hands[0].status, 'playing', 'la main reste jouable après un hit (total 11)');
  assert.strictEqual(carl.presetAction, null);
  assert.deepStrictEqual(game2.current, { playerId: 'c', handIndex: 0 }, 'c\'est maintenant vraiment le tour de Carl');
  assert.ok(game2.turnEndsAt, 'un timer de tour normal reprend après le hit programmé');
  console.log('✓ un hit programmé s\'exécute une fois puis repasse en main normale');

  // Un pré-choix devenu invalide (ex. double sans solde suffisant) ne bloque
  // pas la table : on retombe sur un tour manuel classique.
  const game3 = new Game(() => {}, { betTimeMs: 100000, turnTimeMs: 100000 });
  const eve = game3.addPlayer({ token: 'e', name: 'Eve' });
  const finn = game3.addPlayer({ token: 'f', name: 'Finn' });
  game3.phase = 'playing';
  eve.inRound = true;
  eve.balance = 0; // solde insuffisant pour honorer le double programmé
  eve.hands = [{ cards: [c('5'), c('4')], bet: 100, status: 'playing', doubled: false }];
  finn.inRound = true;
  finn.hands = [{ cards: [c('9'), c('8')], bet: 100, status: 'playing', doubled: false }];
  game3.current = { playerId: 'f', handIndex: 0 };
  game3.setPresetAction('e', 'double');

  game3.stand('f');
  assert.deepStrictEqual(game3.current, { playerId: 'e', handIndex: 0 });
  assert.strictEqual(eve.hands[0].status, 'playing', 'la main reste jouable, pas de blocage de la table');
  assert.ok(game3.turnEndsAt, 'un tour manuel normal est proposé à la place');
  console.log('✓ un pré-choix devenu invalide retombe sur un tour manuel sans bloquer la table');
})();

// ---------------------------------------------------------------------- split

(() => {
  // Sabot maîtrisé pour un scénario déterministe : draw() = shoe.pop(),
  // donc les cartes en fin de tableau sont tirées en premier.
  const game = new Game(() => {}, { betTimeMs: 100000, turnTimeMs: 100000 });
  const alice = game.addPlayer({ token: 'a', name: 'Alice' });
  alice.balance = 900; // après une mise de 100 déjà déduite
  const pairA = c('8', '♠');
  const pairB = c('8', '♥');
  alice.hands = [{ cards: [pairA, pairB], bet: 100, status: 'playing', doubled: false }];
  game.phase = 'playing';
  game.current = { playerId: 'a', handIndex: 0 };
  // 1er split tirera d'abord un 8 (pour permettre le resplit), puis un 2.
  game.shoe = [c('2', '♣'), c('8', '♦')];

  game.split('a');
  assert.strictEqual(alice.hands.length, 2, 'le split doit créer une 2ᵉ main');
  assert.strictEqual(alice.balance, 800, 'la mise de la nouvelle main est déduite');
  assert.deepStrictEqual(alice.hands[0].cards.map((x) => x.rank), ['8', '8'], 'la main active a une nouvelle paire de 8');
  assert.strictEqual(game.current.handIndex, 0, 'la main active ne change pas tant qu\'elle est jouable');

  const stateAfterFirstSplit = game.publicState();
  const meAfterFirst = stateAfterFirstSplit.players[0];
  assert.strictEqual(meAfterFirst.hands[0].canSplit, true, 'une nouvelle paire doit pouvoir resplitter');

  // Resplit : refusé auparavant ("un seul split par manche"), désormais autorisé.
  game.split('a');
  assert.strictEqual(alice.hands.length, 3, 'le resplit doit créer une 3ᵉ main');
  assert.strictEqual(alice.balance, 700, 'la mise de la 3ᵉ main est déduite');
  alice.hands.forEach((h, i) => assert.strictEqual(h.cards.length, 2, `la main ${i} doit avoir 2 cartes`));
  console.log('✓ resplit autorisé quand une nouvelle paire apparaît après un split');

  // Le nombre de mains est plafonné (maxSplitHands = 4 par défaut).
  alice.hands = [
    { cards: [c('5', '♠'), c('5', '♥')], bet: 100, status: 'stand', doubled: false },
    { cards: [c('5', '♦'), c('5', '♣')], bet: 100, status: 'stand', doubled: false },
    { cards: [c('5', '♠'), c('5', '♥')], bet: 100, status: 'stand', doubled: false },
    { cards: [c('9', '♠'), c('9', '♥')], bet: 100, status: 'playing', doubled: false }, // 4ᵉ main, encore une paire
  ];
  game.current = { playerId: 'a', handIndex: 3 };
  assert.throws(() => game.split('a'), /maximum 4 mains/i);
  console.log('✓ le nombre de mains après split est plafonné à maxSplitHands');
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

  game.setGameMode('table');
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
