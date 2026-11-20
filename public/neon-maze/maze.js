(function (root) {
  'use strict';

  const MAP = [
    '###################',
    '#o......#.#......o#',
    '#.##.##.#.#.##.##.#',
    '#.................#',
    '#.##.#.#####.#.##.#',
    '#....#...#...#....#',
    '####.###.#.###.####',
    '#....#.......#....#',
    '#.##.#.## ##.#.##.#',
    '#......#   #......#',
    '#.##.#.#####.#.##.#',
    '#....#.......#....#',
    '#.####.##.##.####.#',
    '#........ ........#',
    '#.##.###.#.###.##.#',
    '#..#.....#.....#..#',
    '##.#.#.#####.#.#.##',
    '#....#...#...#....#',
    '#.######.#.######.#',
    '#o...............o#',
    '###################'
  ];
  const DIRS = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
  const SPAWN = { x: 9, y: 13 };
  const HOMES = [{ x: 9, y: 7 }, { x: 8, y: 9 }, { x: 9, y: 9 }, { x: 10, y: 9 }];
  const COLORS = ['#fb7185', '#c084fc', '#22d3ee', '#fb923c'];
  const key = (x, y) => y * MAP[0].length + x;
  const open = (x, y) => y >= 0 && y < MAP.length && x >= 0 && x < MAP[0].length && MAP[y][x] !== '#';
  const canMove = (actor, dir) => dir >= 0 && open(actor.x + DIRS[dir].x, actor.y + DIRS[dir].y);
  const position = actor => ({
    x: actor.x + (actor.dir < 0 ? 0 : DIRS[actor.dir].x * actor.progress),
    y: actor.y + (actor.dir < 0 ? 0 : DIRS[actor.dir].y * actor.progress)
  });
  const makeActor = (cell, dir = -1) => ({ x: cell.x, y: cell.y, dir, progress: 0 });

  function distances(target) {
    const result = new Map([[key(target.x, target.y), 0]]);
    const queue = [target];
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i], distance = result.get(key(cell.x, cell.y)) + 1;
      for (const dir of DIRS) {
        const x = cell.x + dir.x, y = cell.y + dir.y, id = key(x, y);
        if (open(x, y) && !result.has(id)) {
          result.set(id, distance);
          queue.push({ x, y });
        }
      }
    }
    return result;
  }

  // Actors only turn at tile centres; leftover distance is preserved across turns.
  function move(actor, distance, choose, arrive) {
    while (distance > 0) {
      if (actor.progress === 0) {
        actor.dir = choose(actor);
        if (!canMove(actor, actor.dir)) { actor.dir = -1; return; }
      }
      const amount = Math.min(distance, 1 - actor.progress);
      actor.progress += amount;
      distance -= amount;
      if (actor.progress >= 1 - 1e-9) {
        actor.x += DIRS[actor.dir].x;
        actor.y += DIRS[actor.dir].y;
        actor.progress = 0;
        if (arrive && arrive() === false) return;
      }
    }
  }

  class Game {
    constructor(random = Math.random) {
      this.random = random;
      this.score = 0;
      this.level = 1;
      this.lives = 3;
      this.events = [];
      this.buildLevel();
    }

    buildLevel() {
      this.pellets = new Map();
      MAP.forEach((row, y) => Array.from(row).forEach((cell, x) => {
        if (cell === '.' || cell === 'o') this.pellets.set(key(x, y), cell);
      }));
      this.resetActors();
    }

    resetActors() {
      this.player = makeActor(SPAWN);
      this.next = -1;
      this.ghosts = HOMES.map((home, i) => Object.assign(makeActor(home), { home, color: COLORS[i], wait: i * 1.6 }));
      this.power = 0;
      this.combo = 0;
      this.grace = 2;
      this.clock = 0;
      this.phase = 'ready';
      this.timer = 1.2;
    }

    turn(dir) {
      if (!Number.isInteger(dir) || dir < 0 || dir > 3) throw new RangeError('Direction invalide');
      this.next = dir;
      // Reversing mid-corridor must be immediate, including on touch screens.
      if (this.player.progress > 0 && dir === (this.player.dir + 2) % 4) {
        const delta = DIRS[this.player.dir];
        this.player.x += delta.x;
        this.player.y += delta.y;
        this.player.progress = 1 - this.player.progress;
        this.player.dir = dir;
      }
    }

    collect() {
      const id = key(this.player.x, this.player.y), pellet = this.pellets.get(id);
      if (!pellet) return;
      this.pellets.delete(id);
      this.score += pellet === 'o' ? 50 : 10;
      if (pellet === 'o') {
        this.power = Math.max(3, 8 - (this.level - 1) * .5);
        this.combo = 0;
        this.events.push('power');
      }
      this.events.push('score');
      if (!this.pellets.size) {
        this.score += 500 * this.level;
        this.phase = 'clear';
        this.timer = 1.6;
        this.events.push('clear');
      }
    }

    ghostDirection(ghost, index) {
      let choices = DIRS.map((_, dir) => dir).filter(dir => canMove(ghost, dir));
      const forward = choices.filter(dir => dir !== (ghost.dir + 2) % 4);
      if (forward.length) choices = forward;
      if (!choices.length) return -1;
      const scatter = this.clock % 24 < 5;
      let target = this.player;
      if (scatter) {
        target = [{ x: 17, y: 1 }, { x: 1, y: 1 }, { x: 17, y: 19 }, { x: 1, y: 19 }][index];
      } else if (index === 1 && this.player.dir >= 0) {
        const delta = DIRS[this.player.dir];
        for (let n = 3; n > 0; n--) {
          const x = this.player.x + delta.x * n, y = this.player.y + delta.y * n;
          if (open(x, y)) { target = { x, y }; break; }
        }
      } else if (index === 3 && Math.hypot(ghost.x - this.player.x, ghost.y - this.player.y) < 5) {
        target = { x: 1, y: 19 };
      }
      const field = distances(this.power > 0 ? this.player : target);
      const ranked = choices.map(dir => ({
        dir,
        distance: field.get(key(ghost.x + DIRS[dir].x, ghost.y + DIRS[dir].y))
      }));
      ranked.sort((a, b) => this.power > 0 ? b.distance - a.distance : a.distance - b.distance);
      if (this.power > 0 && this.random() < .18) return choices[Math.floor(this.random() * choices.length)];
      return ranked[0].dir;
    }

    collide() {
      const player = position(this.player);
      for (const ghost of this.ghosts) {
        if (ghost.wait > 0) continue;
        const enemy = position(ghost);
        if (Math.hypot(player.x - enemy.x, player.y - enemy.y) >= .7) continue;
        if (this.power > 0) {
          this.score += 200 * 2 ** Math.min(this.combo++, 3);
          Object.assign(ghost, makeActor(ghost.home), { wait: 2 });
          this.events.push('capture', 'score');
        } else if (this.grace <= 0) {
          this.lives--;
          this.events.push('life');
          if (!this.lives) {
            this.phase = 'over';
            this.events.push('over');
          } else {
            this.resetActors();
          }
          return;
        }
      }
    }

    step(dt) {
      if (!Number.isFinite(dt) || dt < 0 || dt > .05) throw new RangeError('Pas de simulation invalide');
      this.events = [];
      if (this.phase === 'over') return this.events;
      if (this.phase === 'ready' || this.phase === 'clear') {
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.phase === 'clear') {
            this.level++;
            this.buildLevel();
            this.events.push('level');
          } else {
            this.phase = 'playing';
            this.events.push('ready');
          }
        }
        return this.events;
      }
      this.clock += dt;
      this.power = Math.max(0, this.power - dt);
      this.grace = Math.max(0, this.grace - dt);
      const speed = Math.min(6, 4.7 + (this.level - 1) * .12);
      move(this.player, speed * dt, actor => canMove(actor, this.next) ? this.next : actor.dir, () => {
        this.collect();
        return this.phase === 'playing';
      });
      if (this.phase !== 'playing') return this.events;
      this.ghosts.forEach((ghost, i) => {
        if (ghost.wait > 0) { ghost.wait = Math.max(0, ghost.wait - dt); return; }
        const ghostSpeed = this.power > 0 ? 2.3 : Math.min(4.9, 3.2 + (this.level - 1) * .14);
        move(ghost, ghostSpeed * dt, () => this.ghostDirection(ghost, i));
      });
      this.collide();
      return this.events;
    }
  }

  const engine = { Game, MAP, DIRS, SPAWN, HOMES, key, open, position, distances };
  if (typeof module !== 'undefined' && module.exports) module.exports = engine;
  else root.NeonMaze = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
