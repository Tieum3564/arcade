(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n).toLocaleString('fr-FR');
  const medals = ['🥇', '🥈', '🥉'];

  function showLogin() {
    $('homeView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
    $('loginError').textContent = '';
    const users = Arcade.getUsers();
    $('knownPlayers').classList.toggle('hidden', users.length === 0);
    $('knownChips').innerHTML = users.map(u => `<button type="button" class="chip" data-name="${esc(u)}">${esc(u)}</button>`).join('');
    $('nameInput').value = '';
    $('nameInput').focus();
  }

  async function showHome() {
    $('loginView').classList.add('hidden');
    $('homeView').classList.remove('hidden');
    $('playerName').textContent = Arcade.getUser();
    renderGames(null);
    renderBoardSelect();
    setBoardMessage('Chargement…');
    await Arcade.ready;
    renderBoard();
    try { renderGames(await Arcade.getStats()); } catch (e) { renderGames({}); }
  }

  // stats === null while loading
  function renderGames(stats) {
    const cards = Arcade.GAMES.map(g => {
      const s = stats && stats[g.id];
      const best = stats ? (s ? fmt(s.best) : '—') : '…';
      const rank = stats ? (s ? '#' + s.rank : '—') : '…';
      return `<article class="card" data-color="${esc(g.color)}">
        <div class="icon" aria-hidden="true">${g.icon}</div>
        <h3>${esc(g.title)}</h3>
        <div class="tags">${(g.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        <p>${esc(g.description)}</p>
        <div class="stats">
          <div class="stat"><span>Mon record</span><b>${best}</b></div>
          <div class="stat"><span>Classement</span><b>${rank}</b></div>
        </div>
        <div class="actions">
          <a class="btn" href="${esc(g.url)}">▶ Jouer</a>
          <button type="button" class="secondary" data-board="${esc(g.id)}" title="Voir les records">🏆</button>
        </div>
      </article>`;
    });
    cards.push(`<article class="card soon"><div class="icon" aria-hidden="true">✨</div><h3>Bientôt</h3><p>D'autres jeux arrivent prochainement…</p></article>`);
    $('gamesGrid').innerHTML = cards.join('');
    // Set via the CSSOM: inline style attributes are blocked by the CSP (no 'unsafe-inline')
    $('gamesGrid').querySelectorAll('[data-color]').forEach(c => c.style.setProperty('--c', c.dataset.color));
  }

  function renderBoardSelect() {
    const sel = $('boardSelect');
    const current = sel.value;
    sel.innerHTML = Arcade.GAMES.map(g => `<option value="${esc(g.id)}">${esc(g.title)}</option>`).join('');
    if (current && Arcade.getGame(current)) sel.value = current;
  }

  function setBoardMessage(text) {
    $('boardBody').innerHTML = `<tr><td colspan="5" class="empty">${esc(text)}</td></tr>`;
  }

  let boardRequest = 0;
  async function renderBoard() {
    const request = ++boardRequest;
    const gameId = $('boardSelect').value;
    const me = (Arcade.getUser() || '').toLowerCase();
    setBoardMessage('Chargement…');
    let rows;
    try {
      rows = await Arcade.getLeaderboard(gameId, 10);
    } catch (e) {
      if (request === boardRequest) setBoardMessage(`⚠️ Impossible de charger les records : ${e.message}`);
      return;
    }
    if (request !== boardRequest) return; // a newer request (game switched) is in progress
    if (!rows.length) {
      setBoardMessage('Aucun record pour l\'instant. Soyez le premier ! 🚀');
      return;
    }
    $('boardBody').innerHTML = rows.map((e, i) => `<tr class="${e.name.toLowerCase() === me ? 'me' : ''}">
      <td class="rank">${medals[i] || i + 1}</td>
      <td>${esc(e.name)}</td>
      <td class="num"><b>${fmt(e.score)}</b></td>
      <td class="num hide-sm">${e.level != null ? esc(e.level) : '—'}</td>
      <td class="num hide-sm">${new Date(e.date).toLocaleDateString('fr-FR')}</td>
    </tr>`).join('');
  }

  async function doLogin(name) {
    const submit = $('loginForm').querySelector('button[type=submit]');
    submit.disabled = true;
    try {
      await Arcade.login(name);
      showHome();
    } catch (err) {
      $('loginError').textContent = err.message;
      $('nameInput').focus();
    } finally {
      submit.disabled = false;
    }
  }

  $('loginForm').addEventListener('submit', e => { e.preventDefault(); doLogin($('nameInput').value); });
  $('nameInput').addEventListener('input', () => { $('loginError').textContent = ''; });
  $('knownChips').addEventListener('click', e => { const b = e.target.closest('[data-name]'); if (b) doLogin(b.dataset.name); });
  $('switchBtn').addEventListener('click', () => { Arcade.logout(); showLogin(); });
  $('boardSelect').addEventListener('change', renderBoard);
  $('gamesGrid').addEventListener('click', e => {
    const b = e.target.closest('[data-board]');
    if (!b) return;
    $('boardSelect').value = b.dataset.board;
    renderBoard();
    $('leaderboard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  // Refresh scores when coming back from a game via the browser's back button (bfcache)
  addEventListener('pageshow', e => { if (e.persisted && Arcade.getUser()) showHome(); });

  if (Arcade.getUser()) showHome(); else showLogin();
})();
