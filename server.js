'use strict';

const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Game } = require('./game/blackjack');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Les téléphones scannent le QR code et tombent sur la vue joueur.
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
// L'ordinateur (table de casino) ouvre /host.
app.get('/host', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));

/**
 * Toutes les adresses IPv4 non internes, triées de la plus probable à la
 * moins probable pour un réseau Wi-Fi domestique. Les interfaces virtuelles
 * (VPN, machines virtuelles, AirDrop…) passent en dernier.
 */
function getLocalIps() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      // Selon la version de Node, family vaut 'IPv4' ou 4.
      if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
        candidates.push({ name, address: iface.address, score: scoreInterface(name, iface.address) });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function scoreInterface(name, address) {
  let score = 0;
  const n = name.toLowerCase();
  // Interfaces physiques habituelles (en0 = Wi-Fi sur Mac, wlan/eth/Wi-Fi ailleurs)
  if (/^(en0|en1|eth0|wlan0|wi-?fi)/.test(n)) score += 40;
  // Interfaces virtuelles : VPN, VM, conteneurs, AirDrop, bridges
  if (/(utun|tun|tap|vmnet|vboxnet|docker|br-|veth|awdl|llw|bridge|ppp|zt|ts)/.test(n)) score -= 50;
  // Plages privées typiques d'une box / d'un routeur domestique
  if (address.startsWith('192.168.')) score += 20;
  else if (address.startsWith('10.')) score += 10;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) score += 10;
  // Plage d'auto-configuration (pas de DHCP) : rarement la bonne
  if (address.startsWith('169.254.')) score -= 40;
  return score;
}

const localIps = getLocalIps();
// L'adresse peut être forcée : HOST_IP=192.168.1.42 npm start
const localIp = process.env.HOST_IP || (localIps[0] ? localIps[0].address : 'localhost');
// Hébergement en ligne (Render, Railway…) : PUBLIC_URL=https://mon-app.onrender.com
const publicUrl = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/+$/, '') : null;
const joinUrl = publicUrl ? `${publicUrl}/` : `http://${localIp}:${PORT}/`;

const game = new Game((state) => io.emit('state', state));

// token socket -> playerId, pour gérer les déconnexions
const socketPlayer = new Map();

/** Adresse IPv4 normalisée du socket (retire le préfixe IPv4-mappée IPv6). */
function clientIp(socket) {
  const addr = socket.handshake.address || '';
  return addr.replace(/^::ffff:/, '');
}

