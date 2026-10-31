/**
 * Canyon Duel's rules and state. No DOM in here, so a game can be stepped headless.
 *
 * Each player has a field FIELD_W × FIELD_H units with y pointing down. Both fields show the
 * same canyon at the same scroll: something d units up the canyon is drawn at
 * y = FIELD_H - (d - scroll), so it slides down the screen as the scroll grows.
 */

export const FIELD_W = 600;
export const FIELD_H = 800;

/** Ships start 30% up the field and blow up when they're knocked back to the bottom. */
export const SHIP_START_Y = FIELD_H * 0.7;
export const DEATH_Y = FIELD_H - 16;
export const SHIP_SPEED = 430;
const SHIP_HALF_W = 17;
const SHIP_RADIUS = 15;
const ROCK_KNOCKBACK = 46;
const WALL_KNOCKBACK = 20;

/** Scroll speed in units per second, creeping up to MAX_SPEED. */
const START_SPEED = 180;
const MAX_SPEED = 430;
const ACCEL = 2.3;
export const COUNTDOWN = 3;

/** Stepping on the matching arrow this many seconds either side of it reaching the ship catches it... */
export const GOOD_WINDOW = 0.16;
const PERFECT_WINDOW = 0.06;
/** ...and stepping on an arrow this early fumbles it, so mashing doesn't pay. */
const EARLY_WINDOW = 0.36;
/** How far sideways an arrow can be from the ship and still be caught. */
export const CATCH_REACH = 44;
/** An arrow's approach ring appears this many seconds before it arrives. */
export const APPROACH_TIME = 1.2;
const MISSILE_TIME = 0.7;

/** Distance between the canyon's bends, and between the corners drawn along its walls. */
const CANYON_STEP = 700;
export const WALL_STEP = 28;

export const PLAYER_HUES = [193, 326];
export const ARROW_HUES = { up: 110, down: 268 } as const;

export type Phase = 'title' | 'countdown' | 'play' | 'over';
export type Arrow = 'up' | 'down';
export type Point = [number, number];

export interface Rock {
  id: number;
  d: number;
  x: number;
  r: number;
  hue: number;
  angle: number;
  spin: number;
  /** Radius multiplier for each corner. */
  shape: number[];
  /** On rocks a player sent: who sent them. */
  from?: number;
}

export interface Powerup {
  id: number;
  d: number;
  x: number;
  arrow: Arrow;
}

/** A glowing line segment (spark or debris), or an expanding ring. */
export interface Particle {
  ring: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Steady downward drift on top of vy, e.g. to scroll away with the canyon. */
  fall: number;
  angle: number;
  spin: number;
  /** Segment length or ring radius. */
  size: number;
  grow: number;
  hue: number;
  life: number;
  maxLife: number;
}

export interface Label {
  text: string;
  x: number;
  y: number;
  hue: number;
  size: number;
  age: number;
  life: number;
}

export interface Ship {
  index: number;
  hue: number;
  x: number;
  y: number;
  /** Where knockbacks are pushing y to. */
  targetY: number;
  vx: number;
  invuln: number;
  /** Touching a wall: it only knocks you back once per touch, so overshooting on a pad isn't a disaster. */
  onWall: boolean;
  alive: boolean;
  shake: number;
  flash: number;
  /** Rocks this ship has smashed into (the other ship still sees them). */
  smashed: Set<number>;
  /** What happened to each arrow, for this ship. */
  arrows: Map<number, 'caught' | 'fumbled' | 'passed'>;
  /** Extra rocks the other player sent. */
  incoming: Rock[];
  particles: Particle[];
  labels: Label[];
  caught: number;
  sent: number;
  crashes: number;
}

export interface Missile {
  from: number;
  to: number;
  count: number;
  /** 0 → 1 over the flight. */
  t: number;
  /** Launch point in the sender's field, and landing x along the top of the target's. */
  x: number;
  y: number;
  tx: number;
}

