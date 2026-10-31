import '../../src/lib/theme.css';
import './style.css';
import { Pads } from '../../src/lib/pads';
import {
  COLS,
  ROTATIONS,
  ROWS,
  Game,
  cellsOf,
  landingY,
  type GameEvent,
  type Kind,
  type Piece,
  type Player,
} from './game';

const pads = new Pads({ autoPoll: false });
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;

const PLAYER_COLORS = ['#3ad6ff', '#ff4fb3'];
const ACCENT = '#ffd84a';
const TEXT = '#f3f4ff';
const MUTED = '#a4a9d2';
const DANGER = '#ff5566';
const FONT = "ui-rounded, 'SF Pro Rounded', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const COLORS: Record<Kind | 'X', string> = {
  I: '#3ad6ff',
  O: '#ffd84a',
  T: '#b26bff',
  S: '#46e68b',
  Z: '#ff5577',
  J: '#4d7cff',
  L: '#ff9a3d',
  X: '#8b90b5', // extra pieces the other player sent
};

/** Hold left or right: wait this long, then keep sliding one column this often (seconds). */
const REPEAT_DELAY = 0.3;
const REPEAT_EVERY = 0.09;
const COUNTDOWN = 3;
const SHOT_TIME = 0.55;
const SHAKE_TIME = 0.35;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type Phase = 'title' | 'countdown' | 'playing' | 'paused' | 'over';
let phase: Phase = 'title';
let phaseTime = 0;
let game = new Game();
const wins = [0, 0];
/**
 * For each player: how long they've stood on left/right (to keep sliding), whether they've pressed down since this
 * piece came in (to make it fall faster), and the piece they were steering at the time.
 */
const held = [
  { left: 0, right: 0 },
  { left: 0, right: 0 },
];
const dropping = [false, false];
const steering: (Piece | undefined)[] = [undefined, undefined];

interface Popup {
  player: number;
  text: string;
  color: string;
  /** Text height in cells, and the board row it starts at. */
  size: number;
  row: number;
  age: number;
  life: number;
}
/** An attack flying from one board to the other's queue. */
interface Shot {
  from: number;
  to: number;
  count: number;
  age: number;
}
let popups: Popup[] = [];
let shots: Shot[] = [];
let flashes: { player: number; rows: number[]; age: number }[] = [];
const shake = [0, 0];
/** How far each queue is still sliding in towards the board after its front piece dropped in, in slots. */
const slide = [0, 0];
/** When each queued piece first showed up, so new arrivals can pop in. */
const firstSeenAt = new WeakMap<object, number>();

function setPhase(next: Phase): void {
  phase = next;
  phaseTime = 0;
}

function startRound(): void {
  game = new Game();
  for (const h of held) h.left = h.right = 0;
  popups = [];
  shots = [];
  flashes = [];
  shake.fill(0);
  slide.fill(0);
  setPhase('countdown');
  sfx.count(false);
}

// For poking at the game from the browser console while developing: stackAttack.game.players[0].board ...
if (import.meta.env.DEV) Object.assign(window, { stackAttack: { get game() { return game; } } });

function popup(player: number, text: string, color: string, size: number, life = 1.1, row = 7): void {
  popups.push({ player, text, color, size, row, life, age: 0 });
}

