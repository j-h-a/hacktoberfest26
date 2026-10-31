/**
 * Bounce Barrage's rules and state. No DOM in here, so a game can be stepped headless.
 *
 * The arena is FIELD_W × FIELD_H units with y pointing down. Player 1's paddle guards the left
 * end and player 2's the right, and crates fall down a strip in the middle.
 */

export const FIELD_W = 1600;
export const FIELD_H = 900;
export const LIVES = 5;
export const COUNTDOWN = 3;

/** Each paddle's centre sits this far in from its end of the arena. */
const PADDLE_INSET = 64;
export const PADDLE_W = 22;
const PADDLE_H = 170;
const PADDLE_SPEED = 700;
/** Big Paddle makes the paddle this much taller, and the cursed capsule this much shorter. */
const BIG_SCALE = 1.7;
const CURSED_SCALE = 0.55;

/**
 * Seconds to load each ball. The first one loads by itself, so a tap of forward fires it.
 * Holding forward loads a second and a third, and letting go fires them all.
 */
const SECONDS_PER_BALL = 1;
const QUICK_SECONDS_PER_BALL = 0.5;
export const MAX_BALLS = 3;
/** Where each loaded ball waits in front of the paddle (offset from its centre), and the angle it fires at. */
export const LOADED_SLOTS = [0, -36, 36];
const SLOT_ANGLES = [0, -0.2, 0.2];

export const BALL_R = 13;
/** Balls start at BALL_SPEED and creep up to BALL_SPEED_LATE over RAMP_TIME seconds of play. */
const BALL_SPEED = 480;
const BALL_SPEED_LATE = 620;
const RAMP_TIME = 120;
/** Batting your own ball back speeds it up a little, to at most BALL_SPEED_MAX. */
const RETURN_BOOST = 1.05;
const BALL_SPEED_MAX = 760;
/** Balls always move sideways at least this fraction of their speed, so none bounce up and down forever. */
const MIN_VX = 0.45;

/** Crates fall down a strip this wide in the middle of the arena. */
export const DROP_ZONE_W = 280;
const CRATE_FALL = 75;
const CRATE_FALL_LATE = 105;
const CRATE_SIZES: [number, number][] = [
  [80, 80],
  [100, 100],
  [50, 50],
  [60, 130],
  [130, 60],
  [40, 170],
  [170, 40],
  [110, 70],
  [70, 110],
];
/** Seconds between crates (at the starting fall speed), and between gold ? crates. */
const CRATE_GAP: [number, number] = [2.8, 4.8];
const SPECIAL_GAP: [number, number] = [5, 10];
const SPECIAL_SIZE = 84;

const POWERUP_SPEED = 340;
/** A power-up can be caught from this far in front of the paddle's face to this far behind it... */
export const CATCH_REACH = 110;
export const CATCH_BEHIND = 30;
/** ...and this far past either end of the paddle. */
export const CATCH_SLACK = 40;
/** Stepping back holds the catch out this long, then it can't catch again for a moment (so stomping doesn't pay). */
export const GRAB_TIME = 0.2;
const GRAB_COOLDOWN = 0.45;

export const PLAYER_HUES = [193, 326];
export const GOLD_HUE = 46;

export type PowerupKind = 'big' | 'volley' | 'heart' | 'quick' | 'pierce' | 'cursed';

export interface PowerupInfo {
  name: string;
  icon: string;
  /** Some glyphs are small for their font size: draw them this much bigger. */
  iconScale?: number;
  hue: number;
  /** Seconds it lasts, or 0 for a one-off. */
  time: number;
  /** A trap: better to let it fly past. */
  bad?: boolean;
}

/** One-offs happen in catchPowerup(); timed ones are checked wherever they make a difference. */
export const POWERUPS: Record<PowerupKind, PowerupInfo> = {
  big: { name: 'Big paddle', icon: '↕', hue: 135, time: 10 },
  volley: { name: 'Free volley', icon: '×3', hue: 22, time: 0 },
  heart: { name: 'Extra heart', icon: '♥', hue: 352, time: 0 },
  quick: { name: 'Quick charge', icon: '»', iconScale: 1.8, hue: 54, time: 10 },
  pierce: { name: 'Piercing shot', icon: '↠', hue: 275, time: 5 },
  cursed: { name: 'Cursed', icon: '☠', iconScale: 1.25, hue: 0, time: 5, bad: true },
};
export const POWERUP_KINDS = Object.keys(POWERUPS) as PowerupKind[];

