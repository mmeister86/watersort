// Pure Water Sort game state machine. No DOM, no storage, no randomness.
//
// The board always holds the real colors. Hidden layers are a rendering
// concern: `visibleUnits` masks everything below the top unit, and the UI
// decides from `level.hidden` whether to use it.

import {
  applyMove,
  isMoveLegal,
  isWin,
  type Board,
  type ColorId,
  type Move,
  type Tube,
} from '@shared/rules';
import type { Level } from '@shared/generator';

/** Everything the UI and the sync layer need to know about one level attempt. */
export type GameState = {
  level: Level;
  board: Board;
  history: Move[];
  moves: number;
  undos: number;
};

/** The counter increment reported to the server when a level is solved. */
export type StatsDelta = {
  solved: number;
  moves: number;
  undos: number;
};

/** The placeholder shown for every hidden unit below a tube's top unit. */
export const HIDDEN_UNIT = '?' as const;

/** A unit as rendered: either the real color or the hidden placeholder. */
export type VisibleUnit = ColorId | typeof HIDDEN_UNIT;

/**
 * Builds the initial state for a level. The board is a structural copy of the
 * level's tubes so later moves never mutate the level definition.
 */
export function startLevel(level: Level): GameState {
  return {
    level,
    board: level.tubes.map((tube) => tube.slice()),
    history: [],
    moves: 0,
    undos: 0,
  };
}

/** Whether pouring `from -> to` is legal in the current state. */
export function canMove(state: GameState, from: number, to: number): boolean {
  return isMoveLegal(state.board, state.level.capacity, from, to);
}

/**
 * Applies a legal move and returns the next state: the poured board, the move
 * appended to the history and the move counter incremented. Throws on an
 * illegal move, matching {@link applyMove}.
 */
export function move(state: GameState, from: number, to: number): GameState {
  if (!canMove(state, from, to)) {
    throw new Error(`Illegal move from tube ${from} to tube ${to}`);
  }

  const board = applyMove(state.board, state.level.capacity, from, to);
  return {
    ...state,
    board,
    history: [...state.history, { from, to }],
    moves: state.moves + 1,
  };
}

/**
 * Reverts the most recent move by replaying the history from the level start,
 * incrementing `undos`. Undoing with an empty history is a no-op and returns
 * the same state object.
 */
export function undo(state: GameState): GameState {
  if (state.history.length === 0) {
    return state;
  }

  const history = state.history.slice(0, -1);
  let board = startLevel(state.level).board;
  for (const past of history) {
    board = applyMove(board, state.level.capacity, past.from, past.to);
  }

  return {
    ...state,
    board,
    history,
    moves: state.moves - 1,
    undos: state.undos + 1,
  };
}

/**
 * Resets to the level's start state. This is a fresh attempt, so the move and
 * undo counters restart at zero as well.
 */
export function restart(state: GameState): GameState {
  return startLevel(state.level);
}

/** Whether every tube is currently empty or complete. */
export function isSolved(state: GameState): boolean {
  return isWin(state.board, state.level.capacity);
}

/** The sync payload for a solved level: one solve plus effort counters. */
export function statsDelta(state: GameState): StatsDelta {
  return {
    solved: 1,
    moves: state.moves,
    undos: state.undos,
  };
}

/**
 * The units to render for a tube under hidden layers: every unit below the top
 * one is masked with {@link HIDDEN_UNIT}, the top unit shows its real color.
 * Rendering-only; the board itself keeps the real colors.
 */
export function visibleUnits(tube: Tube): VisibleUnit[] {
  const units: VisibleUnit[] = tube.map(() => HIDDEN_UNIT);
  const topColor = tube[tube.length - 1];
  if (topColor !== undefined) {
    units[units.length - 1] = topColor;
  }
  return units;
}
