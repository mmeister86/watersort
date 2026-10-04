import { describe, expect, it } from 'vitest';

import {
  applyMove,
  colorName,
  isMoveLegal,
  isTubeComplete,
  isWin,
  type Board,
} from '../src/rules';
import * as shared from '../src/index';

const CAPACITY = 4;

describe('isMoveLegal', () => {
  it('rejects a move from a tube onto itself', () => {
    expect(isMoveLegal([[1], [2]], CAPACITY, 0, 0)).toBe(false);
  });

  it('rejects a move from an empty tube', () => {
    expect(isMoveLegal([[], [1]], CAPACITY, 0, 1)).toBe(false);
  });

  it('rejects a move into a full tube', () => {
    expect(isMoveLegal([[1], [2, 2, 2, 2]], CAPACITY, 0, 1)).toBe(false);
  });

  it('rejects a move onto a mismatched top color', () => {
    expect(isMoveLegal([[1], [2]], CAPACITY, 0, 1)).toBe(false);
  });

  it('allows a move into an empty tube', () => {
    expect(isMoveLegal([[1], []], CAPACITY, 0, 1)).toBe(true);
  });

  it('allows a move onto a matching top color', () => {
    expect(isMoveLegal([[1], [1, 1]], CAPACITY, 0, 1)).toBe(true);
  });
});

describe('applyMove', () => {
  it('pours only what fits when the target is nearly full', () => {
    const board: Board = [
      [5, 5, 5, 5],
      [5, 5, 5],
    ];
    const next = applyMove(board, CAPACITY, 0, 1);
    expect(next[0]).toEqual([5, 5, 5]);
    expect(next[1]).toEqual([5, 5, 5, 5]);
  });

  it('pours the whole contiguous run when there is space', () => {
    const board: Board = [
      [1, 2, 2, 2],
      [2],
    ];
    const next = applyMove(board, CAPACITY, 0, 1);
    expect(next[0]).toEqual([1]);
    expect(next[1]).toEqual([2, 2, 2, 2]);
  });

  it('stops at a color change and leaves the bottom units in place', () => {
    const board: Board = [[3, 4, 4], []];
    const next = applyMove(board, CAPACITY, 0, 1);
    expect(next[0]).toEqual([3]);
    expect(next[1]).toEqual([4, 4]);
  });

  it('does not mutate the original board', () => {
    const board: Board = [[1, 1], []];
    const snapshot = board.map((tube) => [...tube]);
    applyMove(board, CAPACITY, 0, 1);
    expect(board).toEqual(snapshot);
  });

  it('throws on an illegal move', () => {
    expect(() => applyMove([[1], [2]], CAPACITY, 0, 1)).toThrow();
  });
});

describe('isTubeComplete', () => {
  it('is true for a full single-color tube', () => {
    expect(isTubeComplete([2, 2, 2, 2], CAPACITY)).toBe(true);
  });

  it('is false for an empty tube', () => {
    expect(isTubeComplete([], CAPACITY)).toBe(false);
  });

  it('is false for a partially filled uniform tube', () => {
    expect(isTubeComplete([2, 2], CAPACITY)).toBe(false);
  });

  it('is false for a full multi-color tube', () => {
    expect(isTubeComplete([1, 1, 2, 2], CAPACITY)).toBe(false);
  });
});

describe('isWin', () => {
  it('is true for an empty board', () => {
    expect(isWin([], CAPACITY)).toBe(true);
  });

  it('is true when every tube is empty or complete', () => {
    expect(isWin([[], [1, 1, 1, 1], [2, 2, 2, 2]], CAPACITY)).toBe(true);
  });

  it('is false for a near-miss board', () => {
    expect(isWin([[1, 1, 1], [2, 2, 2, 2]], CAPACITY)).toBe(false);
  });
});

describe('colorName', () => {
  it('maps ids 1..14 to the German color names', () => {
    const expected = [
      'rot',
      'blau',
      'grün',
      'gelb',
      'orange',
      'violett',
      'pink',
      'türkis',
      'braun',
      'hellblau',
      'dunkelgrün',
      'grau',
      'schwarz',
      'weiß',
    ];
    expected.forEach((name, index) => {
      expect(colorName(index + 1)).toBe(name);
    });
  });
});

describe('shared barrel', () => {
  it('re-exports the rules and rng public API', () => {
    expect(typeof shared.isMoveLegal).toBe('function');
    expect(typeof shared.applyMove).toBe('function');
    expect(typeof shared.mulberry32).toBe('function');
    expect(typeof shared.hash32).toBe('function');
    expect(typeof shared.shuffled).toBe('function');
  });
});