export interface Game {
  phase: Phase;
  phaseTime: number;
  /** Seconds since this game was made, for animation. */
  clock: number;
  /** Seconds of racing, which sets the speed. */
  time: number;
  /** How far up the canyon the bottom edge of the view is. */
  scroll: number;
  speed: number;
  ships: Ship[];
  rocks: Rock[];
  powerups: Powerup[];
  missiles: Missile[];
  /** Index of the winning ship, or -1 for a draw. */
  winner: number | null;
  /** The title-screen backdrop: an empty canyon with both ships on autopilot. */
  attract: boolean;
  seed: number;
  rand: () => number;
  canyonRand: () => number;
  canyonX: number[];
  canyonHalf: number[];
  generatedTo: number;
  nextArrowAt: number;
  nextId: number;
}

export interface Input {
  left: boolean;
  right: boolean;
  /** Pressed this frame. */
  up: boolean;
  down: boolean;
}

const NO_INPUT: Input = { left: false, right: false, up: false, down: false };

export const SHIP_HULL: Point[] = [
  [0, -24], [7, -8], [10, 2], [19, 12], [19, 17], [8, 12], [5, 16],
  [-5, 16], [-8, 12], [-19, 17], [-19, 12], [-10, 2], [-7, -8],
];
export const SHIP_COCKPIT: Point[] = [[0, -14], [4, -3], [0, 1], [-4, -3]];
const ARROW: Point[] = [[0, -22], [21, -1], [9, -1], [9, 20], [-9, 20], [-9, -1], [-21, -1]];

export function arrowPoints(arrow: Arrow, size: number): Point[] {
  const flip = arrow === 'up' ? 1 : -1;
  return ARROW.map(([x, y]): Point => [x * size, y * size * flip]);
}

export function rockPoints(rock: Rock, clock: number): Point[] {
  const turn = rock.angle + rock.spin * clock;
  return rock.shape.map((m, i): Point => {
    const a = turn + (i / rock.shape.length) * Math.PI * 2;
    return [Math.cos(a) * rock.r * m, Math.sin(a) * rock.r * m];
  });
}

export function newGame(attract: boolean, seed = (Math.random() * 2 ** 32) >>> 0): Game {
  return {
    phase: attract ? 'title' : 'countdown',
    phaseTime: 0,
    clock: 0,
    time: 0,
    scroll: 0,
    speed: START_SPEED,
    ships: PLAYER_HUES.map((hue, index) => ({
      index,
      hue,
      x: FIELD_W / 2,
      y: SHIP_START_Y,
      targetY: SHIP_START_Y,
      vx: 0,
      invuln: 0,
      onWall: false,
      alive: true,
      shake: 0,
      flash: 0,
      smashed: new Set<number>(),
      arrows: new Map<number, 'caught' | 'fumbled' | 'passed'>(),
      incoming: [],
      particles: [],
      labels: [],
      caught: 0,
      sent: 0,
      crashes: 0,
    })),
    rocks: [],
    powerups: [],
    missiles: [],
    winner: null,
    attract,
    seed,
    rand: mulberry32(seed),
    canyonRand: mulberry32(seed ^ 0x5bd1e995),
    canyonX: [],
    canyonHalf: [],
    generatedTo: 950,
    nextArrowAt: 1800,
    nextId: 1,
  };
}

export function update(game: Game, dt: number, inputs: readonly Input[]): void {
  game.clock += dt;
  game.phaseTime += dt;
  if (game.phase === 'countdown' && game.phaseTime >= COUNTDOWN) setPhase(game, 'play');

  if (game.phase === 'play') {
    game.time += dt;
    game.speed = Math.min(MAX_SPEED, START_SPEED + ACCEL * game.time);
  } else if (game.phase === 'over') {
    game.speed = Math.max(100, game.speed - 90 * dt);
  } else {
    game.speed = game.phase === 'title' ? 130 : START_SPEED;
  }
  game.scroll += game.speed * dt;
  generate(game);

  for (const ship of game.ships) updateShip(game, ship, dt, inputs[ship.index] ?? NO_INPUT);
  updateMissiles(game, dt);

  // Forget whatever has scrolled off the bottom.
  const gone = game.scroll - 120;
  game.rocks = game.rocks.filter((rock) => rock.d > gone);
  game.powerups = game.powerups.filter((p) => p.d > gone);
  for (const ship of game.ships) ship.incoming = ship.incoming.filter((rock) => rock.d > gone);

  if (game.phase === 'play') {
    const alive = game.ships.filter((ship) => ship.alive);
    if (alive.length < game.ships.length) {
      game.winner = alive.length === 1 ? alive[0].index : -1;
      setPhase(game, 'over');
    }
  }
}

