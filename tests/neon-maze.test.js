/* Run with Node, or open neon-maze.html through a local static server. */
(() => {
  'use strict';
  const { Game, MAP, DIRS, key, open, position, distances } = typeof module !== 'undefined'
    ? require('../public/neon-maze/maze.js') : NeonMaze;
  const results = [];
  function assert(value, message) { if (!value) throw new Error(message); }
  function test(name, run) {
    try { run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  }
  function playing() {
    const game = new Game(() => .5);
    game.phase = 'playing';
    game.ghosts.forEach(ghost => { ghost.wait = 100; });
    return game;
  }
  function advance(game, seconds) {
    for (let i = 0; i < Math.round(seconds * 120); i++) game.step(1 / 120);
  }

  test('Every pellet and spawn is reachable in the original maze', () => {
    const game = new Game(), field = distances(game.player);
    assert(MAP.length === 21 && MAP.every(row => row.length === 19), 'Invalid maze dimensions');
    MAP.forEach((row, y) => Array.from(row).forEach((cell, x) => {
      if (cell !== '#') assert(field.has(key(x, y)), `Disconnected cell ${x},${y}`);
    }));
    assert(game.ghosts.every(ghost => field.has(key(ghost.x, ghost.y))), 'Unreachable ghost');
    assert([...game.pellets.keys()].every(id => field.has(id)), 'Unreachable pellet');
  });

  test('Buffered turns wait for a valid junction and cannot enter walls', () => {
    const game = playing();
    game.player = { x: 1, y: 1, dir: 0, progress: .4 };
    game.turn(1);
    advance(game, .9);
    const point = position(game.player);
    assert(Math.abs(point.x - 4) < 1e-8 && point.y > 1, 'Buffered turn was lost');
    assert(open(game.player.x, game.player.y), 'Player entered a wall');
    game.player = { x: 1, y: 1, dir: -1, progress: 0 };
    game.turn(3);
    advance(game, .5);
    assert(game.player.x === 1 && game.player.y === 1 && game.player.progress === 0, 'Wall did not block movement');
  });

  test('A mid-corridor reversal preserves position and immediately reverses travel', () => {
    const game = playing();
    game.player = { x: 2, y: 1, dir: 0, progress: .3 };
    const before = position(game.player);
    game.turn(2);
    assert(Math.abs(position(game.player).x - before.x) < 1e-8, 'Reversal teleported the player');
    advance(game, .05);
    assert(position(game.player).x < before.x, 'Player did not reverse');
  });

  test('Pellets score once; super-orbs expire and enable chained captures', () => {
    const game = playing();
    game.player = { x: 2, y: 1, dir: -1, progress: 0 };
    game.collect(); game.collect();
    assert(game.score === 10, 'Pellet was counted twice');
    game.player.x = 1;
    game.collect();
    assert(game.score === 60 && game.power === 8, 'Super-orb not activated');
    const ghost = game.ghosts[0];
    Object.assign(ghost, game.player, { wait: 0 });
    game.collide();
    assert(game.score === 260 && ghost.wait === 2, 'First capture failed');
    game.collide();
    assert(game.score === 260, 'Waiting ghost captured twice');
    Object.assign(game.ghosts[1], game.player, { wait: 0 });
    game.collide();
    assert(game.score === 660, 'Chain bonus failed');
    game.ghosts.forEach(enemy => { enemy.wait = 100; });
    advance(game, 8.1);
    assert(game.power === 0, 'Power did not expire');
  });

  test('Collisions cost only one life, retain pellets and reset actors', () => {
    const game = playing(), count = game.pellets.size;
    game.grace = 0;
    game.ghosts.forEach(ghost => Object.assign(ghost, game.player, { wait: 0 }));
    game.collide();
    assert(game.lives === 2 && game.phase === 'ready', 'Collision did not reset the round');
    assert(game.pellets.size === count && game.grace > 0, 'Progress or protection lost');
    game.phase = 'playing'; game.grace = 0; game.lives = 1;
    Object.assign(game.ghosts[0], game.player, { wait: 0 });
    game.collide();
    assert(game.phase === 'over' && game.lives === 0, 'Game did not end');
    const score = game.score;
    advance(game, 1);
    assert(game.score === score && game.lives === 0, 'Finished game kept running');
  });

  test('Clearing the maze grants a bonus and rebuilds the next level without losing score or lives', () => {
    const game = playing();
    game.lives = 2;
    game.player = { x: 2, y: 1, dir: -1, progress: 0 };
    game.pellets = new Map([[key(2, 1), '.']]);
    game.collect();
    assert(game.phase === 'clear' && game.score === 510, 'Level completion or bonus failed');
    advance(game, 1.7);
    assert(game.level === 2 && game.score === 510 && game.lives === 2, 'Progress was reset');
    assert(game.pellets.size === new Game().pellets.size && game.phase === 'ready', 'Next level not rebuilt');
  });

  test('Sentinel pathfinding selects legal routes, including dead ends', () => {
    const game = playing();
    MAP.forEach((row, y) => Array.from(row).forEach((cell, x) => {
      if (cell === '#') return;
      const ghost = { x, y, dir: 0, progress: 0 };
      for (const power of [0, 5]) {
        game.power = power;
        const dir = game.ghostDirection(ghost, 0), delta = DIRS[dir];
        assert(open(x + delta.x, y + delta.y), `Illegal route at ${x},${y}`);
      }
    }));
  });

  const report = results.map(result => `${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.error ? ': ' + result.error : ''}`).join('\n');
  if (typeof document !== 'undefined') document.getElementById('results').textContent = report;
  console.log(report);
  if (results.some(result => !result.passed)) throw new Error('Neon Maze regression tests failed');
})();
