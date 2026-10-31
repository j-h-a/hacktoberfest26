/**
 * Draws the arena on a 2D canvas. Everything is in field units; one transform scales the field
 * to fit the screen. main.ts adds the glow by screening a blurred copy of the frame over it.
 */
import {
  BALL_R,
  CATCH_BEHIND,
  CATCH_REACH,
  CATCH_SLACK,
  DROP_ZONE_W,
  FIELD_H,
  FIELD_W,
  GOLD_HUE,
  GRAB_TIME,
  LIVES,
  LOADED_SLOTS,
  MAX_BALLS,
  PADDLE_W,
  PLAYER_HUES,
  POWERUP_KINDS,
  POWERUPS,
  aheadOf,
  clamp,
  inCatchZone,
  loadedBalls,
  type Game,
  type Paddle,
} from './game';

const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export interface Layout {
  width: number;
  height: number;
  /** CSS pixels per field unit. */
  scale: number;
  /** Top-left corner of the field, in CSS pixels. */
  x: number;
  y: number;
}

export function makeLayout(width: number, height: number): Layout {
  const scale = Math.min(width / FIELD_W, height / FIELD_H);
  return { width, height, scale, x: (width - FIELD_W * scale) / 2, y: (height - FIELD_H * scale) / 2 };
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsl(${h} ${s}% ${l}% / ${a})`;
}

export function render(ctx: CanvasRenderingContext2D, game: Game, layout: Layout, dpr: number, now: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#020309';
  ctx.fillRect(0, 0, layout.width, layout.height);

  const shake = game.shake * game.shake * 14;
  const ox = (Math.random() * 2 - 1) * shake;
  const oy = (Math.random() * 2 - 1) * shake;
  const s = layout.scale * dpr;
  ctx.setTransform(s, 0, 0, s, (layout.x + ox * layout.scale) * dpr, (layout.y + oy * layout.scale) * dpr);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const t = now / 1000;
  drawArena(ctx, game, t);
  drawHud(ctx, game);
  drawCrates(ctx, game, t);
  drawCatchZones(ctx, game, t);
  drawPowerups(ctx, game);
  drawBalls(ctx, game);
  for (const p of game.paddles) drawPaddle(ctx, p, t);
  drawParticles(ctx, game);
  drawLabels(ctx, game);
}

function drawArena(ctx: CanvasRenderingContext2D, game: Game, t: number): void {
  ctx.fillStyle = '#060817';
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);

  ctx.strokeStyle = 'rgb(120 130 255 / 0.05)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 50; x < FIELD_W; x += 50) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, FIELD_H);
  }
  for (let y = 50; y < FIELD_H; y += 50) {
    ctx.moveTo(0, y);
    ctx.lineTo(FIELD_W, y);
  }
  ctx.stroke();

  // The drop zone, its edges marching down with the crates.
  const zx = (FIELD_W - DROP_ZONE_W) / 2;
  ctx.fillStyle = 'rgb(140 150 255 / 0.035)';
  ctx.fillRect(zx, 0, DROP_ZONE_W, FIELD_H);
  ctx.strokeStyle = 'rgb(150 160 255 / 0.25)';
  ctx.lineWidth = 3;
  ctx.setLineDash([16, 20]);
  ctx.lineDashOffset = -t * game.crateFall;
  ctx.beginPath();
  ctx.moveTo(zx, 0);
  ctx.lineTo(zx, FIELD_H);
  ctx.moveTo(zx + DROP_ZONE_W, 0);
  ctx.lineTo(zx + DROP_ZONE_W, FIELD_H);
  ctx.stroke();
  ctx.setLineDash([]);

  // Each end glows in its player's colour, and flashes when they lose a heart.
  for (const p of game.paddles) {
    const x0 = p.dir === 1 ? 0 : FIELD_W;
    const depth = 190;
    const glow = ctx.createLinearGradient(x0, 0, x0 + p.dir * depth, 0);
    glow.addColorStop(0, hsl(PLAYER_HUES[p.index], 100, 60, 0.16 + p.flash * 0.55));
    glow.addColorStop(1, hsl(PLAYER_HUES[p.index], 100, 60, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(p.dir === 1 ? 0 : FIELD_W - depth, 0, depth, FIELD_H);
    ctx.strokeStyle = hsl(PLAYER_HUES[p.index], 100, 65, 0.55 + p.flash * 0.45);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x0 + p.dir * 2, 0);
    ctx.lineTo(x0 + p.dir * 2, FIELD_H);
    ctx.stroke();
  }

  // Top and bottom walls, which the balls bounce off.
  ctx.strokeStyle = 'rgb(190 200 255 / 0.75)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.lineTo(FIELD_W, 2);
  ctx.moveTo(0, FIELD_H - 2);
  ctx.lineTo(FIELD_W, FIELD_H - 2);
  ctx.stroke();
}

function drawHud(ctx: CanvasRenderingContext2D, game: Game): void {
  if (game.phase === 'title') return;
  for (const p of game.paddles) {
    const hue = PLAYER_HUES[p.index];
    // Just inside the paddle's lane, so the paddle never covers it.
    const x0 = p.dir === 1 ? 100 : FIELD_W - 100;
    ctx.font = `900 34px ${FONT}`;
    ctx.textAlign = p.dir === 1 ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hsl(hue, 100, 66);
    ctx.fillText(`P${p.index + 1}`, x0, 42);
    for (let i = 0; i < LIVES; i++) {
      heartPath(ctx, x0 + p.dir * (82 + i * 40), 42, 14);
      if (i < p.lives) {
        ctx.fillStyle = hsl(hue, 100, 62);
        ctx.fill();
      } else {
        ctx.strokeStyle = hsl(hue, 40, 45, 0.6);
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
    }
    // Timed power-ups under the hearts, each with a bar running down.
    let row = 0;
    for (const kind of POWERUP_KINDS) {
      const info = POWERUPS[kind];
      const left = p.effects[kind];
      if (info.time <= 0 || left <= 0) continue;
      const y = 72 + row * 36;
      const w = 170 * (left / info.time);
      ctx.fillStyle = hsl(info.hue, 90, 55, 0.85);
      ctx.fillRect(p.dir === 1 ? x0 : x0 - w, y, w, 7);
      ctx.font = `800 18px ${FONT}`;
      ctx.fillStyle = hsl(info.hue, 90, 70);
      ctx.fillText(`${info.icon} ${info.name.toUpperCase()}`, x0, y + 22);
      row++;
    }
  }
}

function heartPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.95);
  ctx.bezierCurveTo(x - s * 0.15, y + s * 0.75, x - s, y + s * 0.3, x - s, y - s * 0.25);
  ctx.bezierCurveTo(x - s, y - s * 0.8, x - s * 0.3, y - s * 1.05, x, y - s * 0.45);
  ctx.bezierCurveTo(x + s * 0.3, y - s * 1.05, x + s, y - s * 0.8, x + s, y - s * 0.25);
  ctx.bezierCurveTo(x + s, y + s * 0.3, x + s * 0.15, y + s * 0.75, x, y + s * 0.95);
  ctx.closePath();
}

function drawCrates(ctx: CanvasRenderingContext2D, game: Game, t: number): void {
  for (const c of game.crates) {
    const x = c.x - c.w / 2;
    const y = c.y - c.h / 2;
    if (c.special) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 9);
      ctx.fillStyle = hsl(GOLD_HUE, 100, 50, 0.35 + pulse * 0.25);
      ctx.strokeStyle = hsl((t * 200) % 360, 100, 68);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.roundRect(x, y, c.w, c.h, 12);
      ctx.fill();
      ctx.stroke();
      ctx.font = `900 50px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = hsl(GOLD_HUE, 100, 85 + pulse * 15);
      ctx.fillText('?', c.x, c.y + 3);
      continue;
    }
    // Ordinary crates: a frame with an inset panel, in slightly varying blues.
    const hue = 222 + ((c.id * 37) % 30);
    ctx.fillStyle = hsl(hue, 35, 17, 0.95);
    ctx.strokeStyle = hsl(hue, 70, 72);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, c.w, c.h, 6);
    ctx.fill();
    ctx.stroke();
    const inset = Math.min(9, c.w / 5, c.h / 5);
    ctx.strokeStyle = hsl(hue, 60, 62, 0.35);
    ctx.lineWidth = 2;
    ctx.strokeRect(x + inset, y + inset, c.w - inset * 2, c.h - inset * 2);
  }
}

