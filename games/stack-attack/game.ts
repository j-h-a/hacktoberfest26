/**
 * Stack Attack's rules, with no drawing or input (main.ts does those).
 *
 * Each player has a well, a queue of pieces waiting to drop in, and any number of pieces falling at once; you steer
 * the oldest (lowest) one, and holding down makes it fall faster. The front of the queue drops in straight away when
 * nothing's falling; otherwise it waits for the drop rate limit (at least that long since the last one dropped in) and
 * for room. The queue gains a piece when you land a regular piece (like the next piece in normal play), or when
 * you've gone IDLE_BONUS seconds without landing anything. Every row you clear puts an extra piece straight into the
 * other player's queue; landing those doesn't queue another piece, so they don't snowball.
 */

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

export const COLS = 10;
export const ROWS = 20;

/** Seconds per row of fall at level 1; each level multiplies it by GRAVITY_PER_LEVEL. */
const GRAVITY_START = 1;
const GRAVITY_PER_LEVEL = 0.85;
const GRAVITY_FASTEST = 0.05;

/** Seconds per row while you hold down (unless the normal fall is already faster). */
const SOFT_DROP = 0.04;

/** The drop rate limit: while a piece is falling, the least time between two leaving the queue. Shortens each level. */
const RELEASE_GAP_START = 5;
const RELEASE_GAP_PER_LEVEL = 0.25;
const RELEASE_GAP_SHORTEST = 2;

/** Land nothing for this long and another piece joins your queue anyway. */
export const IDLE_BONUS = 20;

/** Seconds per level. Both players share the level, so the speed-up is even. */
export const LEVEL_TIME = 30;
const MAX_LEVEL = 15;

/** Pieces in each queue at the start. */
const START_PIECES = 1;

/** Extra pieces sent to the other player for clearing this many rows with one piece. */
export const ATTACK: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4 };

/**
 * A piece resting on the stack locks after this long; moving or turning it restarts that, up to LOCK_RESETS times.
 * Long enough to step off down and onto an arrow to slide a piece under an overhang.
 */
const LOCK_DELAY = 0.7;
const LOCK_RESETS = 15;

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