export type Phase = 'title' | 'countdown' | 'play' | 'over';

export interface Input {
  /** Held: move the paddle. */
  up: boolean;
  down: boolean;
  /** Held: load more balls. Letting go fires what's loaded. */
  forward: boolean;
  /** Pressed this frame: reach out to catch a power-up. */
  back: boolean;
}

const NO_INPUT: Input = { up: false, down: false, forward: false, back: false };

export interface Stats {
  fired: number;
  /** Hearts taken off the rival. */
  hits: number;
  blocked: number;
  /** Own balls batted back out. */
  returned: number;
  /** Good power-ups caught (cursed ones don't count). */
  caught: number;
}

export interface Paddle {
  /** 0 for player 1 (left end), 1 for player 2 (right end). */
  index: number;
  /** Which way this paddle fires: +1 is right. */
  dir: 1 | -1;
  x: number;
  y: number;
  vy: number;
  /** Current height (Big Paddle and the curse change it). */
  h: number;
  lives: number;
  /** Balls loaded, fractional: 1.5 is one ball ready and the next half loaded. */
  charge: number;
  /** Forward is held. */
  charging: boolean;
  /** Seconds left on the current catch, and before another can start. */
  grab: number;
  grabCooldown: number;
  /** 1 → 0 after losing a heart. */
  flash: number;
  /** Seconds left on each timed power-up (0 when it's off). */
  effects: Record<PowerupKind, number>;
  stats: Stats;
}

export interface Ball {
  id: number;
  /** Who fired it. It only hurts the other player. */
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Fired under Piercing Shot: goes straight through crates. */
  pierce: boolean;
  /** Recent positions, x, y, x, y, ... oldest first. */
  trail: number[];
  dead: boolean;
}

export interface Crate {
  id: number;
  /** Centre. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Gold ? crates smash when hit and send a power-up to whoever hit them. */
  special: boolean;
  dead: boolean;
}

export interface Powerup {
  id: number;
  /** Who it's flying to. */
  owner: number;
  kind: PowerupKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  dead: boolean;
}

/** A glowing dot, or an expanding ring. */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Dot radius or ring radius. */
  size: number;
  /** Ring growth per second. */
  grow: number;
  ring: boolean;
  hue: number;
  sat: number;
  life: number;
  maxLife: number;
}

export interface Label {
  text: string;
  x: number;
  y: number;
  /** -1 for white. */
  hue: number;
  size: number;
  age: number;
  life: number;
}

/** Things that happened this step, for sounds. The game never reads them back. */
export type EventType =
  | 'count'
  | 'go'
  | 'charge'
  | 'fire'
  | 'fizzle'
  | 'bounce'
  | 'return'
  | 'block'
  | 'hit'
  | 'smash'
  | 'grab'
  | 'catch'
  | 'curse'
  | 'drop'
  | 'dodge'
  | 'over';

export interface GameEvent {
  type: EventType;
  player: number;
  n: number;
}

export interface Game {
  phase: Phase;
  /** Seconds since the phase began. */
  phaseTime: number;
  /** Seconds of play. */
  time: number;
  paddles: Paddle[];
  balls: Ball[];
  crates: Crate[];
  powerups: Powerup[];
  particles: Particle[];
  labels: Label[];
  /** How fast every crate is falling (units per second). */
  crateFall: number;
  nextCrate: number;
  nextSpecial: number;
  shake: number;
  /** Who won: 0, 1, or -1 for a draw. */
  winner: number | null;
  events: GameEvent[];
  nextId: number;
}

