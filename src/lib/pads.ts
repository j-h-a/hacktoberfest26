/**
 * Shared input for every game: two dance pads (or any gamepads) plus the
 * keyboard, presented as two players with six buttons each.
 *
 *   const pads = new Pads();
 *   pads.on('press', ({ player, button }) => { ... });  // player is 0 or 1
 *
 *   // ...or poll from your own game loop:
 *   if (pads.wasPressed('left', 0)) { ... }  // player 1 just stepped left
 *   if (pads.isDown('up')) { ... }           // anyone is holding up
 *
 * Holding Select for a second goes back to the menu on every page that has a
 * Pads (pass `{ exitToMenu: false }` to turn that off).
 *
 * Gamepad buttons already held as a page opens are ignored until they're
 * released: they're left over from the previous page (see LEFTOVER_WINDOW_MS).
 */

export const PAD_BUTTONS = ['up', 'down', 'left', 'right', 'select', 'start'] as const;
export type PadButton = (typeof PAD_BUTTONS)[number];

export const PLAYER_COUNT = 2;

/** A raw gamepad input: a button index, or an axis pushed past halfway one way. */
export type Binding = { button: number } | { axis: number; dir: 1 | -1 };
export type Mapping = Record<PadButton, Binding[]>;

/**
 * L-TEK Prime in its Dancepad profile (Start/Select lit green + red). From the
 * Prime manual: B1 left, B2 right, B3 up, B4 down, B11 Start (the right-hand
 * small button) and B12 Select (the left-hand one). Browsers count from 0, so
 * B1 is button 0.
 */
const LTEK_DANCEPAD: Mapping = {
  up: [{ button: 2 }],
  down: [{ button: 3 }],
  left: [{ button: 0 }],
  right: [{ button: 1 }],
  select: [{ button: 11 }],
  start: [{ button: 10 }],
};

/** Controllers the browser recognises (Xbox, PlayStation, ...): d-pad or left stick, A/Start, B/Back. */
const STANDARD: Mapping = {
  up: [{ button: 12 }, { axis: 1, dir: -1 }],
  down: [{ button: 13 }, { axis: 1, dir: 1 }],
  left: [{ button: 14 }, { axis: 0, dir: -1 }],
  right: [{ button: 15 }, { axis: 0, dir: 1 }],
  select: [{ button: 8 }, { button: 1 }],
  start: [{ button: 9 }, { button: 0 }],
};

/** Which mapping a gamepad uses. Anything non-standard is assumed to be a dance pad laid out like the L-TEK. */
export function mappingFor(gamepad: Gamepad): { name: string; mapping: Mapping } {
  if (gamepad.mapping === 'standard') return { name: 'Standard gamepad', mapping: STANDARD };
  if (/l-?tek/i.test(gamepad.id)) return { name: 'L-TEK Prime (Dancepad profile)', mapping: LTEK_DANCEPAD };
  return { name: 'Unknown pad, assuming the L-TEK layout', mapping: LTEK_DANCEPAD };
}

export function isActive(gamepad: Gamepad, binding: Binding): boolean {
  if ('button' in binding) return gamepad.buttons[binding.button]?.pressed ?? false;
  return (gamepad.axes[binding.axis] ?? 0) * binding.dir > 0.5;
}

export function describeBinding(binding: Binding): string {
  return 'button' in binding ? `button ${binding.button}` : `axis ${binding.axis}${binding.dir > 0 ? '+' : '−'}`;
}

/** "L-TEK Dance Pad (Vendor: 03eb Product: 8041)" → "L-TEK Dance Pad" */
export function gamepadName(id: string): string {
  return id.replace(/\s*\((STANDARD GAMEPAD\s*)?Vendor: \w+ Product: \w+\)$/i, '').replace(/^\w{4}-\w{4}-/, '') || id;
}

/**
 * Keyboard controls, by key position (KeyboardEvent.code) so they work on any
 * layout. W/A/S/D and I/J/K/L are also what the L-TEK Prime's two keyboard
 * profiles send.
 */
