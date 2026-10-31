/**
 * Hop-tu-Naa's rules and state. No DOM or three.js in here, so a game can be stepped headless.
 *
 * The path has six lanes, 0 on the far left, and runs away from the camera. Distance d is
 * measured along it, and the fairy is always at d = game.scroll. The path is cut into rows
 * ROW_LEN long; the generator blocks cells (lane, row) with pumpkins, rocks, hedges and logs,
 * and always keeps at least one way through open.
 */

export const COLS = 6;
/** Length of one row of the path's grid, in world units (metres, for the score). */
export const ROW_LEN = 1.5;

/** Speed in units per second, rising steadily with time up to MAX_SPEED. */
export const START_SPEED = 7;
export const MAX_SPEED = 15;
const ACCEL = 0.06;
const TITLE_SPEED = 6.5;

/** Sideways speed in lanes per second: LAT_GAIN × the distance still to go, at most LAT_MAX. */
const LAT_GAIN = 18;
const LAT_MAX = 16;

/** A hop lasts this many seconds and carries her over anything but a hedge. */
export const HOP_TIME = 0.55;
/** Hops she can save up, and the seconds it takes to earn each one back. */
export const HOP_CHARGES = 3;
const HOP_RECHARGE = 2.5;

/** Half the fairy's size for collisions: across in lanes, along the path in units. */
const FAIRY_HALF_W = 0.26;
const FAIRY_HALF_D = 0.25;
/** Clipping the front of something by less than this (in lanes) slips her past it instead. */
const GRAZE = 0.14;

export const LIVES = 3;
/** Seconds of passing through things after a crash. */
const GHOST_TIME = 1.6;
export const COUNTDOWN = 3;
/** Empty rows at the start of a game, to cover the countdown. */
const LEAD_IN_ROWS = 18;
/** How far ahead of the fairy the path is laid out. */
const AHEAD = 90;

export type Phase = 'title' | 'countdown' | 'play' | 'over';

/**
 * What the pads asked for this frame. Side by side, the two pads' ← ↓ → panels make six
 * columns, one per lane, and ↑ on either pad hops.
 */
export interface Input {
  /** Lanes whose panels were stepped on this frame, in order: the last one wins. */
  lanes: number[];
  hop: boolean;
}

export type Kind = 'pumpkin' | 'turnip' | 'rock' | 'toadstool' | 'stump' | 'hedge' | 'log';

export interface Obstacle {
  id: number;
  kind: Kind;
  /** Leftmost lane, and how many lanes across (logs lie across several). */
  lane: number;
  lanes: number;
  /** First row, and how many rows along (hedges run along the path). */
  row: number;
  rows: number;
  /** What the fairy bumps into: x0..x1 across in lanes, d0..d1 along the path. */
  x0: number;
  x1: number;
  d0: number;
  d1: number;
  /** Crashed into and burst, so no longer in the way. */
  smashed: boolean;
  /** 0–1, for the renderer to vary sizes and looks. */
  look: number;
}

export interface Fairy {
  /** Position across the path, in lanes. */
  x: number;
  vx: number;
  /** The lane she's heading for. */
  target: number;
  /** Seconds left of the hop she's in; 0 on the ground. */
  hop: number;
  /** Hops saved up, at most HOP_CHARGES; the fraction is the next one building up. */
  hopCharge: number;
  lives: number;
  /** Seconds left of passing through things after a crash. */
  ghost: number;
  /** -1 or 1 while something beside her stops her going that way, else 0. */
  pressing: number;
  crashes: number;
  hops: number;
  alive: boolean;
}

export type GameEvent =
  | { type: 'crash'; obstacle: Obstacle }
  | { type: 'hop' }
  /** ↑ with no hops saved up. */
  | { type: 'nohop' }
  | { type: 'go' }
  | { type: 'over' };

/** A way through that the generator keeps open. */
interface Thread {
  lane: number;
  /** While `door` rows remain, every lane from `from` to `lane` is kept open too. */
  from: number;
  door: number;
  /** Rows until this branch or its rival dead-ends (Infinity for the main way). */
  life: number;
  /** Just branched off: move away from the parent straight away. */
  fresh: boolean;
}

/** The path comes in stretches, each with its own feel. */
type Stretch = 'clear' | 'meadow' | 'patch' | 'hedges' | 'gates';