/** A new game: on the title screen, or counting down. Pass the old game to keep its crates falling smoothly. */
export function newGame(title: boolean, previous?: Game): Game {
  const game: Game = {
    phase: title ? 'title' : 'countdown',
    phaseTime: 0,
    time: 0,
    paddles: [0, 1].map(makePaddle),
    balls: [],
    crates: previous?.crates.filter((c) => !c.special) ?? [],
    powerups: [],
    particles: [],
    labels: [],
    crateFall: CRATE_FALL,
    nextCrate: previous?.nextCrate ?? 0,
    nextSpecial: rand(...SPECIAL_GAP) / 2,
    shake: 0,
    winner: null,
    events: [],
    nextId: previous?.nextId ?? 1,
  };
  // Fill the strip, as if crates had been falling for a while.
  if (!previous) for (let i = 0; i < 140; i++) updateCrates(game, 0.1);
  if (!title) emit(game, 'count', -1, COUNTDOWN);
  return game;
}

function makePaddle(index: number): Paddle {
  return {
    index,
    dir: index === 0 ? 1 : -1,
    x: index === 0 ? PADDLE_INSET : FIELD_W - PADDLE_INSET,
    y: FIELD_H / 2,
    vy: 0,
    h: PADDLE_H,
    lives: LIVES,
    charge: 0,
    charging: false,
    grab: 0,
    grabCooldown: 0,
    flash: 0,
    effects: { big: 0, volley: 0, heart: 0, quick: 0, pierce: 0, cursed: 0 },
    stats: { fired: 0, hits: 0, blocked: 0, returned: 0, caught: 0 },
  };
}

export function update(game: Game, dt: number, inputs: Input[]): void {
  game.phaseTime += dt;
  game.shake = Math.max(0, game.shake - dt * 2.5);
  if (game.phase === 'countdown') {
    const left = Math.ceil(COUNTDOWN - game.phaseTime);
    if (game.phaseTime >= COUNTDOWN) {
      game.phase = 'play';
      game.phaseTime = 0;
      emit(game, 'go');
    } else if (left !== Math.ceil(COUNTDOWN - game.phaseTime + dt)) {
      emit(game, 'count', -1, left);
    }
  }
  if (game.phase === 'play') game.time += dt;

  updateCrates(game, dt);
  for (const p of game.paddles) updatePaddle(game, p, inputs[p.index] ?? NO_INPUT, dt);
  updateBalls(game, dt);
  updatePowerups(game, dt);
  updateEffects(game, dt);

  if (game.phase === 'play') {
    const out = game.paddles.filter((p) => p.lives <= 0);
    if (out.length > 0) {
      game.phase = 'over';
      game.phaseTime = 0;
      game.winner = out.length === 2 ? -1 : 1 - out[0].index;
      for (const p of out) {
        burst(game, p.x, p.y, PLAYER_HUES[p.index], 60, 700);
        ring(game, p.x, p.y, PLAYER_HUES[p.index], 30, 900, 0.8);
      }
      game.shake = 1.4;
      emit(game, 'over', game.winner);
    }
  }
}

function updateCrates(game: Game, dt: number): void {
  game.crateFall = lerp(CRATE_FALL, CRATE_FALL_LATE, ramp(game));
  for (const crate of game.crates) {
    crate.y += game.crateFall * dt;
    if (crate.y - crate.h / 2 > FIELD_H) crate.dead = true;
  }
  game.crates = game.crates.filter((c) => !c.dead);
  game.nextCrate -= dt;
  if (game.nextCrate <= 0) {
    // Faster crates come along more often, so the strip stays as full. No room at the top yet? Try again shortly.
    game.nextCrate = spawnCrate(game, false) ? (rand(...CRATE_GAP) * CRATE_FALL) / game.crateFall : 0.2;
  }
  if (game.phase !== 'play') return;
  game.nextSpecial -= dt;
  if (game.nextSpecial <= 0) game.nextSpecial = spawnCrate(game, true) ? rand(...SPECIAL_GAP) : 0.2;
}