// ---------------------------------------------------------------------------
// Loop and input
// ---------------------------------------------------------------------------

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  pads.poll();
  handleInput(dt);
  advance(dt);
  for (const event of game.events.splice(0)) react(event);
  age(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function handleInput(dt: number): void {
  if (pads.wasPressed('start')) {
    wakeAudio();
    if (phase === 'title' || (phase === 'over' && phaseTime > 1)) startRound();
    else if (phase === 'playing') setPhase('paused');
    else if (phase === 'paused') setPhase('playing');
  }
  if (phase !== 'playing') return;

  for (const player of game.players) {
    const i = player.index;
    // A new piece to steer starts still, even if you're still standing on an arrow from the last one.
    if (player.active !== steering[i]) {
      steering[i] = player.active;
      held[i].left = held[i].right = 0;
      dropping[i] = false;
    }
    for (const [dir, dx, other] of [
      ['left', -1, 'right'],
      ['right', 1, 'left'],
    ] as const) {
      if (pads.wasPressed(dir, i)) {
        held[i][dir] = 0;
        game.move(i, dx);
      } else if (pads.isDown(dir, i) && !pads.isDown(other, i)) {
        // Keep standing on it to keep sliding (but not when standing on both arrows).
        held[i][dir] += dt;
        while (held[i][dir] >= REPEAT_DELAY) {
          held[i][dir] -= REPEAT_EVERY;
          game.move(i, dx);
        }
      }
    }
    if (pads.wasPressed('up', i)) game.turn(i);
    if (pads.wasPressed('down', i)) dropping[i] = true;
    player.softDrop = dropping[i] && pads.isDown('down', i);
  }
}

function advance(dt: number): void {
  const before = phaseTime;
  phaseTime += dt;
  if (phase === 'countdown') {
    if (phaseTime >= COUNTDOWN) {
      setPhase('playing');
      sfx.count(true);
      for (const i of [0, 1]) popup(i, 'GO!', ACCENT, 2.6, 0.7, 9);
    } else if (Math.ceil(COUNTDOWN - phaseTime) < Math.ceil(COUNTDOWN - before)) {
      sfx.count(false);
    }
  } else if (phase === 'playing') {
    game.update(dt);
    if (game.winner !== null) {
      if (game.winner >= 0) wins[game.winner]++;
      setPhase('over');
    }
  }
}

/** Sounds and effects for what just happened in the game. */
function react(event: GameEvent): void {
  switch (event.type) {
    case 'move':
      sfx.move();
      break;
    case 'turn':
      sfx.turn();
      break;
    case 'release':
      slide[event.player] += 1;
      sfx.release(event.extra);
      break;
    case 'land':
      sfx.land();
      break;
    case 'clear': {
      const rows = event.rows.length;
      flashes.push({ player: event.player, rows: event.rows, age: 0 });
      const name = ['', '', 'DOUBLE', 'TRIPLE!', 'QUAD!!'][rows];
      if (name) popup(event.player, name, rows >= 3 ? ACCENT : TEXT, rows >= 3 ? 1.7 : 1.2);
      if (event.attack) {
        popup(event.player, `+${event.attack} ${event.player === 0 ? '▶' : '◀'}`, PLAYER_COLORS[event.player], 1.3, 1.3, 9);
        shots.push({ from: event.player, to: 1 - event.player, count: event.attack, age: 0 });
        sfx.attack();
      }
      sfx.clear(rows);
      break;
    }
    case 'bonus':
      popup(event.player, '+1 PIECE', MUTED, 0.8, 0.9, 3);
      sfx.bonus();
      break;
    case 'level':
      for (const i of [0, 1]) popup(i, 'SPEED UP', ACCENT, 1.3);
      sfx.level();
      break;
    case 'out':
      shake[event.player] = SHAKE_TIME * 2;
      sfx.out();
      break;
  }
}

function age(dt: number): void {
  shots = shots.filter((shot) => {
    shot.age += dt;
    if (shot.age < SHOT_TIME) return true;
    shake[shot.to] = SHAKE_TIME;
    popup(shot.to, 'INCOMING!', DANGER, 1.3, 1.1, 4);
    sfx.incoming();
    return false;
  });
  popups = popups.filter((p) => (p.age += dt) < p.life);
  flashes = flashes.filter((f) => (f.age += dt) < 0.35);
  for (const i of [0, 1]) {
    shake[i] = Math.max(0, shake[i] - dt);
    slide[i] = slide[i] < 0.01 ? 0 : slide[i] * Math.exp(-10 * dt);
  }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/**
 * Everything is measured in cells (board squares). The two boards (10 wide) and the middle (5) are centred, and each
 * player's panel sits outside their board, a gap away, in whatever room is left. Down: names (2.5), boards (20),
 * footer (2).
 */
interface Layout {
  cell: number;
  /** The left edge of P1's board. */
  left: number;
  top: number;
  /** Queue slot size and spacing in pixels: full size when there's room for all of them, smaller when there isn't. */
  slot: number;
  step: number;
}
const GAP = 0.6;
/** The panel width the boards always leave room for (the stats need about 4.2). */
const MIN_PANEL = 6;
/** Queue slots at full size: size and spacing in cells, and how many show. */
const SLOT = 2.2;
const SLOT_STEP = 2.5;
const SLOTS = 5;

function layout(w: number, h: number): Layout {
  const cell = Math.max(6, Math.floor(Math.min(w / (2 * (COLS + GAP + MIN_PANEL) + 6), h / 24.5)));
  const left = (w - (2 * COLS + 5) * cell) / 2;
  const room = left - (GAP + 0.4) * cell; // from the panel's inner edge to just short of the screen edge
  const scale = Math.min(1, room / ((SLOT + (SLOTS - 1) * SLOT_STEP) * cell));
  const top = (h - 24.5 * cell) / 2 + 2.5 * cell;
  return { cell, left, top, slot: SLOT * cell * scale, step: SLOT_STEP * cell * scale };
}
const boardX = (i: number, L: Layout) => L.left + i * (COLS + 5) * L.cell;
const midX = (L: Layout) => L.left + (COLS + 2.5) * L.cell;
/** The edge of a player's panel next to their board. */
const innerX = (i: number, L: Layout) => L.left + (i === 0 ? -GAP : 2 * COLS + 5 + GAP) * L.cell;
/** The left edge of queue slot k, counting out from the board (0 is the front). Fractional while sliding. */
const slotX = (i: number, k: number, L: Layout) =>
  i === 0 ? innerX(0, L) - L.slot - k * L.step : innerX(1, L) + k * L.step;
const slotY = (L: Layout) => L.top + 0.9 * L.cell;

function draw(): void {
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const L = layout(w, h);
  for (const player of game.players) drawPlayer(player, L);
  drawMiddle(L);
  drawShots(L);
  drawPopups(L);
  drawOverlay(L, w, h);
}

function drawPlayer(p: Player, L: Layout): void {
  const { cell, top: y } = L;
  const color = PLAYER_COLORS[p.index];
  const x = boardX(p.index, L) + Math.sin(shake[p.index] * 80) * cell * 0.35 * Math.min(1, shake[p.index] / SHAKE_TIME);
  const w = COLS * cell;
  const h = ROWS * cell;

  text(`PLAYER ${p.index + 1}`, x + w / 2, y - 1.2 * cell, 1.1 * cell, color, 'center', 900);

  // The well
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = cell * 0.9;
  ctx.fillStyle = 'rgb(8 9 22 / 0.92)';
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, cell * 0.08);
  ctx.beginPath();
  ctx.roundRect(x - cell * 0.2, y - cell * 0.2, w + cell * 0.4, h + cell * 0.4, cell * 0.3);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = 'rgb(255 255 255 / 0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 1; c < COLS; c++) {
    ctx.moveTo(x + c * cell, y);
    ctx.lineTo(x + c * cell, y + h);
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.moveTo(x, y + r * cell);
    ctx.lineTo(x + w, y + r * cell);
  }
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  p.board.forEach((row, r) =>
    row.forEach((c, col) => {
      if (c) block(x + col * cell, y + r * cell, cell, COLORS[c], c === 'X');
    }),
  );

  // Pieces you're not steering yet are dimmed; the one you are gets an outline and a ghost where it would land.
  ctx.globalAlpha = 0.42;
  for (const piece of p.falling.slice(1)) drawPiece(piece, x, y, cell);
  ctx.globalAlpha = 1;
  const active = p.active;
  if (active) {
    ctx.lineWidth = Math.max(1.5, cell * 0.07);
    ctx.strokeStyle = pieceColor(active);
    ctx.globalAlpha = 0.6;
    for (const [cx, cy] of cellsOf(active, active.rot, active.x, landingY(p, active))) {
      ctx.beginPath();
      ctx.roundRect(x + (cx + 0.12) * cell, y + (cy + 0.12) * cell, cell * 0.76, cell * 0.76, cell * 0.15);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    drawPiece(active, x, y, cell);
    ctx.strokeStyle = 'rgb(255 255 255 / 0.9)';
    for (const [cx, cy] of cellsOf(active)) {
      ctx.beginPath();
      ctx.roundRect(x + (cx + 0.05) * cell, y + (cy + 0.05) * cell, cell * 0.9, cell * 0.9, cell * 0.2);
      ctx.stroke();
    }
  }

  for (const flash of flashes) {
    if (flash.player !== p.index) continue;
    ctx.fillStyle = `rgb(255 255 255 / ${0.9 * (1 - flash.age / 0.35)})`;
    for (const r of flash.rows) ctx.fillRect(x, y + r * cell, w, cell);
  }
  ctx.restore();

  if (p.out) {
    ctx.fillStyle = 'rgb(9 10 20 / 0.72)';
    ctx.fillRect(x, y, w, h);
    outlined('TOPPED OUT', x + w / 2, y + h * 0.5, 1.2 * cell, DANGER);
  }

  drawPanel(p, L);
}

/**
 * The queue, running in towards the board: the front piece (next to the board) drops in straight away if nothing's
 * falling, or else when the bar under it fills (the drop rate limit). Extras are outlined in red. Then the stats.
 */
function drawPanel(p: Player, L: Layout): void {
  const { cell, top, slot: size } = L;
  const i = p.index;
  const inner = innerX(i, L);
  const y = slotY(L);
  const radius = size * 0.14;
  const now = performance.now();

  label('QUEUE', inner, top + 0.3 * cell, cell, i === 0 ? 'right' : 'left');
  ctx.fillStyle = 'rgb(255 255 255 / 0.035)';
  for (let k = 0; k < SLOTS; k++) {
    ctx.beginPath();
    ctx.roundRect(slotX(i, k, L), y, size, size, radius);
    ctx.fill();
  }
  p.queue.slice(0, SLOTS).forEach((item, k) => {
    const x = slotX(i, k + slide[i], L);
    const grow = Math.min(1, (now - firstSeen(item, now)) / 180);
    ctx.globalAlpha = grow;
    ctx.fillStyle = 'rgb(255 255 255 / 0.09)';
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, radius);
    ctx.fill();
    if (item.extra) {
      ctx.strokeStyle = DANGER;
      ctx.lineWidth = Math.max(2, 0.08 * cell);
      ctx.stroke();
    }
    mini(item.kind, item.extra, x + size / 2, y + size * 0.45, size * 0.22 * (0.5 + 0.5 * grow));
    ctx.globalAlpha = 1;
  });
  if (p.queue.length && p.falling.length) {
    // The drop timer, on the front piece
    const x = slotX(i, slide[i], L);
    const bar = { x: x + size * 0.11, y: y + size * 0.81, w: size * 0.78, h: Math.max(3, size * 0.07) };
    ctx.fillStyle = 'rgb(255 255 255 / 0.12)';
    ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(bar.x, bar.y, bar.w * Math.min(1, p.sinceRelease / game.releaseGap), bar.h);
    const wait = game.releaseGap - p.sinceRelease;
    if (wait > 0) text(`${(Math.ceil(wait * 10) / 10).toFixed(1)}s`, x + size / 2, y + size + 0.45 * cell, 0.45 * cell, TEXT, 'center', 800);
  }
  if (p.queue.length > SLOTS) {
    text(`+${p.queue.length - SLOTS} more`, slotX(i, SLOTS - 1, L) + size / 2, y + size + 0.45 * cell, 0.45 * cell, TEXT, 'center', 800);
  }

  // Stats, in the bottom corner next to the board
  const sx = i === 0 ? inner - 4.2 * cell : inner;
  const stats: [string, number][] = [
    ['LINES', p.lines],
    ['SENT', p.sent],
    ['TAKEN', p.taken],
  ];
  stats.forEach(([name, value], n) => {
    const sy = top + (16.6 + n * 1.2) * cell;
    label(name, sx, sy, cell);
    text(String(value), sx + 4.2 * cell, sy, 0.8 * cell, TEXT, 'right', 900);
  });
}