export type Kind = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export const KINDS: readonly Kind[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

/** A locked square: the kind of piece it came from, X for an extra piece the other player sent, or null if empty. */
export type Cell = Kind | 'X' | null;

export type Point = [x: number, y: number];

const SHAPES: Record<Kind, string[]> = {
  I: ['....', '####', '....', '....'],
  O: ['##', '##'],
  T: ['.#.', '###', '...'],
  S: ['.##', '##.', '...'],
  Z: ['##.', '.##', '...'],
  J: ['#..', '###', '...'],
  L: ['..#', '###', '...'],
};

/** Each kind's four rotations, turning clockwise inside its box. */
export const ROTATIONS = Object.fromEntries(
  KINDS.map((kind) => {
    const rows = SHAPES[kind];
    let cells = rows.flatMap((row, y) => [...row].flatMap((c, x): Point[] => (c === '#' ? [[x, y]] : [])));
    const turns = [cells];
    for (let i = 1; i < 4; i++) turns.push((cells = cells.map(([x, y]): Point => [rows.length - 1 - y, x])));
    return [kind, turns];
  }),
) as Record<Kind, Point[][]>;

/** Where to try a turned piece when its own spot is taken: a simple wall and floor kick. */
const KICKS: Point[] = [[0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [-2, 0], [2, 0]];

export interface Queued {
  kind: Kind;
  /** Sent by the other player: landing it doesn't queue another piece. */
  extra: boolean;
}

export interface Piece extends Queued {
  rot: number;
  x: number;
  y: number;
  /** Seconds towards the next one-row fall. */
  fall: number;
  /** Seconds spent resting on the stack. */
  rest: number;
  resets: number;
}

export function cellsOf(piece: Piece, rot = piece.rot, x = piece.x, y = piece.y): Point[] {
  return ROTATIONS[piece.kind][rot].map(([cx, cy]): Point => [x + cx, y + cy]);
}

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shuffled sets of all seven kinds. Both players get the same seed, so the same order of pieces. */
export class Bag {
  #upcoming: Kind[] = [];
  #random: () => number;

  constructor(seed: number) {
    this.#random = mulberry32(seed);
  }

  peek(count: number): Kind[] {
    while (this.#upcoming.length < count) {
      const set = [...KINDS];
      for (let i = set.length - 1; i > 0; i--) {
        const j = Math.floor(this.#random() * (i + 1));
        [set[i], set[j]] = [set[j], set[i]];
      }
      this.#upcoming.push(...set);
    }
    return this.#upcoming.slice(0, count);
  }

  take(): Kind {
    this.peek(1);
    return this.#upcoming.shift()!;
  }
}

// ---------------------------------------------------------------------------
// Players and the game
// ---------------------------------------------------------------------------

export type GameEvent =
  | { type: 'move' | 'turn' | 'land' | 'bonus' | 'out'; player: number }
  | { type: 'release'; player: number; extra: boolean }
  | { type: 'clear'; player: number; rows: number[]; attack: number }
  | { type: 'level'; level: number };

const emptyRow = (): Cell[] => Array<Cell>(COLS).fill(null);

export class Player {
  readonly index: number;
  readonly bag: Bag;
  board: Cell[][] = Array.from({ length: ROWS }, emptyRow);
  /** Pieces in the well, oldest first. You steer the first one. */
  falling: Piece[] = [];
  /** Pieces waiting to drop in, front first. */
  queue: Queued[] = [];
  /** Seconds since a piece last dropped in from the queue. */
  sinceRelease = Infinity;
  /** Seconds since you last landed a piece. */
  idle = 0;
  /** Holding down: the piece you steer falls faster. */
  softDrop = false;
  lines = 0;
  sent = 0;
  taken = 0;
  out = false;

  constructor(index: number, seed: number) {
    this.index = index;
    this.bag = new Bag(seed);
    for (let i = 0; i < START_PIECES; i++) this.queue.push({ kind: this.bag.take(), extra: false });
  }

  /** The piece you're steering: the oldest one still falling. */
  get active(): Piece | undefined {
    return this.falling[0];
  }
}

/** Do these cells hit a wall, the floor or the stack? (Above the top is open.) */
function hitsStack(p: Player, cells: Point[]): boolean {
  return cells.some(([x, y]) => x < 0 || x >= COLS || y >= ROWS || (y >= 0 && p.board[y][x] !== null));
}

function hitsFalling(p: Player, cells: Point[], self?: Piece): boolean {
  return p.falling.some(
    (other) => other !== self && cellsOf(other).some(([ox, oy]) => cells.some(([x, y]) => x === ox && y === oy)),
  );
}

function fits(p: Player, piece: Piece, rot: number, x: number, y: number): boolean {
  const cells = cellsOf(piece, rot, x, y);
  return !hitsStack(p, cells) && !hitsFalling(p, cells, piece);
}

function onStack(p: Player, piece: Piece): boolean {
  return hitsStack(p, cellsOf(piece, piece.rot, piece.x, piece.y + 1));
}

/** The row the piece would end up on if dropped now. */
export function landingY(p: Player, piece: Piece): number {
  let y = piece.y;
  while (fits(p, piece, piece.rot, piece.x, y + 1)) y++;
  return y;
}

function bottom(piece: Piece): number {
  return Math.max(...cellsOf(piece).map(([, y]) => y));
}

/** Moving a piece that's resting on the stack gives it a little longer before it locks (but not forever). */
function nudged(piece: Piece): void {
  if (piece.rest > 0 && piece.resets < LOCK_RESETS) {
    piece.rest = 0;
    piece.resets++;
  }
}

export class Game {
  readonly players: Player[];
  /** Seconds of play. */
  elapsed = 0;
  level = 1;
  /** What happened since you last emptied this, for sounds and effects. */
  events: GameEvent[] = [];
  /** Set once someone's out: the winner's index, or -1 if both went out together. */
  winner: number | null = null;

  constructor(seed = Math.floor(Math.random() * 2 ** 32)) {
    this.players = [0, 1].map((i) => new Player(i, seed));
  }

  /** Seconds per row of fall. */
  get gravity(): number {
    return Math.max(GRAVITY_FASTEST, GRAVITY_START * GRAVITY_PER_LEVEL ** (this.level - 1));
  }

  /** The drop rate limit, in seconds. */
  get releaseGap(): number {
    return Math.max(RELEASE_GAP_SHORTEST, RELEASE_GAP_START - RELEASE_GAP_PER_LEVEL * (this.level - 1));
  }

  update(dt: number): void {
    if (this.winner !== null) return;
    this.elapsed += dt;
    const level = Math.min(MAX_LEVEL, 1 + Math.floor(this.elapsed / LEVEL_TIME));
    if (level !== this.level) {
      this.level = level;
      this.events.push({ type: 'level', level });
    }
    for (const p of this.players) if (!p.out) this.#tick(p, dt);
    const alive = this.players.filter((p) => !p.out);
    if (alive.length < this.players.length) this.winner = alive.length === 1 ? alive[0].index : -1;
  }

  /** Slide the piece you're steering one column (dx is -1 or 1). */
  move(player: number, dx: number): void {
    const p = this.#steering(player);
    const piece = p?.active;
    if (!p || !piece || !fits(p, piece, piece.rot, piece.x + dx, piece.y)) return;
    piece.x += dx;
    nudged(piece);
    this.events.push({ type: 'move', player });
  }

  /** Turn the piece you're steering clockwise. */
  turn(player: number): void {
    const p = this.#steering(player);
    const piece = p?.active;
    if (!p || !piece || piece.kind === 'O') return;
    const rot = (piece.rot + 1) % 4;
    const kick = KICKS.find(([kx, ky]) => fits(p, piece, rot, piece.x + kx, piece.y + ky));
    if (!kick) return;
    piece.rot = rot;
    piece.x += kick[0];
    piece.y += kick[1];
    nudged(piece);
    this.events.push({ type: 'turn', player });
  }

  #steering(player: number): Player | undefined {
    const p = this.players[player];
    return p && !p.out && this.winner === null ? p : undefined;
  }

  #tick(p: Player, dt: number): void {
    // Dawdle and another piece joins the queue anyway.
    p.idle += dt;
    if (p.idle >= IDLE_BONUS) {
      p.idle -= IDLE_BONUS;
      p.queue.push({ kind: p.bag.take(), extra: false });
      this.events.push({ type: 'bonus', player: p.index });
    }

    p.sinceRelease += dt;
    this.#release(p);
    if (p.out) return;

    // Gravity, lowest piece first so a piece right behind another follows it down.
    const steered = p.active;
    for (const piece of [...p.falling].sort((a, b) => bottom(b) - bottom(a))) {
      const gravity = piece === steered && p.softDrop ? Math.min(SOFT_DROP, this.gravity) : this.gravity;
      piece.fall = Math.min(piece.fall, gravity) + dt; // (capped, so speeding up doesn't jump several rows at once)
      while (piece.fall >= gravity) {
        if (!fits(p, piece, piece.rot, piece.x, piece.y + 1)) {
          piece.fall = gravity; // blocked: fall again as soon as there's room
          break;
        }
        piece.y++;
        piece.fall -= gravity;
      }
      if (!onStack(p, piece)) piece.rest = 0;
      else if ((piece.rest += dt) >= LOCK_DELAY) {
        this.#land(p, piece);
        if (p.out) return;
      }
    }
  }

  /** Drop the front of the queue in: straight away if nothing's falling, else once the rate limit allows and there's room. */
  #release(p: Player): void {
    const next = p.queue[0];
    if (!next || (p.falling.length > 0 && p.sinceRelease < this.releaseGap)) return;
    const piece: Piece = {
      ...next,
      rot: 0,
      x: next.kind === 'O' ? 4 : 3,
      y: next.kind === 'I' ? -1 : 0,
      fall: 0,
      rest: 0,
      resets: 0,
    };
    // The stack's in the way: try a row higher, and if that's blocked too, you're out.
    if (hitsStack(p, cellsOf(piece))) piece.y--;
    if (hitsStack(p, cellsOf(piece))) return this.#knockOut(p);
    // Another falling piece is in the way: wait for it to fall clear.
    if (hitsFalling(p, cellsOf(piece))) return;
    p.queue.shift();
    p.falling.push(piece);
    p.sinceRelease = 0;
    this.events.push({ type: 'release', player: p.index, extra: piece.extra });
  }

  #land(p: Player, piece: Piece): void {
    p.falling.splice(p.falling.indexOf(piece), 1);
    const cells = cellsOf(piece);
    const value: Cell = piece.extra ? 'X' : piece.kind;
    for (const [x, y] of cells) if (y >= 0) p.board[y][x] = value;
    p.idle = 0;
    // Landing a regular piece queues the next one, as in normal play. Extras don't, or they'd snowball.
    if (!piece.extra) p.queue.push({ kind: p.bag.take(), extra: false });
    this.events.push({ type: 'land', player: p.index });

    const rows: number[] = [];
    for (let y = 0; y < ROWS; y++) if (p.board[y].every((c) => c !== null)) rows.push(y);
    if (rows.length) {
      for (const y of rows) {
        p.board.splice(y, 1);
        p.board.unshift(emptyRow());
      }
      p.lines += rows.length;
      const attack = ATTACK[rows.length] ?? 0;
      if (attack) this.#send(p, this.players[1 - p.index], attack);
      this.events.push({ type: 'clear', player: p.index, rows, attack });
    }

    // Any of it still sticking out above the top (after the clear moved it down)? Then you're out.
    for (const [x, y] of cells) {
      if (y >= 0) continue;
      if (y + rows.length < 0) return this.#knockOut(p);
      p.board[y + rows.length][x] = value;
    }
    // The stack moved down: lift any falling piece it now overlaps (rare, needs an overhang).
    if (rows.length) {
      for (const other of p.falling) for (let i = 0; i < 4 && hitsStack(p, cellsOf(other)); i++) other.y--;
    }
  }

  #send(from: Player, to: Player, count: number): void {
    from.sent += count;
    to.taken += count;
    // Straight into their queue, ahead of regular pieces, to drop in as soon as the rate limit allows.
    const extras = Array.from({ length: count }, (): Queued => ({
      kind: KINDS[Math.floor(Math.random() * KINDS.length)],
      extra: true,
    }));
    const at = to.queue.findIndex((q) => !q.extra);
    to.queue.splice(at < 0 ? to.queue.length : at, 0, ...extras);
  }

  #knockOut(p: Player): void {
    if (p.out) return;
    p.out = true;
    this.events.push({ type: 'out', player: p.index });
  }
}
