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
const joinUrl = `http://${localIp}:${PORT}/`;

const game = new Game((state) => io.emit('state', state));

// token socket -> playerId, pour gérer les déconnexions
const socketPlayer = new Map();

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

  socket.on('player:join', ({ token, name, color, avatar } = {}, ack) => {
    try {
      if (!token || typeof token !== 'string' || token.length > 64) {
        throw new Error('Session invalide, recharge la page.');
      }
      const player = game.addPlayer({ token, name, color, avatar });
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
  console.log(`  Table (ordinateur) : http://localhost:${PORT}/host`);
  console.log(`  Joueurs (mobiles)  : ${joinUrl}`);
  console.log('  ──────────────────────────────────────────');
  if (localIps.length > 1) {
    console.log('  Plusieurs interfaces réseau détectées — si les téléphones');
    console.log('  ne se connectent pas, essayez une autre adresse :');
    for (const c of localIps) {
      const marker = c.address === localIp ? '→' : ' ';
      console.log(`   ${marker} http://${c.address}:${PORT}/   (${c.name})`);
    }
    console.log(`  Pour en forcer une : HOST_IP=<adresse> npm start`);
    console.log('  ──────────────────────────────────────────');
  }
  console.log('  Les téléphones doivent être sur le même réseau Wi-Fi.');
  console.log('');
});