function setPhase(game: Game, phase: Phase): void {
  game.phase = phase;
  game.phaseTime = 0;
}

// ---- The canyon ----

/** The canyon's centre line and half-width d units up. Smooth, and the same for both players. */
export function canyonAt(game: Game, d: number): { cx: number; hw: number } {
  const u = Math.max(0, d) / CANYON_STEP;
  const k = Math.floor(u);
  while (game.canyonX.length < k + 2) extendCanyon(game);
  const s = (1 - Math.cos(Math.PI * (u - k))) / 2;
  return {
    cx: lerp(game.canyonX[k], game.canyonX[k + 1], s),
    hw: lerp(game.canyonHalf[k], game.canyonHalf[k + 1], s),
  };
}

function extendCanyon(game: Game): void {
  const k = game.canyonX.length;
  if (k < 2) {
    // Start wide and straight.
    game.canyonX.push(FIELD_W / 2);
    game.canyonHalf.push(205);
    return;
  }
  const rand = game.canyonRand;
  const hw = lerp(190, 135, difficulty(k * CANYON_STEP)) * (0.88 + 0.24 * rand());
  const cx = clamp(game.canyonX[k - 1] + (rand() * 2 - 1) * 170, hw + 26, FIELD_W - hw - 26);
  game.canyonX.push(cx);
  game.canyonHalf.push(hw);
}

/** 0 at the start of the canyon, rising to 1 roughly two minutes in. */
function difficulty(d: number): number {
  return clamp((d - 1200) / 30000, 0, 1);
}

/** Lay out rock rows and arrows a little beyond the top of the view. */
function generate(game: Game): void {
  const horizon = game.scroll + FIELD_H + 300;
  while (game.generatedTo < horizon) {
    const diff = difficulty(game.generatedTo);
    game.generatedTo += lerp(290, 175, diff) * (0.8 + 0.4 * game.rand());
    const d = game.generatedTo;
    if (game.attract || game.phase === 'over') continue;
    if (d >= game.nextArrowAt) {
      const { cx, hw } = canyonAt(game, d);
      const x = cx + (game.rand() * 2 - 1) * (hw - 60);
      game.powerups.push({ id: game.nextId++, d, x, arrow: game.rand() < 0.5 ? 'up' : 'down' });
      game.nextArrowAt = d + lerp(1300, 2300, diff) * (0.8 + 0.4 * game.rand());
    } else {
      addRockRow(game, d, diff);
    }
  }
}

function addRockRow(game: Game, d: number, diff: number): void {
  const rand = game.rand;
  const { cx, hw } = canyonAt(game, d);
  const left = cx - hw;
  const right = cx + hw;
  if (rand() > lerp(0.15, 0.55, diff)) {
    const r = 17 + rand() * 13;
    game.rocks.push(makeRock(game, d, left + r + 6 + rand() * (right - left - 2 * (r + 6)), r));
    return;
  }
  // Two rocks, one either side of a gap the ship is sure to fit through.
  const gapHalf = 52;
  const gap = left + gapHalf + 12 + rand() * (right - left - 2 * (gapHalf + 12));
  for (const side of [-1, 1]) {
    const r = 17 + rand() * 11;
    const lo = side < 0 ? left + r + 4 : gap + gapHalf + r;
    const hi = side < 0 ? gap - gapHalf - r : right - r - 4;
    if (hi > lo) game.rocks.push(makeRock(game, d + (rand() - 0.5) * 30, lo + rand() * (hi - lo), r));
  }
}

