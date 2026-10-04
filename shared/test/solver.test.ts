import { describe, expect, it } from 'vitest';

import {
  applyMove,
  isMoveLegal,
  isTubeComplete,
  isWin,
  type Board,
} from '../src/rules';
import { canonicalKey, solve } from '../src/solver';
import * as shared from '../src/index';

/**
 * Replays a solver solution through the public rules, asserting every move is
 * legal and pruned (no source complete, no single-color -> empty, empty target
 * is always the first empty tube), and returns the final board.
 */
function replaySolution(
  board: Board,
  capacity: number,
  moves: [number, number][],
): Board {
  let current = board;
  for (const [from, to] of moves) {
    expect(isMoveLegal(current, capacity, from, to)).toBe(true);

    const source = current[from]!;
    expect(isTubeComplete(source, capacity)).toBe(false);

    const target = current[to]!;
    if (target.length === 0) {
      const firstEmpty = current.findIndex((tube) => tube.length === 0);
      expect(to).toBe(firstEmpty);
      const uniform = source.every((unit) => unit === source[0]);
      expect(uniform).toBe(false);
    }

    current = applyMove(current, capacity, from, to);
  }
  return current;
}

// 3 colors, capacity 4, 2 empty tubes: two colors each stacked on top of each
// other. Solvable in three pours.
const SIMPLE_THREE: Board = [
  [1, 1, 2, 2],
  [2, 2, 1, 1],
  [],
  [],
];

// 3 colors, capacity 4, 2 empty tubes: a cyclic (Latin-square-like) mixing
// where every color appears exactly four times. Not solvable in one move.
const CYCLIC_THREE: Board = [
  [1, 2, 3, 1],
  [2, 3, 1, 2],
  [3, 1, 2, 3],
  [],
  [],
];

// 6 colors, capacity 4, 2 empty tubes: cyclic mixing, every color exactly four
// times. Used for the performance sanity check.
const CYCLIC_SIX: Board = [
  [1, 2, 3, 4],
  [2, 3, 4, 5],
  [3, 4, 5, 6],
  [4, 5, 6, 1],
  [5, 6, 1, 2],
  [6, 1, 2, 3],
  [],
  [],
];

// Two colors interleaved with no empty tube and capacity exhausted: no legal
// move exists and the board is not won.
const DEADLOCKED: Board = [
  [1, 2],
  [2, 1],
];

describe('solve: solvable boards', () => {
  it('solves a simple 3-color board and replays to a win', () => {
    const result = solve(SIMPLE_THREE, 4);
    expect(result.solved).toBe(true);
    expect(result.moves.length).toBeGreaterThan(0);
    const final = replaySolution(SIMPLE_THREE, 4, result.moves);
    expect(isWin(final, 4)).toBe(true);
  });

  it('solves a cyclic 3-color board and replays to a win', () => {
    const result = solve(CYCLIC_THREE, 4);
    expect(result.solved).toBe(true);
    const final = replaySolution(CYCLIC_THREE, 4, result.moves);
    expect(isWin(final, 4)).toBe(true);
  });

  it('treats an already won board as solved with no moves', () => {
    const won: Board = [
      [1, 1, 1, 1],
      [2, 2, 2, 2],
      [],
    ];
    const result = solve(won, 4);
    expect(result.solved).toBe(true);
    expect(result.moves).toEqual([]);
  });

  it('is deterministic: solving the same board twice is deep-equal', () => {
    const first = solve(CYCLIC_THREE, 4);
    const second = solve(CYCLIC_THREE, 4);
    expect(second).toEqual(first);
  });
});

describe('solve: unsolvable boards', () => {
  it('returns solved false when no legal move exists', () => {
    const result = solve(DEADLOCKED, 2);
    expect(result.solved).toBe(false);
    expect(result.moves).toEqual([]);
    expect(result.expanded).toBeLessThanOrEqual(1);
  });

  it('returns solved false when the open set empties without reaching a win', () => {
    // Three colors, capacity 2, no empty tube: every tube is full and no two
    // tops match.
    const board: Board = [
      [1, 2],
      [3, 1],
      [2, 3],
    ];
    const result = solve(board, 2, 50_000);
    expect(result.solved).toBe(false);
  });
});

describe('solve: budget', () => {
  it('with budget 0 returns solved false and expanded 0', () => {
    const result = solve(SIMPLE_THREE, 4, 0);
    expect(result.solved).toBe(false);
    expect(result.expanded).toBe(0);
  });

  it('never expands more states than the budget', () => {
    const result = solve(CYCLIC_SIX, 4, 5);
    expect(result.expanded).toBeLessThanOrEqual(5);
  });

  it('does not solve a board that needs more expansions than the budget', () => {
    // SIMPLE_THREE needs at least two pours, so a budget of one expansion
    // cannot reach a win.
    const result = solve(SIMPLE_THREE, 4, 1);
    expect(result.solved).toBe(false);
    expect(result.expanded).toBeLessThanOrEqual(1);
  });
});

describe('canonicalKey', () => {
  it('ignores tube order', () => {
    const a: Board = [
      [1, 2],
      [],
      [3, 3, 3, 3],
    ];
    const permuted: Board = [
      [3, 3, 3, 3],
      [1, 2],
      [],
    ];
    expect(canonicalKey(a)).toBe(canonicalKey(permuted));
  });

  it('ignores the order of several empty tubes', () => {
    expect(canonicalKey([[1], [], []])).toBe(canonicalKey([[], [], [1]]));
  });

  it('distinguishes boards that are not permutations', () => {
    expect(canonicalKey([[1, 2], []])).not.toBe(canonicalKey([[2, 1], []]));
    expect(canonicalKey([[1, 2]])).not.toBe(canonicalKey([[1], [2]]));
  });
});

describe('solve: pruning', () => {
  it('never pours from a complete tube, from a single-color tube into an empty tube, or into a non-first empty tube', () => {
    // Exercise several boards; replaySolution asserts the three pruning rules
    // for every returned move.
    for (const [board, capacity] of [
      [SIMPLE_THREE, 4],
      [CYCLIC_THREE, 4],
      [CYCLIC_SIX, 4],
    ] as const) {
      const result = solve(board, capacity);
      expect(result.solved).toBe(true);
      replaySolution(board, capacity, result.moves);
    }
  });
});

describe('solve: performance sanity', () => {
  it('solves a 6-color board within the default budget and well under 10 s', () => {
    const started = Date.now();
    const result = solve(CYCLIC_SIX, 4);
    const elapsed = Date.now() - started;
    expect(result.solved).toBe(true);
    const final = replaySolution(CYCLIC_SIX, 4, result.moves);
    expect(isWin(final, 4)).toBe(true);
    expect(elapsed).toBeLessThan(10_000);
  });
});

describe('shared barrel', () => {
  it('re-exports solve and canonicalKey', () => {
    expect(typeof shared.solve).toBe('function');
    expect(typeof shared.canonicalKey).toBe('function');
  });
});
