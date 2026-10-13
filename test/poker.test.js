'use strict';

/* Tests du moteur de poker (Texas Hold'em No Limit). */

const assert = require('assert');
const { PokerGame } = require('../game/poker');

const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
let uid = 0;
const card = (t) => ({
  rank: t.slice(0, -1).toUpperCase().replace('T', '10'),
  suit: SUIT[t.slice(-1).toUpperCase()],
  id: `c${uid++}-${t}`,
});
const cards = (str) => str.split(/\s+/).filter(Boolean).map(card);

/**
 * Paquet imposé. `hands` dans l'ordre de distribution (à gauche du bouton,
 * le bouton en dernier ; en tête-à-tête : la grosse blinde puis le bouton).
 */
function rig(game, hands, board) {
  const h = hands.map((x) => (Array.isArray(x) ? x.map(card) : cards(x)));
  const b = cards(board);
  const deck = [
    ...h.map((x) => x[0]), ...h.map((x) => x[1]),
    card('2c'), b[0], b[1], b[2], // brûlée + flop
    card('3c'), b[3],             // brûlée + turn
    card('4c'), b[4],             // brûlée + river
  ];
  for (let i = 0; i < 20; i++) deck.push(card('5d'));
  game.nextDeck = deck;
}

function table(n, opts = {}) {
  const game = new PokerGame(() => {}, { turnTimeMs: 100000, resultsTimeMs: 100000, runoutDelayMs: 0, ...opts });
  const names = ['Alice', 'Bob', 'Carl', 'Dana', 'Eve', 'Fred'];
  const ps = names.slice(0, n).map((name, i) => game.addPlayer({ token: name[0].toLowerCase(), name }));
  return { game, ps };
}