io.on('connection', (socket) => {
  // Chaque nouvel écran reçoit l'état courant immédiatement.
  socket.emit('state', game.publicState());

  socket.on('host:register', async () => {
    socket.join('hosts');
    try {
      const qrDataUrl = await QRCode.toDataURL(joinUrl, {
        margin: 1,
        width: 480,
        color: { dark: '#0b1f16', light: '#f5e9c8' },
      });
      socket.emit('host:info', { ip: localIp, port: PORT, url: joinUrl, qrDataUrl });
    } catch (err) {
      socket.emit('host:info', { ip: localIp, port: PORT, url: joinUrl, qrDataUrl: null });
    }
  });

  socket.on('host:newRound', () => {
    try {
      game.startBetting();
    } catch (err) {
      socket.emit('game:error', { message: err.message });
    }
  });

  socket.on('player:join', ({ token, name, color, avatar, ignoreResume } = {}, ack) => {
    try {
      if (!token || typeof token !== 'string' || token.length > 64) {
        throw new Error('Session invalide, recharge la page.');
      }
      const ip = clientIp(socket);
      // Nouvel onglet / stockage effacé depuis une IP déjà vue récemment :
      // on propose de reprendre l'ancienne place plutôt que d'en recréer une.
      if (!ignoreResume && !game.players.has(token)) {
        const candidate = game.findResumeCandidate(ip, token);
        if (candidate) {
          if (typeof ack === 'function') {
            ack({
              ok: false,
              resumeCandidate: {
                token: candidate.id,
                name: candidate.name,
                avatar: candidate.avatar,
                color: candidate.color,
                balance: candidate.balance,
              },
            });
          }
          return;
        }
      }
      const player = game.addPlayer({ token, name, color, avatar });
      player.ip = ip;
      socketPlayer.set(socket.id, token);
      if (typeof ack === 'function') ack({ ok: true, id: player.id });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, message: err.message });
    }
  });

  socket.on('player:bet', ({ amount } = {}, ack) => {
    respond(ack, () => {
      const token = socketPlayer.get(socket.id);
      if (!token) throw new Error('Rejoins la partie d’abord.');
      game.placeBet(token, amount);
    });
  });

  // Mode de jeu, obligatoire avant la première manche (écran table ou chef).
  socket.on('host:setGameMode', ({ mode } = {}) => {
    try {
      game.setGameMode(mode);
    } catch (err) {
      socket.emit('game:error', { message: err.message });
    }
  });

  socket.on('player:setGameMode', ({ mode } = {}, ack) => {
    respond(ack, () => {
      const token = socketPlayer.get(socket.id);
      if (!token) throw new Error('Rejoins la partie d’abord.');
      if (token !== game.hostPlayerId()) {
        throw new Error('Seul le chef de table peut choisir le mode de jeu.');
      }
      game.setGameMode(mode);
    });
  });

  // Cave de départ, réglée avant la première manche (écran table ou chef).
  socket.on('host:setStartingBalance', ({ amount } = {}) => {
    try {
      game.setStartingBalance(amount);
    } catch (err) {
      socket.emit('game:error', { message: err.message });
    }
  });

  socket.on('player:setStartingBalance', ({ amount } = {}, ack) => {
    respond(ack, () => {
      const token = socketPlayer.get(socket.id);
      if (!token) throw new Error('Rejoins la partie d’abord.');
      if (token !== game.hostPlayerId()) {
        throw new Error('Seul le chef de table peut régler la cave de départ.');
      }
      game.setStartingBalance(amount);
    });
  });

  // Re-cave : demande d'un joueur à sec, votée à l'unanimité par les autres.
  socket.on('player:requestRebuy', (ack) => {
    respond(ack, () => {
      const token = socketPlayer.get(socket.id);
      if (!token) throw new Error('Rejoins la partie d’abord.');
      game.requestRebuy(token);
    });
  });

  socket.on('player:voteRebuy', ({ accept } = {}, ack) => {
    try {
      const token = socketPlayer.get(socket.id);
      if (!token) throw new Error('Rejoins la partie d’abord.');
      const result = game.voteRebuy(token, !!accept);
      if (result.kicked) {
        // Le refus exclut le demandeur : on prévient son téléphone.
        for (const [sid, t] of [...socketPlayer]) {
          if (t === result.kicked) {
            io.to(sid).emit('player:kicked', {
              message: 'La re-cave a été refusée : tu quittes la table. Tu peux revenir comme nouveau joueur.',
            });
            socketPlayer.delete(sid);
          }
        }
      }
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, message: err.message });
    }
  });

  // Mode « chacun son écran » : le chef de table lance les manches du téléphone.
  socket.on('player:newRound', (ack) => {
    respond(ack, () => {
      const token = socketPlayer.get(socket.id);
      if (!token) throw new Error('Rejoins la partie d’abord.');
      if (token !== game.hostPlayerId()) {
        throw new Error('Seul le chef de table peut lancer la manche.');
      }
      game.startBetting();
    });
  });

  socket.on('player:action', ({ type } = {}, ack) => {
    respond(ack, () => {
      const token = socketPlayer.get(socket.id);
      if (!token) throw new Error('Rejoins la partie d’abord.');
      if (type === 'hit') game.hit(token);
      else if (type === 'stand') game.stand(token);
      else if (type === 'double') game.double(token);
      else if (type === 'split') game.split(token);
      else throw new Error('Action inconnue.');
    });
  });

  // Pré-choix : programme l'action jouée automatiquement dès que le tour arrive.
  socket.on('player:setPreset', ({ action } = {}, ack) => {
    respond(ack, () => {
      const token = socketPlayer.get(socket.id);
      if (!token) throw new Error('Rejoins la partie d’abord.');
      game.setPresetAction(token, action ?? null);
    });
  });

  socket.on('disconnect', () => {
    const token = socketPlayer.get(socket.id);
    socketPlayer.delete(socket.id);
    if (!token) return;
    // Un autre socket (reconnexion rapide) peut déjà porter ce joueur.
    const stillConnected = [...socketPlayer.values()].includes(token);
    if (!stillConnected) game.disconnectPlayer(token);
  });
});

function respond(ack, fn) {
  try {
    fn();
    if (typeof ack === 'function') ack({ ok: true });
  } catch (err) {
    if (typeof ack === 'function') ack({ ok: false, message: err.message });
  }
}

server.listen(PORT, () => {
  console.log('');
  console.log('  ♠ ♥  BLACKJACK ROYALE  ♦ ♣');
  console.log('  ──────────────────────────────────────────');
  console.log(`  Table (ordinateur) : ${publicUrl ? `${publicUrl}/host` : `http://localhost:${PORT}/host`}`);
  console.log(`  Joueurs (mobiles)  : ${joinUrl}`);
  console.log('  ──────────────────────────────────────────');
  if (!publicUrl && localIps.length > 1) {
    console.log('  Plusieurs interfaces réseau détectées — si les téléphones');
    console.log('  ne se connectent pas, essayez une autre adresse :');
    for (const c of localIps) {
      const marker = c.address === localIp ? '→' : ' ';
      console.log(`   ${marker} http://${c.address}:${PORT}/   (${c.name})`);
    }
    console.log(`  Pour en forcer une : HOST_IP=<adresse> npm start`);
    console.log('  ──────────────────────────────────────────');
  }
  if (publicUrl) {
    console.log('  Serveur public : partagez simplement le lien ci-dessus.');
  } else {
    console.log('  Les téléphones doivent être sur le même réseau Wi-Fi.');
  }
  console.log('');
});
