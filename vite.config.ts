import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = import.meta.dirname;

/**
 * Every folder in games/ is one game: an index.html page plus a game.json that
 * the menu lists. The dev server serves any page, but the build needs each
 * page named, so find them all (and complain early about half-made folders).
 */
function gamePages(): Record<string, string> {
  const pages: Record<string, string> = {};
  for (const entry of readdirSync(resolve(root, 'games'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = resolve(root, 'games', entry.name);
    for (const file of ['index.html', 'game.json']) {
      if (!existsSync(resolve(dir, file))) {
        throw new Error(`games/${entry.name}/ needs an index.html and a game.json (missing ${file})`);
      }
    }
    pages[`games/${entry.name}`] = resolve(dir, 'index.html');
  }
  return pages;
}

export default defineConfig({
  // To host under a sub-path (e.g. GitHub Pages): BASE_PATH=/repo-name/ npm run build
  base: process.env.BASE_PATH ?? '/',
  // Separate pages, no single-page-app fallback: a wrong URL is a 404, not the menu.
  appType: 'mpa',
  build: {
    rolldownOptions: {
      input: { menu: resolve(root, 'index.html'), ...gamePages() },
    },
  },
});
