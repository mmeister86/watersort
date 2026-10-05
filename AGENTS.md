# AGENTS.md — Water Sort PWA

Ad-free, self-hosted water sort puzzle for one family. Playable in any browser (desktop and mobile) and installable as a PWA. Hosted as a single Docker container on Coolify.

Read this whole file before writing code. When something here conflicts with your instincts, this file wins. When something is unclear, ask instead of guessing.

---

## 1. Non-negotiables

1. **Every level the player sees is provably solvable.** A level is only shown after the solver found a full solution for it. No exceptions, no "probably solvable".
2. **Levels are derived from their number.** `generateLevel(n)` is deterministic: same `n` + same `GENERATOR_VERSION` → identical level on every device. Never use `Math.random()` in game logic.
3. **No ads, no timers, no lives, no energy, no paywalls, no tracking.**
4. **The server stores no levels.** Only players and their level numbers/stats.
5. **The "database" is one JSON file** at `${DATA_DIR}/data.json`. No SQLite, no Postgres, no ORM.
6. **Works offline** after the first load, including generating new levels.
7. **Works in the desktop browser** with mouse and keyboard, not just on touch devices.

---

## 2. Stack

| Part | Choice |
| --- | --- |
| Language | TypeScript (strict) everywhere |
| Frontend | Vanilla TS + Vite. No React/Vue/Svelte. DOM + CSS rendering, no canvas. |
| PWA | `vite-plugin-pwa` (Workbox) |
| Level logic | `shared/` module, run in a Web Worker in the browser |
| Backend | Node 22 + Hono |
| Tests | Vitest |
| Package manager | npm workspaces |
| Deploy | One multi-stage Dockerfile, Coolify, persistent volume at `/data` |

Keep dependencies minimal. Ask before adding any runtime dependency not listed here.

---

## 3. Repo layout

```
watersort/
  AGENTS.md
  package.json            # npm workspaces: shared, web, server
  Dockerfile
  shared/
    src/
      rules.ts            # pour rule, win check, state types
      rng.ts              # seeded PRNG + hash
      curve.ts            # level number -> parameters
      solver.ts           # A* solver with budget
      generator.ts        # generateLevel(n)
      index.ts
    test/
  web/
    index.html
    src/
      main.ts
      ui/                 # board, tube, screens, input
      worker/             # level generation worker
      storage.ts          # localStorage + sync queue
      api.ts
    public/icons/
  server/
    src/
      index.ts            # Hono app, static files, /api
      store.ts            # JSON file store
```

## 4. Commands

```
npm install
npm run dev          # Vite dev server + server with watch, proxy /api
npm test             # Vitest for all workspaces
npm run build        # builds web/dist and server/dist
npm run typecheck
```

Before calling any task done: `npm run typecheck && npm test` must pass.

---

## 5. Game rules (spec)

- State: array of tubes. Each tube is an array of color IDs, index 0 = bottom. Capacity `H` is the same for all tubes.
- A move `from -> to` is legal when: `from` is not empty, `to` is not full, `from !== to`, and `to` is empty or `top(to) === top(from)`.
- A move pours the whole contiguous top run of `top(from)`'s color, limited by free space in `to`.
- Win: every tube is empty or full with a single color.
- Hidden layers (later levels): all units except the top one of each tube are rendered as `?` until uncovered. The game state always knows the real colors.

## 6. Level generation (spec)

`generateLevel(n: number): Level` where `Level = { n, version, tubes, capacity, hidden, solution }`.

1. `params = curve(n)` → `{ colors K, capacity H, empty E, hidden, minMoves, maxMoves }`.
2. For `attempt = 0..`: `seed = hash32(n, attempt, GENERATOR_VERSION)`, PRNG = mulberry32(seed).
3. Put `K × H` units in a pool, Fisher-Yates shuffle with the PRNG, fill K tubes, add E empty tubes.
4. Quick reject: any tube already complete; any tube with ≥ `H - 1` identical units stacked.
5. Run the solver with a budget (default 200 000 expanded states). Budget exceeded = reject.
6. Reject if `solution.length` is outside `[minMoves, maxMoves]`.
7. Accept, or continue with the next attempt. After 50 failed attempts, increase E by 1 and continue. The loop must always terminate.