export interface Game {
  phase: Phase;
  phaseTime: number;
  /** Seconds since this game was made, for animation. */
  clock: number;
  /** Seconds of play. */
  time: number;
  scroll: number;
  /** Where the fairy was when the countdown finished: the score counts from here. */
  startScroll: number;
  speed: number;
  /** 1 just after a crash, easing back to 0: the fairy slows while she recovers. */
  slow: number;
  fairy: Fairy;
  obstacles: Obstacle[];
  /** What happened during the last update, for the renderer. */
  events: GameEvent[];
  /** The title-screen backdrop, steered by the autopilot and never ending. */
  attract: boolean;
  autopilot: boolean;
  rand: () => number;
  nextId: number;
  /** The grid: rows[r - rowBase][lane] is 1 where something stands. */
  rows: Uint8Array[];
  rowBase: number;
  /** The next row to generate. */
  genRow: number;
  threads: Thread[];
  stretches: number;
  lastStretch: Stretch;
  lastHard: Stretch;
}

export function newGame(attract: boolean, seed = (Math.random() * 2 ** 32) >>> 0): Game {
  const game: Game = {
    phase: attract ? 'title' : 'countdown',
    phaseTime: 0,
    clock: 0,
    time: 0,
    scroll: 0,
    startScroll: 0,
    speed: attract ? TITLE_SPEED : START_SPEED,
    slow: 0,
    fairy: {
      x: 2.5,
      vx: 0,
      target: 2.5,
      hop: 0,
      hopCharge: HOP_CHARGES,
      lives: LIVES,
      ghost: 0,
      pressing: 0,
      crashes: 0,
      hops: 0,
      alive: true,
    },
    obstacles: [],
    events: [],
    attract,
    autopilot: attract,
    rand: mulberry32(seed),
    nextId: 1,
    rows: [],
    rowBase: 0,
    genRow: 0,
    threads: [{ lane: 2 + (seed % 2), from: 2, door: 0, life: Infinity, fresh: false }],
    stretches: 0,
    lastStretch: 'clear',
    lastHard: 'clear',
  };
  generate(game);
  return game;
}

/** Speed at distance d: a steady acceleration in time from START_SPEED up to MAX_SPEED. */
export function speedAt(d: number): number {
  return Math.min(MAX_SPEED, Math.sqrt(START_SPEED ** 2 + 2 * ACCEL * Math.max(0, d)));
}

/** Metres flown since the countdown ended. */
export function distance(game: Game): number {
  return game.phase === 'play' || game.phase === 'over' ? Math.max(0, game.scroll - game.startScroll) : 0;
}

export function update(game: Game, dt: number, input: Input): void {
  game.events.length = 0;
  game.clock += dt;
  game.phaseTime += dt;
  if (game.phase === 'countdown' && game.phaseTime >= COUNTDOWN) {
    setPhase(game, 'play');
    game.startScroll = game.scroll;
    game.events.push({ type: 'go' });
  }
  if (game.phase === 'play') game.time += dt;

  const fairy = game.fairy;
  if (fairy.alive && game.autopilot) {
    autopilot(game, dt);
  } else if (fairy.alive && game.phase !== 'title') {
    for (const lane of input.lanes) fairy.target = lane;
    if (input.hop) hop(game);
  }
  fairy.hopCharge = Math.min(HOP_CHARGES, fairy.hopCharge + dt / HOP_RECHARGE);

  game.slow = Math.max(0, game.slow - dt / 1.5);
  if (game.phase === 'title') game.speed = TITLE_SPEED;
  else if (game.phase === 'over') game.speed = Math.max(0, game.speed - 10 * dt);
  else game.speed = speedAt(game.scroll) * (1 - 0.45 * game.slow);

  // Small steps, so a slow frame can't carry her through anything.
  const steps = Math.max(1, Math.ceil(dt * 120));
  for (let i = 0; i < steps; i++) step(game, dt / steps);

  generate(game);
  prune(game);
}

function setPhase(game: Game, phase: Phase): void {
  game.phase = phase;
  game.phaseTime = 0;
}

// ---- Hopping ----

function hop(game: Game): void {
  const fairy = game.fairy;
  if (fairy.hop > 0) return;
  if (fairy.hopCharge < 1) {
    game.events.push({ type: 'nohop' });
    return;
  }
  fairy.hop = HOP_TIME;
  fairy.hopCharge -= 1;
  fairy.hops++;
  game.events.push({ type: 'hop' });
}

// ---- Moving and crashing ----

