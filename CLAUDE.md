
## Working style

- IMPORTANT: This is a hackday, so quick delivery is more important than architectural elegance and comprehensive
  edge-case coverage. Make best-guess assumptions about what will work and try it, then let the user give feedback
  about what's not working. Only do minimal research in advance of building, and only when it will speed up the
  development and feedback cycle.

## Dev server

- The user usually keeps `npm run dev` running in this container at http://localhost:5173 (it hot-reloads edits).
  Check it's up with `curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/` and test against it rather than
  starting another server.
- Never stop or kill it (no broad `pkill vite`). If a separate server is really needed, give it another port with
  `--strictPort` and stop only that one.

## Parallel development

Several Claude sessions can work at once: one in the main checkout (`/workspace`, on `main`) and each of the others in
its own git worktree on its own branch. Every session shares `/workspace`, so never switch branches there, never use
`git stash` (the stash is shared by every worktree), and leave `.claude/worktrees/` alone.

When the user asks you to work in parallel, set up a worktree before changing anything:

1. Pick a slug, normally the game's folder name (e.g. `canyon-duel`), and run
   `git worktree add -b <slug> .claude/worktrees/<slug> main`.
2. Check `.git/info/exclude` has the line `.claude/worktrees/` (add it if not), so the main checkout's `git status` and
   `git add -A` never see worktrees.
3. Switch into the worktree with the EnterWorktree tool, passing its `path` (its `name` option branches from `origin`,
   which this repo doesn't have). From then on keep each Bash command simple and inside the worktree: the harness
   refuses commands it can't verify stay there.
4. Run `npm ci` in the worktree, so installing a library doesn't change the shared `node_modules`.
5. Start the worktree's own dev server in the background with `npx vite --port 5174 --strictPort` (5175 and so on if
   that's taken) and test there, since 5173 serves `/workspace`. VS Code forwards the port to the user.
6. Keep changes inside `games/<slug>/`. Ask before changing shared files (`src/lib/`, `vite.config.ts`, `package.json`),
   since other sessions may be changing them too.

When the user asks you to merge into `main`:

1. Commit in the worktree. If `main` has moved (`git log --oneline -3 main`), run `git rebase main`. Then run
   `npm run build` to check every game still type-checks and builds together.
2. Go back to `/workspace` with ExitWorktree (`keep`).
3. Run `git status --short` to see what other sessions have in progress, then `git merge --ff-only <slug>`. A
   fast-forward only brings in your commits, so it's safe while other sessions have uncommitted work elsewhere.
4. Check the game on 5173, then stop your own dev server (only that one).
5. Clean up with `git worktree remove .claude/worktrees/<slug>` and `git branch -d <slug>`.

