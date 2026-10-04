import { describe, expect, it } from 'vitest';

import { curve } from '../src/curve';

// The shared workspace deliberately has no Node type definitions so that
// `shared/src` cannot accidentally use Node APIs. The test needs only these
// three globals, so they are declared locally instead of pulling in
// `@types/node` for the whole workspace.
declare const process: { env: Record<string, string | undefined> };
declare const performance: { now: () => number };
declare const console: { log: (...args: unknown[]) => void };
import {
  GENERATOR_VERSION,
  generateLevel,
  generateLevelWithAttempts,
  type Level,
} from '../src/generator';
import { applyMove, isMoveLegal, isWin, type Board } from '../src/rules';

/**
 * Default `npm test` soaks n = 1..100 so the suite stays fast. `npm run
 * test:full` sets WATERSORT_FULL_LEVELS=1 and soaks n = 1..500 per AGENTS.md
 * section 11.
 */
const FULL = process.env.WATERSORT_FULL_LEVELS === '1';
const MAX_LEVEL = FULL ? 500 : 100;

/** Nearest-rank percentile (p in [0, 1]) over a sorted ascending array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[index]!;
}

/** Asserts the board structure and the level metadata for `n`. */
function expectShape(level: Level, n: number): void {
  const params = curve(n);

  expect(level.n).toBe(n);
  expect(level.version).toBe(GENERATOR_VERSION);
  expect(level.capacity).toBe(params.capacity);
  expect(level.hidden).toBe(params.hidden);

  const filled = level.tubes.filter((tube) => tube.length > 0);
  const empties = level.tubes.filter((tube) => tube.length === 0);

  // Exactly K filled tubes of capacity H plus at least the curve's empties.
  // The generator may have added empty tubes while reaching a solvable board;
  // the 16-tube cap is a hard limit.
  expect(filled.length).toBe(params.colors);
  for (const tube of filled) {
    expect(tube.length).toBe(params.capacity);
  }
  expect(empties.length).toBeGreaterThanOrEqual(params.empty);
  expect(level.tubes.length).toBeLessThanOrEqual(16);

  // Every color appears exactly H times, so each color can form one tube.
  const counts = new Map<number, number>();
  for (const tube of level.tubes) {
    for (const color of tube) {
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }
  expect(counts.size).toBe(params.colors);
  for (const count of counts.values()) {
    expect(count).toBe(params.capacity);
  }
}

/**
 * Replays a solution through the public rules, asserting each move is legal,
 * and returns the final board.
 */
function replay(board: Board, capacity: number, moves: [number, number][]): Board {
  let current = board;
  for (const [from, to] of moves) {
    expect(isMoveLegal(current, capacity, from, to)).toBe(true);
    current = applyMove(current, capacity, from, to);
  }
  return current;
}

describe('generateLevel: determinism', () => {
  const levels = [1, 2, 3, 5, 10, 37, 76, 100, 149, 150, 201, 333, 420, 601];

  for (const n of levels) {
    it(`is deep-equal across two calls for n=${n}`, () => {
      expect(generateLevel(n)).toEqual(generateLevel(n));
    }, 60_000);
  }

  it('uses the current GENERATOR_VERSION and level number in every level', () => {
    const level = generateLevel(7);
    expect(level.version).toBe(GENERATOR_VERSION);
    expect(level.n).toBe(7);
  });
});

describe('generateLevel: solvability + band + timing soak', () => {
  it(
    `generates solvable, in-band levels ${FULL ? '1..500 (full)' : '1..100'}`,
    () => {
      const times: number[] = [];
      let worstAttempts = 0;
      let worstAttemptsLevel = 0;
      const started = Date.now();

      for (let n = 1; n <= MAX_LEVEL; n += 1) {
        const params = curve(n);

        const t0 = performance.now();
        const { level, attempts } = generateLevelWithAttempts(n);
        const elapsed = performance.now() - t0;
        times.push(elapsed);

        if (attempts > worstAttempts) {
          worstAttempts = attempts;
          worstAttemptsLevel = n;
        }

        expectShape(level, n);

        const final = replay(level.tubes, level.capacity, level.solution);
        expect(isWin(final, level.capacity)).toBe(true);

        expect(level.solution.length).toBeGreaterThanOrEqual(params.minMoves);
        expect(level.solution.length).toBeLessThanOrEqual(params.maxMoves);
      }

      const sorted = times.slice().sort((a, b) => a - b);
      const max = sorted[sorted.length - 1] ?? 0;
      const p95 = percentile(sorted, 0.95);
      const total = Date.now() - started;

      // Required diagnostic output so slow bands are visible in CI logs.
      console.log(
        `soak 1..${MAX_LEVEL}: total=${total}ms max=${max.toFixed(1)}ms ` +
          `p95=${p95.toFixed(1)}ms worstAttempts=${worstAttempts}@n=${worstAttemptsLevel}`,
      );

      expect(p95).toBeLessThan(300);
    },
    FULL ? 300_000 : 60_000,
  );
});