Do NOT generate by reversing moves from the solved state.

### Solver

- Best-first / A*. Heuristic: number of color changes inside tubes (adjacent units of different color) plus count of non-uniform tubes.
- Visited set keyed by a canonical string: serialize each tube, sort the tube strings, join. Tube order does not matter.
- Prune: never pour from a complete tube; never pour a single-color tube into an empty tube; when several tubes are empty, only consider the first one as target.
- Returns `{ solved: boolean, moves: [from, to][], expanded: number }`.
- Also used for the hint button: `solve(currentState)` → first move.

### Difficulty curve (starting values, tune after playtests)

| Levels | Colors | Capacity | Empty | Extra | Moves |
| --- | --- | --- | --- | --- | --- |
| 1–5 | 3 | 4 | 2 | tutorial | 6–12 |
| 6–20 | 4–5 | 4 | 2 | | 12–25 |
| 21–50 | 6–7 | 4 | 2 | | 20–35 |
| 51–100 | 8–9 | 4 | 2 | | 30–50 |
| 101–200 | 10–11 | 4 | 2 | hidden layers from 150 | 40–60 |
| 201–400 | 12 | 5 | 2 | | 50–75 |
| 400+ | 12–14 | 5 | 2 (every 10th level: 1) | boss levels | 60–90 |

- Sawtooth: every 5th level uses the parameters of one band lower.
- Hard cap: 16 tubes total (fits 2 rows of 8 on a phone).
- `GENERATOR_VERSION` is a constant in `shared/src/generator.ts`. Bump it whenever generation output changes. On version mismatch the client discards a saved in-progress board but keeps the level number.

---

## 7. UI

One responsive app for phone, tablet and desktop browser.

- Layout: phone portrait = 2 rows, controls at the bottom (thumb zone). Desktop = board centered, max ~900 px wide, controls below. Tube size is computed by `boardMetrics()` in `web/src/ui/board.ts` from the space the board actually has (ResizeObserver) and applied as CSS custom properties; every tube dimension derives from `--unit`. The board never scrolls.
- Input: Pointer Events only (one code path for mouse and touch). Tap/click tube to select, tap/click target to pour. Tap the selected tube again to deselect.
- Desktop extras: hover lift on tubes; when a tube is selected, legal targets are highlighted.
- Keyboard: `1`–`9`, `0` select tubes 1–10, `Q`–`P` select tubes 11–20. Select twice = pour. `Z` / `Ctrl+Z` / `Cmd+Z` = undo, `R` = restart, `Esc` = deselect.
- Pour animation: the source tube flies over the target and tilts (Web Animations API, positions measured at runtime), a stream of the poured color runs down, and liquid levels change via CSS height transitions. Tube nodes are reused between renders so these transitions can run. Input is ignored while an animation runs. A full single-color tube gets a cork.
- Accessibility: tubes are `<button>`s with `aria-label` (e.g. "Tube 3, top blue, 2 of 4 filled"), visible focus ring, `prefers-reduced-motion` disables animations.
- Colors: 14 clearly distinguishable colors defined as CSS custom properties. Later: optional symbol overlay for color-blind mode.
- Screens: family code entry → player picker → game → level complete. No settings maze.
- Undo is unlimited. Restart resets to the level's start state.

## 8. Storage, sync, API

### Server store (`server/src/store.ts`)

- Load `data.json` once at startup (create it if missing), keep it in memory, read only from memory.
- All writes go through a single promise queue. Never two writes in parallel.
- Atomic write: write `data.json.tmp`, then `fs.rename` to `data.json`.
- Once per day copy to `data.json.bak`.
- On startup, write and delete a probe file in `DATA_DIR`; if it fails, log a loud error and exit non-zero.

