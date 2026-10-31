import '../../src/lib/theme.css';
import './style.css';
import { Pads } from '../../src/lib/pads';
import { makeLayout, render, type Layout } from './draw';
import { COUNTDOWN, FIELD_W, newGame, update, type Game, type Input } from './game';

/** Seconds after a race ends before START begins another, so a last frantic stomp doesn't skip the result. */
const RESTART_DELAY = 1.5;

const vec = document.querySelector<HTMLCanvasElement>('#vec')!;
const bloom = document.querySelector<HTMLCanvasElement>('#bloom')!;
const ctx = vec.getContext('2d', { alpha: false })!;
const bloomCtx = bloom.getContext('2d')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const distance = document.querySelector<HTMLElement>('#distance')!;
const tags = Array.from(document.querySelectorAll<HTMLElement>('.tag'));

const pads = new Pads({ autoPoll: false });
let game: Game = newGame(true);
// For poking at a live game from the dev tools console (dev server only).
if (import.meta.env.DEV) Object.assign(window, { canyonDuel: () => game });
let layout: Layout = makeLayout(innerWidth, innerHeight);
let dpr = 1;

function resize(): void {
  dpr = Math.min(devicePixelRatio || 1, 2);
  vec.width = Math.round(innerWidth * dpr);
  vec.height = Math.round(innerHeight * dpr);
  // The glow is a third-size copy of the lines that CSS blurs and screens back over them.
  bloom.width = Math.max(1, Math.round(innerWidth / 3));
  bloom.height = Math.max(1, Math.round(innerHeight / 3));
  bloomCtx.imageSmoothingQuality = 'high';
  layout = makeLayout(innerWidth, innerHeight);
  tags.forEach((tag, i) => {
    const field = layout.fields[i];
    tag.style.left = `${field.x}px`;
    tag.style.top = `${field.y}px`;
    tag.style.width = `${FIELD_W * layout.scale}px`;
  });
}
addEventListener('resize', resize);
resize();

function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

const TITLE = `
  <div class="panel">
    <h1 class="logo">Canyon Duel</h1>
    <ul class="how">
      <li>Hold <b>←</b> <b>→</b> to steer up the canyon. Rocks and walls knock you back.</li>
      <li>When an <b class="up">↑</b> or <b class="down">↓</b> arrow reaches your ship, step on that arrow to catch it
        and fire rocks into your rival's canyon.</li>
      <li>For a <b class="both">↕</b> arrow, jump onto <b>↑</b> and <b>↓</b> together: it fires rocks
        <em>and</em> lifts you back up the canyon.</li>
      <li>Get knocked off the bottom and you lose.</li>
    </ul>
    <p class="start">Press START</p>
  </div>`;

function resultHtml(): string {
  const [p1, p2] = game.ships;
  const winner = game.winner ?? -1;
  const row = (name: string, a: number, b: number) => `<tr><th>${name}</th><td>${a}</td><td>${b}</td></tr>`;
  return `
    <div class="panel">
      <h1 class="winner ${winner >= 0 ? `p${winner + 1}` : ''}">${winner >= 0 ? `Player ${winner + 1} wins!` : 'Draw!'}</h1>
      <table class="stats">
        <tr><th></th><td class="p1">P1</td><td class="p2">P2</td></tr>
        ${row('Arrows caught', p1.caught, p2.caught)}
        ${row('Rocks sent', p1.sent, p2.sent)}
        ${row('Crashes', p1.crashes, p2.crashes)}
      </table>
      <p class="lasted">The race lasted ${Math.round(game.time)} seconds</p>
      <p class="start later">Press START to race again · hold SELECT for the menu</p>
    </div>`;
}

let overlayKey = '';
function updateOverlay(): void {
  let key = '';
  if (game.phase === 'title' || game.phase === 'over') key = game.phase;
  else if (game.phase === 'countdown') key = String(Math.ceil(COUNTDOWN - game.phaseTime));
  else if (game.phaseTime < 0.7) key = 'GO!';
  overlay.classList.toggle('ready', game.phase === 'over' && game.phaseTime >= RESTART_DELAY);
  if (key === overlayKey) return;
  overlayKey = key;
  if (key === 'title') overlay.innerHTML = TITLE;
  else if (key === 'over') overlay.innerHTML = resultHtml();
  else overlay.innerHTML = key ? `<div class="count">${key}</div>` : '';
}

function updateHud(): void {
  const racing = game.phase === 'play' || game.phase === 'over';
  setText(distance, racing ? `${Math.floor(game.scroll / 10)} m` : '');
  tags.forEach((tag, i) => {
    const sent = game.ships[i].sent;
    setText(tag.lastElementChild!, racing && sent ? `${sent} rocks sent` : '');
  });
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  pads.poll();
  const canStart = game.phase === 'title' || (game.phase === 'over' && game.phaseTime >= RESTART_DELAY);
  if (canStart && pads.wasPressed('start')) game = newGame(false);
  const inputs: Input[] = [0, 1].map((i) => ({
    left: pads.isDown('left', i),
    right: pads.isDown('right', i),
    up: pads.wasPressed('up', i),
    down: pads.wasPressed('down', i),
  }));
  update(game, dt, inputs);
  render(ctx, game, layout, dpr);
  bloomCtx.drawImage(vec, 0, 0, bloom.width, bloom.height);
  updateOverlay();
  updateHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
