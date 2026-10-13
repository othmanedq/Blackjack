'use strict';

/**
 * Table de poker : un canal Socket.io à part (/poker), indépendant de la
 * table de blackjack. Soldes, chat et joueurs sont séparés ; le code
 * modérateur est le même.
 */

const { PokerGame } = require('./game/poker');
const { Chat } = require('./game/chat');

/**
 * @param {object} deps
 * @param {import('socket.io').Server} deps.io
 * @param {(key: unknown) => boolean} deps.isAdminKey
 * @param {() => string} deps.joinUrl — adresse de la page d'accueil (se termine par /)
 * @param {(url: string) => Promise<string|null>} deps.qrFor
 * @param {(socket: object) => string} deps.clientIp
 * @param {string[]} deps.reactions
 * @param {number} deps.reactionCooldownMs
 */
function setupPoker({ io, isAdminKey, joinUrl, qrFor, clientIp, reactions, reactionCooldownMs }) {
  const ns = io.of('/poker');
  const socketPlayer = new Map(); // socket id -> token joueur
  const chat = new Chat();

  // Chaque écran reçoit son propre état : ses cartes, jamais celles des autres.
  const game = new PokerGame((g) => {
    for (const [sid, socket] of ns.sockets) socket.emit('state', g.stateFor(socketPlayer.get(sid) || null));
  });

  const pokerUrl = () => `${joinUrl()}poker`;

  async function sendHostInfo(target) {
    const url = pokerUrl();
    target.emit('host:info', { url, qrDataUrl: await qrFor(url) });
  }

  function respond(ack, fn) {
    try {
      fn();
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, message: err.message });
    }
  }

  ns.on('connection', (socket) => {
    socket.emit('state', game.stateFor(null));
    socket.emit('chat:history', chat.history());
    const me = () => socketPlayer.get(socket.id);
    const requireMe = () => {
      const token = me();
      if (!token || !game.players.has(token)) throw new Error('Rejoins la table d’abord.');
      return token;
    };

    socket.on('host:register', () => {
      socket.join('hosts');
      sendHostInfo(socket);
    });

    socket.on('player:join', ({ token, name, color, avatar, ignoreResume, adminKey } = {}, ack) => {
      try {
        if (!token || typeof token !== 'string' || token.length > 64) {
          throw new Error('Session invalide, recharge la page.');
        }
        const ip = clientIp(socket);
        if (!ignoreResume && !game.players.has(token)) {
          const c = game.findResumeCandidate(ip, token);
          if (c) {
            if (typeof ack === 'function') {
              ack({ ok: false, resumeCandidate: { token: c.id, name: c.name, avatar: c.avatar, color: c.color, balance: c.stack } });
            }
            return;
          }
        }
        const clean = String(name || '').replace(/\s+/g, ' ').trim();
        const player = game.addPlayer({ token, name: [...clean].slice(0, 12).join('') || 'Joueur', color, avatar });
        player.ip = ip;
        socketPlayer.set(socket.id, token);
        const moderator = isAdminKey(adminKey);
        if (moderator) game.setModerator(token);
        game.push(); // l'état de ce socket inclut désormais ses cartes
        if (typeof ack === 'function') {
          ack({ ok: true, id: player.id, moderator, adminKeyRejected: !!adminKey && !moderator });
        }
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, message: err.message });
      }
    });

    socket.on('player:act', ({ type, amount } = {}, ack) => {
      respond(ack, () => game.act(requireMe(), type, amount));
    });

    // Lancement et réglages : le chef depuis son téléphone, ou l'écran de la table.
    socket.on('player:start', (ack) => respond(ack, () => game.start(requireMe())));
    socket.on('host:start', (ack) => respond(ack, () => game.start(game.hostPlayerId())));
    socket.on('player:configure', (opts = {}, ack) => respond(ack, () => game.configure(requireMe(), opts)));
    socket.on('host:configure', (opts = {}, ack) => respond(ack, () => game.configure(game.hostPlayerId(), opts)));

    socket.on('player:rebuy', (ack) => respond(ack, () => game.rebuy(requireMe())));

    socket.on('player:leave', (ack) => {
      respond(ack, () => {
        const token = requireMe();
        game.leaveTable(token);
        for (const [sid, t] of [...socketPlayer]) if (t === token) socketPlayer.delete(sid);
      });
    });

    socket.on('player:kick', ({ target } = {}, ack) => {
      respond(ack, () => {
        game.kick(requireMe(), target);
        for (const [sid, t] of [...socketPlayer]) {
          if (t !== target) continue;
          ns.to(sid).emit('player:kicked', { message: 'Le chef de table t’a exclu. Tu peux revenir comme nouveau joueur.' });
          socketPlayer.delete(sid);
        }
      });
    });

    socket.on('mod:adjust', ({ target, delta } = {}, ack) => {
      respond(ack, () => {
        const applied = game.adjustStack(me(), target, delta);
        if (applied !== 0) {
          for (const [sid, t] of socketPlayer) if (t === target) ns.to(sid).emit('player:modAdjust', { amount: applied });
        }
      });
    });

    socket.on('player:chat', ({ text } = {}, ack) => {
      respond(ack, () => {
        const player = game.players.get(requireMe());
        ns.emit('chat:message', chat.post(player, text));
      });
    });

    let lastReactionAt = 0;
    socket.on('player:react', ({ face } = {}, ack) => {
      respond(ack, () => {
        const token = requireMe();
        if (!reactions.includes(face)) throw new Error('Réaction inconnue.');
        const now = Date.now();
        if (now - lastReactionAt < reactionCooldownMs) throw new Error('Doucement !');
        lastReactionAt = now;
        ns.emit('reaction', { playerId: token, face });
      });
    });

    socket.on('disconnect', () => {
      const token = me();
      socketPlayer.delete(socket.id);
      if (!token) return;
      if (![...socketPlayer.values()].includes(token)) game.disconnectPlayer(token);
    });
  });

  return {
    game,
    /** Le réseau a changé : nouveau QR code sur les écrans de la table. */
    refreshHostInfo: () => sendHostInfo(ns.to('hosts')),
    playerCount: () => game.players.size,
  };
}

module.exports = { setupPoker };
