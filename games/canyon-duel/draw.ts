/**
 * Vector-monitor drawing: every shape is a glowing stroked line, added on top of a screen
 * that fades rather than clears, so moving things leave a short phosphor trail.
 */
import {
  APPROACH_TIME,
  ARROW_HUES,
  CATCH_REACH,
  DEATH_Y,
  FIELD_H,
  FIELD_W,
  GOOD_WINDOW,
  PLAYER_HUES,
  SHIP_COCKPIT,
  SHIP_HULL,
  SHIP_SPEED,
  SHIP_START_Y,
  WALL_STEP,
  arrowPoints,
  canyonAt,
  clamp,
  hash,
  rockPoints,
  screenY,
  timeToShip,
  type Game,
  type Point,
  type Ship,
} from './game';

const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export interface Layout {
  width: number;
  height: number;
  /** CSS pixels per field unit. */
  scale: number;
  /** Top-left corner of each player's field, in CSS pixels. */
  fields: { x: number; y: number }[];
}

/** Two fields side by side, each as big as fits in its half of the screen. */
export function makeLayout(width: number, height: number): Layout {
  const half = width / 2;
  const scale = Math.min(half / FIELD_W, height / FIELD_H);
  const w = FIELD_W * scale;
  const y = (height - FIELD_H * scale) / 2;
  return { width, height, scale, fields: [{ x: (half - w) / 2, y }, { x: half + (half - w) / 2, y }] };
}

export function render(ctx: CanvasRenderingContext2D, game: Game, layout: Layout, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(2, 3, 9, 0.6)'; // fade the last frame instead of wiping it
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const ship of game.ships) {
    const field = layout.fields[ship.index];
    ctx.save();
    ctx.translate(field.x, field.y);
    ctx.scale(layout.scale, layout.scale);
    drawFrame(ctx, ship);
    ctx.beginPath();
    ctx.rect(0, 0, FIELD_W, FIELD_H);
    ctx.clip();
    if (ship.shake > 0) ctx.translate((Math.random() - 0.5) * ship.shake * 16, (Math.random() - 0.5) * ship.shake * 10);
    drawCanyon(ctx, game);
    drawLines(ctx, game, ship);
    drawArrows(ctx, game, ship);
    drawRocks(ctx, game, ship);
    drawCatchZone(ctx, game, ship);
    drawShip(ctx, game, ship);
    drawParticles(ctx, ship);
    drawLabels(ctx, ship);
    ctx.restore();
  }
  drawMissiles(ctx, game, layout);
  ctx.globalAlpha = 1;
}

/** Stroke the current path as a glowing vector line: a soft wide halo under a hot core. */
function glow(ctx: CanvasRenderingContext2D, hue: number, width: number, alpha = 1, light = 60, sat = 100): void {
  if (alpha <= 0.01) return;
  ctx.globalAlpha = alpha * 0.3;
  ctx.strokeStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
  ctx.lineWidth = width * 3.5;
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = `hsl(${hue}, ${sat}%, ${Math.min(94, light + 24)}%)`;
  ctx.lineWidth = width;
  ctx.stroke();
}

function tracePath(ctx: CanvasRenderingContext2D, points: readonly Point[], ox: number, oy: number): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x, oy + y) : ctx.moveTo(ox + x, oy + y)));
  ctx.closePath();
}

function drawFrame(ctx: CanvasRenderingContext2D, ship: Ship): void {
  ctx.beginPath();
  ctx.rect(0, 0, FIELD_W, FIELD_H);
  glow(ctx, ship.hue, 1.4, 0.32);
  if (ship.flash > 0) glow(ctx, 0, 2.6, ship.flash); // red flash on a crash
}

// ---- Canyon ----

/** The walls drift round the colour wheel the further up the canyon you get. */
function wallHue(d: number): number {
  return (250 + d * 0.03) % 360;
}

/** A corner of a wall's edge (layer 0) or of a contour line further out (1, 2). Slightly jagged. */
function wallPoint(game: Game, i: number, side: number, layer: number): Point {
  const d = i * WALL_STEP;
  const { cx, hw } = canyonAt(game, d);
  const jag = (hash(i, game.seed + side * 31 + layer * 7) - 0.5) * 13;
  return [cx + side * (hw + layer * 30 + jag), screenY(game, d)];
}

