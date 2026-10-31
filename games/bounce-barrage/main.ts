import '../../src/lib/theme.css';
import './style.css';
import { Pads, type PadButton } from '../../src/lib/pads';
import { makeLayout, render, type Layout } from './draw';
import {
  COUNTDOWN,
  LIVES,
  POWERUP_KINDS,
  POWERUPS,
  newGame,
  update,
  type Game,
  type GameEvent,
  type Input,
} from './game';

/** Seconds after a game ends before START begins another, so a last frantic stomp doesn't skip the result. */
const RESTART_DELAY = 1.5;

/** Players stand side-on facing each other, so forward and back are opposite arrows for each of them. */
const FORWARD: PadButton[] = ['right', 'left'];
const BACK: PadButton[] = ['left', 'right'];

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const bloom = document.querySelector<HTMLCanvasElement>('#bloom')!;
const ctx = canvas.getContext('2d', { alpha: false })!;
const bloomCtx = bloom.getContext('2d')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;

const pads = new Pads({ autoPoll: false });
let game: Game = newGame(true);
// For poking at a live game from the dev tools console (dev server only).
if (import.meta.env.DEV) Object.assign(window, { bounceBarrage: () => game });
let layout: Layout = makeLayout(innerWidth, innerHeight);
let dpr = 1;