/**
 * While a power-up is on its way to someone, light up where they can catch it: gold with a
 * step-back arrow, or red with a skull for a cursed one they should let go by.
 */
function drawCatchZones(ctx: CanvasRenderingContext2D, game: Game, t: number): void {
  for (const pu of game.powerups) {
    const p = game.paddles[pu.owner];
    const ahead = aheadOf(p, pu.x);
    if (ahead < -CATCH_BEHIND) continue;
    const bad = POWERUPS[pu.kind].bad;
    const hue = bad ? 0 : GOLD_HUE;
    const near = clamp(1 - (ahead - CATCH_REACH) / 900, 0, 1);
    const ready = inCatchZone(p, pu);
    const face = p.x + (p.dir * PADDLE_W) / 2;
    const x = p.dir === 1 ? face - CATCH_BEHIND : face - CATCH_REACH;
    const y = p.y - p.h / 2 - CATCH_SLACK;
    const h = p.h + CATCH_SLACK * 2;
    const w = CATCH_REACH + CATCH_BEHIND;
    ctx.fillStyle = hsl(hue, 100, 55, ready ? 0.3 : 0.05 + near * 0.1);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = hsl(hue, 100, 62, ready ? 1 : 0.25 + near * 0.5);
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 10]);
    ctx.lineDashOffset = t * 40;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    // Over the paddle: the step-back arrow (← for player 1, → for player 2), or a warning skull.
    const pulse = ready ? 1 + 0.15 * Math.sin(t * 25) : 1;
    ctx.font = `900 ${Math.round(46 * pulse)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hsl(hue, 100, ready ? 70 : 60, ready ? 1 : 0.3 + near * 0.5);
    const above = p.y - p.h / 2 - CATCH_SLACK - 34;
    const arrowY = above < 30 ? p.y + p.h / 2 + CATCH_SLACK + 34 : above;
    ctx.fillText(bad ? '☠' : p.dir === 1 ? '←' : '→', face + p.dir * 40, arrowY);
  }
}

function drawPowerups(ctx: CanvasRenderingContext2D, game: Game): void {
  for (const pu of game.powerups) {
    const info = POWERUPS[pu.kind];
    const pulse = 1 + Math.sin(pu.age * 14) * 0.07;
    ctx.save();
    ctx.translate(pu.x, pu.y);
    ctx.scale(pulse, pulse);
    ctx.beginPath();
    ctx.roundRect(-40, -25, 80, 50, 25);
    // Cursed ones are dark with a red rim; the rest are bright with a white one.
    ctx.fillStyle = info.bad ? hsl(0, 55, 10) : hsl(info.hue, 100, 48);
    ctx.fill();
    ctx.strokeStyle = info.bad ? hsl(0, 100, 58) : '#fff';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.font = `900 ${Math.round(30 * (info.iconScale ?? 1))}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!info.bad) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgb(0 0 0 / 0.35)';
      ctx.strokeText(info.icon, 0, 2);
    }
    ctx.fillStyle = info.bad ? hsl(0, 100, 62) : '#fff';
    ctx.fillText(info.icon, 0, 2);
    ctx.restore();
  }
}