function spawnCrate(game: Game, special: boolean): boolean {
  const [w, h] = special ? [SPECIAL_SIZE, SPECIAL_SIZE] : pick(CRATE_SIZES);
  const y = -h / 2 - 2;
  for (let tries = 0; tries < 8; tries++) {
    const x = FIELD_W / 2 + rand(-1, 1) * (DROP_ZONE_W / 2 - w / 2);
    const clear = game.crates.every(
      (c) => Math.abs(c.x - x) > (c.w + w) / 2 + 24 || Math.abs(c.y - y) > (c.h + h) / 2 + 24,
    );
    if (clear) {
      game.crates.push({ id: game.nextId++, x, y, w, h, special, dead: false });
      return true;
    }
  }
  return false;
}

function updatePaddle(game: Game, p: Paddle, input: Input, dt: number): void {
  p.flash = Math.max(0, p.flash - dt * 1.5);
  p.grab = Math.max(0, p.grab - dt);
  p.grabCooldown = Math.max(0, p.grabCooldown - dt);
  for (const kind of POWERUP_KINDS) p.effects[kind] = Math.max(0, p.effects[kind] - dt);
  const height = PADDLE_H * (p.effects.big > 0 ? BIG_SCALE : 1) * (p.effects.cursed > 0 ? CURSED_SCALE : 1);
  p.h += (height - p.h) * Math.min(1, dt * 10);

  const move = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  p.vy = move * PADDLE_SPEED;
  p.y = clamp(p.y + p.vy * dt, p.h / 2, FIELD_H - p.h / 2);

  if (game.phase === 'countdown') {
    // Load the first ball during the countdown, ready to fire at GO.
    p.charge = Math.min(p.charge + dt / SECONDS_PER_BALL, 1);
    return;
  }
  if (game.phase !== 'play') {
    p.charge = 0;
    p.charging = false;
    return;
  }

  // The first ball loads by itself; holding forward loads the others.
  const before = loadedBalls(p);
  const rate = dt / (p.effects.quick > 0 ? QUICK_SECONDS_PER_BALL : SECONDS_PER_BALL);
  if (input.forward) p.charge = Math.min(p.charge + rate, MAX_BALLS);
  else if (p.charge < 1) p.charge = Math.min(p.charge + rate, 1);
  const now = loadedBalls(p);
  if (now > before) emit(game, 'charge', p.index, now);

  if (input.forward) {
    p.charging = true;
  } else if (p.charging) {
    // Let go: fire whatever's loaded.
    p.charging = false;
    const balls = loadedBalls(p);
    if (balls > 0) {
      fire(game, p, balls);
      p.charge = 0;
    } else {
      burst(game, p.x + p.dir * (PADDLE_W / 2 + BALL_R), p.y, 0, 8, 120, 0);
      emit(game, 'fizzle', p.index);
    }
  }

  if (input.back && p.grabCooldown <= 0) {
    p.grab = GRAB_TIME;
    p.grabCooldown = GRAB_TIME + GRAB_COOLDOWN;
    emit(game, 'grab', p.index);
  }
}

/** How many whole balls the paddle has loaded. */
export function loadedBalls(p: Paddle): number {
  return Math.min(MAX_BALLS, Math.floor(p.charge + 1e-9));
}

function fire(game: Game, p: Paddle, balls: number): void {
  const speed = lerp(BALL_SPEED, BALL_SPEED_LATE, ramp(game));
  // Moving as you fire tilts the volley that way.
  const tilt = (p.vy / PADDLE_SPEED) * 0.3 + rand(-0.12, 0.12);
  const x = p.x + p.dir * (PADDLE_W / 2 + BALL_R + 5);
  for (let i = 0; i < balls; i++) {
    const angle = tilt + SLOT_ANGLES[i];
    const y = clamp(p.y + LOADED_SLOTS[i], BALL_R, FIELD_H - BALL_R);
    game.balls.push({
      id: game.nextId++,
      owner: p.index,
      x,
      y,
      vx: p.dir * Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      pierce: p.effects.pierce > 0,
      trail: [],
      dead: false,
    });
    burst(game, x, y, PLAYER_HUES[p.index], 6, 200);
  }
  p.stats.fired += balls;
  emit(game, 'fire', p.index, balls);
}