const totalChips = (game) => [...game.players.values()].reduce((n, p) => n + p.stack + p.totalBet * (game.phase === 'showdown' ? 0 : 1), 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Attend la fin de la main (le tableau se retourne via des minuteries). */
async function untilShowdown(game, maxMs = 3000) {
  const end = Date.now() + maxMs;
  while (game.phase !== 'showdown' && Date.now() < end) await sleep(2);
}

(async () => {
  // ------------------------------------------------ tête-à-tête : blindes et ordre de parole
  {
    const { game, ps: [a, b] } = table(2);
    rig(game, [['9c', '9d'], ['Kh', 'Qh']], '2s 7d Jc 3h 8s'); // b (grosse blinde) puis a (bouton)
    game.start('a');
    assert.strictEqual(game.dealerSeat, a.seat);
    assert.strictEqual(game.sbSeat, a.seat, 'en tête-à-tête, le bouton paie la petite blinde');
    assert.strictEqual(game.bbSeat, b.seat);
    assert.strictEqual(a.stack, 995);
    assert.strictEqual(b.stack, 990);
    assert.strictEqual(game.toAct, a.seat, 'le bouton parle en premier avant le flop');
    game.act('a', 'call');
    assert.strictEqual(game.toAct, b.seat, 'la grosse blinde garde la parole (option)');
    game.act('b', 'check');
    assert.strictEqual(game.phase, 'flop');
    assert.strictEqual(game.board.length, 3);
    assert.strictEqual(game.toAct, b.seat, 'après le flop, le non-bouton parle en premier');
    console.log('✓ poker : blindes et ordre de parole en tête-à-tête');
  }

  // ------------------------------------------------ 3 joueurs : blindes, coucher, ramasser
  {
    const { game, ps: [a, b, c] } = table(3);
    game.start('a');
    assert.strictEqual(game.dealerSeat, a.seat);
    assert.strictEqual(game.sbSeat, b.seat);
    assert.strictEqual(game.bbSeat, c.seat);
    assert.strictEqual(game.toAct, a.seat, 'à 3, le bouton parle en premier avant le flop (après la grosse blinde)');
    game.act('a', 'raise', 40);
    game.act('b', 'fold');
    game.act('c', 'fold');
    assert.strictEqual(game.phase, 'showdown');
    assert.strictEqual(game.results.showdown, false, 'pas d’abattage quand tout le monde se couche');
    assert.strictEqual(a.stack, 1015, 'Alice ramasse les blindes (5 + 10)');
    assert.strictEqual(b.stack + c.stack + a.stack, 3000, 'aucun jeton créé ni perdu');
    game.clearTimers();
    // Main suivante : le bouton tourne.
    game.startHand();
    assert.strictEqual(game.dealerSeat, b.seat);
    game.clearTimers();
    console.log('✓ poker : coucher, ramasser, bouton qui tourne');
  }

  // ------------------------------------------------ relances minimales No Limit
  {
    const { game } = table(3);
    game.start('a');
    assert.throws(() => game.act('a', 'raise', 15), /Relance minimum : jusqu’à 20/);
    game.act('a', 'raise', 30);  // relance de 20
    assert.throws(() => game.act('b', 'raise', 45), /jusqu’à 50/, 'la relance suivante doit être d’au moins 20');
    game.act('b', 'raise', 50);
    assert.strictEqual(game.minRaise, 20);
    assert.throws(() => game.act('c', 'check'), /pas checker/);
    game.clearTimers();
    console.log('✓ poker : relance minimale = taille de la dernière relance');
  }

  // ------------------------------------------------ tapis incomplet : pas de sur-relance pour qui a déjà parlé
  {
    const { game, ps: [a, b] } = table(2);
    b.stack = 140;
    rig(game, [['9c', '9d'], ['Kh', 'Qh']], '2s 7d Jc 3h 8s');
    game.start('a');
    game.act('a', 'call');      // 10
    game.act('b', 'check');
    // Flop : b parle en premier.
    game.act('b', 'check');
    game.act('a', 'raise', 100); // mise de 100
    game.act('b', 'allin');      // tapis à 130 : relance incomplète (+30 < 100)
    assert.throws(() => game.act('a', 'raise', 400), /suivre ou te coucher/);
    game.act('a', 'call');
    // Tout le monde à tapis ou à égalité : le tableau se retourne seul.
    await untilShowdown(game);
    assert.strictEqual(game.phase, 'showdown');
    assert.strictEqual(game.board.length, 5);
    assert.strictEqual(a.stack + b.stack, 990 + 140 + 10, 'jetons conservés');
    game.clearTimers();
    console.log('✓ poker : tapis incomplet sans réouverture des relances');
  }

  // ------------------------------------------------ pots annexes
  {
    const { game, ps: [a, b, c] } = table(3);
    a.stack = 100;
    b.stack = 300;
    c.stack = 300;
    // Ordre de distribution : b (petite), c (grosse), a (bouton).
    // Alice : brelan ; Bob : deux paires ; Carl : rien.
    rig(game, [['Kd', 'Qd'], ['4h', '6s'], ['8h', '8d']], '8s Ks Qc 2h 3c');
    game.start('a');
    game.act('a', 'allin'); // 100
    game.act('b', 'allin'); // 300
    game.act('c', 'call');  // 300
    await untilShowdown(game);
    assert.strictEqual(game.phase, 'showdown');
    const pots = game.results.pots;
    assert.strictEqual(pots.length, 2);
    assert.strictEqual(pots[0].amount, 300, 'pot principal : 3 × 100');
    assert.strictEqual(pots[0].winners[0].id, 'a');
    assert.strictEqual(pots[1].amount, 400, 'pot annexe : 2 × 200, sans Alice');
    assert.strictEqual(pots[1].winners[0].id, 'b');
    assert.deepStrictEqual([a.stack, b.stack, c.stack], [300, 400, 0]);
    game.clearTimers();
    console.log('✓ poker : pot principal et pot annexe');
  }

  // ------------------------------------------------ partage
  {
    const { game, ps: [a, b] } = table(2);
    rig(game, [['2c', '3d'], ['4h', '5h']], 'As Ks Qs Js Ts'); // quinte flush royale au tableau
    game.start('a');
    game.act('a', 'allin');
    game.act('b', 'call');
    await untilShowdown(game);
    assert.strictEqual(game.results.pots[0].winners.length, 2, 'partage');
    assert.deepStrictEqual([a.stack, b.stack], [1000, 1000]);
    game.clearTimers();
    console.log('✓ poker : pot partagé quand le tableau joue');
  }

  // ------------------------------------------------ mise non suivie rendue
  {
    const { game, ps: [a, b] } = table(2);
    a.stack = 50;
    rig(game, [['2c', '3d'], ['Ah', 'Ad']], '9s 8h 4c Jd Qs');
    game.start('a');
    game.act('a', 'allin');        // 50
    game.act('b', 'raise', 300);   // personne ne peut suivre au-delà de 50
    await untilShowdown(game);
    assert.strictEqual(game.phase, 'showdown');
    assert.strictEqual(game.results.pots.reduce((n, p) => n + p.amount, 0), 100, 'seuls 2 × 50 sont disputés');
    assert.strictEqual(a.stack + b.stack, 1050);
    game.clearTimers();
    console.log('✓ poker : mise non suivie rendue à son auteur');
  }

  // ------------------------------------------------ temps écoulé et joueur absent
  {
    const { game, ps: [a, b] } = table(2, { turnTimeMs: 30 });
    game.start('a');
    await sleep(60);
    assert.strictEqual(a.folded, true, 'temps écoulé face à une mise : le joueur se couche');
    game.clearTimers();
    game.startHand(); // bouton chez Bob
    game.disconnectPlayer('b');
    assert.strictEqual(game.phase, 'showdown', 'un absent dont c’est le tour se couche tout seul');
    game.clearTimers();
    console.log('✓ poker : temps écoulé et absents ne bloquent pas la table');
  }

  // ------------------------------------------------ cartes secrètes
  {
    const { game } = table(3);
    game.start('a');
    const seenByA = game.stateFor('a');
    assert.strictEqual(seenByA.you.holeCards.length, 2);
    const json = JSON.stringify(seenByA);
    for (const id of ['b', 'c']) {
      for (const c of game.players.get(id).holeCards) {
        assert.ok(!json.includes(c.id), 'les cartes des autres ne sont jamais envoyées');
      }
    }
    game.clearTimers();
    console.log('✓ poker : les cartes privées restent secrètes');
  }

  // ------------------------------------------------ propriété : des mains au hasard ne créent ni ne perdent de jetons
  {
    // Recaves illimitées ici : on veut 400 mains, pas tester le plafond.
    const { game } = table(5, { runoutDelayMs: 0, freeRebuys: Infinity });
    let expected = 5000; // 5 × 1 000, plus chaque recave
    let hands = 0;
    for (let i = 0; i < 400; i++) {
      // Les joueurs ruinés se recavent, pour jouer vraiment 400 mains.
      for (const p of game.players.values()) {
        if (p.stack === 0) {
          game.rebuy(p.id);
          expected += 1000;
        }
      }
      game.clearTimers();
      game.startHand();
      let guard = 0;
      while (game.isBetting() && guard++ < 200) {
        const p = game.playerAt(game.toAct);
        if (!p) break;
        const toCall = game.currentBet - p.bet;
        const r = Math.random();
        try {
          if (r < 0.15) game.act(p.id, 'fold');
          else if (r < 0.25) game.act(p.id, 'allin');
          else if (r < 0.45 && p.stack > toCall) {
            const min = Math.min(p.bet + p.stack, game.currentBet + game.minRaise);
            game.act(p.id, 'raise', Math.min(p.bet + p.stack, min + Math.floor(Math.random() * 3) * game.minRaise));
          } else game.act(p.id, toCall > 0 ? 'call' : 'check');
        } catch {
          game.act(p.id, toCall > 0 ? 'call' : 'check');
        }
      }
      // Tapis : le reste du tableau se retourne avec des minuteries à 0 ms.
      await untilShowdown(game);
      assert.strictEqual(game.phase, 'showdown', `main ${i} terminée`);
      const sum = [...game.players.values()].reduce((n, p) => n + p.stack, 0);
      assert.strictEqual(sum, expected, `main ${i} : jetons conservés`);
      for (const p of game.players.values()) assert.ok(p.stack >= 0);
      hands++;
    }
    game.clearTimers();
    console.log(`✓ poker : ${hands} mains jouées au hasard, aucun jeton créé ni perdu`);
  }

  // ------------------------------------------------ recaves : 3 automatiques, puis vote
  {
    const { game, ps: [a] } = table(3);
    for (let i = 0; i < 3; i++) {
      a.stack = 0;
      assert.strictEqual(game.rebuy('a'), 'granted', `recave ${i + 1} : automatique`);
    }
    a.stack = 0;
    assert.strictEqual(game.rebuy('a'), 'vote', '4e recave : vote des autres joueurs');
    assert.strictEqual(game.stateFor('b').rebuyRequest.needed, 2, '2 votants : il faut 2 oui');
    game.voteRebuy('b', true);
    assert.strictEqual(game.voteRebuy('c', false).outcome, 'denied', '1 oui sur 2 : refusée');
    assert.strictEqual(a.stack, 0);
    assert.throws(() => game.rebuy('a'), /réessaie dans/, 'une minute avant de redemander');
    a.rebuyRetryAt = 0;
    game.rebuy('a');
    game.voteRebuy('b', true);
    assert.strictEqual(game.voteRebuy('c', true).outcome, 'granted');
    assert.strictEqual(a.stack, 1000);
    assert.strictEqual(a.rebuys, 4);
    // Un votant qui part ne bloque pas le vote.
    a.stack = 0;
    game.rebuy('a');
    game.voteRebuy('b', true);
    game.disconnectPlayer('c');
    assert.strictEqual(a.stack, 1000, 'la majorité se recalcule sans le joueur parti');
    console.log('✓ poker : 3 recaves automatiques, puis vote à la majorité');
  }

  // ------------------------------------------------ blindes progressives
  {
    // Chrono : un niveau de plus quand le temps est écoulé, jamais en pleine main.
    const { game, ps: [a] } = table(2);
    game.configure('a', { mode: 'fast', blinds: 3 });
    assert.throws(() => game.configure('a', { mode: 'turbo' }), /invalide/);
    game.start('a');
    assert.deepStrictEqual([game.smallBlind, game.bigBlind], [5, 10]);
    assert.ok(game.nextLevelAt > Date.now(), 'prochain niveau programmé');
    game.nextLevelAt = Date.now() - 1; // le temps du niveau est écoulé…
    assert.strictEqual(game.bigBlind, 10, '…mais la main en cours garde ses blindes');
    game.act(game.playerAt(game.toAct).id, 'fold');
    game.clearTimers();
    game.startHand();
    assert.deepStrictEqual([game.smallBlind, game.bigBlind], [10, 20], 'nouvelle main : niveau suivant');
    assert.strictEqual(game.stateFor('a').blindsJustRose, true, 'annonce de la hausse');
    assert.throws(() => game.configure('a', { mode: 'long' }), /avant la première main/);
    game.clearTimers();

    // Pause : le chrono s'arrête quand la partie s'arrête faute de joueurs.
    const before = game.nextLevelAt;
    game.pausedAt = Date.now() - 60000; // une minute de pause
    game.advanceBlinds(Date.now());
    assert.ok(game.nextLevelAt - before >= 59000, 'le temps de pause est rendu au niveau en cours');
    console.log('✓ poker : blindes qui montent au chrono, figées pendant les pauses');
  }
  {
    // Élimination : chaque joueur tombé à zéro fait monter les blindes d'un niveau.
    const { game, ps: [a, b, c] } = table(3);
    game.configure('a', { mode: 'elimination' });
    c.stack = 30;
    rig(game, [['2c', '3d'], ['7h', '2s'], ['Ah', 'Ad']], 'Ks 9d 4c Jh 8s'); // ordre : b, c, a
    game.start('a');
    game.act('a', 'raise', 100);
    game.act('b', 'fold');
    game.act('c', 'allin'); // Carl à tapis avec 7-2 contre As-As
    await untilShowdown(game);
    assert.strictEqual(c.stack, 0, 'Carl est éliminé');
    assert.strictEqual(game.bigBlind, 10);
    game.clearTimers();
    game.startHand();
    assert.deepStrictEqual([game.smallBlind, game.bigBlind], [10, 20], 'une élimination = un niveau de plus');
    game.clearTimers();
    console.log('✓ poker : blindes qui montent à chaque élimination');
  }

  console.log('✓ tous les tests de poker passent');
  process.exit(0);
})().catch((err) => {
  console.error('✗ échec du test de poker :', err);
  process.exit(1);
});