const KEYS = new Map<string, [player: number, button: PadButton]>([
  ['ArrowUp', [0, 'up']], ['ArrowDown', [0, 'down']], ['ArrowLeft', [0, 'left']], ['ArrowRight', [0, 'right']],
  ['KeyW', [0, 'up']], ['KeyS', [0, 'down']], ['KeyA', [0, 'left']], ['KeyD', [0, 'right']],
  ['Enter', [0, 'start']], ['NumpadEnter', [0, 'start']], ['KeyE', [0, 'start']],
  ['Escape', [0, 'select']], ['KeyQ', [0, 'select']],
  ['KeyI', [1, 'up']], ['KeyK', [1, 'down']], ['KeyJ', [1, 'left']], ['KeyL', [1, 'right']],
  ['KeyO', [1, 'start']], ['KeyU', [1, 'select']],
]);

export interface PadEvent {
  type: 'press' | 'release';
  /** 0 for player 1, 1 for player 2. */
  player: number;
  button: PadButton;
  /** performance.now() of the frame it was seen in. */
  time: number;
}

export interface Player {
  /** 0 for player 1, 1 for player 2. */
  readonly index: number;
  /** This player's gamepad as of the last poll; null means keyboard only. */
  readonly gamepad: Gamepad | null;
  /** Name of the mapping used to read that gamepad. */
  readonly mappingName: string;
  /** Buttons held right now. */
  readonly down: ReadonlySet<PadButton>;
}

class PlayerState implements Player {
  readonly index: number;
  gamepad: Gamepad | null = null;
  mappingName = '';
  down = new Set<PadButton>();
  pressed = new Set<PadButton>();
  released = new Set<PadButton>();
  constructor(index: number) {
    this.index = index;
  }
}

export interface PadsOptions {
  /** Hold Select for a second to go back to the menu (default true). */
  exitToMenu?: boolean;
  /** Poll every animation frame (default true). If false, call poll() at the start of each frame of your loop. */
  autoPoll?: boolean;
}

type Listener = (event: PadEvent) => void;

const ORDER_KEY = 'pad-arcade:player-order';
const EXIT_HOLD_MS = 1000;

/**
 * Gamepad buttons held when a page starts (or comes back into view) are left over from before, so
 * they're ignored until they're released. They may not even be real: browsers stop reading gamepads
 * while no page is, so a release during a page change can be missed, and the browser goes on
 * reporting the button as held until that pad sends anything else. Only gamepads seen this soon
 * after the first poll get this treatment: browsers hide the pads from each new page until a button
 * is pressed on one, and that first press must still count.
 */
const LEFTOVER_WINDOW_MS = 500;

export class Pads {
  #players = Array.from({ length: PLAYER_COUNT }, (_, i) => new PlayerState(i));
  readonly players: readonly Player[] = this.#players;
  /** False when the browser hides gamepads from this page (it needs https or localhost). Keys still work. */
  readonly gamepadsSupported = typeof navigator.getGamepads === 'function';
  /** Every gamepad the browser currently shows, assigned to a player or not. */
  gamepads: Gamepad[] = [];

  #listeners: Record<PadEvent['type'], Set<Listener>> = { press: new Set(), release: new Set() };
  #keysHeld = new Set<string>();
  #keysTapped = new Set<string>(); // pressed since the last poll, so a very quick tap still counts
  #order: number[] = loadOrder();
  #exitToMenu: boolean;
  #selectHeldSince: number | null = null;
  #overlay: HTMLElement | null = null;
  #frame = 0;
  #destroyed = false;
  /** Per gamepad index: buttons held when it showed up, ignored until they're released. */
  #leftovers = new Map<number, Set<PadButton>>();
  /** Gamepads that show up before this time have their held buttons ignored. Set by the first poll. */
  #leftoverUntil: number | null = null;