function updateBalls(game: Game, dt: number): void {
  for (const ball of game.balls) {
    // Small steps, so fast balls can't skip through thin crates or paddles.
    const steps = Math.max(1, Math.ceil((Math.hypot(ball.vx, ball.vy) * dt) / 6));
    const step = dt / steps;
    for (let i = 0; i < steps && !ball.dead; i++) {
      ball.x += ball.vx * step;
      ball.y += ball.vy * step;
      if (ball.y < BALL_R) {
        ball.y = BALL_R;
        ball.vy = Math.abs(ball.vy);
        emit(game, 'bounce');
      } else if (ball.y > FIELD_H - BALL_R) {
        ball.y = FIELD_H - BALL_R;
        ball.vy = -Math.abs(ball.vy);
        emit(game, 'bounce');
      }
      for (const crate of game.crates) if (!crate.dead && !ball.dead) hitCrate(game, ball, crate);
      for (const p of game.paddles) if (!ball.dead) hitPaddle(game, ball, p);
    }
    ball.trail.push(ball.x, ball.y);
    if (ball.trail.length > 20) ball.trail.splice(0, 2);
    if (!ball.dead && (ball.x < -BALL_R || ball.x > FIELD_W + BALL_R)) {
      ball.dead = true;
      ballOut(game, ball);
    }
  }
  game.balls = game.balls.filter((b) => !b.dead);
  game.crates = game.crates.filter((c) => !c.dead);
}

function hitCrate(game: Game, ball: Ball, crate: Crate): void {
  const hw = crate.w / 2;
  const hh = crate.h / 2;
  const cx = clamp(ball.x, crate.x - hw, crate.x + hw);
  const cy = clamp(ball.y, crate.y - hh, crate.y + hh);
  let nx = ball.x - cx;
  let ny = ball.y - cy;
  const dist = Math.hypot(nx, ny);
  if (dist >= BALL_R) return;
  if (crate.special) {
    smash(game, crate, ball); // and the ball carries on through
    return;
  }
  if (ball.pierce) return; // straight through
  if (dist > 0.001) {
    nx /= dist;
    ny /= dist;
    ball.x = cx + nx * BALL_R;
    ball.y = cy + ny * BALL_R;
  } else {
    // The ball's centre got inside: push it out through the nearest side.
    const dx = ball.x - crate.x;
    const dy = ball.y - crate.y;
    if (hw - Math.abs(dx) < hh - Math.abs(dy)) {
      nx = dx < 0 ? -1 : 1;
      ny = 0;
      ball.x = crate.x + nx * (hw + BALL_R);
    } else {
      nx = 0;
      ny = dy < 0 ? -1 : 1;
      ball.y = crate.y + ny * (hh + BALL_R);
    }
  }
  const dot = ball.vx * nx + ball.vy * ny;
  if (dot >= 0) return; // already moving away
  ball.vx -= 2 * dot * nx;
  ball.vy -= 2 * dot * ny;
  keepMoving(ball);
  burst(game, ball.x - nx * BALL_R, ball.y - ny * BALL_R, PLAYER_HUES[ball.owner], 5, 160);
  emit(game, 'bounce');
}

/** Stop a ball from going too steep, keeping its speed. */
function keepMoving(ball: Ball): void {
  const speed = Math.hypot(ball.vx, ball.vy);
  const minVx = speed * MIN_VX;
  if (Math.abs(ball.vx) >= minVx) return;
  const sx = ball.vx !== 0 ? Math.sign(ball.vx) : ball.owner === 0 ? 1 : -1;
  const sy = ball.vy !== 0 ? Math.sign(ball.vy) : 1;
  ball.vx = sx * minVx;
  ball.vy = sy * Math.sqrt(speed * speed - minVx * minVx);
}