function firstSeen(item: object, now: number): number {
  const seen = firstSeenAt.get(item);
  if (seen !== undefined) return seen;
  firstSeenAt.set(item, now);
  return now;
}

function drawMiddle(L: Layout): void {
  const { cell, top } = L;
  const x = midX(L);
  label('LEVEL', x, top + 0.3 * cell, cell, 'center');
  text(String(game.level), x, top + 1.8 * cell, 2 * cell, ACCENT, 'center', 900);
  text(clock(game.elapsed), x, top + 3.3 * cell, 0.6 * cell, MUTED, 'center', 700);

  label('WINS', x, top + 5.4 * cell, cell, 'center');
  text(String(wins[0]), x - 1.3 * cell, top + 6.9 * cell, 1.6 * cell, PLAYER_COLORS[0], 'center', 900);
  text('–', x, top + 6.9 * cell, cell, MUTED, 'center', 900);
  text(String(wins[1]), x + 1.3 * cell, top + 6.9 * cell, 1.6 * cell, PLAYER_COLORS[1], 'center', 900);

  const controls: [string, string][] = [
    ['↑', 'TURN'],
    ['← →', 'MOVE'],
    ['↓', 'HOLD TO DROP'],
  ];
  controls.forEach(([key, what], n) => {
    const ry = top + (14.6 + n * 1.9) * cell;
    text(key, x, ry, 0.9 * cell, TEXT, 'center', 900);
    text(what, x, ry + 0.8 * cell, 0.42 * cell, MUTED, 'center', 800);
  });

  text('Hold SELECT for the menu  ·  START pauses', x, top + 21.1 * cell, 0.45 * cell, MUTED, 'center', 600);
}