```json
{
  "version": 1,
  "players": [
    {
      "id": "p_k3x9",
      "name": "Papa",
      "color": "teal",
      "level": 37,
      "stats": { "solved": 36, "moves": 812, "undos": 40 },
      "createdAt": "2026-10-04T18:00:00Z",
      "updatedAt": "2026-10-04T19:10:00Z"
    }
  ]
}
```

### Auth

- Env `FAMILY_CODE`. `POST /api/session { code }` sets a long-lived (1 year) httpOnly, Secure, SameSite=Lax cookie (signed with env `COOKIE_SECRET`).
- All other `/api/*` routes except `/api/health` require the cookie → 401 otherwise.
- No player passwords.

### Endpoints

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/api/session` | `{ code }` | 204 or 401 |
| GET | `/api/players` | | list |
| POST | `/api/players` | `{ name, color }` | name 1–20 chars, trimmed |
| PUT | `/api/players/:id/progress` | `{ level, statsDelta }` | merge rule below |
| DELETE | `/api/players/:id` | | |
| GET | `/api/health` | | `{ ok: true }`, no auth |

Validate all input. Merge rule: `level = max(server.level, body.level)`, stats are added from `statsDelta`. Reject `level` jumps greater than +100 in one request.

### Client

- `localStorage`: active player id, last known level per player, in-progress board (with `GENERATOR_VERSION`), pending sync queue.
- After each solved level: `PUT /progress`. On failure keep it in the queue; flush on `online` event and on app start.

## 9. PWA

- Manifest: name, short_name, icons 192/512 (maskable), `display: standalone`, `orientation: any`, theme color.
- Service worker precaches the app shell. Never cache `/api/*`.
- Updates: `registerType: 'autoUpdate'`, activate on next launch; never interrupt a running level.
- iOS: show a one-time "Add to Home Screen" hint only on iOS Safari when not already standalone.
- Optional: Screen Wake Lock while a level is open.

## 10. Deploy (Coolify)

- Multi-stage Dockerfile: build stage runs `npm ci && npm run build`, runtime stage on `node:22-alpine` serves `web/dist` as static files and `/api` from the same Hono app.
- Env: `PORT=3000`, `DATA_DIR=/data`, `FAMILY_CODE`, `COOKIE_SECRET`.
- Coolify: Dockerfile build pack, port 3000, persistent storage mounted at `/data`, healthcheck `GET /api/health`. HTTPS via Coolify/Traefik (required for service workers).

---

## 11. Testing requirements

- `shared/`: unit tests for the pour rule and win check, including edge cases (full target, partial pour, same tube).
- Determinism: `generateLevel(n)` twice → deep-equal.
- Solvability: generate levels 1–500 and replay each `solution` through `rules.ts`; every one must end in a win. Log max and p95 generation time; p95 must stay under 300 ms on a laptop.
- Curve: solution lengths lie inside each band's `[minMoves, maxMoves]`.
- Server: store write queue under concurrent requests, atomic write, merge rule, auth on every route.

## 12. Work plan

Track work as tasks in `backlog.md`. Work phase by phase; do not start a phase before the previous one passes its done check.

1. **Core logic** — `rules`, `rng`, `curve`, `solver`, `generator` + tests. Done: section 11 `shared/` tests green.
2. **Playable in the browser** — board, pointer + keyboard input, undo/restart, level complete screen, generation in a Web Worker, localStorage. Done: levels 1–30 playable on phone and desktop without a server.
3. **Server + players** — Hono, JSON store, family code, player picker, sync queue. Done: two browsers share progress for the same player.
4. **PWA + deploy** — manifest, icons, service worker, Dockerfile. Done: installs on iOS/Android, plays in airplane mode, runs on Coolify with data surviving a redeploy.
5. **Extras** — hint button, stars vs. optimal moves, hidden layers, color-blind mode, sound, family leaderboard.

## 13. Conventions

- Pure functions in `shared/`; no DOM, no Node APIs there.
- Small files, named exports, no default exports.
- No `any`. No silent `catch {}`.
- UI text in German. Code, comments and commit messages in English.
- Commits: Conventional Commits (`feat:`, `fix:`, `test:` …), one logical change each.