function makeRock(game: Game, d: number, x: number, r: number): Rock {
  const rand = game.rand;
  return {
    id: game.nextId++,
    d,
    x,
    r,
    hue: 6 + rand() * 46,
    angle: rand() * Math.PI * 2,
    spin: (rand() - 0.5) * 1.6,
    shape: Array.from({ length: 7 + Math.floor(rand() * 4) }, () => 0.74 + rand() * 0.32),
  };
}

// ---- Ships ----

/** Where something d units up the canyon is drawn (field y). */
export function screenY(game: Game, d: number): number {
  return FIELD_H - (d - game.scroll);
}

function shipD(game: Game, ship: Ship): number {
  return game.scroll + FIELD_H - ship.y;
}

/** Seconds until something d units up the canyon reaches the ship (negative once it's gone past). */
export function timeToShip(game: Game, ship: Ship, d: number): number {
  return (d - shipD(game, ship)) / game.speed;
}

function updateShip(game: Game, ship: Ship, dt: number, input: Input): void {
  let steer = 0;
  if (game.phase === 'title') {
    // Attract mode: weave lazily along the canyon.
    const ahead = canyonAt(game, shipD(game, ship) + 150);
    const want = ahead.cx + Math.sin(game.clock * 0.8 + ship.index * 2.1) * ahead.hw * 0.45;
    steer = clamp((want - ship.x) / 40, -1, 1);
  } else if (ship.alive) {
    steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  }
  ship.vx += (steer * SHIP_SPEED - ship.vx) * Math.min(1, dt * 12);
  ship.x += ship.vx * dt;
  ship.y += (ship.targetY - ship.y) * Math.min(1, dt * 7);
  ship.invuln = Math.max(0, ship.invuln - dt);
  ship.shake = Math.max(0, ship.shake - dt * 2.5);
  ship.flash = Math.max(0, ship.flash - dt * 2.5);

  if (ship.alive) {
    const racing = game.phase === 'play';
    const { cx, hw } = canyonAt(game, shipD(game, ship));
    const min = cx - hw + SHIP_HALF_W;
    const max = cx + hw - SHIP_HALF_W;
    if (ship.x < min || ship.x > max) {
      const side = ship.x < min ? -1 : 1;
      ship.x = clamp(ship.x, min, max);
      ship.vx = 0;
      if (racing && !ship.onWall && ship.invuln <= 0) {
        knock(ship, WALL_KNOCKBACK, 0.4);
        sparks(ship, ship.x + side * SHIP_HALF_W, ship.y, 45, 14, 200, game.speed * 0.5);
      } else if (racing && Math.random() < dt * 25) {
        sparks(ship, ship.x + side * SHIP_HALF_W, ship.y, 45, 1, 160, game.speed * 0.5); // grinding along it
      }
      ship.onWall = true;
    } else if (Math.min(ship.x - min, max - ship.x) > 4) {
      ship.onWall = false;
    }
    if (racing) {
      if (ship.invuln <= 0) hitRocks(game, ship);
      if (input.up) tryCatch(game, ship, 'up');
      if (input.down) tryCatch(game, ship, 'down');
      letArrowsPass(game, ship);
      if (ship.y >= DEATH_Y - 2) explode(ship);
    }
  }
  updateEffects(ship, dt);
}

function knock(ship: Ship, amount: number, invuln: number): void {
  ship.targetY = Math.min(ship.targetY + amount, DEATH_Y + 12);
  ship.invuln = invuln;
  ship.shake = 1;
  ship.flash = 1;
  ship.crashes++;
}

function hitRocks(game: Game, ship: Ship): void {
  for (const list of [game.rocks, ship.incoming]) {
    for (const rock of list) {
      if (ship.smashed.has(rock.id)) continue;
      const y = screenY(game, rock.d);
      const dx = rock.x - ship.x;
      const dy = y - ship.y;
      const reach = rock.r * 0.85 + SHIP_RADIUS;
      if (dx * dx + dy * dy > reach * reach) continue;
      ship.smashed.add(rock.id);
      shatter(ship, rock.x, y, rockPoints(rock, game.clock), rock.hue, 150, game.speed);
      sparks(ship, (rock.x + ship.x) / 2, (y + ship.y) / 2, ship.hue, 16, 260, game.speed * 0.5);
      knock(ship, ROCK_KNOCKBACK, 1.1);
      return;
    }
  }
}

