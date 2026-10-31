import '../../src/lib/theme.css';
import './style.css';
import { Pads } from '../../src/lib/pads';
import { COUNTDOWN, HOLD_LANE, HOLD_TIME, PANELS, TAP_LANE, distance, newGame, update, type Game, type Input, type Panel } from './game';
import { View } from './scene';

/** Seconds after the night ends before START begins another, so a last stomp doesn't skip the result. */
const RESTART_DELAY = 1.5;
const BEST_KEY = 'pad-arcade:hop-tu-naa:best';

/** Which pad and arrow each steering panel is. */
const PANEL_BUTTONS: Record<Panel, [player: number, button: 'left' | 'right']> = {
  p1l: [0, 'left'],
  p1r: [0, 'right'],
  p2l: [1, 'left'],
  p2r: [1, 'right'],
};

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const distanceText = document.querySelector<HTMLElement>('#distance')!;
const legs = Array.from(document.querySelectorAll<SVGGElement>('#legs .leg'));
const lanes = Array.from(document.querySelectorAll<HTMLElement>('#lanes .lane'));
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
  const input = {} as Input;
  for (const panel of PANELS) {
    const [player, button] = PANEL_BUTTONS[panel];
    input[panel] = { down: pads.isDown(button, player), pressed: pads.wasPressed(button, player) };
  }
  return input;
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
      <li>Stand across <b>both pads</b> and step on an <b>←</b> or <b>→</b> to fly to its lane.</li>
      <li><b>Hold</b> pad 1's <b>←</b> or pad 2's <b>→</b> to reach the edge lanes. Step off to come back in.</li>
      <li>Dodge the pumpkins, turnips, rocks and hedges. You can't slip sideways past anything
        beside you, so pick your gap early.</li>
      <li>Three crashes and the night's over.</li>
    </ul>
    <p class="start">Press START</p>
  </div>`;

function overHtml(): string {
  const metres = Math.floor(distance(game));
  return `
    <div class="panel">
      <h1 class="over">Oie vie!</h1>
      <p class="tagline">Good night, little fairy</p>
      <p class="score">${metres} m</p>
      <p class="best">${newBest ? 'A new best!' : `Best: ${best} m`}</p>
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

  // The lane guide: where she is, where she's heading, which panels are down, how long the hold has to go.
  const here = Math.round(f.x);
  const held = new Set(PANELS.filter((p) => readPanel(p)));
  lanes.forEach((el, lane) => {
    el.classList.toggle('here', lane === here);
    el.classList.toggle('target', lane === f.target);
    const panel = PANELS.find((p) => TAP_LANE[p] === lane || HOLD_LANE[p] === lane)!;
    el.classList.toggle('down', held.has(panel));
  });
  for (const panel of ['p1l', 'p2r'] as const) {
    const el = lanes[HOLD_LANE[panel]!];
    const s = f.steer;
    const progress = s?.panel === panel ? (s.held ? 1 : Math.min(1, (game.clock - s.at) / HOLD_TIME)) : 0;
    el.style.setProperty('--hold', String(progress));
  }
}

function readPanel(panel: Panel): boolean {
  const [player, button] = PANEL_BUTTONS[panel];
  return pads.isDown(button, player);
}

function flashScreen(): void {
  flash.classList.remove('on');
  void flash.offsetWidth; // restart the animation
  flash.classList.add('on');
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
    if (event.type === 'crash' && !game.attract) flashScreen();
    if (event.type === 'over') saveBest();
  }
  view.render(game, dt);
  updateHud();
  updateOverlay();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
