import '../../src/lib/theme.css';
import './style.css';
import { PAD_BUTTONS, Pads, describeBinding, gamepadName, mappingFor, type PadButton, type Player } from '../../src/lib/pads';

const pads = new Pads();

const LABELS: Record<PadButton, string> = {
  up: '↑ Up',
  down: '↓ Down',
  left: '← Left',
  right: '→ Right',
  select: 'Select',
  start: 'Start',
};

const ARROW = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 6 94 50H68v44H32V50H6z"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

document.querySelector<HTMLAnchorElement>('#back')!.href = import.meta.env.BASE_URL;
document.querySelector('#swap')!.addEventListener('click', () => pads.swapPlayers());

// One card per player: a pad diagram laid out like the Prime (Select/Start sit
// in the top-right square), what each button reads, press counts and raw input.
interface Card {
  device: HTMLElement;
  mappingName: HTMLElement;
  cells: Record<PadButton, HTMLElement>;
  rows: Record<PadButton, HTMLElement>;
  binds: Record<PadButton, HTMLElement>;
  counts: Record<PadButton, HTMLElement>;
  presses: Record<PadButton, number>;
  raw: HTMLElement;
  rawFor: string;
  rawButtons: HTMLElement[];
  rawAxes: { fill: HTMLElement; value: HTMLElement }[];
}

const panel = (button: PadButton) => `<div class="panel" data-button="${button}">${ARROW}</div>`;

const cards: Card[] = pads.players.map((player) => {
  const section = el('section', `player p${player.index + 1}`);
  section.innerHTML = `
    <h2>Player ${player.index + 1}</h2>
    <p class="device"></p>
    <div class="player-body">
      <div class="pad">
        <div class="tile"></div>${panel('up')}
        <div class="tile smalls">
          <div class="small" data-button="select">SELECT</div><div class="small" data-button="start">START</div>
        </div>
        ${panel('left')}<div class="tile"></div>${panel('right')}
        <div class="tile"></div>${panel('down')}<div class="tile"></div>
      </div>
      <table class="mapping">
        <thead><tr><th>Button</th><th>Reads</th><th class="count">Presses</th></tr></thead>
        <tbody>
          ${PAD_BUTTONS.map((b) => `<tr data-button="${b}"><td>${LABELS[b]}</td><td class="bind"></td><td class="count">0</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="mapping-name"></p>
    <div class="raw"></div>`;
  document.querySelector('#players')!.append(section);

  const each = <T>(get: (button: PadButton) => T) =>
    Object.fromEntries(PAD_BUTTONS.map((b) => [b, get(b)])) as Record<PadButton, T>;
  const row = (b: PadButton) => section.querySelector<HTMLElement>(`tr[data-button="${b}"]`)!;
  return {
    device: section.querySelector('.device')!,
    mappingName: section.querySelector('.mapping-name')!,
    cells: each((b) => section.querySelector<HTMLElement>(`.pad [data-button="${b}"]`)!),
    rows: each(row),
    binds: each((b) => row(b).querySelector<HTMLElement>('.bind')!),
    counts: each((b) => row(b).querySelector<HTMLElement>('.count')!),
    presses: each(() => 0),
    raw: section.querySelector('.raw')!,
    rawFor: '',
    rawButtons: [],
    rawAxes: [],
  };
});

// Event log
const log = document.querySelector('#log')!;
const pressedAt = new Map<string, number>();

function addLog(player: number, text: string): void {
  const item = el('li', `p${player + 1}`);
  item.append(el('b', '', `P${player + 1}`), ` ${text}`);
  log.prepend(item);
  while (log.children.length > 12) log.lastElementChild!.remove();
}

pads.on('press', ({ player, button, time }) => {
  const card = cards[player];
  card.presses[button]++;
  setText(card.counts[button], String(card.presses[button]));
  pressedAt.set(`${player}:${button}`, time);
  addLog(player, `${LABELS[button]} pressed`);
});

pads.on('release', ({ player, button, time }) => {
  const since = pressedAt.get(`${player}:${button}`);
  addLog(player, `${LABELS[button]} released${since === undefined ? '' : ` after ${Math.round(time - since)} ms`}`);
});

// Drawing, once per frame (after Pads has polled, as it was created first).
const notice = document.querySelector<HTMLElement>('#notice')!;

function render(): void {
  for (const player of pads.players) renderPlayer(player, cards[player.index]);

  const text = !pads.gamepadsSupported
    ? "This page can't see gamepads: browsers only allow it over https or on http://localhost, so open the site that way. The keyboard still works."
    : pads.gamepads.length === 0
      ? 'No pads detected yet. Browsers hide gamepads until you press something, so step on a panel on each pad.'
      : '';
  notice.hidden = !text;
  setText(notice, text);

  requestAnimationFrame(render);
}

function renderPlayer(player: Player, card: Card): void {
  const gamepad = player.gamepad;
  setText(
    card.device,
    gamepad ? `${gamepadName(gamepad.id)} · gamepad #${gamepad.index}` : 'No pad yet: step on one to connect it. The keyboard works too.',
  );
  setText(card.mappingName, gamepad ? `Mapping: ${player.mappingName}` : '');
  const mapping = gamepad && mappingFor(gamepad).mapping;
  for (const button of PAD_BUTTONS) {
    const on = player.down.has(button);
    card.cells[button].classList.toggle('on', on);
    card.rows[button].classList.toggle('on', on);
    setText(card.binds[button], mapping ? mapping[button].map(describeBinding).join(' or ') : 'keyboard only');
  }
  renderRaw(card, gamepad);
}

/** Every raw button and axis, so you can see what each panel really sends. */
function renderRaw(card: Card, gamepad: Gamepad | null): void {
  const key = gamepad ? `${gamepad.index}/${gamepad.id}/${gamepad.buttons.length}/${gamepad.axes.length}` : '';
  if (key !== card.rawFor) {
    card.rawFor = key;
    card.raw.replaceChildren();
    card.rawButtons = [];
    card.rawAxes = [];
    if (gamepad) {
      const buttons = el('div', 'raw-buttons');
      card.rawButtons = gamepad.buttons.map((_, i) => buttons.appendChild(el('span', 'raw-button', String(i))));
      const axes = el('div', 'raw-axes');
      card.rawAxes = gamepad.axes.map((_, i) => {
        const fill = el('span', 'axis-fill');
        const track = el('span', 'axis-track');
        const value = el('span', 'axis-value');
        const row = el('div', 'raw-axis');
        track.append(fill);
        row.append(el('span', '', `axis ${i}`), track, value);
        axes.append(row);
        return { fill, value };
      });
      card.raw.append(el('h3', '', `Raw input: ${gamepad.buttons.length} buttons, ${gamepad.axes.length} axes`), buttons, axes);
    }
  }
  if (!gamepad) return;
  gamepad.buttons.forEach((button, i) => card.rawButtons[i].classList.toggle('on', button.pressed));
  gamepad.axes.forEach((value, i) => {
    const clamped = Math.max(-1, Math.min(1, value));
    const { fill, value: label } = card.rawAxes[i];
    fill.style.left = `${50 + Math.min(clamped, 0) * 50}%`;
    fill.style.width = `${Math.abs(clamped) * 50}%`;
    setText(label, value.toFixed(2));
  });
}

render();