function explode(ship: Ship): void {
  ship.alive = false;
  ship.shake = 1.6;
  ship.flash = 1;
  shatter(ship, ship.x, ship.y, SHIP_HULL, ship.hue, 170, 0);
  sparks(ship, ship.x, ship.y, ship.hue, 40, 340);
  sparks(ship, ship.x, ship.y, 40, 30, 260);
  ring(ship, ship.x, ship.y, ship.hue, 320);
  addLabel(ship, 'WRECKED', FIELD_W / 2, FIELD_H * 0.17, ship.hue, 46, 3); // above the results panel
}

// ---- Arrows and attacks ----

function tryCatch(game: Game, ship: Ship, arrow: Arrow): void {
  // The nearest arrow in line with the ship that's about to arrive or has only just arrived.
  let best: Powerup | undefined;
  let bestT = 0;
  for (const p of game.powerups) {
    if (ship.arrows.has(p.id) || Math.abs(p.x - ship.x) > CATCH_REACH) continue;
    const t = timeToShip(game, ship, p.d);
    if (t > EARLY_WINDOW || t < -GOOD_WINDOW) continue;
    if (!best || Math.abs(t) < Math.abs(bestT)) {
      best = p;
      bestT = t;
    }
  }
  if (!best) return;

  const y = screenY(game, best.d);
  const hue = ARROW_HUES[best.arrow];
  if (best.arrow !== arrow || bestT > GOOD_WINDOW) {
    ship.arrows.set(best.id, 'fumbled');
    shatter(ship, best.x, y, arrowPoints(best.arrow, 1.25), hue, 120, game.speed);
    addLabel(ship, best.arrow !== arrow ? 'WRONG ARROW' : 'TOO EARLY', best.x, y - 40, 0, 24);
    return;
  }

  ship.arrows.set(best.id, 'caught');
  ship.caught++;
  const perfect = Math.abs(bestT) <= PERFECT_WINDOW;
  addLabel(ship, perfect ? 'PERFECT!' : 'GOOD!', ship.x, ship.y - 52, hue, perfect ? 36 : 28);
  sparks(ship, best.x, y, hue, perfect ? 30 : 18, 280);
  ring(ship, best.x, y, hue, 260);
  const rival = game.ships[1 - ship.index];
  if (rival.alive) {
    const count = perfect ? 3 : 2;
    ship.sent += count;
    const tx = canyonAt(game, game.scroll + FIELD_H).cx;
    game.missiles.push({ from: ship.index, to: rival.index, count, t: 0, x: ship.x, y: ship.y, tx });
  }
}

function letArrowsPass(game: Game, ship: Ship): void {
  for (const p of game.powerups) {
    if (ship.arrows.has(p.id) || timeToShip(game, ship, p.d) > -GOOD_WINDOW) continue;
    ship.arrows.set(p.id, 'passed');
    if (Math.abs(p.x - ship.x) <= CATCH_REACH) addLabel(ship, 'MISSED', p.x, ship.y - 44, 0, 22);
  }
}

function updateMissiles(game: Game, dt: number): void {
  for (const missile of game.missiles) {
    missile.t += dt / MISSILE_TIME;
    if (missile.t >= 1) dropRocks(game, game.ships[missile.to], missile.count, missile.from);
  }
  game.missiles = game.missiles.filter((missile) => missile.t < 1);
}

