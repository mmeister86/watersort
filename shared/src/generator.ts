// Deterministic, provably solvable level generation.
// Pure: no DOM, no Node APIs, no randomness outside the seeded PRNG.
//
// Every level the player sees is produced here and has been solved by
// `solve` before it is returned. The level is a pure function of its number
// and `GENERATOR_VERSION`: the same inputs always yield the identical level
// on every device.

import { curve } from './curve';
import { hash32, mulberry32, shuffled } from './rng';
import { isTubeComplete, type Board, type ColorId } from './rules';
import { solve } from './solver';

/**
 * Bumping this constant invalidates every previously generated level. The
 * client discards a saved in-progress board on a version mismatch but keeps
 * the level number, so a bump must be accompanied by an intentional change in
 * generation output.
 */
export const GENERATOR_VERSION = 1;

/** A fully generated level, including the solver's certified solution. */
export type Level = {
  n: number;
  version: number;
  tubes: Board;
  capacity: number;
  hidden: boolean;
  solution: [number, number][];
};

/** Hard cap on total tubes (filled + empty) from AGENTS.md section 6. */
const MAX_TUBES = 16;

/** Failed attempts between two working-state adjustments. */
const ATTEMPTS_PER_STEP = 50;

/** How much each bound widens per block of failed attempts once E is capped. */
const BAND_STEP = 5;

/** `minMoves` never drops below this when the band is widened. */
const MIN_MOVES_FLOOR = 6;

/**
 * Absolute safety valve. `E` growth plus band widening makes acceptance
 * practically certain, but a hard stop guarantees the loop can never spin
 * forever even in the face of a future curve/solver regression. Reaching it is
 * a bug, not a normal outcome, so it throws instead of returning an unsolved
 * level (which would violate the "every level is provably solvable" rule).
 */
const MAX_ATTEMPTS = 20_000;

/**
 * Builds a board for one attempt: `colors` filled tubes of `capacity` units
 * drawn from a shuffled pool in which every color appears exactly `capacity`
 * times, followed by `empty` empty tubes.
 */
function buildBoard(
  colors: number,
  capacity: number,
  empty: number,
  rand: () => number,
): Board {
  const pool: ColorId[] = [];
  for (let color = 1; color <= colors; color += 1) {
    for (let unit = 0; unit < capacity; unit += 1) {
      pool.push(color);
    }
  }

  const units = shuffled(pool, rand);
  const board: Board = [];
  for (let tube = 0; tube < colors; tube += 1) {
    const start = tube * capacity;
    board.push(units.slice(start, start + capacity));
  }
  for (let e = 0; e < empty; e += 1) {
    board.push([]);
  }
  return board;
}

/**
 * Cheap rejection before spending solver budget. A board is rejected when any
 * tube is already complete (trivially solved) or when a tube contains a
 * contiguous same-color run of length >= capacity - 1 (nearly solved and thus
 * too easy for the target difficulty).
 */
function quickReject(board: Board, capacity: number): boolean {
  for (const tube of board) {
    if (isTubeComplete(tube, capacity)) return true;

    let run = 1;
    for (let i = 1; i < tube.length; i += 1) {
      if (tube[i] === tube[i - 1]) {
        run += 1;
        if (run >= capacity - 1) return true;
      } else {
        run = 1;
      }
    }
  }
  return false;
}

/**
 * The generator internals, returning how many attempts were needed in addition
 * to the level itself. `generateLevel` is the supported contract; this is
 * exported so soak tests can log attempt counts as a difficulty-curve signal.
 *
 * Attempt loop, per AGENTS.md section 6 and the task brief:
 * 1. `seed = hash32(n, attempt, GENERATOR_VERSION)`, PRNG = mulberry32(seed).
 * 2. Shuffle the `colors * capacity` pool and fill `colors` tubes, append the
 *    current working number of empty tubes.
 * 3. Quick-reject trivially easy boards.
 * 4. Solve with the default budget; reject an unsolved board.
 * 5. Reject a solution outside `[minMoves, maxMoves]`.
 * 6. Attempt accounting: every 50 consecutive failures add one empty tube up to
 *    the 16-tube cap; once the cap is reached, every further 50 failures widen
 *    both bounds by 5 (`maxMoves += 5`, `minMoves = max(6, minMoves - 5)`).
 *    More empty tubes generally shorten solutions, so both ends must relax.
 *
 * The returned `tubes` is the actual accepted board (including any added empty
 * tubes), `hidden` comes from the curve, and `solution` is the solver's path.
 */
export function generateLevelWithAttempts(n: number): {
  level: Level;
  attempts: number;
} {
  const params = curve(n);
  const { colors, capacity, hidden } = params;

  let empty = params.empty;
  let minMoves = params.minMoves;
  let maxMoves = params.maxMoves;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const seed = hash32(n, attempt, GENERATOR_VERSION);
    const rand = mulberry32(seed);
    const board = buildBoard(colors, capacity, empty, rand);

    if (!quickReject(board, capacity)) {
      const result = solve(board, capacity);
      if (
        result.solved &&
        result.moves.length >= minMoves &&
        result.moves.length <= maxMoves
      ) {
        return {
          level: {
            n,
            version: GENERATOR_VERSION,
            tubes: board,
            capacity,
            hidden,
            solution: result.moves,
          },
          attempts: attempt + 1,
        };
      }
    }

    // Attempt accounting. `attempt` is the zero-based index of the attempt that
    // just failed, so after it there have been `attempt + 1` consecutive
    // failures.
    if ((attempt + 1) % ATTEMPTS_PER_STEP === 0) {
      if (colors + empty < MAX_TUBES) {
        empty += 1;
      } else {
        maxMoves += BAND_STEP;
        minMoves = Math.max(MIN_MOVES_FLOOR, minMoves - BAND_STEP);
      }
    }
  }

  throw new Error(
    `generateLevel(${n}): gave up after ${MAX_ATTEMPTS} attempts ` +
      `(colors=${colors}, capacity=${capacity})`,
  );
}

/**
 * Generates the certified level for `n`. Deterministic for a given `n` and
 * `GENERATOR_VERSION`. This is the supported public contract; use
 * `generateLevelWithAttempts` only for diagnostics.
 */
export function generateLevel(n: number): Level {
  return generateLevelWithAttempts(n).level;
}
