# Water Sort PWA — SDD Implementation Plan

Source plan: `.docs/Water Sort PWA – Bauplan.md`. Binding spec: `AGENTS.md` (repo root). When this plan and AGENTS.md conflict, AGENTS.md wins. Work happens on branch `feat/build`.

## Global Constraints

- TypeScript strict everywhere. No `any`, no default exports, no silent `catch {}`, no non-null `!` assertions where a guard can be written.
- `shared/` contains pure functions only: no DOM, no Node APIs, no `Math.random()` in game logic. All randomness flows through the seeded PRNG in `shared/src/rng.ts`.
- Every level is only accepted after the solver found a full solution (budget-bounded A*). No unsolved level ever leaves `generateLevel`.
- Level generation is deterministic: same `n` + same `GENERATOR_VERSION` → identical level.
- No ads, no timers, no lives, no energy, no paywalls, no tracking. The server stores no levels, only players and their level numbers/stats.
- Database = one JSON file at `${DATA_DIR}/data.json`. All writes via a single promise queue, atomic (tmp + rename), daily `.bak`, startup write-probe that exits non-zero on failure.
- Runtime dependencies allowed: `hono`, `@hono/node-server` (server), nothing else without asking. Dev dependencies allowed: `typescript`, `vitest`, `@types/node`, `vite`, `vite-plugin-pwa`.
- `shared` is NOT a built package: consumers import its TS source via the alias `@shared/*` → `../shared/src/*` (tsconfig paths, Vite alias, Vitest alias). No runtime/build step for `shared`.
- UI text in German. Code, identifiers, commit messages in English. Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- Comments only where non-obvious; prefer clear names.
- Before any task is done: `npm run typecheck && npm test` must pass (run from repo root).
- Board never scrolls; tube size via CSS `clamp()`; hard cap 16 tubes total.
- Keyboard: `1`–`9`, `0` select tubes 1–10, `Q`–`P` tubes 11–20, second press on same tube = pour, `Z`/`Ctrl+Z`/`Cmd+Z` = undo, `R` = restart, `Esc` = deselect.
- PWA: `display: standalone`, `orientation: any`, icons 192 + 512 maskable, autoUpdate, never cache `/api/*`.

## Task 1: Repo scaffolding (npm workspaces + toolchain)

Requirements:

- Root `package.json`: `name: "watersort"`, `private: true`, `workspaces: ["shared", "web", "server"]`, scripts:
  - `dev`: starts server (watch mode) and Vite dev server together; Vite proxies `/api` to `http://localhost:3000`.
  - `build`: builds `web/dist` (Vite) and `server/dist` (tsc). (shared is not built.)
  - `test`: `vitest run` across workspaces.
  - `test:full`: same as `test` but with env `WATERSORT_FULL_LEVELS=1` (enables the 500-level soak test; default suite runs the 100-level version).
  - `typecheck`: `tsc --noEmit` for shared, web, server project configs.
- Workspace stubs `shared/package.json`, `web/package.json`, `server/package.json` (names `@watersort/shared`, `@watersort/web`, `@watersort/server`; `@watersort/shared` has no build, exports nothing to npm — it is imported by path alias only).
- `tsconfig.base.json` (strict, ES2022, moduleResolution bundler for web/vite; separate `tsconfig.json` per workspace). Each workspace tsconfig defines path alias `@shared/*` → `../shared/src/*` (server uses NodeNext module resolution with `rootDir` including shared sources OR bundler resolution + tsc build that inlines shared — choose the approach that makes `npm run build` produce a runnable `server/dist/index.js`; document the choice in the task report).
- Root `vitest.config.ts` covering shared + server + web tests (projects or include globs), with the `@shared` alias registered.
- Root `.gitignore` already exists; extend with `web/dist`, `server/dist`, `shared/dist` (if ever produced), `.vite`.
- Web workspace initialized for Vite vanilla TS (`web/index.html` placeholder, `web/src/main.ts` placeholder printing nothing fancy).
- Install dev deps at latest stable: `typescript`, `vitest`, `vite`, `@types/node` (root level is fine; `vite-plugin-pwa` and `hono`/`@hono/node-server` come in their tasks).

