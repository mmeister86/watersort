// Difficulty curve: maps a level number to generator parameters.
// Pure and deterministic: no randomness, no DOM, no Node APIs.

/** Parameters the level generator consumes for a given level number. */
export type CurveParams = {
  colors: number;
  capacity: number;
  empty: number;
  hidden: boolean;
  minMoves: number;
  maxMoves: number;
};

type Band = {
  start: number;
  end: number;
  colorsMin: number;
  colorsMax: number;
  capacity: number;
  empty: number;
  minMoves: number;
  maxMoves: number;
};

/** Level bands from AGENTS.md section 6. `end: Infinity` marks the open band. */
const BANDS: readonly Band[] = [
  {
    start: 1,
    end: 5,
    colorsMin: 3,
    colorsMax: 3,
    capacity: 4,
    empty: 2,
    minMoves: 6,
    maxMoves: 12,
  },
  {
    start: 6,
    end: 20,
    colorsMin: 4,
    colorsMax: 5,
    capacity: 4,
    empty: 2,
    minMoves: 12,
    maxMoves: 25,
  },
  {
    start: 21,
    end: 50,
    colorsMin: 6,
    colorsMax: 7,
    capacity: 4,
    empty: 2,
    minMoves: 20,
    maxMoves: 35,
  },
  {
    start: 51,
    end: 100,
    colorsMin: 8,
    colorsMax: 9,
    capacity: 4,
    empty: 2,
    minMoves: 30,
    maxMoves: 50,
  },
  {
    start: 101,
    end: 200,
    colorsMin: 10,
    colorsMax: 11,
    capacity: 4,
    empty: 2,
    minMoves: 40,
    maxMoves: 60,
  },
  {
    start: 201,
    end: 400,
    colorsMin: 12,
    colorsMax: 12,
    capacity: 5,
    empty: 2,
    minMoves: 50,
    maxMoves: 75,
  },
  {
    start: 401,
    end: Number.POSITIVE_INFINITY,
    colorsMin: 12,
    colorsMax: 14,
    capacity: 5,
    empty: 2,
    minMoves: 60,
    maxMoves: 90,
  },
];

/** Index of the band that contains `n`. Bands are contiguous. */
function bandIndexFor(n: number): number {
  for (let i = 0; i < BANDS.length; i += 1) {
    const band = BANDS[i]!;
    if (n >= band.start && n <= band.end) return i;
  }
  return BANDS.length - 1;
}

/**
 * Color count for a band. Finite bands ramp from `colorsMin` to `colorsMax`
 * across the band using the level clamped into the band (`evaluated`). The
 * open B7 band ramps by level instead: 401-600 -> 12, 601-800 -> 13, 801+ -> 14.
 */
function colorsFor(band: Band, level: number, evaluated: number): number {
  if (band.end === Number.POSITIVE_INFINITY) {
    return band.colorsMin + Math.min(2, Math.floor((level - band.start) / 200));
  }
  const span = band.end - band.start + 1;
  const ramp = Math.floor(
    ((evaluated - band.start) * (band.colorsMax - band.colorsMin + 1)) / span,
  );
  return band.colorsMin + ramp;
}

/**
 * Parameters for level `n`. Deterministic: the same `n` always yields the same
 * object. Throws for anything that is not an integer >= 1.
 *
 * - Sawtooth: every 5th level above 5 is evaluated in the band one lower.
 * - Boss: every 10th level from 401 replaces sawtooth and uses `empty = 1`.
 * - Hidden layers turn on at level 150, independent of sawtooth.
 */
export function curve(n: number): CurveParams {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`curve: level must be an integer >= 1, got ${n}`);
  }

  const hidden = n >= 150;

  if (n >= 401 && n % 10 === 0) {
    const boss = BANDS[BANDS.length - 1]!;
    return {
      colors: colorsFor(boss, n, n),
      capacity: boss.capacity,
      empty: 1,
      hidden,
      minMoves: boss.minMoves,
      maxMoves: boss.maxMoves,
    };
  }

  let index = bandIndexFor(n);
  let evaluated = n;
  if (n > 5 && n % 5 === 0) {
    index -= 1;
    const lower = BANDS[index]!;
    evaluated = Math.min(Math.max(n, lower.start), lower.end);
  }

  const band = BANDS[index]!;
  return {
    colors: colorsFor(band, n, evaluated),
    capacity: band.capacity,
    empty: band.empty,
    hidden,
    minMoves: band.minMoves,
    maxMoves: band.maxMoves,
  };
}