function step(game: Game, dt: number): void {
  const fairy = game.fairy;
  const frontBefore = game.scroll + FAIRY_HALF_D;
  game.scroll += game.speed * dt;
  fairy.ghost = Math.max(0, fairy.ghost - dt);
  fairy.hop = Math.max(0, fairy.hop - dt);
  const flying = fairy.hop > 0;
  const back = game.scroll - FAIRY_HALF_D;
  const front = game.scroll + FAIRY_HALF_D;
  const solid = fairy.alive && fairy.ghost <= 0;

  // Whatever has just reached her: slip past a glancing touch, crash into anything more.
  let inside = false;
  for (const o of game.obstacles) {
    if (o.smashed || o.d0 > front || o.d1 < back) continue;
    if (flying && o.kind !== 'hedge') continue; // she's above it (land on it, though, and she crashes)
    const overlap = Math.min(fairy.x + FAIRY_HALF_W, o.x1) - Math.max(fairy.x - FAIRY_HALF_W, o.x0);
    if (overlap <= 0) continue;
    if (!solid) {
      inside = true;
      continue;
    }
    if (o.d0 > frontBefore && overlap < GRAZE) {
      const x = fairy.x < (o.x0 + o.x1) / 2 ? o.x0 - FAIRY_HALF_W : o.x1 + FAIRY_HALF_W;
      fairy.x = clamp(x, 0, COLS - 1);
      continue;
    }
    crash(game, o);
    inside = true;
    break;
  }
  // Stay a ghost until she's clear of whatever she went into.
  if (inside && fairy.alive) fairy.ghost = Math.max(fairy.ghost, 0.2);

  // Sideways, as far as anything beside her allows: she can't squeeze past it.
  let lo = 0;
  let hi = COLS - 1;
  if (fairy.alive && fairy.ghost <= 0) {
    for (const o of game.obstacles) {
      if (o.smashed || o.d0 > front || o.d1 < back) continue;
      if (flying && o.kind !== 'hedge') continue;
      if (o.x1 <= fairy.x - FAIRY_HALF_W + 1e-6) lo = Math.max(lo, o.x1 + FAIRY_HALF_W);
      else if (o.x0 >= fairy.x + FAIRY_HALF_W - 1e-6) hi = Math.min(hi, o.x0 - FAIRY_HALF_W);
    }
  }
  fairy.vx = fairy.alive ? clamp((fairy.target - fairy.x) * LAT_GAIN, -LAT_MAX, LAT_MAX) : 0;
  const x = fairy.x + fairy.vx * dt;
  fairy.pressing = 0;
  if (x < lo) {
    fairy.x = lo;
    fairy.vx = 0;
    if (fairy.target < lo - 0.05) fairy.pressing = -1;
  } else if (x > hi) {
    fairy.x = hi;
    fairy.vx = 0;
    if (fairy.target > hi + 0.05) fairy.pressing = 1;
  } else {
    fairy.x = x;
  }
}

function crash(game: Game, o: Obstacle): void {
  const fairy = game.fairy;
  // Pumpkins and rocks burst; she just passes through hedges and logs.
  if (o.kind !== 'hedge' && o.kind !== 'log') o.smashed = true;
  fairy.crashes++;
  fairy.ghost = GHOST_TIME;
  game.slow = 1;
  game.events.push({ type: 'crash', obstacle: o });
  if (game.phase !== 'play' || game.attract) return;
  fairy.lives--;
  if (fairy.lives <= 0) {
    fairy.alive = false;
    fairy.pressing = 0;
    fairy.hop = 0;
    setPhase(game, 'over');
    game.events.push({ type: 'over' });
  }
}

function prune(game: Game): void {
  const behind = game.scroll - 12;
  if (game.obstacles.some((o) => o.d1 < behind)) game.obstacles = game.obstacles.filter((o) => o.d1 >= behind);
  const firstRow = Math.floor(behind / ROW_LEN);
  if (firstRow > game.rowBase + 20) {
    game.rows.splice(0, firstRow - game.rowBase);
    game.rowBase = firstRow;
  }
}

const EMPTY_ROW = new Uint8Array(COLS);

export function rowAt(game: Game, row: number): Uint8Array {
  return game.rows[row - game.rowBase] ?? EMPTY_ROW;
}

// ---- Laying out the path ----

/** 0 at the start, rising to 1 by about two and a half minutes in. */
function difficulty(game: Game, d: number): number {
  return game.attract ? 0.35 : clamp((d - 30) / 1500, 0, 1);
}

function plannedSpeed(game: Game, d: number): number {
  return game.attract ? TITLE_SPEED : speedAt(d);
}

