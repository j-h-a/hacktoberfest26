import '../../src/lib/theme.css';
import './style.css';
import { Pads } from '../../src/lib/pads';
import { COUNTDOWN, HOP_CHARGES, distance, newGame, update, type Game, type Input } from './game';
import { View } from './scene';

/** Seconds after the night ends before START begins another, so a last stomp doesn't skip the result. */
const RESTART_DELAY = 1.5;
const BEST_KEY = 'pad-arcade:hop-tu-naa:best';

/** Lane i's panel. Side by side, the pads make six columns: ← ↓ → on pad 1, then on pad 2. */
const LANE_PANELS = [
  [0, 'left'],
  [0, 'down'],
  [0, 'right'],
  [1, 'left'],
  [1, 'down'],
  [1, 'right'],
] as const;

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const distanceText = document.querySelector<HTMLElement>('#distance')!;
const legs = Array.from(document.querySelectorAll<SVGGElement>('#legs .leg'));
const lanes = Array.from(document.querySelectorAll<HTMLElement>('#lanes .lane'));
const hops = Array.from(document.querySelectorAll<HTMLElement>('#lanes .hop'));
// One pip per hop she can save up, on each pad's ↑.
const pips = hops.map((hop) => {
  const holder = hop.querySelector('.pips')!;
  return Array.from({ length: HOP_CHARGES }, () => holder.appendChild(document.createElement('i')));
});
const flash = document.querySelector<HTMLElement>('#flash')!;

const view = new View(canvas);
const pads = new Pads({ autoPoll: false });
let game: Game = newGame(true);
// For poking at a live game from the dev tools console (dev server only).
if (import.meta.env.DEV) Object.assign(window, { hopTuNaa: () => game });
let best = loadBest();
let newBest = false;

function resize(): void {
  view.resize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

function readInput(): Input {
  const lanes: number[] = [];
  LANE_PANELS.forEach(([player, button], lane) => {
    if (pads.wasPressed(button, player)) lanes.push(lane);
  });
  return { lanes, hop: pads.wasPressed('up') };
}

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(): void {
  const metres = Math.floor(distance(game));
  newBest = metres > best;
  if (!newBest) return;
  best = metres;
  try {
    localStorage.setItem(BEST_KEY, String(best));
  } catch {
    // Storage blocked: the best lasts until the page reloads.
  }
}

function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

const TITLE = `
  <div class="panel">
    <h1 class="logo">Hop-tu-Naa</h1>
    <p class="tagline">A Manx fairy's dash through the woods on Hop-tu-Naa night</p>
    <ul class="how">
      <li>Stand across <b>both pads</b>. Their <b>←</b> <b>↓</b> <b>→</b> panels are the six lanes, left to
        right: step on one to fly to its lane.</li>
      <li>Step on <b>↑</b> on either pad to <b>hop</b> over pumpkins, turnips, rocks and logs, but not
        hedges. You can save up ${HOP_CHARGES} hops, and they come back slowly.</li>
      <li>You can't slip sideways past anything beside you, so pick your gap early.</li>
      <li>Three crashes and the night's over.</li>
    </ul>
    <p class="start">Press START</p>
  </div>`;

function overHtml(): string {
  const f = game.fairy;
  return `
    <div class="panel">
      <h1 class="over">Oie vie!</h1>
      <p class="tagline">Good night, little fairy</p>
      <p class="score">${Math.floor(distance(game))} m</p>
      <p class="best">${newBest ? 'A new best!' : `Best: ${best} m`} · ${f.hops} hop${f.hops === 1 ? '' : 's'}</p>
      <p class="start later">Press START to fly again · hold SELECT for the menu</p>
    </div>`;
}

let overlayKey = '';
function updateOverlay(): void {
  let key = '';
  if (game.phase === 'title') key = 'title';
  else if (game.phase === 'over' && game.phaseTime > 0.8) key = 'over';
  else if (game.phase === 'countdown') key = String(Math.ceil(COUNTDOWN - game.phaseTime));
  else if (game.phase === 'play' && game.phaseTime < 0.7) key = 'Fly!';
  overlay.classList.toggle('ready', game.phase === 'over' && game.phaseTime >= RESTART_DELAY);
  if (key === overlayKey) return;
  overlayKey = key;
  if (key === 'title') overlay.innerHTML = TITLE;
  else if (key === 'over') overlay.innerHTML = overHtml();
  else overlay.innerHTML = key ? `<div class="count">${key}</div>` : '';
}

function updateHud(): void {
  const f = game.fairy;
  document.body.classList.toggle('playing', game.phase !== 'title');
  setText(distanceText, game.phase === 'play' || game.phase === 'over' ? `${Math.floor(distance(game))} m` : '');
  legs.forEach((leg, i) => leg.classList.toggle('lost', i >= f.lives));

  // The guide: where she is, where she's heading, which panels are down, and the hops saved up.
  const here = Math.round(f.x);
  lanes.forEach((el, lane) => {
    const [player, button] = LANE_PANELS[lane];
    el.classList.toggle('here', lane === here);
    el.classList.toggle('target', lane === f.target);
    el.classList.toggle('down', pads.isDown(button, player));
  });
  hops.forEach((el, player) => {
    el.classList.toggle('down', pads.isDown('up', player));
    el.classList.toggle('flying', f.hop > 0);
    pips[player].forEach((pip, i) => pip.style.setProperty('--fill', String(Math.min(1, Math.max(0, f.hopCharge - i)))));
  });
}

/** Restart a one-shot CSS animation on an element. */
function replay(el: HTMLElement, className: string): void {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  pads.poll();
  const canStart = game.phase === 'title' || (game.phase === 'over' && game.phaseTime >= RESTART_DELAY);
  if (canStart && pads.wasPressed('start')) game = newGame(false);
  update(game, dt, readInput());
  for (const event of game.events) {
    if (event.type === 'crash' && !game.attract) replay(flash, 'on');
    if (event.type === 'nohop') for (const el of hops) replay(el, 'denied');
    if (event.type === 'over') saveBest();
  }
  view.render(game, dt);
  updateHud();
  updateOverlay();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