function drawCanyon(ctx: CanvasRenderingContext2D, game: Game): void {
  const first = Math.floor((game.scroll - 60) / WALL_STEP);
  const last = Math.ceil((game.scroll + FIELD_H + 60) / WALL_STEP);
  const chunk = 6; // corners per stroke, so the colour can shift along the wall
  for (const side of [-1, 1]) {
    for (let layer = 0; layer < 3; layer++) {
      for (let start = first; start < last; start += chunk) {
        ctx.beginPath();
        for (let i = start; i <= Math.min(start + chunk, last); i++) {
          const [x, y] = wallPoint(game, i, side, layer);
          if (i === start) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        glow(ctx, wallHue(start * WALL_STEP) + layer * 20, layer ? 1.4 : 2.2, [1, 0.45, 0.2][layer]);
      }
    }
    // Struts from the edge out to the far contour give the walls some depth.
    ctx.beginPath();
    for (let i = Math.ceil(first / 3) * 3; i < last; i += 3) {
      const [ax, ay] = wallPoint(game, i, side, 0);
      const [bx, by] = wallPoint(game, i + 2, side, 2);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    glow(ctx, wallHue(game.scroll + FIELD_H / 2) + 30, 1.1, 0.28);
  }

  // Speed streaks on the canyon floor.
  const spacing = 46;
  const streak = 6 + game.speed * 0.05;
  ctx.beginPath();
  for (let j = Math.floor(game.scroll / spacing); j * spacing < game.scroll + FIELD_H + spacing; j++) {
    const d = j * spacing;
    const { cx, hw } = canyonAt(game, d);
    const x = cx + (hash(j, game.seed + 99) * 2 - 1) * (hw - 16);
    const y = screenY(game, d);
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + streak);
  }
  glow(ctx, 220, 1, 0.2, 80);
}

/** The red line at the bottom you mustn't be knocked back to, and ticks where the ships start. */
function drawLines(ctx: CanvasRenderingContext2D, game: Game, ship: Ship): void {
  const danger = clamp((ship.y - SHIP_START_Y) / (DEATH_Y - SHIP_START_Y), 0, 1);
  const pulse = 0.5 + 0.5 * Math.sin(game.clock * (3 + danger * 12));
  ctx.setLineDash([16, 12]);
  ctx.lineDashOffset = -game.clock * 30;
  ctx.beginPath();
  ctx.moveTo(0, FIELD_H - 6);
  ctx.lineTo(FIELD_W, FIELD_H - 6);
  glow(ctx, 355, 1.8, 0.3 + danger * (0.35 + 0.35 * pulse));
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.moveTo(0, SHIP_START_Y);
  ctx.lineTo(14, SHIP_START_Y);
  ctx.moveTo(FIELD_W, SHIP_START_Y);
  ctx.lineTo(FIELD_W - 14, SHIP_START_Y);
  glow(ctx, ship.hue, 1.4, 0.5);
}

// ---- Things in the canyon ----

function drawArrows(ctx: CanvasRenderingContext2D, game: Game, ship: Ship): void {
  for (const p of game.powerups) {
    const fate = ship.arrows.get(p.id);
    if (fate === 'caught' || fate === 'fumbled') continue;
    const y = screenY(game, p.d);
    if (y < -150 || y > FIELD_H + 40) continue;
    const hue = ARROW_HUES[p.arrow];
    const t = timeToShip(game, ship, p.d);
    const inLine = Math.abs(p.x - ship.x) <= CATCH_REACH;
    const live = !fate && ship.alive && game.phase === 'play';
    const hot = live && inLine && Math.abs(t) <= GOOD_WINDOW;
    tracePath(ctx, arrowPoints(p.arrow, 1.25 + 0.06 * Math.sin(game.clock * 9)), p.x, y);
    glow(ctx, hue, hot ? 3.2 : 2.3, fate ? 0.3 : 1, hot ? 78 : 60);
    // The approach ring closes onto the arrow just as it reaches the ship.
    if (live && t > 0 && t < APPROACH_TIME) {
      const k = t / APPROACH_TIME;
      ctx.beginPath();
      ctx.arc(p.x, y, 32 + 110 * k, 0, Math.PI * 2);
      glow(ctx, hue, 1.6, (1 - k) * (inLine ? 0.95 : 0.3));
    }
  }
}

/**
 * Rocks are a dull brown, so nobody mistakes them for something to collect. The ones the rival sent
 * look just the same but red, with a flashing warning chevron before they come into view.
 */
function drawRocks(ctx: CanvasRenderingContext2D, game: Game, ship: Ship): void {
  for (const rock of game.rocks) {
    if (ship.smashed.has(rock.id)) continue;
    const y = screenY(game, rock.d);
    if (y < -rock.r || y > FIELD_H + rock.r) continue;
    tracePath(ctx, rockPoints(rock, game.clock), rock.x, y);
    glow(ctx, rock.hue, 2.2, 0.8, 30, 55);
  }
  for (const rock of ship.incoming) {
    if (ship.smashed.has(rock.id)) continue;
    const y = screenY(game, rock.d);
    if (y < -rock.r) {
      ctx.beginPath();
      ctx.moveTo(rock.x - 14, 10);
      ctx.lineTo(rock.x, 24);
      ctx.lineTo(rock.x + 14, 10);
      glow(ctx, rock.hue, 2.4, Math.sin(game.clock * 18) > 0 ? 1 : 0.35, 40);
      continue;
    }
    if (y > FIELD_H + rock.r) continue;
    tracePath(ctx, rockPoints(rock, game.clock), rock.x, y);
    glow(ctx, rock.hue, 2.2, 1, 36);
  }
}

/** Brackets either side of the ship, lit in the colour of the next arrow, show where it can be caught. */
function drawCatchZone(ctx: CanvasRenderingContext2D, game: Game, ship: Ship): void {
  if (!ship.alive || game.phase !== 'play') return;
  let strength = 0;
  let hue = 0;
  for (const p of game.powerups) {
    if (ship.arrows.has(p.id)) continue;
    const t = timeToShip(game, ship, p.d);
    if (t < -GOOD_WINDOW || t > APPROACH_TIME) continue;
    const s = (1 - Math.max(0, t) / APPROACH_TIME) * (Math.abs(p.x - ship.x) <= CATCH_REACH ? 1 : 0.3);
    if (s > strength) {
      strength = s;
      hue = ARROW_HUES[p.arrow];
    }
  }
  if (!strength) return;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    const x = ship.x + side * (CATCH_REACH + 4);
    ctx.moveTo(x - side * 9, ship.y - 18);
    ctx.lineTo(x, ship.y - 18);
    ctx.lineTo(x, ship.y + 18);
    ctx.lineTo(x - side * 9, ship.y + 18);
  }
  glow(ctx, hue, 1.8, strength);
}

