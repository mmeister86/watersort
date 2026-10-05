// Game screen controller.
//
// Ties the pure state machine (`game/state`), storage and the generation worker
// to the DOM: loads or restores a level, renders the board, handles pointer and
// keyboard input, runs the pour animation and drives the level-complete flow.
//
// The DOM is only touched inside functions, so the exported pure helper
// `restoreState` can be imported by node tests.

import type { Level } from '@shared/generator';
import type { Board } from '@shared/rules';
import type { AppStorage, PlayerProgress } from '../storage';

import {
  canMove,
  isSolved,
  move as applyGameMove,
  restart as restartGame,
  startLevel,
  statsDelta as computeStatsDelta,
  undo as undoGame,
  type GameState,
  type StatsDelta,
} from '../game/state';
import { stars } from '../game/stars';
import { solveFirstMove, type SolutionResult } from '../worker/client';
import { createBoardView } from './board';
import { keyboardAction, type KeyAction } from './input';
import type { ScreenManager } from './screens';
import { createWakeLock } from './wakeLock';

/** Progress is stored under a fixed pseudo-id when playing without a session. */
export { LOCAL_PLAYER_ID } from '../flow';

/**
 * Pour animation timing in ms: fly over and tilt, liquid flows, tilt back.
 * `POUR_FLOW_MS` must match the `.unit` height transition in styles.css.
 */
export const POUR_TILT_MS = 300;
export const POUR_FLOW_MS = 340;
export const POUR_RETURN_MS = 260;
/** Total duration of one pour animation. */
export const POUR_MS = POUR_TILT_MS + POUR_FLOW_MS + POUR_RETURN_MS;

/** How long the cork gets to pop on the last tube before the win screen. */
export const WIN_DELAY_MS = 650;

/** How far the pouring tube tilts, in degrees. */
const POUR_ANGLE = 74;

/** How long the hint highlight stays on the recommended tubes. */
export const HINT_MS = 2000;

/** What the caller learns when a level is won (before „Weiter"). */
export type SolvedInfo = {
  playerId: string;
  /** The level that was just completed. */
  level: number;
  statsDelta: StatsDelta;
};

export type GameDeps = {
  screens: ScreenManager;
  storage: AppStorage;
  playerId: string;
  generate: (n: number) => Promise<Level>;
  /** Solves a board for the hint button; defaults to the generation worker. */
  solve?: (board: Board, capacity: number) => Promise<SolutionResult>;
  /** Called once per freshly won level, not on a restored solved board. */
  onSolved?: (info: SolvedInfo) => void;
  /** Called when the player wants to return to the player picker. */
  onSwitchPlayer?: () => void;
};

export type GameController = {
  /** Loads (and restores) the level from storage, then renders it. */
  start(level?: number): Promise<void>;
  /** Points the controller at another player; takes effect on the next start. */
  setPlayer(playerId: string): void;
  /** Detaches the global listeners; used when leaving the game screen. */
  stop(): void;
};

/**
 * Rebuilds a `GameState` from stored progress. The level itself is regenerated
 * (deterministically) by the caller; the saved history is replayed through the
 * rules so a corrupt or tampered history is rejected instead of trusted. The
 * stored board is used as a cross-check and the replay wins. Returns null when
 * the progress does not fit the level.
 */
export function restoreState(
  level: Level,
  progress: PlayerProgress,
): GameState | null {
  const storedBoard = progress.board;
  if (progress.history === undefined) {
    return null;
  }
  if (storedBoard !== undefined && storedBoard.length !== level.tubes.length) {
    return null;
  }
  if (storedBoard?.some((tube) => tube.length > level.capacity)) {
    return null;
  }

  let state = startLevel(level);
  for (const step of progress.history) {
    if (!canMove(state, step.from, step.to)) {
      return null;
    }
    state = applyGameMove(state, step.from, step.to);
  }

  if (storedBoard !== undefined) {
    const matches = storedBoard.every((tube, index) => {
      const replay = state.board[index] ?? [];
      return (
        tube.length === replay.length &&
        tube.every((unit, position) => unit === replay[position])
      );
    });
    if (!matches) {
      return null;
    }
  }

  return state;
}