/** Drop a few extra rocks in from the top of a ship's view, never sealing off the canyon. */
function dropRocks(game: Game, ship: Ship, count: number, from: number): void {
  if (!ship.alive || game.phase !== 'play') return;
  const blockers = [...game.rocks.filter((rock) => !ship.smashed.has(rock.id)), ...ship.incoming];
  let d = game.scroll + FIELD_H + 110;
  let placed = 0;
  for (let tries = 0; placed < count && tries < 40; tries++) {
    const r = 21 + Math.random() * 6;
    const { cx, hw } = canyonAt(game, d);
    const x = cx - hw + r + 8 + Math.random() * (2 * hw - 2 * (r + 8));
    const fits =
      blockers.every(
        (rock) => Math.abs(rock.d - d) > rock.r + r + 30 || Math.abs(rock.x - x) > rock.r + r + 2 * SHIP_HALF_W + 24,
      ) && game.powerups.every((p) => Math.abs(p.d - d) > r + 70 || Math.abs(p.x - x) > r + 60);
    if (fits) {
      const rock: Rock = {
        id: game.nextId++,
        d,
        x,
        r,
        hue: PLAYER_HUES[from],
        angle: Math.random() * Math.PI,
        spin: (Math.random() < 0.5 ? -1 : 1) * 2.2,
        shape: Array.from({ length: 12 }, (_, i) => (i % 2 ? 0.5 : 1)),
        from,
      };
      ship.incoming.push(rock);
      blockers.push(rock);
      placed++;
      d += 130;
    } else if (tries % 6 === 5) {
      d += 45;
    }
  }
  if (placed) addLabel(ship, 'INCOMING!', FIELD_W / 2, 70, PLAYER_HUES[from], 36, 1.3);
}

// ---- Effects ----

function sparks(ship: Ship, x: number, y: number, hue: number, count: number, speed: number, fall = 0): void {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const v = speed * (0.3 + Math.random() * 0.7);
    const life = 0.35 + Math.random() * 0.45;
    ship.particles.push({
      ring: false,
      x,
      y,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v,
      fall,
      angle,
      spin: 0,
      size: 4 + Math.random() * 8,
      grow: 0,
      hue,
      life,
      maxLife: life,
    });
  }
}

/** Break an outline into its edges and fling them outwards. */
function shatter(ship: Ship, x: number, y: number, points: Point[], hue: number, speed: number, fall: number): void {
  points.forEach(([ax, ay], i) => {
    const [bx, by] = points[(i + 1) % points.length];
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const out = Math.atan2(my, mx);
    const v = speed * (0.5 + Math.random() * 0.8);
    const life = 0.6 + Math.random() * 0.6;
    ship.particles.push({
      ring: false,
      x: x + mx,
      y: y + my,
      vx: Math.cos(out) * v,
      vy: Math.sin(out) * v,
      fall,
      angle: Math.atan2(by - ay, bx - ax),
      spin: (Math.random() - 0.5) * 10,
      size: Math.hypot(bx - ax, by - ay),
      grow: 0,
      hue,
      life,
      maxLife: life,
    });
  });
}

function ring(ship: Ship, x: number, y: number, hue: number, grow: number): void {
  ship.particles.push({
    ring: true, x, y, vx: 0, vy: 0, fall: 0, angle: 0, spin: 0, size: 8, grow, hue, life: 0.45, maxLife: 0.45,
  });
}

function addLabel(ship: Ship, text: string, x: number, y: number, hue: number, size: number, life = 0.9): void {
  ship.labels.push({ text, x: clamp(x, 100, FIELD_W - 100), y, hue, size, age: 0, life });
}

function updateEffects(ship: Ship, dt: number): void {
  const drag = Math.max(0, 1 - dt * 2.2);
  for (const p of ship.particles) {
    p.x += p.vx * dt;
    p.y += (p.vy + p.fall) * dt;
    p.vx *= drag;
    p.vy *= drag;
    p.angle += p.spin * dt;
    p.size += p.grow * dt;
    p.life -= dt;
  }
  ship.particles = ship.particles.filter((p) => p.life > 0);
  for (const label of ship.labels) {
    label.age += dt;
    label.y -= 24 * dt;
  }
  ship.labels = ship.labels.filter((label) => label.age < label.life);
}

// ---- Maths ----

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A repeatable random number in [0, 1) for an integer and a salt. */
export function hash(i: number, salt: number): number {
  let h = Math.imul(i | 0, 0x9e3779b1) ^ Math.imul((salt | 0) + 0x7f4a7c15, 0x85ebca77);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
