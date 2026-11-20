(() => {
  'use strict';
  const GAME_ID = 'neon-maze';
  const name = Arcade.requireUser();
  if (!name) return;
  const $ = id => document.getElementById(id);
  const { Game, MAP, position } = NeonMaze;
  const TILE = 32, W = MAP[0].length * TILE, H = MAP.length * TILE;
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const background = document.createElement('canvas'), bg = background.getContext('2d');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const overlays = [$('startOverlay'), $('pauseOverlay'), $('endOverlay')];
  const keyDirections = {
    ArrowRight: 0, KeyD: 0, ArrowDown: 1, KeyS: 1,
    ArrowLeft: 2, KeyA: 2, KeyQ: 2, ArrowUp: 3, KeyW: 3, KeyZ: 3
  };
  let game = new Game(), mode = 'menu', high = 0, last = 0, accumulator = 0, time = 0;
  let particles = [], statusClock = 0, pendingSave = null, needsDraw = true;
  let joyPointer = null;

  $('playerName').textContent = name;

  function prepareCanvas() {
    needsDraw = true;
    const ratio = Math.min(2, devicePixelRatio || 1);
    for (const surface of [canvas, background]) {
      surface.width = W * ratio;
      surface.height = H * ratio;
      surface.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    bg.fillStyle = '#020617';
    bg.fillRect(0, 0, W, H);
    bg.fillStyle = '#071b30';
    bg.strokeStyle = '#22d3ee';
    bg.lineWidth = 1.5;
    bg.shadowColor = '#0891b2';
    bg.shadowBlur = 7;
    MAP.forEach((row, y) => Array.from(row).forEach((cell, x) => {
      if (cell !== '#') return;
      const left = x * TILE, top = y * TILE;
      bg.fillRect(left, top, TILE, TILE);
      bg.beginPath();
      if (NeonMaze.open(x, y - 1)) { bg.moveTo(left, top + 3); bg.lineTo(left + TILE, top + 3); }
      if (NeonMaze.open(x, y + 1)) { bg.moveTo(left, top + TILE - 3); bg.lineTo(left + TILE, top + TILE - 3); }
      if (NeonMaze.open(x - 1, y)) { bg.moveTo(left + 3, top); bg.lineTo(left + 3, top + TILE); }
      if (NeonMaze.open(x + 1, y)) { bg.moveTo(left + TILE - 3, top); bg.lineTo(left + TILE - 3, top + TILE); }
      bg.stroke();
    }));
    bg.shadowBlur = 0;
  }

  function updateHUD() {
    high = Math.max(high, game.score);
    $('score').textContent = game.score.toLocaleString('fr-FR');
    $('high').textContent = high.toLocaleString('fr-FR');
    $('level').textContent = game.level;
    $('lives').textContent = game.lives;
  }

  function updateStatus() {
    let text;
    if (mode === 'paused') text = 'En pause';
    else if (mode === 'over') text = 'Partie terminée';
    else if (mode === 'menu') text = 'Prêt à entrer dans le labyrinthe';
    else if (game.phase === 'ready') text = 'Préparez votre direction !';
    else if (game.phase === 'clear') text = 'Labyrinthe vidé ! Niveau suivant…';
    else if (game.power > 0) text = `Surcharge : ${Math.ceil(game.power)} s · ${game.pellets.size} orbes restants`;
    else text = `${game.pellets.size} orbes restants · Évitez les sentinelles`;
    if ($('status').textContent !== text) $('status').textContent = text;
  }

  function showOverlay(id, focusId) {
    needsDraw = true;
    overlays.forEach(el => el.classList.toggle('hidden', el.id !== id));
    if (focusId) $(focusId).focus();
  }

  function releaseJoystick() {
    const pointer = joyPointer;
    joyPointer = null;
    $('joystickKnob').style.transform = 'translate(0, 0)';
    if (pointer !== null && $('joystick').hasPointerCapture(pointer)) $('joystick').releasePointerCapture(pointer);
  }

  function start() {
    if (pendingSave) return;
    releaseJoystick();
    game = new Game();
    particles = [];
    mode = 'playing';
    accumulator = 0;
    last = performance.now();
    $('menuBtn').disabled = false;
    showOverlay(null);
    $('menuBtn').focus();
    updateHUD();
    updateStatus();
  }

  function pause() {
    if (mode !== 'playing') return;
    mode = 'paused';
    releaseJoystick();
    showOverlay('pauseOverlay', 'resumeBtn');
    updateStatus();
  }

  function resume() {
    if (mode !== 'paused') return;
    mode = 'playing';
    accumulator = 0;
    last = performance.now();
    showOverlay(null, 'menuBtn');
    updateStatus();
  }

  async function finish() {
    if (mode === 'over') return;
    mode = 'over';
    releaseJoystick();
    $('menuBtn').disabled = true;
    $('restartBtn').disabled = true;
    $('endText').textContent = `Score : ${game.score.toLocaleString('fr-FR')} · Niveau ${game.level}`;
    $('saveInfo').textContent = game.score > 0 ? 'Enregistrement du score…' : 'Aucun point à enregistrer.';
    showOverlay('endOverlay', 'homeLink');
    updateHUD();
    updateStatus();
    pendingSave = Arcade.submitScore(GAME_ID, game.score, { level: game.level });
    try {
      const result = await pendingSave;
      if (result && result.queued) {
        $('saveInfo').textContent = 'Serveur indisponible : score conservé sur cet appareil, envoi à la prochaine visite.';
      } else if (result) {
        high = Math.max(high, result.best);
        $('saveInfo').textContent = `${result.record ? 'Nouveau record ! ' : ''}Score enregistré · Classement : #${result.rank}`;
        updateHUD();
      }
    } catch (error) {
      $('saveInfo').textContent = `Score non enregistré : ${error.message}`;
    } finally {
      pendingSave = null;
      $('restartBtn').disabled = false;
    }
  }

  function burst(actor, color) {
    if (reducedMotion) return;
    const point = position(actor);
    for (let i = 0; i < 16; i++) {
      const angle = Math.random() * Math.PI * 2, speed = 25 + Math.random() * 65;
      particles.push({ x: (point.x + .5) * TILE, y: (point.y + .5) * TILE,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: .5, color });
    }
  }

  function drawPlayer() {
    const point = position(game.player), dir = game.player.dir < 0 ? 0 : game.player.dir;
    ctx.save();
    ctx.translate((point.x + .5) * TILE, (point.y + .5) * TILE);
    ctx.rotate(dir * Math.PI / 2);
    ctx.globalAlpha = game.grace > 0 && !reducedMotion ? .6 + .4 * Math.sin(time * 16) ** 2 : 1;
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(13, 0); ctx.lineTo(-7, 11); ctx.lineTo(-3, 0); ctx.lineTo(-7, -11); ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff7b0';
    ctx.beginPath(); ctx.arc(1, 0, 3, 0, Math.PI * 2); ctx.fill();
    if (game.power > 0) {
      ctx.strokeStyle = '#a5f3fc'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawGhost(ghost) {
    const point = position(ghost);
    const frightened = game.power > 0 && ghost.wait <= 0;
    const color = frightened ? (game.power < 2 && Math.sin(time * 15) > 0 ? '#e5f7ff' : '#60a5fa') : ghost.color;
    ctx.save();
    ctx.translate((point.x + .5) * TILE, (point.y + .5) * TILE);
    ctx.globalAlpha = ghost.wait > 0 ? .35 : 1;
    ctx.shadowColor = color; ctx.shadowBlur = 10;
    ctx.fillStyle = '#081827'; ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 3 * i - Math.PI / 6;
      const x = Math.cos(angle) * 12, y = Math.sin(angle) * 12;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.fillRect(-7, -4, 5, 5); ctx.fillRect(2, -4, 5, 5);
    ctx.fillRect(frightened ? -5 : -3, 5, frightened ? 10 : 6, 2);
    ctx.restore();
  }

  function draw() {
    ctx.drawImage(background, 0, 0, W, H);
    ctx.fillStyle = '#bae6fd';
    ctx.beginPath();
    for (const [id, pellet] of game.pellets) {
      if (pellet !== '.') continue;
      const x = (id % MAP[0].length + .5) * TILE, y = (Math.floor(id / MAP[0].length) + .5) * TILE;
      ctx.moveTo(x + 2.4, y); ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.fillStyle = '#f0abfc'; ctx.shadowColor = '#e879f9'; ctx.shadowBlur = 16;
    for (const [id, pellet] of game.pellets) {
      if (pellet !== 'o') continue;
      const x = (id % MAP[0].length + .5) * TILE, y = (Math.floor(id / MAP[0].length) + .5) * TILE;
      ctx.beginPath(); ctx.arc(x, y, reducedMotion ? 7 : 6.5 + Math.sin(time * 5), 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
    game.ghosts.forEach(drawGhost);
    drawPlayer();
    for (const particle of particles) {
      ctx.globalAlpha = Math.max(0, particle.life * 2);
      ctx.fillStyle = particle.color; ctx.fillRect(particle.x, particle.y, 3, 3);
    }
    ctx.globalAlpha = 1;
    if (mode === 'playing' && (game.phase === 'ready' || game.phase === 'clear')) {
      ctx.fillStyle = '#020617dd'; ctx.fillRect(72, H / 2 - 30, W - 144, 60);
      ctx.fillStyle = game.phase === 'clear' ? '#f0abfc' : '#67e8f9';
      ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(game.phase === 'clear' ? 'SECTEUR NETTOYÉ' : `NIVEAU ${game.level} · PRÊT ?`, W / 2, H / 2 + 8);
    }
  }

  function loop(now) {
    const dt = Math.min(Math.max(0, (now - last) / 1000), .05);
    last = now;
    if (!document.hidden) {
      if (!reducedMotion && mode === 'playing') time += dt;
      if (mode === 'playing') {
        accumulator += dt;
        while (accumulator >= 1 / 120 && mode === 'playing') {
          const events = game.step(1 / 120);
          accumulator -= 1 / 120;
          if (events.length) {
            if (events.includes('power')) burst(game.player, '#f0abfc');
            if (events.includes('capture')) burst(game.player, '#60a5fa');
            updateHUD();
            updateStatus();
            if (events.includes('over')) finish();
          }
        }
        particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
        particles = particles.filter(p => p.life > 0);
      }
      statusClock += dt;
      if (statusClock >= .25) { updateStatus(); statusClock = 0; }
      if (mode === 'playing' || needsDraw) {
        draw();
        needsDraw = false;
      }
    }
    requestAnimationFrame(loop);
  }

  function updateJoystick(event) {
    const rect = $('joystick').getBoundingClientRect(), max = rect.width * .32;
    let dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2;
    const length = Math.hypot(dx, dy);
    if (length > max) { dx *= max / length; dy *= max / length; }
    $('joystickKnob').style.transform = `translate(${dx}px, ${dy}px)`;
    if (length > max * .22 && mode === 'playing') {
      game.turn(Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3));
    }
  }

  const joystick = $('joystick');
  joystick.addEventListener('pointerdown', event => {
    if (mode !== 'playing' || joyPointer !== null || event.button !== 0) return;
    event.preventDefault();
    joyPointer = event.pointerId;
    joystick.setPointerCapture(joyPointer);
    updateJoystick(event);
  });
  joystick.addEventListener('pointermove', event => {
    if (event.pointerId === joyPointer) { event.preventDefault(); updateJoystick(event); }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    joystick.addEventListener(type, event => { if (event.pointerId === joyPointer) releaseJoystick(); });
  }

  addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code in keyDirections && mode === 'playing') {
      event.preventDefault();
      game.turn(keyDirections[event.code]);
    }
    if ((event.code === 'KeyP' || event.code === 'Escape') && !event.repeat) {
      if (mode === 'playing') pause(); else if (mode === 'paused') resume();
    }
    if (event.code === 'Tab' && mode !== 'playing') {
      const overlay = overlays.find(el => !el.classList.contains('hidden'));
      if (!overlay) return;
      const focusable = Array.from(overlay.querySelectorAll('button:not(:disabled), a[href]'));
      const first = focusable[0], end = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) {
        event.preventDefault(); end.focus();
      } else if (!event.shiftKey && (document.activeElement === end || !overlay.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
  });
  $('startBtn').addEventListener('click', start);
  $('restartBtn').addEventListener('click', start);
  $('menuBtn').addEventListener('click', pause);
  $('resumeBtn').addEventListener('click', resume);
  $('endBtn').addEventListener('click', finish);
  $('homeLink').addEventListener('click', async event => {
    if (!pendingSave) return;
    event.preventDefault();
    // Let finish() report the outcome before leaving, without duplicating submissions.
    await pendingSave.then(() => { location.href = Arcade.HOME_URL; }, () => {});
  });
  addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  addEventListener('resize', () => { releaseJoystick(); prepareCanvas(); });
  prepareCanvas();
  updateHUD();
  $('startBtn').focus();
  Arcade.ready.then(() => Arcade.getStats()).then(stats => {
    if (stats[GAME_ID]) { high = Math.max(high, stats[GAME_ID].best); updateHUD(); }
  }).catch(error => {
    const note = document.createElement('p');
    note.className = 'tiny';
    note.textContent = `Record indisponible : ${error.message}`;
    $('startOverlay').querySelector('.panel').append(note);
  });
  requestAnimationFrame(loop);
})();