function hitPaddle(game: Game, ball: Ball, p: Paddle): void {
  const hw = PADDLE_W / 2;
  const hh = p.h / 2;
  const cx = clamp(ball.x, p.x - hw, p.x + hw);
  const cy = clamp(ball.y, p.y - hh, p.y + hh);
  if (Math.hypot(ball.x - cx, ball.y - cy) >= BALL_R) return;
  if (ball.owner !== p.index) {
    // The rival's ball: blocked.
    ball.dead = true;
    p.stats.blocked++;
    burst(game, ball.x, ball.y, PLAYER_HUES[ball.owner], 14, 320);
    burst(game, ball.x, ball.y, PLAYER_HUES[p.index], 8, 220);
    ring(game, ball.x, ball.y, PLAYER_HUES[p.index], BALL_R, 260, 0.35);
    label(game, 'BLOCK', p.x + p.dir * 80, ball.y - 36, PLAYER_HUES[p.index], 26, 0.6);
    emit(game, 'block', p.index);
    return;
  }
  if (ball.vx * p.dir > 0) return; // already heading back out
  // Your own ball coming home: bat it back out, aimed by where it hits the paddle.
  const speed = Math.min(Math.hypot(ball.vx, ball.vy) * RETURN_BOOST, BALL_SPEED_MAX);
  const angle = clamp((ball.y - p.y) / hh, -1, 1) * 0.8 + (p.vy / PADDLE_SPEED) * 0.15;
  ball.vx = p.dir * Math.cos(angle) * speed;
  ball.vy = Math.sin(angle) * speed;
  ball.x = p.x + p.dir * (hw + BALL_R);
  p.stats.returned++;
  burst(game, ball.x, ball.y, PLAYER_HUES[p.index], 8, 200);
  emit(game, 'return', p.index);
}

/** A ball left the arena past one of the paddles. */
function ballOut(game: Game, ball: Ball): void {
  const end = ball.x < FIELD_W / 2 ? 0 : 1;
  const x = clamp(ball.x, 0, FIELD_W);
  burst(game, x, ball.y, PLAYER_HUES[ball.owner], 12, 260);
  // Your own balls coming home are harmless, and nothing counts once it's over.
  if (ball.owner === end || game.phase !== 'play') return;
  const p = game.paddles[end];
  p.lives = Math.max(0, p.lives - 1);
  p.flash = 1;
  game.paddles[ball.owner].stats.hits++;
  game.shake = 1;
  burst(game, x, ball.y, PLAYER_HUES[end], 30, 500);
  ring(game, x, ball.y, PLAYER_HUES[ball.owner], 20, 600, 0.6);
  label(game, '−1 ♥', p.x + p.dir * 120, clamp(ball.y, 80, FIELD_H - 60), PLAYER_HUES[end], 56, 1.2);
  emit(game, 'hit', end);
}

function smash(game: Game, crate: Crate, ball: Ball): void {
  crate.dead = true;
  const p = game.paddles[ball.owner];
  // No point offering a heart to someone with all of theirs.
  const kinds = POWERUP_KINDS.filter((k) => k !== 'heart' || p.lives < LIVES);
  game.powerups.push({
    id: game.nextId++,
    owner: p.index,
    kind: pick(kinds),
    x: crate.x,
    y: crate.y,
    vx: -p.dir * POWERUP_SPEED,
    vy: 0,
    age: 0,
    dead: false,
  });
  burst(game, crate.x, crate.y, GOLD_HUE, 40, 460);
  burst(game, crate.x, crate.y, 0, 16, 300, 0);
  ring(game, crate.x, crate.y, GOLD_HUE, 30, 520, 0.5);
  game.shake = Math.max(game.shake, 0.45);
  emit(game, 'smash', p.index);
}

function updatePowerups(game: Game, dt: number): void {
  for (const pu of game.powerups) {
    const p = game.paddles[pu.owner];
    pu.age += dt;
    // Home in on the paddle's height, so it arrives at the paddle.
    const eta = Math.max(aheadOf(p, pu.x) / POWERUP_SPEED, 0.15);
    const wantVy = clamp((p.y - pu.y) / eta, -500, 500);
    pu.vy += (wantVy - pu.vy) * Math.min(1, dt * 6);
    pu.x += pu.vx * dt;
    pu.y = clamp(pu.y + pu.vy * dt, 30, FIELD_H - 30);
    if (Math.random() < dt * 40) {
      const life = 0.4;
      game.particles.push({
        x: pu.x + rand(-20, 20),
        y: pu.y + rand(-14, 14),
        vx: -pu.vx * 0.2,
        vy: rand(-40, 40),
        size: rand(2, 4),
        grow: 0,
        ring: false,
        hue: POWERUPS[pu.kind].hue,
        sat: 100,
        life,
        maxLife: life,
      });
    }
    if (game.phase === 'play' && p.grab > 0 && inCatchZone(p, pu)) catchPowerup(game, p, pu);
    else if (aheadOf(p, pu.x) < -CATCH_BEHIND - 40) dropPowerup(game, p, pu);
  }
  game.powerups = game.powerups.filter((pu) => !pu.dead);
}

