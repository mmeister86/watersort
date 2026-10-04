import { describe, expect, it } from 'vitest';

import type { Level } from '@shared/generator';
import type { Board } from '@shared/rules';

import {
  HIDDEN_UNIT,
  canMove,
  isSolved,
  move,
  restart,
  startLevel,
  statsDelta,
  undo,
  visibleUnits,
} from '../src/game/state';

const CAPACITY = 3;

/** Builds a level from a board without touching the generator. */
function levelWith(tubes: Board, capacity = CAPACITY): Level {
  return {
    n: 1,
    version: 1,
    capacity,
    hidden: false,
    solution: [],
    tubes,
  };
}

/** A fixed, hand-verifiable, solvable 3-color level (capacity 3). */
function threeColorLevel(): Level {
  return levelWith([
    [1, 2, 3],
    [1, 2, 3],
    [1, 2, 3],
    [],
    [],
  ]);
}

/** A minimal level with two different top colors, for legality checks. */
function twoColorLevel(): Level {
  return levelWith([[1], [2], []]);
}

/** The solver-independent winning sequence for {@link threeColorLevel}. */
const WINNING_SEQUENCE: [number, number][] = [
  [2, 3],
  [1, 3],
  [0, 3],
  [2, 4],
  [1, 4],
  [0, 4],
  [2, 1],
  [0, 1],
];

describe('startLevel', () => {
  it('copies the level board and starts with zero counters and history', () => {
    const state = startLevel(threeColorLevel());

    expect(state.board).toEqual([
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
      [],
      [],
    ]);
    expect(state.history).toEqual([]);
    expect(state.moves).toBe(0);
    expect(state.undos).toBe(0);
    expect(state.level.capacity).toBe(CAPACITY);
  });

  it('does not share tube arrays with the level', () => {
    const level = threeColorLevel();
    const state = startLevel(level);

    state.board[0]?.push(9);

    expect(level.tubes[0]).toEqual([1, 2, 3]);
  });
});

describe('canMove', () => {
  it('allows pouring into an empty tube', () => {
    expect(canMove(startLevel(twoColorLevel()), 0, 2)).toBe(true);
  });

  it('rejects a move onto a mismatched color', () => {
    expect(canMove(startLevel(twoColorLevel()), 0, 1)).toBe(false);
  });

  it('rejects moving a tube onto itself', () => {
    expect(canMove(startLevel(twoColorLevel()), 0, 0)).toBe(false);
  });

  it('rejects pouring from an empty tube', () => {
    expect(canMove(startLevel(twoColorLevel()), 2, 0)).toBe(false);
  });
});

describe('move', () => {
  it('applies a legal move, counts it and records history', () => {
    const start = startLevel(twoColorLevel());
    const next = move(start, 0, 2);

    expect(next.board).toEqual([[], [2], [1]]);
    expect(next.moves).toBe(1);
    expect(next.history).toEqual([{ from: 0, to: 2 }]);
  });

  it('does not mutate the previous state', () => {
    const start = startLevel(twoColorLevel());
    move(start, 0, 2);

    expect(start.board).toEqual([[1], [2], []]);
    expect(start.history).toEqual([]);
    expect(start.moves).toBe(0);
  });

  it('throws on an illegal move', () => {
    const start = startLevel(twoColorLevel());
    expect(() => move(start, 0, 1)).toThrow();
    expect(start.moves).toBe(0);
  });
});

describe('undo', () => {
  it('restores the previous board, decrements moves and counts the undo', () => {
    const after = move(startLevel(twoColorLevel()), 0, 2);
    const back = undo(after);

    expect(back.board).toEqual([[1], [2], []]);
    expect(back.moves).toBe(0);
    expect(back.undos).toBe(1);
    expect(back.history).toEqual([]);
  });

  it('supports undoing several moves in order', () => {
    let state = startLevel(twoColorLevel());
    state = move(state, 0, 2); // [[], [2], [1]]
    state = move(state, 1, 0); // [[2], [], [1]]

    expect(state.board).toEqual([[2], [], [1]]);
    state = undo(state);
    expect(state.board).toEqual([[], [2], [1]]);
    state = undo(state);
    expect(state.board).toEqual([[1], [2], []]);
    expect(state.moves).toBe(0);
    expect(state.undos).toBe(2);
  });

  it('is a no-op when there is nothing to undo', () => {
    const start = startLevel(twoColorLevel());
    const same = undo(start);

    expect(same).toBe(start);
    expect(same.undos).toBe(0);
  });
});

describe('restart', () => {
  it('resets the board, history and counters to the level start', () => {
    let state = startLevel(twoColorLevel());
    state = move(state, 0, 2);
    state = undo(state);

    const fresh = restart(state);

    expect(fresh.board).toEqual([[1], [2], []]);
    expect(fresh.history).toEqual([]);
    expect(fresh.moves).toBe(0);
    expect(fresh.undos).toBe(0);
  });
});

describe('isSolved', () => {
  it('is false for the starting board', () => {
    expect(isSolved(startLevel(threeColorLevel()))).toBe(false);
  });

  it('is true after replaying the winning sequence', () => {
    let state = startLevel(threeColorLevel());
    for (const [from, to] of WINNING_SEQUENCE) {
      state = move(state, from, to);
    }

    expect(isSolved(state)).toBe(true);
  });
});

describe('statsDelta', () => {
  it('reports one solve plus the accumulated moves and undos', () => {
    let state = startLevel(threeColorLevel());
    for (const [from, to] of WINNING_SEQUENCE) {
      state = move(state, from, to);
    }
    state = undo(state);

    expect(statsDelta(state)).toEqual({
      solved: 1,
      moves: WINNING_SEQUENCE.length - 1,
      undos: 1,
    });
  });
});

describe('visibleUnits', () => {
  it('reveals only the top unit and hides the rest', () => {
    expect(visibleUnits([1, 2, 3])).toEqual([HIDDEN_UNIT, HIDDEN_UNIT, 3]);
  });

  it('returns a single revealed unit for a one-unit tube', () => {
    expect(visibleUnits([5])).toEqual([5]);
  });

  it('returns an empty array for an empty tube', () => {
    expect(visibleUnits([])).toEqual([]);
  });

  it('does not mutate the underlying tube', () => {
    const tube = [1, 2, 3];
    visibleUnits(tube);
    expect(tube).toEqual([1, 2, 3]);
  });
});

describe('hidden layers', () => {
  it('keeps the real colors on the board even when rendering hides them', () => {
    const state = startLevel(threeColorLevel());
    expect(state.board[0]).toEqual([1, 2, 3]);
    expect(visibleUnits(state.board[0] ?? [])).toEqual(['?', '?', 3]);
  });
});