function drawShots(L: Layout): void {
  const { cell, top } = L;
  for (const shot of shots) {
    const t = shot.age / SHOT_TIME;
    const ease = t * t * (3 - 2 * t);
    const fx = boardX(shot.from, L) + 5 * cell;
    const fy = top + 9 * cell;
    const tx = slotX(shot.to, 0, L) + L.slot / 2;
    const ty = slotY(L) + L.slot / 2;
    const sx = fx + (tx - fx) * ease;
    const sy = fy + (ty - fy) * ease - Math.sin(Math.PI * t) * 5 * cell;
    ctx.save();
    ctx.shadowColor = PLAYER_COLORS[shot.from];
    ctx.shadowBlur = 1.5 * cell;
    ctx.fillStyle = PLAYER_COLORS[shot.from];
    ctx.beginPath();
    ctx.arc(sx, sy, (0.6 + 0.2 * shot.count) * cell, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    text(`+${shot.count}`, sx, sy, 0.75 * cell, '#0b0c1a', 'center', 900);
  }
}

function drawPopups(L: Layout): void {
  const { cell, top } = L;
  for (const pop of popups) {
    const t = pop.age / pop.life;
    const grow = t < 0.12 ? 0.6 + (t / 0.12) * 0.4 : 1;
    ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
    outlined(pop.text, boardX(pop.player, L) + 5 * cell, top + (pop.row - t * 1.5) * cell, pop.size * grow * cell, pop.color);
    ctx.globalAlpha = 1;
  }
}

function drawOverlay(L: Layout, w: number, h: number): void {
  const { cell, top } = L;
  const mid = midX(L);
  const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 180);

  if (phase === 'title') {
    veil(w, h, 0.93);
    const gradient = ctx.createLinearGradient(mid - 9 * cell, 0, mid + 9 * cell, 0);
    gradient.addColorStop(0, PLAYER_COLORS[0]);
    gradient.addColorStop(1, PLAYER_COLORS[1]);
    text('STACK ATTACK', mid, top + 2.5 * cell, 3.4 * cell, gradient, 'center', 900);
    text('Two players side by side. Last one standing wins.', mid, top + 5.2 * cell, 0.75 * cell, TEXT, 'center', 700);
    text('↑ turn      ← → move      ↓ hold to drop', mid, top + 7.2 * cell, 1 * cell, ACCENT, 'center', 900);
    const rules = [
      'Every row you clear sends your rival an extra piece.',
      `Extras drop in even while you're busy (one every ${game.releaseGap} seconds at most), so you can`,
      'end up with several pieces falling at once. You always steer the lowest one.',
    ];
    rules.forEach((line, n) => text(line, mid, top + (9.3 + n * 1.05) * cell, 0.62 * cell, MUTED, 'center', 600));
    ctx.globalAlpha = pulse;
    text('PRESS START', mid, top + 14.6 * cell, 1.5 * cell, ACCENT, 'center', 900);
    ctx.globalAlpha = 1;
    text('Keyboard: P1 W A S D or arrows, Enter to start · P2 I J K L, O to start', mid, top + 17 * cell, 0.5 * cell, MUTED, 'center', 600);
  } else if (phase === 'countdown') {
    const left = COUNTDOWN - phaseTime;
    const n = Math.ceil(left);
    const within = left - (n - 1); // 1 → 0 through each second
    for (const i of [0, 1]) outlined(String(n), boardX(i, L) + 5 * cell, top + 9 * cell, (2.4 + within * 1.4) * cell, ACCENT);
  } else if (phase === 'paused') {
    veil(w, h, 0.72);
    text('PAUSED', mid, top + 8 * cell, 2.6 * cell, TEXT, 'center', 900);
    text('Press START to carry on', mid, top + 10.6 * cell, 0.8 * cell, MUTED, 'center', 700);
  } else if (phase === 'over') {
    const winner = game.winner ?? -1;
    if (winner >= 0) outlined('WINNER!', boardX(winner, L) + 5 * cell, top + 7 * cell, 2 * cell, PLAYER_COLORS[winner]);
    else for (const i of [0, 1]) outlined('DRAW', boardX(i, L) + 5 * cell, top + 7 * cell, 2 * cell, ACCENT);
    if (phaseTime > 1) {
      ctx.globalAlpha = pulse;
      for (const i of [0, 1]) outlined('PRESS START', boardX(i, L) + 5 * cell, top + 12 * cell, 1 * cell, ACCENT);
      ctx.globalAlpha = 1;
    }
  }
}

