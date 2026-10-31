import '../lib/theme.css';
import './menu.css';
import { Pads, gamepadName } from '../lib/pads';

/** What a game's game.json says about it. */
interface GameInfo {
  title: string;
  description?: string;
  /** Shown as e.g. "1–2 players". */
  players?: string;
  /** What it's built with, e.g. "three.js". */
  tech?: string;
  /** Lower numbers are listed first (default 0), then by title. */
  order?: number;
}

const games = Object.entries(import.meta.glob<GameInfo>('/games/*/game.json', { eager: true, import: 'default' }))
  .map(([path, info]) => {
    const slug = path.split('/')[2];
    return { ...info, url: `${import.meta.env.BASE_URL}games/${slug}/` };
  })
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

// Game cards
const list = document.querySelector('#games')!;
const cards = games.map((game, i) => {
  const card = el('a', 'card');
  card.href = game.url;
  const tags = el('span', 'card-tags');
  if (game.players) tags.append(el('span', 'tag', `${game.players} player${game.players === '1' ? '' : 's'}`));
  if (game.tech) tags.append(el('span', 'tag', game.tech));
  card.append(
    el('span', 'card-title', game.title),
    el('span', 'card-desc', game.description ?? ''),
    tags,
    el('span', 'card-go', 'Press START'),
  );
  card.addEventListener('mouseenter', () => select(i));
  card.addEventListener('focus', () => select(i));
  const item = el('li', '');
  item.append(card);
  list.append(item);
  return card;
});

let selected = 0;
function select(index: number, focus = false): void {
  selected = index;
  cards.forEach((card, i) => card.toggleAttribute('data-selected', i === index));
  if (focus) cards[index].focus();
}
if (cards.length) select(0);

// Pads and keyboard: any direction moves through the list, Start launches.
const pads = new Pads({ exitToMenu: false });
pads.on('press', ({ button }) => {
  if (!cards.length) return;
  const step = { left: -1, up: -1, right: 1, down: 1 }[button as string];
  if (step) select((selected + step + cards.length) % cards.length, true);
  if (button === 'start') location.assign(games[selected].url);
});

// Who's connected, lighting up as each player presses things.
const pills = pads.players.map((player) => {
  const pill = el('div', `pill p${player.index + 1}`);
  const detail = el('span', 'pill-detail');
  pill.append(el('span', 'dot'), el('b', '', `P${player.index + 1}`), detail);
  document.querySelector('#players')!.append(pill);
  return { pill, detail };
});

function renderPlayers(): void {
  for (const player of pads.players) {
    const { pill, detail } = pills[player.index];
    pill.classList.toggle('connected', player.gamepad !== null);
    pill.classList.toggle('active', player.down.size > 0);
    const text = player.gamepad
      ? gamepadName(player.gamepad.id)
      : pads.gamepadsSupported
        ? 'step on a pad to connect'
        : 'pads need http://localhost or https';
    if (detail.textContent !== text) detail.textContent = text;
  }
  requestAnimationFrame(renderPlayers);
}
renderPlayers();
