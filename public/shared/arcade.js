/*
 * Neon Arcade – shared module used by the home page and every game.
 * Scores are stored on the server (SQLite via /api). The current player name is
 * remembered in localStorage; scores that cannot be sent (server unreachable)
 * are queued locally and re-sent on the next page load.
 *
 * To add a new game: add an entry to GAMES below, then in the game page
 * include <script src="../shared/arcade.js"></script>, call Arcade.requireUser()
 * at startup and Arcade.submitScore('<id>', score, { level }) when a run ends.
 */
(function (global) {
  'use strict';

  const GAMES = [
    {
      id: 'neon-invaders',
      title: 'Neon Invaders',
      description: 'Repoussez les vagues d\'envahisseurs, esquivez les astéroïdes et affrontez le Dreadnought tous les 5 niveaux.',
      url: 'space-invaders/neon_space_invaders_mobile_joystick_menu.html',
      icon: '👾',
      color: '#22d3ee',
      tags: ['Arcade', 'Shoot\'em up', 'Mobile']
    },
    {
      id: 'neon-maze',
      title: 'Neon Maze',
      description: 'Videz le labyrinthe de ses orbes, échappez aux sentinelles et renversez la chasse avec les super-orbes.',
      url: 'neon-maze/neon-maze.html',
      icon: '🟡',
      color: '#facc15',
      tags: ['Arcade', 'Labyrinthe', 'Mobile']
    }
  ];

  const KEYS = { user: 'arcade.currentUser', users: 'arcade.users', pending: 'arcade.pendingScores' };
  const NAME_PATTERN = /^[\p{L}\p{N} _.\-']{2,20}$/u;

  const script = document.currentScript || document.querySelector('script[src$="shared/arcade.js"]');
  const base = script ? script.src : location.href;
  const HOME_URL = new URL('../index.html', base).href;
  const API_URL = new URL('../api/', base).href;

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or disabled */ }
  }

  // Errors flagged "offline" are temporary (network, server down, rate limit): the action can be retried later
  async function api(path, body) {
    let res;
    try {
      res = await fetch(API_URL + path, body === undefined
        ? { cache: 'no-store' }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true });
    } catch (e) {
      throw Object.assign(new Error('Serveur injoignable.'), { offline: true });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(new Error(data.error || `Erreur serveur (${res.status}).`), { offline: res.status >= 500 || res.status === 429 });
    }
    return data;
  }

  function normalizeName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ');
  }
  function validateName(name) {
    const n = normalizeName(name);
    if (n.length < 2) return 'Le nom doit contenir au moins 2 caractères.';
    if (n.length > 20) return 'Le nom doit contenir au maximum 20 caractères.';
    if (!NAME_PATTERN.test(n)) return 'Utilisez uniquement des lettres, chiffres, espaces, « - », « _ », « . » ou « \' ».';
    return null;
  }

  // Players already used on this device (quick re-login)
  function getUsers() { return read(KEYS.users, []); }
  function getUser() { return read(KEYS.user, null); }

  async function login(name) {
    const error = validateName(name);
    if (error) throw new Error(error);
    let finalName = normalizeName(name);
    try {
      // The server returns the existing spelling if the name is already taken (case-insensitive)
      finalName = (await api('login', { name: finalName })).name;
    } catch (e) {
      if (!e.offline) throw e;
    }
    const users = getUsers().filter(u => u.toLowerCase() !== finalName.toLowerCase());
    users.unshift(finalName);
    write(KEYS.users, users.slice(0, 8));
    write(KEYS.user, finalName);
    return finalName;
  }
  function logout() {
    try { localStorage.removeItem(KEYS.user); } catch (e) { /* ignore */ }
  }

  function getGame(id) { return GAMES.find(g => g.id === id) || null; }

  // Resolves to {saved, record, best, rank}, {queued: true} when offline, or null when there is nothing to save
  async function submitScore(gameId, score, extra) {
    const name = getUser();
    score = Math.floor(Number(score) || 0);
    if (!name || score <= 0) return null;
    const payload = Object.assign({}, extra, { game: gameId, name: name, score: score });
    try {
      return await api('scores', payload);
    } catch (e) {
      if (!e.offline) throw e;
      write(KEYS.pending, read(KEYS.pending, []).concat([payload]).slice(-50));
      return { queued: true };
    }
  }

  async function flushPending() {
    const queue = read(KEYS.pending, []);
    if (!queue.length) return;
    const failed = [];
    for (const payload of queue) {
      try { await api('scores', payload); } catch (e) { if (e.offline) failed.push(payload); }
    }
    // Keep anything queued while flushing
    const addedMeanwhile = read(KEYS.pending, []).slice(queue.length);
    write(KEYS.pending, failed.concat(addedMeanwhile));
  }

  async function getLeaderboard(gameId, limit) {
    const data = await api(`leaderboard?game=${encodeURIComponent(gameId)}&limit=${limit || 10}`);
    return data.entries;
  }

  // Resolves to { <gameId>: { best, rank } } for the given (or current) player
  async function getStats(name) {
    name = name || getUser();
    if (!name) return {};
    return (await api(`stats?name=${encodeURIComponent(name)}`)).games;
  }

  // For game pages: redirect to the home page when nobody is logged in
  function requireUser() {
    const user = getUser();
    if (!user) location.replace(HOME_URL);
    return user;
  }

  const ready = getUser() ? flushPending().catch(() => {}) : Promise.resolve();

  global.Arcade = {
    GAMES, HOME_URL, API_URL, ready,
    getUsers, getUser, login, logout, validateName,
    getGame, submitScore, getLeaderboard, getStats, requireUser
  };
})(window);