function prefersReducedMotion(): boolean {
  return (
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

/** Queries a required element, throwing a clear error when it is missing. */
function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) {
    throw new Error(`Game screen is missing ${selector}`);
  }
  return found;
}

/** Builds the controller and wires the game screen's buttons immediately. */
export function createGameController(deps: GameDeps): GameController {
  const { screens, storage, generate, onSolved, onSwitchPlayer } = deps;
  const solve = deps.solve ?? solveFirstMove;
  let playerId = deps.playerId;

  const gameScreen = screens.screens.game;
  const completeScreen = screens.screens.complete;
  const boardElement = requireElement<HTMLElement>(gameScreen, '[data-board]');
  const levelElement = gameScreen.querySelector<HTMLElement>('[data-hud="level"]');
  const movesElement = gameScreen.querySelector<HTMLElement>('[data-hud="moves"]');
  const undoButton = gameScreen.querySelector<HTMLButtonElement>('[data-action="undo"]');
  const restartButton = gameScreen.querySelector<HTMLButtonElement>('[data-action="restart"]');
  const hintButton = gameScreen.querySelector<HTMLButtonElement>('[data-action="hint"]');
  const symbolsButton = gameScreen.querySelector<HTMLButtonElement>('[data-action="color-blind"]');
  const hintMessageElement = gameScreen.querySelector<HTMLElement>('[data-hint-message]');
  const nextButton = completeScreen.querySelector<HTMLButtonElement>('[data-action="next"]');
  const completeLevelElement = completeScreen.querySelector<HTMLElement>('[data-complete-level]');
  const starsElement = completeScreen.querySelector<HTMLElement>('[data-stars]');
  const switchButtons = [
    ...gameScreen.querySelectorAll<HTMLButtonElement>('[data-action="switch-player"]'),
    ...completeScreen.querySelectorAll<HTMLButtonElement>('[data-action="switch-player"]'),
  ];

  const view = createBoardView(boardElement);
  // Best-effort: keeps the screen awake while a level is open.
  const wakeLock = createWakeLock();

  let state: GameState | null = null;
  let selection: number | null = null;
  let locked = false;
  let started = false;
  let colorBlind = storage.getSettings().colorBlind;

  function setHud(level: number, moves: number): void {
    if (levelElement !== null) levelElement.textContent = String(level);
    if (movesElement !== null) movesElement.textContent = String(moves);
  }

  function renderLoading(level: number): void {
    setHud(level, 0);
    boardElement.replaceChildren();
    const status = document.createElement('p');
    status.className = 'board__placeholder';
    status.setAttribute('role', 'status');
    status.textContent = 'Level wird erstellt…';
    boardElement.append(status);
  }

  function renderLoadError(error: unknown): void {
    console.error('Failed to generate level', error);
    wakeLock.release();
    boardElement.replaceChildren();
    const message = document.createElement('p');
    message.className = 'board__placeholder';
    message.setAttribute('role', 'alert');
    message.textContent = 'Level konnte nicht erstellt werden.';
    boardElement.append(message);
  }

  function render(): HTMLButtonElement[] {
    if (state === null) return [];
    setHud(state.level.n, state.moves);
    return view.update(state, selection, colorBlind);
  }

  /** Reflects the persisted color-blind preference on the toggle button. */
  function updateSymbolsButton(): void {
    if (symbolsButton === null) return;
    symbolsButton.setAttribute('aria-pressed', String(colorBlind));
    symbolsButton.classList.toggle('is-active', colorBlind);
  }

  function setHintMessage(text: string): void {
    if (hintMessageElement === null) return;
    hintMessageElement.textContent = text;
    hintMessageElement.hidden = false;
  }

  function clearHintMessage(): void {
    if (hintMessageElement === null) return;
    hintMessageElement.textContent = '';
    hintMessageElement.hidden = true;
  }

  /** Fills or empties the three star glyphs and updates the screen-reader text. */
  function updateStars(rating: 1 | 2 | 3): void {
    if (starsElement === null) return;
    const glyphs = starsElement.querySelectorAll<HTMLElement>('.star');
    glyphs.forEach((glyph, index) => {
      glyph.classList.toggle('is-filled', index < rating);
    });
    starsElement.setAttribute('aria-label', `${rating} von 3 Sternen`);
  }

  function persist(): void {
    if (state === null) return;
    storage.setPlayerProgress(playerId, {
      level: state.level.n,
      board: state.board,
      moves: state.moves,
      history: state.history,
    });
  }

  /**
   * Plays the pour from tube `from` into tube `to`: the source flies over the
   * target and tilts, a stream of `color` runs down while `apply` re-renders
   * the new state (the liquid levels animate via CSS), then the source tilts
   * back. Under reduced motion `apply` runs at once with no animation.
   */
  async function animatePour(
    from: number,
    to: number,
    color: number,
    apply: () => void,
  ): Promise<void> {
    const tubes = view.tubes();
    const source = tubes[from];
    const target = tubes[to];
    if (
      source === undefined ||
      target === undefined ||
      prefersReducedMotion() ||
      typeof source.animate !== 'function'
    ) {
      apply();
      return;
    }

    const { unit } = view.metrics();
    const width = source.offsetWidth;
    // Untransformed positions relative to the board (offsetParent).
    const sourceX = source.offsetLeft;
    const sourceY = source.offsetTop;
    const targetX = target.offsetLeft;
    const targetY = target.offsetTop;
    const dir = targetX >= sourceX ? 1 : -1;

    // Pivot on the lip corner facing the target; it ends up just above the
    // target's mouth, slightly off-centre, so the stream falls into it.
    const pivotX = sourceX + (dir === 1 ? width : 0);
    const pivotY = sourceY;
    const lipX = targetX + width / 2 - dir * width * 0.18;
    const lipY = targetY - unit * 1.15;
    const dx = lipX - pivotX;
    const dy = lipY - pivotY;

    // Start from the current lift (a selected tube is already raised).
    const lift = new DOMMatrixReadOnly(getComputedStyle(source).transform).m42;
    const rest = `translate(0px, ${lift}px) rotate(0deg)`;
    const mid = `translate(${dx}px, ${dy}px) rotate(${dir * 18}deg)`;
    const tilted = `translate(${dx}px, ${dy}px) rotate(${dir * POUR_ANGLE}deg)`;
    const home = 'translate(0px, 0px) rotate(0deg)';

    source.style.transformOrigin = dir === 1 ? '100% 0' : '0 0';
    source.classList.add('is-pouring');

    const tilt = source.animate(
      [
        { transform: rest },
        { transform: mid, offset: 0.62 },
        { transform: tilted },
      ],
      { duration: POUR_TILT_MS, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' },
    );
    await tilt.finished;

    // The stream runs from the lip down to the target's current surface.
    const filled = target.querySelectorAll('.unit:not(.is-empty)').length;
    const glass = target.querySelector<HTMLElement>('.tube__glass');
    const glassBottom =
      glass === null ? target.offsetHeight : glass.offsetTop + glass.offsetHeight;
    const surfaceY = targetY + glassBottom - filled * unit;
    const stream = document.createElement('span');
    stream.className = 'pour-stream';
    stream.dataset.color = String(color);
    stream.setAttribute('aria-hidden', 'true');
    const streamWidth = Math.max(3, Math.round(unit * 0.2));
    stream.style.width = `${streamWidth}px`;
    stream.style.left = `${lipX - streamWidth / 2}px`;
    stream.style.top = `${lipY}px`;
    stream.style.height = `${Math.max(0, surfaceY - lipY)}px`;
    boardElement.append(stream);

    stream.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], {
      duration: 90,
      easing: 'ease-in',
      fill: 'forwards',
    });
    apply();
    await wait(POUR_FLOW_MS);

    const end = stream.animate(
      [
        { transform: 'scaleY(1)', transformOrigin: '50% 100%' },
        { transform: 'scaleY(0)', transformOrigin: '50% 100%' },
      ],
      { duration: 90, easing: 'ease-out', fill: 'forwards' },
    );
    const back = source.animate([{ transform: tilted }, { transform: home }], {
      duration: POUR_RETURN_MS,
      easing: 'cubic-bezier(0.3, 0, 0.2, 1)',
      fill: 'forwards',
    });
    await end.finished;
    stream.remove();
    await back.finished;

    tilt.cancel();
    back.cancel();
    source.classList.remove('is-pouring');
    source.style.transformOrigin = '';
  }

  function completeLevel(level: number, report: boolean): void {
    wakeLock.release();
    if (completeLevelElement !== null) {
      completeLevelElement.textContent = `Level ${level}`;
    }
    if (state !== null) {
      updateStars(stars(state.moves, state.level.solution.length));
    }
    screens.show('complete');
    if (report && state !== null) {
      onSolved?.({
        playerId,
        level,
        statsDelta: computeStatsDelta(state),
      });
    }
  }

  async function load(n: number, progress: PlayerProgress | null): Promise<void> {
    locked = true;
    selection = null;
    clearHintMessage();
    renderLoading(n);
    screens.show('game');

    let loaded: GameState;
    try {
      const level = await generate(n);
      loaded =
        progress === null
          ? startLevel(level)
          : restoreState(level, progress) ?? startLevel(level);
    } catch (error) {
      state = null;
      renderLoadError(error);
      return;
    }

    state = loaded;
    locked = false;
    render();
    persist();
    wakeLock.acquire();

    // A solved board can be restored after a reload that happened between the
    // winning move and "Weiter"; go straight back to the completion screen,
    // but do not report the solve a second time.
    if (isSolved(loaded)) {
      completeLevel(loaded.level.n, false);
    }
  }

  async function performMove(from: number, to: number): Promise<void> {
    if (state === null) return;
    const previous = state;
    const source = previous.board[from] ?? [];
    const color = source[source.length - 1] ?? 0;
    const next = applyGameMove(previous, from, to);
    state = next;
    selection = null;
    locked = true;
    clearHintMessage();
    persist();
    await animatePour(from, to, color, () => {
      render();
    });

    if (isSolved(next)) {
      // Let the last cork pop before the win screen takes over.
      if (!prefersReducedMotion()) {
        await wait(WIN_DELAY_MS);
      }
      locked = false;
      // A reload or player switch may have replaced the level meanwhile.
      if (state === next) {
        completeLevel(next.level.n, true);
      }
      return;
    }
    locked = false;
  }

  async function activate(index: number): Promise<void> {
    if (locked || state === null) return;
    const target = state.board[index];
    if (target === undefined) return;

    if (selection === null) {
      if (target.length > 0) {
        selection = index;
        render();
      }
      return;
    }

    if (selection === index) {
      selection = null;
      render();
      return;
    }

    if (canMove(state, selection, index)) {
      await performMove(selection, index);
      return;
    }

    // An illegal target: treat the tap as selecting the new tube when it holds
    // a color, otherwise clear the selection.
    selection = target.length > 0 ? index : null;
    render();
  }

  function doUndo(): void {
    if (locked || state === null) return;
    const next = undoGame(state);
    if (next === state) return;
    state = next;
    selection = null;
    clearHintMessage();
    render();
    persist();
  }

  function doRestart(): void {
    if (locked || state === null) return;
    state = restartGame(state);
    selection = null;
    clearHintMessage();
    render();
    persist();
  }

  /** Persists the color-blind preference and re-renders the symbols. */
  function doToggleColorBlind(): void {
    colorBlind = !colorBlind;
    storage.setSettings({ colorBlind });
    updateSymbolsButton();
    render();
  }

  /**
   * Asks the worker for a solve of the current board and highlights the
   * recommended source and target for {@link HINT_MS}. When the board can no
   * longer be solved, announces a German fallback suggesting undo. Free and
   * unlimited; input is locked while the solve and the highlight run.
   */
  async function doHint(): Promise<void> {
    if (locked || state === null) return;
    const current = state;
    locked = true;
    if (hintButton !== null) hintButton.disabled = true;
    clearHintMessage();

    try {
      const { solved, firstMove } = await solve(
        current.board,
        current.level.capacity,
      );
      // A different level may have loaded while the worker was thinking.
      if (state !== current) return;
      if (!solved || firstMove === null) {
        setHintMessage("Hier geht's nicht weiter — versuch es mit Zurück.");
        return;
      }

      selection = null;
      const tubes = render();
      const [from, to] = firstMove;
      const source = tubes[from];
      const target = tubes[to];
      source?.classList.add('is-hint-source');
      target?.classList.add('is-hint-target');
      await wait(HINT_MS);
      source?.classList.remove('is-hint-source');
      target?.classList.remove('is-hint-target');
    } catch (error) {
      console.error('Failed to compute a hint', error);
      setHintMessage('Tipp gerade nicht möglich.');
    } finally {
      locked = false;
      if (hintButton !== null) hintButton.disabled = false;
    }
  }

  async function doNext(): Promise<void> {
    if (locked || state === null) return;
    const next = state.level.n + 1;
    state = null;
    storage.setPlayerProgress(playerId, { level: next });
    await load(next, null);
  }

  function tubeIndexFromEvent(event: Event): number | null {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    const tube = target.closest('.tube');
    if (tube === null) return null;
    const raw = tube.getAttribute('data-tube');
    if (raw === null) return null;
    const index = Number(raw);
    return Number.isInteger(index) ? index : null;
  }

  function onPointerUp(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0) return;
    const index = tubeIndexFromEvent(event);
    if (index === null) return;
    void activate(index);
  }

  function onClick(event: MouseEvent): void {
    // Pointer taps are already handled by `pointerup`; `detail === 0` marks a
    // keyboard or assistive activation of a focused tube button.
    if (event.detail !== 0) return;
    const index = tubeIndexFromEvent(event);
    if (index === null) return;
    void activate(index);
  }

  function handleAction(action: KeyAction): void {
    switch (action.kind) {
      case 'select':
        void activate(action.index);
        return;
      case 'undo':
        doUndo();
        return;
      case 'restart':
        doRestart();
        return;
      case 'deselect':
        if (selection !== null) {
          selection = null;
          render();
        }
        return;
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (locked || screens.current() !== 'game') return;

    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    const action = keyboardAction(event.key, {
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      alt: event.altKey,
      shift: event.shiftKey,
      repeat: event.repeat,
    });
    if (action === null) return;

    event.preventDefault();
    handleAction(action);
  }

  updateSymbolsButton();

  undoButton?.addEventListener('click', doUndo);
  restartButton?.addEventListener('click', doRestart);
  hintButton?.addEventListener('click', () => {
    void doHint();
  });
  symbolsButton?.addEventListener('click', doToggleColorBlind);
  nextButton?.addEventListener('click', () => {
    void doNext();
  });
  for (const switchButton of switchButtons) {
    switchButton.addEventListener('click', () => {
      onSwitchPlayer?.();
    });
  }

  async function start(level?: number): Promise<void> {
    if (!started) {
      started = true;
      globalThis.addEventListener('keydown', onKeyDown);
      boardElement.addEventListener('pointerup', onPointerUp);
      boardElement.addEventListener('click', onClick);
    }

    const saved = storage.getPlayerProgress(playerId);
    const n = level ?? saved?.level ?? 1;
    await load(n, saved !== null && saved.level === n ? saved : null);
  }

  function setPlayer(nextPlayerId: string): void {
    playerId = nextPlayerId;
  }

  function stop(): void {
    started = false;
    wakeLock.release();
    globalThis.removeEventListener('keydown', onKeyDown);
    boardElement.removeEventListener('pointerup', onPointerUp);
    boardElement.removeEventListener('click', onClick);
  }

  return { start, setPlayer, stop };
}