/** Rows a sideways gap needs to stay open for the fairy to get `shift` lanes across at speed v. */
function doorRows(shift: number, v: number): number {
  return Math.ceil((v * (0.18 + shift / LAT_MAX) + 1.1) / ROW_LEN);
}

function generate(game: Game): void {
  while (game.genRow * ROW_LEN < game.scroll + AHEAD) addStretch(game);
}

/**
 * Lay out the next stretch of path. Every stretch keeps its threads (the ways through) open
 * and fills some of the other cells; hard stretches alternate with short easy meadows.
 */
function addStretch(game: Game): void {
  const rand = game.rand;
  const start = game.genRow;
  const D = difficulty(game, start * ROW_LEN);
  const v = plannedSpeed(game, start * ROW_LEN);
  let kind: Stretch;
  let length: number;
  if (game.stretches === 0) {
    kind = 'clear';
    length = game.attract ? 4 : LEAD_IN_ROWS;
  } else if (game.stretches === 1 && !game.attract) {
    kind = 'meadow';
    length = 16;
  } else if (game.lastStretch !== 'meadow') {
    kind = 'meadow';
    length = Math.round(lerp(10, 5, D) + rand() * 4);
  } else {
    const options = (['patch', 'hedges', 'gates'] as const).filter((k) => k !== game.lastHard);
    kind = options[Math.floor(rand() * options.length)];
    game.lastHard = kind;
    length = kind === 'hedges' ? Math.round(16 + 18 * D + rand() * 8) : Math.round(12 + 14 * D + rand() * 6);
  }
  // Gates: a fallen log across the path every few rows, with gaps where the threads are.
  const spacing = Math.max(5, doorRows(3, v) + 2);
  if (kind === 'gates') length = spacing * (3 + Math.floor(3 * D + rand() * 2));

  const rows: Uint8Array[] = [];
  const barriers: number[] = [];
  for (let i = 0; i < length; i++) {
    const r = game.genRow++;
    const barrier = kind === 'gates' && i % spacing === spacing - 1;
    const open = advanceThreads(game, kind, D, plannedSpeed(game, r * ROW_LEN), kind === 'gates' && i % spacing === 0);
    const density = barrier ? 1 : densityOf(kind, D);
    const cells = new Uint8Array(COLS);
    for (let c = 0; c < COLS; c++) cells[c] = !open[c] && rand() < density ? 1 : 0;
    game.rows.push(cells);
    rows.push(cells);
    if (barrier) barriers.push(i);
  }
  addObstacles(game, kind, start, rows, barriers);
  game.stretches++;
  game.lastStretch = kind;
}

function densityOf(kind: Stretch, D: number): number {
  switch (kind) {
    case 'clear':
      return 0;
    case 'meadow':
      return lerp(0.07, 0.2, D);
    case 'patch':
      return lerp(0.32, 0.55, D);
    case 'hedges':
      return lerp(0.86, 1, D);
    case 'gates':
      return lerp(0.04, 0.14, D);
  }
}

/** Move the threads on a row: branch, dead-end, shift sideways. Returns the lanes to keep open. */
function advanceThreads(game: Game, kind: Stretch, D: number, v: number, forceShift: boolean): boolean[] {
  const rand = game.rand;
  // A branch's time is up: a coin decides whether it or its rival dead-ends.
  for (const t of game.threads.slice()) {
    if (t.life === Infinity || --t.life > 0) continue;
    const rivals = game.threads.filter((o) => o !== t);
    if (!rivals.length) {
      t.life = Infinity;
    } else if (rand() < 0.5) {
      game.threads = rivals;
    } else {
      const main = rivals.find((o) => o.life === Infinity) ?? rivals[0];
      game.threads = game.threads.filter((o) => o !== main);
      t.life = Infinity;
    }
  }

  const maxThreads = kind === 'clear' || kind === 'meadow' ? 1 : D > 0.55 ? 3 : 2;
  const branchChance = kind === 'hedges' ? 0.1 : kind === 'patch' ? 0.07 : kind === 'gates' && forceShift ? 0.3 : 0;
  if (game.threads.length < maxThreads && rand() < branchChance) {
    const parent = game.threads[Math.floor(rand() * game.threads.length)];
    if (parent.door === 0) {
      game.threads.push({ lane: parent.lane, from: parent.lane, door: 0, life: 4 + Math.floor(rand() * 8), fresh: true });
    }
  }

  const shiftChance = { clear: 0.05, meadow: 0.1, patch: 0.16, hedges: 0.11, gates: 0 }[kind];
  const maxShift = kind === 'gates' || D > 0.6 ? 3 : 2;
  const open: boolean[] = new Array(COLS).fill(false);
  for (const t of game.threads) {
    if (t.door === 0 && (t.fresh || forceShift || rand() < shiftChance)) {
      const others = game.threads.filter((o) => o !== t).map((o) => o.lane);
      const to = pickLane(rand, t.lane, maxShift, others);
      if (to !== t.lane) {
        t.from = t.lane;
        t.lane = to;
        t.door = doorRows(Math.abs(to - t.from), v);
      }
      t.fresh = false;
    }
    if (t.door > 0) {
      for (let c = Math.min(t.from, t.lane); c <= Math.max(t.from, t.lane); c++) open[c] = true;
      t.door--;
    }
    open[t.lane] = true;
  }
  // Two threads in one lane are one thread.
  game.threads = game.threads.filter(
    (t, i, all) => !all.some((u, j) => j < i && u.lane === t.lane && u.door === 0 && t.door === 0),
  );
  return open;
}