function drawBalls(ctx: CanvasRenderingContext2D, game: Game): void {
  for (const b of game.balls) {
    const hue = PLAYER_HUES[b.owner];
    const tr = b.trail;
    for (let i = 2; i < tr.length; i += 2) {
      const a = i / tr.length;
      ctx.strokeStyle = hsl(hue, 100, 60, a * 0.45);
      ctx.lineWidth = BALL_R * 1.6 * a;
      ctx.beginPath();
      ctx.moveTo(tr[i - 2], tr[i - 1]);
      ctx.lineTo(tr[i], tr[i + 1]);
      ctx.stroke();
    }
    ball(ctx, b.x, b.y, BALL_R, hue, 1, b.pierce);
  }
}

/** A ball; piercing ones wear a violet halo. */
function ball(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, hue: number, alpha: number, pierce: boolean): void {
  if (pierce) {
    ctx.strokeStyle = hsl(POWERUPS.pierce.hue, 100, 75, alpha);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = hsl(hue, 100, 60, alpha);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hsl(hue, 100, 92, alpha);
  ctx.beginPath();
  ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
}

function drawPaddle(ctx: CanvasRenderingContext2D, p: Paddle, t: number): void {
  const hue = PLAYER_HUES[p.index];
  const face = p.x + (p.dir * PADDLE_W) / 2;
  const top = p.y - p.h / 2;

  // Loaded balls wait in front of the paddle, and the next one grows as it loads.
  if (p.charge > 0) {
    const loaded = loadedBalls(p);
    const full = loaded >= MAX_BALLS;
    const frac = full ? 0 : p.charge - loaded;
    const pierce = p.effects.pierce > 0;
    const bx = face + p.dir * (BALL_R + 5);
    for (let i = 0; i < MAX_BALLS; i++) {
      const by = p.y + LOADED_SLOTS[i];
      if (i < loaded) {
        const r = BALL_R * (full ? 1 + 0.12 * Math.sin(t * 20) : 1);
        ball(ctx, bx, by, r, hue, 1, pierce);
      } else if (i === loaded && frac > 0) {
        ctx.strokeStyle = hsl(hue, 100, 70, 0.5);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(bx, by, BALL_R, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
        ball(ctx, bx, by, BALL_R * frac, hue, 0.45, false);
      }
    }
  }

  // The catch: a scoop held out in front of the paddle.
  if (p.grab > 0) {
    const k = p.grab / GRAB_TIME;
    const reach = CATCH_REACH * (0.6 + 0.4 * k);
    ctx.strokeStyle = hsl(GOLD_HUE, 100, 65, 0.35 + 0.65 * k);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(face + p.dir * reach, top - 18);
    ctx.lineTo(face, top - 18);
    ctx.lineTo(face, top + p.h + 18);
    ctx.lineTo(face + p.dir * reach, top + p.h + 18);
    ctx.stroke();
  }

  const glow = p.charging ? 0.5 + 0.5 * Math.sin(t * (6 + p.charge * 6)) : 0;
  ctx.fillStyle = p.flash > 0 ? hsl(hue, 100 - p.flash * 100, 60 + p.flash * 40) : hsl(hue, 100, 58 + glow * 14);
  ctx.beginPath();
  ctx.roundRect(p.x - PADDLE_W / 2, top, PADDLE_W, p.h, PADDLE_W / 2);
  ctx.fill();
  if (p.effects.cursed > 0) {
    ctx.strokeStyle = hsl(0, 100, 58, 0.6 + 0.4 * Math.sin(t * 12));
    ctx.lineWidth = 5;
    ctx.stroke();
  }
  ctx.fillStyle = hsl(hue, 100, 90);
  ctx.beginPath();
  ctx.roundRect(p.x - 3, top + 10, 6, p.h - 20, 3);
  ctx.fill();
}

function drawParticles(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.globalCompositeOperation = 'lighter';
  for (const pt of game.particles) {
    const a = clamp(pt.life / pt.maxLife, 0, 1);
    const light = pt.sat === 0 ? 85 : 62;
    if (pt.ring) {
      ctx.strokeStyle = hsl(pt.hue, pt.sat, light, a);
      ctx.lineWidth = 4 * a + 1;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = hsl(pt.hue, pt.sat, light, a);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * (0.4 + 0.6 * a), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawLabels(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of game.labels) {
    const k = l.age / l.life;
    const a = 1 - k * k;
    const pop = 1 + Math.max(0, 0.3 - l.age) * 1.5;
    ctx.font = `900 ${Math.round(l.size * pop)}px ${FONT}`;
    const x = clamp(l.x, 120, FIELD_W - 120);
    const y = l.y - l.age * 50;
    ctx.lineWidth = 6;
    ctx.strokeStyle = `rgb(2 3 9 / ${a * 0.8})`;
    ctx.strokeText(l.text, x, y);
    ctx.fillStyle = l.hue < 0 ? `rgb(230 232 255 / ${a})` : hsl(l.hue, 100, 70, a);
    ctx.fillText(l.text, x, y);
  }
}
