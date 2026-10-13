'use strict';

/**
 * Chat textuel de la table : nettoyage des messages, anti-flood et
 * historique récent (envoyé à chaque écran qui se connecte).
 * Gardé en mémoire seulement : un redémarrage du serveur l'efface.
 */

const CHAT_DEFAULTS = {
  maxLength: 200,   // caractères par message
  historySize: 50,  // messages conservés pour les nouveaux arrivants
  burst: 5,         // messages autorisés…
  windowMs: 8000,   // …sur cette fenêtre glissante
};

/** Texte sur une ligne : caractères de contrôle retirés, espaces regroupés. */
function cleanText(text, maxLength) {
  const flat = String(text ?? '')
    .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Coupe par caractère réel (pas par unité UTF-16), pour ne pas casser un accent ou un symbole.
  return [...flat].slice(0, maxLength).join('');
}

class Chat {
  constructor(options = {}) {
    this.opts = { ...CHAT_DEFAULTS, ...options };
    this.messages = [];
    this.sentAt = new Map(); // playerId -> horodatages récents
    this.seq = 0;
  }

  /**
   * @param {{ id: string, name: string, color: string, avatar: string }} player
   * @returns {object} le message publié
   */
  post(player, text, now = Date.now()) {
    const clean = cleanText(text, this.opts.maxLength);
    if (!clean) throw new Error('Message vide.');
    const recent = (this.sentAt.get(player.id) || []).filter((t) => now - t < this.opts.windowMs);
    if (recent.length >= this.opts.burst) throw new Error('Doucement : attends un peu avant d’écrire.');
    recent.push(now);
    this.sentAt.set(player.id, recent);

    const message = {
      id: ++this.seq,
      playerId: player.id,
      name: player.name,
      color: player.color,
      avatar: player.avatar,
      text: clean,
      at: now,
    };
    this.messages.push(message);
    if (this.messages.length > this.opts.historySize) this.messages.shift();
    return message;
  }

  history() {
    return this.messages.slice();
  }
}

module.exports = { Chat, cleanText, CHAT_DEFAULTS };