function pickLane(rand: () => number, from: number, maxShift: number, avoid: number[]): number {
  let to = from;
  for (let tries = 0; tries < 6; tries++) {
    const dist = 1 + Math.floor(rand() * maxShift);
    const dir = rand() < 0.5 ? -1 : 1;
    to = from + dir * dist;
    if (to < 0 || to >= COLS) to = from - dir * dist;
    to = clamp(to, 0, COLS - 1);
    if (!avoid.includes(to)) break;
  }
  return to;
}

/** Turn a stretch's blocked cells into things: runs into hedges, gate rows into logs, the rest one by one. */
function addObstacles(game: Game, kind: Stretch, start: number, rows: Uint8Array[], barriers: number[]): void {
  const used = rows.map(() => new Uint8Array(COLS));
  if (kind === 'hedges') {
    for (let c = 0; c < COLS; c++) {
      for (let i = 0; i < rows.length; ) {
        if (!rows[i][c]) {
          i++;
          continue;
        }
        let j = i;
        while (j < rows.length && rows[j][c]) j++;
        if (j - i >= 2) {
          addObstacle(game, 'hedge', c, 1, start + i, j - i);
          for (let k = i; k < j; k++) used[k][c] = 1;
        }
        i = j;
      }
    }
  }
  for (const i of barriers) {
    for (let c = 0; c < COLS; ) {
      if (!rows[i][c]) {
        c++;
        continue;
      }
      let e = c;
      while (e < COLS && rows[i][e]) e++;
      addObstacle(game, 'log', c, e - c, start + i, 1);
      for (let k = c; k < e; k++) used[i][k] = 1;
      c = e;
    }
  }
  for (let i = 0; i < rows.length; i++) {
    for (let c = 0; c < COLS; c++) {
      if (rows[i][c] && !used[i][c]) addObstacle(game, singleKind(game.rand, kind), c, 1, start + i, 1);
    }
  }
}

function singleKind(rand: () => number, kind: Stretch): Kind {
  const r = rand();
  if (kind === 'patch') return r < 0.62 ? 'pumpkin' : r < 0.8 ? 'turnip' : 'rock';
  if (kind === 'hedges') return r < 0.35 ? 'pumpkin' : r < 0.6 ? 'rock' : r < 0.8 ? 'toadstool' : 'stump';
  return r < 0.36 ? 'pumpkin' : r < 0.5 ? 'turnip' : r < 0.7 ? 'rock' : r < 0.85 ? 'toadstool' : 'stump';
}

/** Half-sizes of what the fairy can hit: across in lanes, along in units (hedges fill their rows). */
const BOX: Record<Kind, [halfW: number, halfD: number]> = {
  pumpkin: [0.36, 0.42],
  turnip: [0.32, 0.36],
  rock: [0.38, 0.45],
  toadstool: [0.34, 0.4],
  stump: [0.34, 0.4],
  hedge: [0.42, 0],
  log: [0.45, 0.32],
};

function addObstacle(game: Game, kind: Kind, lane: number, lanes: number, row: number, rows: number): void {
  const [halfW, halfD] = BOX[kind];
  const mid = (row + rows / 2) * ROW_LEN;
  game.obstacles.push({
    id: game.nextId++,
    kind,
    lane,
    lanes,
    row,
    rows,
    x0: lane - halfW,
    x1: lane + lanes - 1 + halfW,
    d0: kind === 'hedge' ? row * ROW_LEN + 0.08 : mid - halfD,
    d1: kind === 'hedge' ? (row + rows) * ROW_LEN - 0.08 : mid + halfD,
    smashed: false,
    look: game.rand(),
  });
}