Done check: `npm install`, `npm run typecheck`, `npm test` (0 tests is OK here, suite must be green), `npm run build` all succeed from repo root. `npm run dev` starts both processes and `curl http://localhost:5173` and `curl http://localhost:3000/api/health` respond (server health route may be a stub `{ ok: true }` in this task, replaced properly in Task 9).

## Task 2: shared rules + rng

Files: `shared/src/rules.ts`, `shared/src/rng.ts`, `shared/src/index.ts` (re-exports), tests `shared/test/rules.test.ts`, `shared/test/rng.test.ts`.

`rules.ts`:

- Types: `ColorId = number` (1..K), `Tube = ColorId[]` (index 0 = bottom), `Board = Tube[]`, `Move = { from: number; to: number }`.
- `isMoveLegal(board: Board, capacity: number, from: number, to: number): boolean` — legal iff `from !== to`, `from` not empty, `to` not full, and (`to` empty or `top(to) === top(from)`).
- `applyMove(board: Board, capacity: number, from: number, to: number): Board` — returns a NEW board (deep-copied tubes that change; untouched tubes may be shared by reference but the board array is new). Throws on illegal move. Pours the whole contiguous top run of `top(from)`'s color, limited by free space in `to`.
- `isTubeComplete(tube: Tube, capacity: number): boolean` — full and single color.
- `isWin(board: Board, capacity: number): boolean` — every tube empty or complete.
- `colorName(id: ColorId): string` — German color name for aria labels: ids 1–14 → `rot, blau, grün, gelb, orange, violett, pink, türkis, braun, hellblau, dunkelgrün, grau, schwarz, weiß` (used by UI; keep in rules so worker and UI agree; names correspond to CSS custom properties defined in Task 6).

`rng.ts`:

- `mulberry32(seed: number): () => number` — standard mulberry32 returning floats in [0, 1).
- `hash32(a: number, b: number, c: number): number` — deterministic 32-bit hash mixing three uint32 inputs (murmur3-style finalizer over the three values). Used as `hash32(n, attempt, GENERATOR_VERSION)`.
- `shuffled<T>(items: T[], rand: () => number): T[]` — Fisher-Yates using `rand()`, returns new array, does not mutate input.

Tests (deterministic, no snapshot of internals): legality edge cases (same tube, empty from, full to, mismatched top, empty to OK, matching top OK); pour edge cases (partial pour when target nearly full pours only what fits, whole run pours when space allows, bottom units stay); win check (empty board win, complete tubes win, near-miss no win); `applyMove` immutability (original board unchanged); rng: same seed → identical sequence (mulberry32 known first values may be asserted), hash32 deterministic + differs for differing inputs (n, attempt), shuffle: is a permutation, deterministic, unbiasedness not required.

## Task 3: shared curve

File: `shared/src/curve.ts`, test `shared/test/curve.test.ts`.

`curve(n: number): { colors: number; capacity: number; empty: number; hidden: boolean; minMoves: number; maxMoves: number }` for `n >= 1` (throw for n < 1).

Bands (start–end, K range, H, E, moves):

| Band | Levels | Colors K | H | E | Moves |
| --- | --- | --- | --- | --- | --- |
| B1 | 1–5 | 3 | 4 | 2 | 6–12 |
| B2 | 6–20 | 4–5 | 4 | 2 | 12–25 |
| B3 | 21–50 | 6–7 | 4 | 2 | 20–35 |
| B4 | 51–100 | 8–9 | 4 | 2 | 30–50 |
| B5 | 101–200 | 10–11 | 4 | 2 | 40–60 |
| B6 | 201–400 | 12 | 5 | 2 | 50–75 |
| B7 | 401+ | 12–14 | 5 | 2 | 60–90 |

Color ramp inside a band: `K = Kmin + floor((m - start) * (Kmax - Kmin + 1) / (end - start + 1))` where `m` is the level evaluated inside the band. For B7 (unbounded): `K = 12 + min(2, floor((n - 401) / 200))` (401–600 → 12, 601–800 → 13, 801+ → 14).