function drawShip(ctx: CanvasRenderingContext2D, game: Game, ship: Ship): void {
  if (!ship.alive) return;
  const alpha = ship.invuln > 0 && Math.floor(ship.invuln * 14) % 2 ? 0.3 : 1;
  const bank = clamp(ship.vx / SHIP_SPEED, -1, 1);
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(bank * 0.2);
  ctx.scale(1 - Math.abs(bank) * 0.25, 1); // squash as it banks, like it's rolling
  const flame = 9 + Math.random() * 9 + game.speed * 0.02;
  ctx.beginPath();
  ctx.moveTo(-6, 16);
  ctx.lineTo(0, 16 + flame);
  ctx.lineTo(6, 16);
  glow(ctx, 28, 2, alpha);
  ctx.beginPath();
  ctx.moveTo(-3, 16);
  ctx.lineTo(0, 16 + flame * 0.55);
  ctx.lineTo(3, 16);
  glow(ctx, 52, 1.4, alpha, 72);
  tracePath(ctx, SHIP_HULL, 0, 0);
  glow(ctx, ship.hue, 2.5, alpha);
  tracePath(ctx, SHIP_COCKPIT, 0, 0);
  glow(ctx, ship.hue, 1.5, alpha, 78);
  ctx.restore();
}

function drawParticles(ctx: CanvasRenderingContext2D, ship: Ship): void {
  for (const p of ship.particles) {
    ctx.beginPath();
    if (p.ring) {
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    } else {
      const dx = (Math.cos(p.angle) * p.size) / 2;
      const dy = (Math.sin(p.angle) * p.size) / 2;
      ctx.moveTo(p.x - dx, p.y - dy);
      ctx.lineTo(p.x + dx, p.y + dy);
    }
    glow(ctx, p.hue, p.ring ? 2.2 : 1.8, Math.min(1, (p.life / p.maxLife) * 1.6));
  }
}

function drawLabels(ctx: CanvasRenderingContext2D, ship: Ship): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const label of ship.labels) {
    const pop = 1 + 0.6 * Math.max(0, 1 - label.age / 0.12);
    ctx.font = `800 ${Math.round(label.size * pop)}px ${FONT}`;
    ctx.globalAlpha = Math.min(1, (1 - label.age / label.life) * 2.5);
    ctx.fillStyle = `hsl(${label.hue}, 100%, 72%)`;
    ctx.fillText(label.text, label.x, label.y);
  }
}

// ---- Between the fields ----

/** A caught arrow arcs over from the catcher's ship into the top of the rival's canyon. */
function drawMissiles(ctx: CanvasRenderingContext2D, game: Game, layout: Layout): void {
  for (const missile of game.missiles) {
    const a = toScreen(layout, missile.from, missile.x, missile.y);
    const b = toScreen(layout, missile.to, missile.tx, 0);
    const c: Point = [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - 60];
    const at = (t: number): Point => {
      const e = t * t * (3 - 2 * t);
      const u = 1 - e;
      return [u * u * a[0] + 2 * u * e * c[0] + e * e * b[0], u * u * a[1] + 2 * u * e * c[1] + e * e * b[1]];
    };
    const hue = PLAYER_HUES[missile.from];
    ctx.beginPath();
    for (let k = 0; k <= 10; k++) {
      const [x, y] = at(clamp(missile.t - k * 0.025, 0, 1));
      if (k) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    glow(ctx, hue, 3, 1, 65);
    const [hx, hy] = at(missile.t);
    ctx.beginPath();
    ctx.arc(hx, hy, 6, 0, Math.PI * 2);
    glow(ctx, hue, 2.5, 1, 80);
  }
}

function toScreen(layout: Layout, field: number, x: number, y: number): Point {
  const origin = layout.fields[field];
  return [origin.x + x * layout.scale, origin.y + y * layout.scale];
}