// ---- Autopilot (title screen, and headless testing) ----

/** Steer by botTarget, hop over anything low that's about to hit, and on the title screen hop now and then for show. */
function autopilot(game: Game, dt: number): void {
  const fairy = game.fairy;
  fairy.target = botTarget(game);
  if (fairy.hop > 0 || fairy.hopCharge < 1) return;
  const showOff = game.attract && Math.random() < dt / 2.5;
  if ((showOff || lowThingAhead(game)) && landingClear(game)) hop(game);
}

/** Is something she could hop over about to reach her? */
function lowThingAhead(game: Game): boolean {
  const f = game.fairy;
  const front = game.scroll + FAIRY_HALF_D;
  return game.obstacles.some(
    (o) =>
      !o.smashed &&
      o.kind !== 'hedge' &&
      o.d0 > front &&
      o.d0 < front + game.speed * 0.15 &&
      o.x0 < f.x + FAIRY_HALF_W &&
      o.x1 > f.x - FAIRY_HALF_W,
  );
}

/** Would a hop now meet no hedge on the way and come down somewhere clear? */
function landingClear(game: Game): boolean {
  const f = game.fairy;
  const land = game.scroll + HOP_TIME * game.speed;
  const lo = Math.min(f.x, f.target) - FAIRY_HALF_W;
  const hi = Math.max(f.x, f.target) + FAIRY_HALF_W;
  return !game.obstacles.some(
    (o) =>
      !o.smashed &&
      o.x0 < hi &&
      o.x1 > lo &&
      (o.kind === 'hedge' ? o.d0 < land + 1 && o.d1 > game.scroll : o.d0 < land + 0.7 && o.d1 > land - 0.7),
  );
}

const BOT_LOOK = 22;
const TRAPPED = 1e9;

/**
 * The lane to head for: look BOT_LOOK rows ahead and work back to find, for each lane, how much
 * sideways moving it takes to get through from there (moving sooner is a little cheaper).
 */
export function botTarget(game: Game): number {
  const r0 = Math.floor(game.scroll / ROW_LEN);
  // Rows that every lane crossed must stay open for, to get `lanes` across at this speed.
  const v = Math.max(game.speed, 1);
  const rowsFor = (lanes: number) => Math.ceil((v * (0.12 + lanes / LAT_MAX)) / ROW_LEN) + 1;
  let cost: Float64Array = new Float64Array(COLS);
  for (let i = BOT_LOOK; i >= 1; i--) {
    const row = rowAt(game, r0 + i);
    const ahead = cost;
    cost = new Float64Array(COLS);
    for (let c = 0; c < COLS; c++) cost[c] = row[c] ? TRAPPED : ahead[c];
    cost = slide(game, r0 + i, cost, 1 + 0.04 * i, rowsFor);
  }
  const c0 = clamp(Math.round(game.fairy.x), 0, COLS - 1);
  const stuck = rowAt(game, r0)[c0] === 1; // a ghost inside something: anywhere goes
  let best = c0;
  let bestCost = Infinity;
  for (let c = 0; c < COLS; c++) {
    if (!stuck && !canCross(game, r0, c0, c, rowsFor(Math.abs(c - c0)))) continue;
    const total = cost[c] + Math.abs(c - c0) - (c === c0 ? 0.01 : 0);
    if (total < bestCost) {
      bestCost = total;
      best = c;
    }
  }
  return best;
}

/** From each open cell of row r, she can slide sideways to a better lane if the way is open for long enough. */
function slide(game: Game, r: number, cost: Float64Array, perLane: number, rowsFor: (lanes: number) => number): Float64Array {
  const out = Float64Array.from(cost);
  const row = rowAt(game, r);
  for (let c = 0; c < COLS; c++) {
    if (row[c]) continue;
    for (let k = 0; k < COLS; k++) {
      if (k === c || !canCross(game, r, c, k, rowsFor(Math.abs(k - c)))) continue;
      out[c] = Math.min(out[c], cost[k] + Math.abs(k - c) * perLane);
    }
  }
  return out;
}

/** Is every lane from a to b open for n rows from row r? */
function canCross(game: Game, r: number, a: number, b: number, n: number): boolean {
  for (let i = 0; i < n; i++) {
    const row = rowAt(game, r + i);
    for (let c = Math.min(a, b); c <= Math.max(a, b); c++) if (row[c]) return false;
  }
  return true;
}

// ---- Helpers ----

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