  constructor({ exitToMenu = true, autoPoll = true }: PadsOptions = {}) {
    this.#exitToMenu = exitToMenu;
    addEventListener('keydown', this.#onKeyDown);
    addEventListener('keyup', this.#onKeyUp);
    addEventListener('blur', this.#onBlur);
    document.addEventListener('visibilitychange', this.#onVisibilityChange);
    if (autoPoll) {
      const loop = () => {
        if (this.#destroyed) return;
        this.poll();
        this.#frame = requestAnimationFrame(loop);
      };
      this.#frame = requestAnimationFrame(loop);
    }
  }

  /** Listen for presses or releases. Returns a function that stops listening. */
  on(type: PadEvent['type'], listener: Listener): () => void {
    this.#listeners[type].add(listener);
    return () => this.#listeners[type].delete(listener);
  }

  /** Is the button held? Leave out `player` to ask about anyone. */
  isDown(button: PadButton, player?: number): boolean {
    return this.#check(player, (p) => p.down.has(button));
  }

  /** Was the button pressed since the previous poll (i.e. this frame)? */
  wasPressed(button: PadButton, player?: number): boolean {
    return this.#check(player, (p) => p.pressed.has(button));
  }

  /** Was the button released since the previous poll? */
  wasReleased(button: PadButton, player?: number): boolean {
    return this.#check(player, (p) => p.released.has(button));
  }

  /** Swap which pad is player 1 and which is player 2. Remembered in this browser. */
  swapPlayers(): void {
    const [p1, p2] = this.#players.map((p) => p.gamepad?.index ?? -1);
    this.#order = [p2, p1];
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(this.#order));
    } catch {
      // Storage blocked: the swap still lasts until the page reloads.
    }
  }

  /** Read the gamepads and keyboard, update every player and fire events. Runs every frame unless autoPoll is off. */
  poll(): void {
    const now = performance.now();
    const early = now < (this.#leftoverUntil ??= now + LEFTOVER_WINDOW_MS);
    this.gamepads = readGamepads();
    const assigned = assignGamepads(this.gamepads, this.#order);
    const events: PadEvent[] = [];

    for (const player of this.#players) {
      const gamepad = assigned[player.index];
      const next = new Set<PadButton>();
      player.gamepad = gamepad;
      player.mappingName = '';
      if (gamepad) {
        const { name, mapping } = mappingFor(gamepad);
        player.mappingName = name;
        const leftovers = this.#leftoversFor(gamepad, mapping, early);
        for (const button of PAD_BUTTONS) {
          const held = isHeld(gamepad, mapping, button);
          if (leftovers.has(button)) {
            if (!held) leftovers.delete(button); // released at last: it counts from now on
          } else if (held) {
            next.add(button);
          }
        }
      }
      for (const code of [...this.#keysHeld, ...this.#keysTapped]) {
        const [owner, button] = KEYS.get(code)!;
        if (owner === player.index) next.add(button);
      }

      player.pressed.clear();
      player.released.clear();
      for (const button of next) {
        if (!player.down.has(button)) {
          player.pressed.add(button);
          events.push({ type: 'press', player: player.index, button, time: now });
        }
      }
      for (const button of player.down) {
        if (!next.has(button)) {
          player.released.add(button);
          events.push({ type: 'release', player: player.index, button, time: now });
        }
      }
      player.down = next;
    }
    this.#keysTapped.clear();

    if (this.#exitToMenu) this.#checkExit(now);
    for (const event of events) {
      for (const listener of this.#listeners[event.type]) listener(event);
    }
  }

  destroy(): void {
    this.#destroyed = true;
    cancelAnimationFrame(this.#frame);
    removeEventListener('keydown', this.#onKeyDown);
    removeEventListener('keyup', this.#onKeyUp);
    removeEventListener('blur', this.#onBlur);
    document.removeEventListener('visibilitychange', this.#onVisibilityChange);
    this.#overlay?.remove();
  }

  /** The buttons to ignore on a gamepad. If it first shows up early on, that's whatever it has held. */
  #leftoversFor(gamepad: Gamepad, mapping: Mapping, early: boolean): Set<PadButton> {
    let leftovers = this.#leftovers.get(gamepad.index);
    if (!leftovers) {
      leftovers = new Set(early ? PAD_BUTTONS.filter((button) => isHeld(gamepad, mapping, button)) : []);
      this.#leftovers.set(gamepad.index, leftovers);
    }
    return leftovers;
  }

  #check(player: number | undefined, test: (p: PlayerState) => boolean): boolean {
    if (player === undefined) return this.#players.some(test);
    const state = this.#players[player];
    return state ? test(state) : false;
  }

  /** Hold Select (any player) for a second to go back to the menu, with an on-screen countdown. */
  #checkExit(now: number): void {
    if (!this.isDown('select')) {
      this.#selectHeldSince = null;
      this.#overlay?.remove();
      return;
    }
    this.#selectHeldSince ??= now;
    const held = now - this.#selectHeldSince;
    if (held < 200) return; // a quick tap of Select is just a tap
    if (!this.#overlay) {
      this.#overlay = document.createElement('div');
      this.#overlay.style.cssText =
        'position:fixed;left:50%;bottom:10vh;transform:translateX(-50%);z-index:2147483647;pointer-events:none;' +
        'padding:16px 24px;border-radius:14px;background:#0b0c1a;border:2px solid #ffd84a;color:#fff;text-align:center;' +
        'font:600 22px/1.3 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5)';
      this.#overlay.innerHTML =
        'Keep holding SELECT for the menu' +
        '<div style="margin-top:10px;height:8px;border-radius:4px;background:rgba(255,255,255,.2)">' +
        '<div style="height:100%;width:0;border-radius:4px;background:#ffd84a"></div></div>';
    }
    if (!this.#overlay.isConnected) document.body.append(this.#overlay);
    (this.#overlay.lastElementChild!.firstElementChild as HTMLElement).style.width = `${Math.min(held / EXIT_HOLD_MS, 1) * 100}%`;
    if (held >= EXIT_HOLD_MS) {
      this.#exitToMenu = false; // only navigate once
      location.assign(import.meta.env.BASE_URL);
    }
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (!KEYS.has(event.code) || event.ctrlKey || event.altKey || event.metaKey || isTyping(event.target)) return;
    if (event.code.startsWith('Arrow')) event.preventDefault(); // don't scroll the page
    if (event.repeat) return;
    this.#keysHeld.add(event.code);
    this.#keysTapped.add(event.code);
  };

  #onKeyUp = (event: KeyboardEvent): void => {
    this.#keysHeld.delete(event.code);
  };

  #onBlur = (): void => {
    this.#keysHeld.clear(); // key-ups are lost while another window has focus
  };

  #onVisibilityChange = (): void => {
    // Browsers stop reading gamepads for hidden pages too, so coming back is like opening a new page.
    if (document.visibilityState !== 'visible') return;
    this.#leftovers.clear();
    this.#leftoverUntil = null;
  };
}

function isHeld(gamepad: Gamepad, mapping: Mapping, button: PadButton): boolean {
  return mapping[button].some((binding) => isActive(gamepad, binding));
}

function readGamepads(): Gamepad[] {
  try {
    return (navigator.getGamepads?.() ?? []).filter((g): g is Gamepad => g !== null && g.connected);
  } catch {
    return []; // e.g. blocked by a permissions policy
  }
}

/** Each player gets the gamepad they had before (see swapPlayers) if it's here, then the rest in browser order. */
function assignGamepads(gamepads: Gamepad[], order: number[]): (Gamepad | null)[] {
  const slots: (Gamepad | null)[] = [];
  for (let i = 0; i < PLAYER_COUNT; i++) {
    slots.push(gamepads.find((g) => g.index === order[i] && !slots.includes(g)) ?? null);
  }
  const spare = gamepads.filter((g) => !slots.includes(g));
  return slots.map((g) => g ?? spare.shift() ?? null);
}

function loadOrder(): number[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.map((n) => (Number.isInteger(n) ? n : -1)) : [];
  } catch {
    return [];
  }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}