Sawtooth: if `n > 5` and `n % 5 === 0`, evaluate with `m = clamp(n, lowerBand.start, lowerBand.end)` in the band one lower (B2→B1, B3→B2, …, B7→B6).

Boss levels: if `n >= 401` and `n % 10 === 0`, sawtooth does NOT apply; use B7 params at `n` with `empty = 1`.

`hidden = n >= 150` (always, even on sawtooth levels).

Exact test vectors (assert full param objects):

- n=1: {colors:3, capacity:4, empty:2, hidden:false, minMoves:6, maxMoves:12}
- n=5: same as n=1
- n=7: {colors:4, …, minMoves:12, maxMoves:25}
- n=10 (sawtooth→B1): {colors:3, capacity:4, empty:2, hidden:false, minMoves:6, maxMoves:12}
- n=14: {colors:5, …12–25}
- n=36: {colors:7, …20–35}
- n=76: {colors:9, …30–50}
- n=100 (sawtooth→B3 at 50): {colors:7, capacity:4, empty:2, hidden:false, minMoves:20, maxMoves:35}
- n=150 (sawtooth→B3 at 50): {colors:7, capacity:4, empty:2, hidden:true, minMoves:20, maxMoves:35}
- n=200 (sawtooth→B4 at 100): {colors:9, capacity:4, empty:2, hidden:true, minMoves:30, maxMoves:50}
- n=201: {colors:12, capacity:5, empty:2, hidden:true, minMoves:50, maxMoves:75}
- n=400 (sawtooth→B5 at 200): {colors:11, capacity:4, empty:2, hidden:true, minMoves:40, maxMoves:60}
- n=401: {colors:12, capacity:5, empty:2, hidden:true, minMoves:60, maxMoves:90}
- n=420 (boss): {colors:12, capacity:5, empty:1, hidden:true, minMoves:60, maxMoves:90}
- n=425 (sawtooth→B6 at 400): {colors:12, capacity:5, empty:2, hidden:true, minMoves:50, maxMoves:75}
- n=601: colors 13; n=801: colors 14