function resize(): void {
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  // The glow is a quarter-size copy of the frame that CSS blurs and screens back over it.
  bloom.width = Math.max(1, Math.round(innerWidth / 4));
  bloom.height = Math.max(1, Math.round(innerHeight / 4));
  layout = makeLayout(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

const LEGEND = POWERUP_KINDS.map((kind) => {
  const { name, icon, iconScale = 1, hue, bad } = POWERUPS[kind];
  return (
    // Enlarged glyphs sit low in the chip, so lift them a touch.
    `<span class="${bad ? 'bad' : ''}"><i style="--hue: ${hue}">` +
    `<b style="font-size: ${iconScale}em; top: ${-(iconScale - 1) * 0.15}em">${icon}</b></i>` +
    `${name}${bad ? ': let it go!' : ''}</span>`
  );
}).join('');

const TITLE = `
  <div class="panel">
    <h1 class="logo">Bounce Barrage</h1>
    <p class="stance">Stand side-on, facing each other</p>
    <table class="controls">
      <tr><th></th><td class="p1">P1</td><td class="p2">P2</td></tr>
      <tr><th>Move</th><td><kbd>↑</kbd> <kbd>↓</kbd></td><td><kbd>↑</kbd> <kbd>↓</kbd></td></tr>
      <tr><th>Fire <small>tap forward, or hold it for more balls</small></th><td><kbd>→</kbd></td><td><kbd>←</kbd></td></tr>
      <tr><th>Catch a power-up <small>step back</small></th><td><kbd>←</kbd></td><td><kbd>→</kbd></td></tr>
    </table>
    <ul class="how">
      <li>A ball loads by itself every second: <b>tap</b> forward to fire it. <b>Hold</b> forward to load a 2nd and
        3rd, then let go to fire them all.</li>
      <li>Block your rival's balls with your paddle. Each one that gets past costs a heart, and ${LIVES} gone is game over.</li>
      <li>Your own balls can't hurt you: bat them back out if the crates bounce them home.</li>
      <li>Hit a <span class="gold">glowing ? crate</span> and a power-up flies your way. Step back as it reaches you to catch it.</li>
    </ul>
    <p class="legend">${LEGEND}</p>
    <p class="start">Press START</p>
  </div>`;

function resultHtml(): string {
  const [p1, p2] = game.paddles;
  const winner = game.winner ?? -1;
  const row = (name: string, a: number, b: number) => `<tr><th>${name}</th><td>${a}</td><td>${b}</td></tr>`;
  return `
    <div class="panel">
      <h1 class="winner ${winner >= 0 ? `p${winner + 1}` : ''}">${winner >= 0 ? `Player ${winner + 1} wins!` : 'Draw!'}</h1>
      <table class="stats">
        <tr><th></th><td class="p1">P1</td><td class="p2">P2</td></tr>
        ${row('Hearts left', p1.lives, p2.lives)}
        ${row('Balls fired', p1.stats.fired, p2.stats.fired)}
        ${row('Blocks', p1.stats.blocked, p2.stats.blocked)}
        ${row('Balls batted back', p1.stats.returned, p2.stats.returned)}
        ${row('Power-ups caught', p1.stats.caught, p2.stats.caught)}
      </table>
      <p class="lasted">The battle lasted ${Math.round(game.time)} seconds</p>
      <p class="start later">Press START to play again · hold SELECT for the menu</p>
    </div>`;
}

let overlayKey = '';
function updateOverlay(): void {
  let key = '';
  if (game.phase === 'title' || (game.phase === 'over' && game.phaseTime > 1)) key = game.phase;
  else if (game.phase === 'countdown') key = String(Math.ceil(COUNTDOWN - game.phaseTime));
  else if (game.phase === 'play' && game.phaseTime < 0.7) key = 'GO!';
  overlay.classList.toggle('ready', game.phase === 'over' && game.phaseTime >= RESTART_DELAY);
  if (key === overlayKey) return;
  overlayKey = key;
  if (key === 'title') overlay.innerHTML = TITLE;
  else if (key === 'over') overlay.innerHTML = resultHtml();
  else overlay.innerHTML = key ? `<div class="count">${key}</div>` : '';
}

// Sound: tiny synth blips. Browsers only allow audio after a key or click, so pads alone stay silent.
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

function playSounds(events: GameEvent[]): void {
  const played = new Set<string>(); // one of each sound per frame, however many balls bounced
  for (const e of events) {
    const key = `${e.type}:${e.player}`;
    if (played.has(key)) continue;
    played.add(key);
    switch (e.type) {
      case 'count':
        tone(440, 0.15, { volume: 0.05 });
        break;
      case 'go':
        tone(880, 0.3, { volume: 0.05 });
        break;
      case 'charge':
        // The first ball loads every second by itself, so it only gets a soft tick.
        if (e.n === 1) tone(700, 0.04, { type: 'sine', volume: 0.02 });
        else tone(330 * 1.26 ** e.n, 0.09, { type: 'triangle', volume: 0.06 });
        break;
      case 'fire':
        for (let i = 0; i < e.n; i++) tone(950, 0.14, { volume: 0.03, to: 260, delay: i * 0.05 });
        break;
      case 'fizzle':
        tone(180, 0.1, { type: 'triangle', volume: 0.04, to: 110 });
        break;
      case 'bounce':
        tone(1250, 0.03, { type: 'triangle', volume: 0.03 });
        break;
      case 'return':
        tone(620, 0.08, { volume: 0.03, to: 930 });
        break;
      case 'block':
        tone(260, 0.12, { volume: 0.05, to: 120 });
        break;
      case 'hit':
        tone(170, 0.6, { type: 'sawtooth', volume: 0.08, to: 40 });
        break;
      case 'smash':
        [523, 784, 1047].forEach((f, i) => tone(f, 0.12, { type: 'triangle', volume: 0.07, delay: i * 0.05 }));
        break;
      case 'grab':
        tone(520, 0.05, { type: 'sine', volume: 0.04, to: 380 });
        break;
      case 'catch':
        [659, 880, 1175, 1568].forEach((f, i) => tone(f, 0.14, { type: 'triangle', volume: 0.07, delay: i * 0.06 }));
        break;
      case 'curse':
        [330, 311, 294, 277].forEach((f, i) => tone(f, 0.18, { type: 'sawtooth', volume: 0.05, delay: i * 0.09 }));
        break;
      case 'drop':
        tone(400, 0.35, { type: 'triangle', volume: 0.05, to: 150 });
        break;
      case 'dodge':
        tone(500, 0.12, { type: 'sine', volume: 0.04, to: 750 });
        break;
      case 'over':
        [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { type: 'triangle', volume: 0.08, delay: 0.3 + i * 0.14 }));
        break;
    }
  }
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  pads.poll();
  const canStart = game.phase === 'title' || (game.phase === 'over' && game.phaseTime >= RESTART_DELAY);
  if (canStart && pads.wasPressed('start')) game = newGame(false, game);
  const inputs: Input[] = [0, 1].map((i) => ({
    up: pads.isDown('up', i),
    down: pads.isDown('down', i),
    forward: pads.isDown(FORWARD[i], i),
    back: pads.wasPressed(BACK[i], i),
  }));
  update(game, dt, inputs);
  playSounds(game.events);
  game.events.length = 0;
  render(ctx, game, layout, dpr, now);
  bloomCtx.drawImage(canvas, 0, 0, bloom.width, bloom.height);
  updateOverlay();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
