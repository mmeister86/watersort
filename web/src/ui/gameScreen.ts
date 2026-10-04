// Game screen controller.
//
// Ties the pure state machine (`game/state`), storage and the generation worker
// to the DOM: loads or restores a level, renders the board, handles pointer and
// keyboard input, runs the pour animation and drives the level-complete flow.
//
// The DOM is only touched inside functions, so the exported pure helper
// `restoreState` can be imported by node tests.

import type { Level } from '@shared/generator';
import type { AppStorage, PlayerProgress } from '../storage';

import {
  canMove,
  isSolved,
  move as applyGameMove,
  restart as restartGame,
  startLevel,
  undo as undoGame,
  type GameState,
} from '../game/state';
import { createBoardView } from './board';
import { keyboardAction, type KeyAction } from './input';
import type { ScreenManager } from './screens';

/** Progress is stored under a fixed pseudo-id until the server (Task 9/10). */
export const LOCAL_PLAYER_ID = 'local';

/** Pour transition duration; must match `.tube.is-pouring` in styles.css. */
export const POUR_MS = 250;

export type GameDeps = {
  screens: ScreenManager;
  storage: AppStorage;
  playerId: string;
  generate: (n: number) => Promise<Level>;
};

export type GameController = {
  /** Loads (and restores) the level from storage, then renders it. */
  start(): Promise<void>;
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
  const { screens, storage, playerId, generate } = deps;

  const gameScreen = screens.screens.game;
  const completeScreen = screens.screens.complete;
  const boardElement = requireElement<HTMLElement>(gameScreen, '[data-board]');
  const levelElement = gameScreen.querySelector<HTMLElement>('[data-hud="level"]');
  const movesElement = gameScreen.querySelector<HTMLElement>('[data-hud="moves"]');
  const undoButton = gameScreen.querySelector<HTMLButtonElement>('[data-action="undo"]');
  const restartButton = gameScreen.querySelector<HTMLButtonElement>('[data-action="restart"]');
  const nextButton = completeScreen.querySelector<HTMLButtonElement>('[data-action="next"]');
  const completeLevelElement = completeScreen.querySelector<HTMLElement>('[data-complete-level]');

  const view = createBoardView(boardElement);

  let state: GameState | null = null;
  let selection: number | null = null;
  let locked = false;
  let started = false;

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
    return view.update(state, selection);
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

  async function animatePour(
    from: HTMLButtonElement | undefined,
    to: HTMLButtonElement | undefined,
  ): Promise<void> {
    if (from === undefined || to === undefined || prefersReducedMotion()) {
      return;
    }
    // The board was just rebuilt, so read layout once to commit each button's
    // base style before the animating classes flip `transform`. Without this
    // forced reflow the browser only ever sees the post-class style and skips
    // the transition entirely (the tube would snap, not pour).
    void from.offsetWidth;
    void to.offsetWidth;
    from.classList.add('is-pouring');
    to.classList.add('is-receiving');
    await wait(POUR_MS);
    from.classList.remove('is-pouring');
    to.classList.remove('is-receiving');
  }

  function completeLevel(level: number): void {
    if (completeLevelElement !== null) {
      completeLevelElement.textContent = `Level ${level}`;
    }
    screens.show('complete');
  }

  async function load(n: number, progress: PlayerProgress | null): Promise<void> {
    locked = true;
    selection = null;
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

    // A solved board can be restored after a reload that happened between the
    // winning move and "Weiter"; go straight back to the completion screen.
    if (isSolved(loaded)) {
      completeLevel(loaded.level.n);
    }
  }

  async function performMove(from: number, to: number): Promise<void> {
    if (state === null) return;
    const next = applyGameMove(state, from, to);
    state = next;
    selection = null;
    locked = true;
    const tubes = render();
    persist();
    await animatePour(tubes[from], tubes[to]);
    locked = false;

    if (isSolved(next)) {
      completeLevel(next.level.n);
    }
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
    render();
    persist();
  }

  function doRestart(): void {
    if (locked || state === null) return;
    state = restartGame(state);
    selection = null;
    render();
    persist();
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

  undoButton?.addEventListener('click', doUndo);
  restartButton?.addEventListener('click', doRestart);
  nextButton?.addEventListener('click', () => {
    void doNext();
  });

  async function start(): Promise<void> {
    if (!started) {
      started = true;
      globalThis.addEventListener('keydown', onKeyDown);
      boardElement.addEventListener('pointerup', onPointerUp);
      boardElement.addEventListener('click', onClick);
    }

    const saved = storage.getPlayerProgress(playerId);
    const n = saved?.level ?? 1;
    await load(n, saved !== null && saved.level === n ? saved : null);
  }

  function stop(): void {
    started = false;
    globalThis.removeEventListener('keydown', onKeyDown);
    boardElement.removeEventListener('pointerup', onPointerUp);
    boardElement.removeEventListener('click', onClick);
  }

  return { start, stop };
}