function drawPiece(piece: Piece, x: number, y: number, cell: number): void {
  for (const [cx, cy] of cellsOf(piece)) block(x + cx * cell, y + cy * cell, cell, pieceColor(piece), piece.extra);
}

/** One square of a piece. Extras (sent by the other player) are grey with hazard stripes. */
function block(x: number, y: number, size: number, color: string, extra = false): void {
  const pad = size * 0.06;
  const s = size - pad * 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x + pad, y + pad, s, s, s * 0.2);
  ctx.fill();
  if (extra) {
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgb(20 22 44 / 0.5)';
    ctx.lineWidth = s * 0.14;
    ctx.beginPath();
    for (let k = -1; k <= 1; k++) {
      ctx.moveTo(x + pad + k * s * 0.55, y + pad + s);
      ctx.lineTo(x + pad + k * s * 0.55 + s, y + pad);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = 'rgb(255 255 255 / 0.32)';
  ctx.beginPath();
  ctx.roundRect(x + pad + s * 0.14, y + pad + s * 0.1, s * 0.72, s * 0.18, s * 0.09);
  ctx.fill();
  ctx.fillStyle = 'rgb(0 0 0 / 0.2)';
  ctx.fillRect(x + pad + s * 0.14, y + pad + s * 0.8, s * 0.72, s * 0.08);
}

/** A piece in its spawn rotation, centred on (cx, cy). */
function mini(kind: Kind, extra: boolean, cx: number, cy: number, size: number): void {
  const cells = ROTATIONS[kind][0];
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const ox = cx - ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * size;
  const oy = cy - ((Math.min(...ys) + Math.max(...ys) + 1) / 2) * size;
  for (const [x, y] of cells) block(ox + x * size, oy + y * size, size, extra ? COLORS.X : COLORS[kind], extra);
}

const pieceColor = (piece: Piece) => (piece.extra ? COLORS.X : COLORS[piece.kind]);

function text(
  str: string,
  x: number,
  y: number,
  size: number,
  color: string | CanvasGradient,
  align: CanvasTextAlign = 'left',
  weight = 700,
): void {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

/** Big centred text with a dark outline, so it reads over the blocks. */
function outlined(str: string, x: number, y: number, size: number, color: string): void {
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = 'rgb(9 10 20 / 0.9)';
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function label(str: string, x: number, y: number, cell: number, align: CanvasTextAlign = 'left'): void {
  text(str, x, y, 0.45 * cell, MUTED, align, 800);
}

function veil(w: number, h: number, alpha: number): void {
  ctx.fillStyle = `rgb(9 10 20 / ${alpha})`;
  ctx.fillRect(0, 0, w, h);
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Sound: little synth blips. Browsers only start audio after a key press or click (pad presses may not count).
// ---------------------------------------------------------------------------

let audio: AudioContext | undefined;

function wakeAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    // No sound, then.
  }
}
addEventListener('keydown', wakeAudio);
addEventListener('pointerdown', wakeAudio);

function tone(
  freq: number,
  seconds: number,
  { type = 'square', volume = 0.05, to = freq, delay = 0 }: { type?: OscillatorType; volume?: number; to?: number; delay?: number } = {},
): void {
  if (!audio || audio.state !== 'running') return;
  const start = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, start + seconds);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
  osc.connect(gain).connect(audio.destination);
  osc.start(start);
  osc.stop(start + seconds);
}

const sfx = {
  move: () => tone(520, 0.03, { volume: 0.012 }),
  turn: () => tone(780, 0.05, { volume: 0.02 }),
  release: (extra: boolean) => (extra ? tone(200, 0.18, { volume: 0.04, to: 150 }) : tone(660, 0.07, { type: 'sine', volume: 0.04, to: 880 })),
  land: () => tone(220, 0.14, { type: 'triangle', volume: 0.12, to: 60 }),
  clear: (rows: number) =>
    [523, 659, 784, 1047].slice(0, rows).forEach((f, i) => tone(f, 0.16, { type: 'triangle', volume: 0.09, delay: i * 0.07 })),
  attack: () => tone(260, 0.4, { type: 'sawtooth', volume: 0.05, to: 1400 }),
  incoming: () => tone(330, 0.3, { volume: 0.05, to: 140 }),
  bonus: () => tone(990, 0.07, { volume: 0.025 }),
  level: () => [440, 660, 880].forEach((f, i) => tone(f, 0.1, { volume: 0.04, delay: i * 0.08 })),
  count: (go: boolean) => tone(go ? 880 : 440, go ? 0.3 : 0.15, { volume: 0.05 }),
  out: () => [392, 311, 262, 196].forEach((f, i) => tone(f, 0.22, { type: 'triangle', volume: 0.08, delay: i * 0.16 })),
};
