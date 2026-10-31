
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