Also assert `colors + empty <= 16` for n in 1..1000 (sampled: every level 1–1000, it's cheap).

## Task 4: shared solver

Files: `shared/src/solver.ts`, test `shared/test/solver.test.ts`.

`solve(board: Board, capacity: number, budget = 200_000): { solved: boolean; moves: [number, number][]; expanded: number }`

- Best-first / A* over canonical states. Priority = g + h where g = moves so far, h = heuristic: (number of adjacent color changes inside all tubes) + (number of non-uniform, non-empty tubes).
- Canonical visited key: serialize each tube (e.g. color IDs joined with a separator that cannot appear in a serialized sub-tube, join units with `,`), sort tube strings, join — tube order must not matter.
- Pruning: never pour from a complete tube; never pour a single-color tube into an empty tube; when several tubes are empty, only the first empty tube is a pour target.
- Stop with `solved: true` + move list when win state reached; `solved: false` when open set empties or expanded states exceed `budget`.
- Returned moves must be a valid pour sequence from the input board to a win (verified by tests replaying through `applyMove`).
- Efficient enough that generating a 14-color level stays well under the generator budget: use a binary heap, typed state copies, no string churn in inner loop beyond the canonical key.

Tests: small handcrafted solvable boards (3 colors) → solved, replay via `applyMove` wins, moves respect legality; unsolvable board (e.g. two colors interleaved with no empty tube and capacity exhausted) → solved false; budget respected (tiny budget → solved false, expanded <= budget); canonicalization: states differing only by tube order are treated as visited (craft a pair); pruning: solver must never return a move that pours from a complete tube or single-color→empty.

## Task 5: shared generator + soak tests

Files: `shared/src/generator.ts`, tests `shared/test/generator.test.ts`.

- `GENERATOR_VERSION = 1` (exported const in `generator.ts`).
- `generateLevel(n: number): Level` with `Level = { n: number; version: number; tubes: Board; capacity: number; hidden: boolean; solution: [number, number][] }`.
- Loop `attempt = 0, 1, 2, …`: `seed = hash32(n, attempt, GENERATOR_VERSION)`, `rand = mulberry32(seed)`; pool = `K × H` units (each color exactly H times — so every color can form one complete tube), `shuffled` with `rand`, fill K tubes, append E empty tubes (E starts at curve's `empty`).
- Quick reject (before solving): any tube complete; any contiguous same-color run of length >= `H - 1` inside a tube.
- Solve with default budget; reject on `solved: false`.
- Reject if `solution.length < minMoves || solution.length > maxMoves` (params from curve at `n`, including sawtooth/boss adjustments).
- Attempt accounting: every 50 consecutive failed attempts, increment working `E` by 1 (max total tubes `K + E <= 16`); if the tube cap is reached and another 50 attempts fail, widen the accepted band by 5 per further block of 50 on BOTH ends: `maxMoves += 5` and `minMoves = max(6, minMoves - 5)` (more empty tubes shorten solutions, so both bounds must relax — practical termination guarantee). The loop must never spin forever; document in code that E-increase + band widening makes acceptance practically certain.
- Level output uses the ACTUAL accepted board (with the working E used on success), `hidden` from curve, `solution` from solver, `version = GENERATOR_VERSION`.

Tests:

1. Determinism: `generateLevel(n)` twice → deep-equal for n in {1, 2, 37, 149, 150, 201, 420, 601} and a few others.
2. Solvability + band: for default range n = 1..100 (full run: n = 1..500 with `WATERSORT_FULL_LEVELS=1`): generate, assert tubes shape matches curve (K filled tubes + E empties, each color exactly H times), replay `solution` through `applyMove` → `isWin` true, `solution.length` within `[minMoves, maxMoves]`.
3. Timing: measure per-level generation time; log max and p95; assert p95 < 300 ms (in the full run; the 100-level default run also asserts it).
4. No `Math.random` anywhere in `shared/src` (test greps source files for `Math.random` — simple source scan via `import.meta`/fs from the test is NOT allowed in shared tests; instead put this source-scan test in `server/test/no-math-random.test.ts` reading `../shared/src/**` with Node fs. It lives in server workspace tests but guards shared.)

## Task 6: web scaffold + design system + screens

Files: `web/index.html`, `web/src/main.ts`, `web/src/ui/screens.ts` (screen switching code-entry → player-picker → game → level-complete containers), `web/src/ui/styles.css` (or `web/src/styles.css` split if cleaner), `web/vite.config.ts` (finalize: alias `@shared`, dev proxy `/api` → `http://localhost:3000`).

- CSS custom properties for the 14 colors matching `colorName` ids 1–14 (rot, blau, grün, gelb, orange, violett, pink, türkis, braun, hellblau, dunkelgrün, grau, schwarz, weiß) — clearly distinguishable, AA contrast against tube background where feasible.
- Layout per AGENTS.md section 7: phone portrait = 2 rows of tubes, controls bottom; desktop = board centered max ~900 px, controls below; tube size via `clamp()` from viewport; board never scrolls; `prefers-reduced-motion` disables animations; visible focus ring.
- Screen shells with German labels: Familien-Code entry (placeholder screen — wired in Task 10), Spieler picker (placeholder — Task 10), Spiel (board area + controls: Undo „Zurück", Neustart, Tipp, level/moves display), „Level geschafft!" complete screen (stars placeholder — filled in Task 13).
- `main.ts` wires screen switching with a tiny state; no framework.

Done check: `npm run build` succeeds; `npm run dev` shows the game screen shell with empty board area. No behavior logic yet beyond screen switching.

## Task 7: web game core (state machine, worker, storage)

Files: `web/src/game/state.ts` (pure game state machine), `web/src/worker/generator.worker.ts`, `web/src/worker/client.ts` (promise wrapper, worker singleton), `web/src/storage.ts`, `web/src/api.ts` (fetch wrapper — only implemented, used in Task 10), tests `web/test/state.test.ts`, `web/test/storage.test.ts`.

- `state.ts` (pure, testable without DOM): game state = { level: Level; board: Board; history: Move[]; moves: number; undos: number }; functions: `startLevel(level)`, `canMove`, `move(state, from, to)` (uses `@shared` rules, pushes history), `undo(state)`, `restart(state)`, `isSolved`, `statsDelta(state)` → `{ solved: 1, moves, undos }` for sync. Hidden layers: expose `visibleUnits(tube)` — top unit real, below `?` — rendering concern only, board always knows real colors.
- Worker: message `{ type: 'generate'; n: number }` → `{ type: 'level'; level: Level }`; `{ type: 'solve'; board: Board; capacity: number }` → `{ type: 'solution'; solved: boolean; firstMove: [number, number] | null }` (for hints). Worker imports `@shared` generator + solver.
- `storage.ts`: typed localStorage wrapper, keys prefixed `watersort.`: `activePlayer` (player id), `player:<id>` = `{ level: number; board?: Board; moves?: number; history?: Move[]; version: number }`, `pendingSync` = array of `{ playerId: string; level: number; statsDelta: { solved: number; moves: number; undos: number } }`, `settings` = `{ colorBlind: boolean }`. On load, discard saved in-progress board if `version !== GENERATOR_VERSION` (keep level number). All operations wrapped so quota/parse errors surface (no silent catch: on corrupt JSON, drop that key and continue — that behavior is tested, not silent).
- Tests: state machine move/undo/restart/win with a tiny handcrafted level (build a fixed 3-color level inline — no generator dependency); hidden `visibleUnits`; storage round-trip + version mismatch discard + corrupt JSON recovery using a localStorage stub injected for tests.

## Task 8: web board UI, input, animation, level flow

Files: `web/src/ui/board.ts`, `web/src/ui/input.ts` (or merged if small), `web/src/ui/gameScreen.ts`, additions to `styles.css`, `web/test/board.test.ts` (pure helpers like aria-label building and keyboard mapping — DOM-free parts only).

- Render tubes as `<button class="tube">` with layers as child divs; `aria-label` German format: „Röhre 3, oben blau, 2 von 4 gefüllt" / „Röhre 5, leer" / hidden: „Röhre 2, oben unbekannt". Update labels after every change.
- Board layout: grid with up to 2 rows (8 per row max); tube count from level.
- Pointer Events only: tap tube → select (visual lift); tap target → pour; tap selected again → deselect. Desktop hover lift (media hover), legal targets highlighted while selected.
- Keyboard: `1`–`9` → tubes 1–9, `0` → tube 10, `Q W E R T Y U I O P` → tubes 11–20, same-tube-again = pour, `Z`/`Cmd+Z`/`Ctrl+Z` undo, `R` restart, `Esc` deselect. `R` (restart) takes precedence over its tube-selector role — tube 14 is pointer-only. Ignore keys while animation runs.
- Pour animation: CSS transition (~250 ms), input locked while it runs, skipped entirely under `prefers-reduced-motion`. Level complete check after each move → „Level geschafft!" screen with „Weiter" button → next level via worker.
- Wire to game core from Task 7: board renders from state; undo/restart buttons work; level number + move counter displayed; in-progress state persisted to localStorage after every move; restore on reload.
- Level generation loading state („Level wird erstellt…") while worker runs.

Done check: `npm run typecheck && npm test` green; `npm run dev` → levels 1–30 playable by mouse and keyboard, undo/restart work, reload restores the board.

## Task 9: server (Hono + JSON store + auth + routes)

Files: `server/src/index.ts`, `server/src/store.ts`, `server/src/app.ts` (app factory so tests import it), `server/test/store.test.ts`, `server/test/api.test.ts`.

- `app.ts` exports `createApp(store, env)` (Hono app; no listen). `index.ts`: reads env `PORT=3000`, `DATA_DIR`, `FAMILY_CODE`, `COOKIE_SECRET`; creates store + app; serves on `PORT` via `@hono/node-server`. Serves `web/dist` as static files at `/` (404 fallback → index.html for SPA) when the directory exists.
- `store.ts`: exactly per AGENTS.md section 8 — load `data.json` once at startup (create if missing), keep in memory; ALL writes through one promise queue (`enqueue` chained promise); atomic write (`data.json.tmp` + `fs.rename`); once per day copy to `data.json.bak` (before first write of a new day); startup probe: write + delete a probe file in DATA_DIR, on failure `console.error` loud message and `process.exit(1)`. Store API: `listPlayers()`, `createPlayer({name, color})`, `updateProgress(id, {level, statsDelta})`, `deletePlayer(id)` — all async, mutations enqueued.
- Player shape exactly per AGENTS.md JSON: `id` (`p_` + 5 chars from crypto random), `name`, `color`, `level` (starts 1), `stats { solved, moves, undos }`, `createdAt`, `updatedAt` (ISO strings).
- Routes (all under `/api`):
  - `POST /api/session` `{ code }` → compare with `FAMILY_CODE` using `crypto.timingSafeEqual`; match → 204 + cookie `ws_session` (value: signed marker, e.g. signed timestamp) set via `hono/cookie` signed cookie with `COOKIE_SECRET`: httpOnly, secure, sameSite Lax, maxAge 1 year, path /. Mismatch → 401.
  - Auth middleware: every `/api/*` route except `/api/health` and `POST /api/session` requires a valid signed cookie → else 401.
  - `GET /api/health` → `{ ok: true }`, no auth.
  - `GET /api/players` → player list (no secrets).
  - `POST /api/players` `{ name, color }` → 201 + player; validate: name trimmed 1–20 chars else 400; color must be one of the 14 German color names from `colorName` (lowercase) else 400; name uniqueness (case-insensitive) → 409.
  - `PUT /api/players/:id/progress` `{ level, statsDelta }` → 200 + updated player; validate: `level` integer >= 1 else 400; `level > server.level + 100` → 400 (reject jumps > +100); statsDelta values non-negative integers else 400; merge: `level = max(server.level, body.level)`, stats added, `updatedAt` refreshed; unknown id → 404.
  - `DELETE /api/players/:id` → 204, unknown id → 404.
- Tests: store — concurrent createPlayer calls all persisted (queue), atomic write (data.json exists and parses after operations; tmp file cleaned), daily backup logic (fake clock or injected `now`), merge rule incl. jump rejection, auth — every protected route 401 without cookie, 200 with valid signed cookie (use Hono `app.request` with cookie helper forged via same secret), session 204/401, validation cases, name uniqueness.
- No silent catches: errors propagate to Hono error handler returning 500 `{ error: 'internal' }` and logged.

## Task 10: web player screens + sync

Files: `web/src/api.ts` (finalize), `web/src/ui/codeScreen.ts`, `web/src/ui/playerScreen.ts`, wiring in `main.ts`/`screens.ts`, tests `web/test/sync.test.ts`.

- Family code screen first (when no session yet): input + „Los" → `POST /api/session`; on 204 → player picker; on 401 → inline error „Falscher Code" (German). Offline/server-unreachable → offer „Offline weiter spielen" (skip to game with last-known/local player; sync later).
- Player picker: list players (name + colored avatar dot), tap to select + persist `activePlayer`; „+ Neuer Spieler" → name input (max 20) + color choice from the 14 colors → `POST /api/players`; long-press / „Entfernen" button per player with confirm → `DELETE`.
- After each solved level: `PUT /api/players/:id/progress` with `{ level: newLevel, statsDelta }`; on failure push to `pendingSync` queue; flush queue on `online` event and on app start (in order, drop entries older than the server-confirmed level per player).
- Active player's level drives which level the game loads; switching player switches level + board restore.
- Tests: sync queue behavior with a mocked fetch (offline → queued; online → flushed in order; failures stay queued), level merge on client side (local max).

Done check: two fresh browser profiles can enter code, create players, and see the same player list; progress survives server restart.

## Task 11: PWA (manifest, icons, service worker, iOS hint)

Files: `web/vite.config.ts` (vite-plugin-pwa), `scripts/generate-icons.mjs` (root scripts dir), `web/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png` (generated, committed), iOS hint in `web/src/ui/`.

- `vite-plugin-pwa` with `registerType: 'autoUpdate'`, manifest: name „Water Sort", short_name „Water Sort", `display: "standalone"`, `orientation: "any"`, theme + background color, icons 192/512 + maskable variants.
- Workbox: precache app shell; `navigateFallback` to index.html; runtime config explicitly excludes `/api/*` from any caching.
- Icons: `scripts/generate-icons.mjs` — dependency-free PNG generator (node:zlib + hand-rolled PNG chunks) drawing a simple tube with 3 color bands on a rounded dark background; maskable variants keep content inside the 80% safe zone. Regenerating must be deterministic (committed output identical).
- iOS: one-time „Zum Home-Bildschirm hinzufügen" hint banner, only on iOS Safari and not in standalone mode, dismissible, remembered in localStorage.
- Optional (skip if fiddly): Screen Wake Lock while a level is open.

Done check: `npm run build` emits `web/dist/sw.js` + manifest; `npm run dev` unaffected; icons are valid PNGs (file size > 0, correct dimensions asserted in a tiny node check run in the task).

## Task 12: Dockerfile + deploy artifacts

Files: `Dockerfile`, `.dockerignore`, small fixes if the multi-stage build reveals them.

- Multi-stage per Bauplan: build stage `node:22-alpine`, `npm ci` (all workspace package.jsons copied first so ci resolves), `npm run build`, then `npm prune --omit=dev`; runtime stage `node:22-alpine`: copy `server/dist` → `server`, `web/dist` → `public`, pruned `node_modules`; `ENV DATA_DIR=/data PORT=3000 NODE_ENV=production`; `USER node`; `EXPOSE 3000`; `HEALTHCHECK` via `node -e "fetch(...)"` hitting `/api/health`; `CMD ["node", "server/index.js"]`.
- `.dockerignore`: `.git`, `node_modules`, `**/dist`, `.superpowers`, `.docs`, `data`.
- If Docker is available locally (`docker --version`), run `docker build .` and `docker run` with a temp volume + `FAMILY_CODE=test COOKIE_SECRET=x`, curl health + session flow; if Docker is NOT available, verify the equivalent steps run locally: `npm ci && npm run build`, `DATA_DIR=$(mktemp -d) PORT=3000 FAMILY_CODE=test COOKIE_SECRET=x node server/dist/index.js`, curl `/api/health` (200), `/api/players` without cookie (401), with session cookie (200), static `/` serves index.html — and state clearly in the report which path was taken.

## Task 13: extras — hint button, stars, color-blind mode

Files: additions in `web/src/ui/gameScreen.ts`, `web/src/worker/*` (hint already spec'd in Task 7 worker — wire it), `web/src/game/stars.ts` + test, color-blind symbols in board rendering, styles.

- Hint button „Tipp": calls worker `solve` on current board; highlights the recommended source tube (and target) for ~2 s; if unsolvable from current state, show „Hier geht's nicht mehr weiter — Rückgängig?" hint (German). Free, unlimited.
- Stars on level complete: `stars(playerMoves, optimal)` — 3 if `playerMoves <= optimal + 3`, 2 if `playerMoves <= ceil(optimal * 1.5)`, else 1. Pure function + unit tests. „Level geschafft!" screen shows stars + „Weiter".
- Color-blind mode: toggle (small button on game screen, persisted via settings storage) renders a distinct symbol per color id 1–14 (Unicode glyphs, CSS `::after` or inline span, chosen to be distinguishable) on every visible unit.
- All UI text German.

Done check: `npm run typecheck && npm test` green; hint works on a real level; stars render; toggle persists.

## Final review

After Task 13: whole-branch review against AGENTS.md (merge-base = `main`), then finishing-a-development-branch.
