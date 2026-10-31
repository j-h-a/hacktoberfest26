# Pad Arcade

Small browser games for two L-TEK Prime dance pads side by side, or a keyboard. The site root is a menu; each game
is its own page, so going back to the root always gets you back to the menu.

## Run it

```sh
npm install
npm run dev
```

Then open <http://localhost:5173>. Use `localhost` (or https): browsers only let secure pages read gamepads.

Inside the dev container, VS Code forwards port 5173 to your machine (see its Ports panel). Without VS Code, publish
the port when creating the container (`-p 5173:5173`) and run `npm run dev -- --host`.

## Setting up the pads

1. Put each Prime in its **Dancepad** profile, where Start/Select glow green + red. From the manual: stand on ← and
   →, hold START + SELECT until the lights pulse, tap START or SELECT until it's green + red, then step off.
2. Open **Input Tester** from the menu and step on each pad. Browsers hide gamepads until you press something, so
   each pad appears after its first step.
3. If the left pad lights up Player 2, press **Swap P1 ⇄ P2** (remembered in this browser).
4. If a panel lights the wrong arrow, the tester's raw view shows which button number it really sends; fix
   `LTEK_DANCEPAD` in [`src/lib/pads.ts`](src/lib/pads.ts).

## Controls

|        | Pads    | Keyboard P1        | Keyboard P2 |
| ------ | ------- | ------------------ | ----------- |
| Move   | arrows  | ← ↑ ↓ → or W A S D | I J K L     |
| Start  | START   | Enter or E         | O           |
| Select | SELECT  | Esc or Q           | U           |

On the menu any arrow moves and START plays. In a game, hold SELECT (or Esc) for a second to get back to the menu.
Other gamepads (Xbox, PlayStation, …) work too: d-pad or left stick, A/Start and B/Back.

## Adding a game

Every folder in `games/` is a game, and the menu lists it automatically:

```
games/my-game/
  game.json    {"title": "My Game", "description": "…", "players": "1–2", "tech": "three.js"}
  index.html   a page with <script type="module" src="./main.ts"></script>
  main.ts
```

`game.json` can also have `"order"`: lower numbers come first in the menu (the tester uses 100 to stay last).

Read the pads with the shared `Pads` class:

```ts
import { Pads } from '../../src/lib/pads';

const pads = new Pads();

// Events: player is 0 or 1, button is 'up' | 'down' | 'left' | 'right' | 'select' | 'start'
pads.on('press', ({ player, button }) => console.log(player, button));

// Or check from your own game loop (Pads updates itself every animation frame):
if (pads.wasPressed('left', 0)) { /* player 1 stepped left this frame */ }
if (pads.isDown('up')) { /* anyone is holding up */ }
```

Each game is bundled separately, so use any tech you like: `npm install three` (or PixiJS, Phaser, …) and import it
in that game's `main.ts`. Only that game's page loads it.

## Build

`npm run build` type-checks and writes a static site to `dist/`; `npm run preview` serves it. To host under a
sub-path (e.g. GitHub Pages), build with `BASE_PATH=/repo-name/ npm run build`.