/** How far x is in front of the paddle's face (negative once it's behind). */
export function aheadOf(p: Paddle, x: number): number {
  return (x - (p.x + (p.dir * PADDLE_W) / 2)) * p.dir;
}

export function inCatchZone(p: Paddle, pu: Powerup): boolean {
  const ahead = aheadOf(p, pu.x);
  return ahead <= CATCH_REACH && ahead >= -CATCH_BEHIND && Math.abs(pu.y - p.y) <= p.h / 2 + CATCH_SLACK;
}

function catchPowerup(game: Game, p: Paddle, pu: Powerup): void {
  pu.dead = true;
  p.grab = 0;
  p.grabCooldown = 0.1;
  const info = POWERUPS[pu.kind];
  if (!info.bad) p.stats.caught++;
  burst(game, pu.x, pu.y, info.hue, 30, 420);
  ring(game, pu.x, pu.y, info.hue, 20, 420, 0.5);
  label(game, `${info.name.toUpperCase()}!`, p.x + p.dir * 230, clamp(p.y, 120, FIELD_H - 100), info.hue, 40, 1.4);
  emit(game, info.bad ? 'curse' : 'catch', p.index);
  // Timed ones (re)start their clock; the one-offs happen here.
  p.effects[pu.kind] = info.time;
  if (pu.kind === 'volley') fire(game, p, MAX_BALLS);
  if (pu.kind === 'heart') p.lives = Math.min(LIVES, p.lives + 1);
}

function dropPowerup(game: Game, p: Paddle, pu: Powerup): void {
  pu.dead = true;
  if (game.phase !== 'play') return;
  const bad = POWERUPS[pu.kind].bad;
  burst(game, pu.x, pu.y, 0, 14, 220, 0);
  label(game, bad ? 'DODGED' : 'MISSED', p.x + p.dir * 140, clamp(pu.y, 80, FIELD_H - 60), -1, 30, 0.9);
  emit(game, bad ? 'dodge' : 'drop', p.index);
}

function updateEffects(game: Game, dt: number): void {
  const drag = Math.max(0, 1 - dt * 2.5);
  for (const pt of game.particles) {
    pt.life -= dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx *= drag;
    pt.vy *= drag;
    pt.size += pt.grow * dt;
  }
  game.particles = game.particles.filter((pt) => pt.life > 0);
  if (game.particles.length > 900) game.particles.splice(0, game.particles.length - 900);
  for (const l of game.labels) l.age += dt;
  game.labels = game.labels.filter((l) => l.age < l.life);
}

function burst(game: Game, x: number, y: number, hue: number, count: number, speed: number, sat = 100): void {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.25 + Math.random() * 0.75);
    const life = 0.3 + Math.random() * 0.5;
    game.particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      size: 2 + Math.random() * 3,
      grow: 0,
      ring: false,
      hue,
      sat,
      life,
      maxLife: life,
    });
  }
}

function ring(game: Game, x: number, y: number, hue: number, size: number, grow: number, life: number): void {
  game.particles.push({ x, y, vx: 0, vy: 0, size, grow, ring: true, hue, sat: 100, life, maxLife: life });
}

function label(game: Game, text: string, x: number, y: number, hue: number, size: number, life: number): void {
  game.labels.push({ text, x, y, hue, size, age: 0, life });
}

function emit(game: Game, type: EventType, player = -1, n = 0): void {
  game.events.push({ type, player, n });
}

/** 0 → 1 over the first RAMP_TIME seconds of play. */
function ramp(game: Game): number {
  return clamp(game.time / RAMP_TIME, 0, 1);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}
