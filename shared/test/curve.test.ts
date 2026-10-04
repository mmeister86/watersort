import { describe, expect, it } from 'vitest';

import { curve, type CurveParams } from '../src/curve';

type Vector = { n: number; expected: CurveParams };

const VECTORS: readonly Vector[] = [
  {
    n: 1,
    expected: {
      colors: 3,
      capacity: 4,
      empty: 2,
      hidden: false,
      minMoves: 6,
      maxMoves: 12,
    },
  },
  {
    n: 5,
    expected: {
      colors: 3,
      capacity: 4,
      empty: 2,
      hidden: false,
      minMoves: 6,
      maxMoves: 12,
    },
  },
  {
    n: 7,
    expected: {
      colors: 4,
      capacity: 4,
      empty: 2,
      hidden: false,
      minMoves: 12,
      maxMoves: 25,
    },
  },
  {
    n: 10,
    expected: {
      colors: 3,
      capacity: 4,
      empty: 2,
      hidden: false,
      minMoves: 6,
      maxMoves: 12,
    },
  },
  {
    n: 14,
    expected: {
      colors: 5,
      capacity: 4,
      empty: 2,
      hidden: false,
      minMoves: 12,
      maxMoves: 25,
    },
  },
  {
    n: 36,
    expected: {
      colors: 7,
      capacity: 4,
      empty: 2,
      hidden: false,
      minMoves: 20,
      maxMoves: 35,
    },
  },
  {
    n: 76,
    expected: {
      colors: 9,
      capacity: 4,
      empty: 2,
      hidden: false,
      minMoves: 30,
      maxMoves: 50,
    },
  },
  {
    n: 100,
    expected: {
      colors: 7,
      capacity: 4,
      empty: 2,
      hidden: false,
      minMoves: 20,
      maxMoves: 35,
    },
  },
  {
    n: 150,
    expected: {
      colors: 9,
      capacity: 4,
      empty: 2,
      hidden: true,
      minMoves: 30,
      maxMoves: 50,
    },
  },
  {
    n: 200,
    expected: {
      colors: 9,
      capacity: 4,
      empty: 2,
      hidden: true,
      minMoves: 30,
      maxMoves: 50,
    },
  },
  {
    n: 201,
    expected: {
      colors: 12,
      capacity: 5,
      empty: 2,
      hidden: true,
      minMoves: 50,
      maxMoves: 75,
    },
  },
  {
    n: 400,
    expected: {
      colors: 11,
      capacity: 4,
      empty: 2,
      hidden: true,
      minMoves: 15,
      maxMoves: 60,
    },
  },
  {
    n: 401,
    expected: {
      colors: 12,
      capacity: 5,
      empty: 2,
      hidden: true,
      minMoves: 35,
      maxMoves: 90,
    },
  },
  {
    n: 420,
    expected: {
      colors: 12,
      capacity: 5,
      empty: 1,
      hidden: true,
      minMoves: 35,
      maxMoves: 90,
    },
  },
  {
    n: 425,
    expected: {
      colors: 12,
      capacity: 5,
      empty: 2,
      hidden: true,
      minMoves: 50,
      maxMoves: 75,
    },
  },
];

describe('curve', () => {
  it('throws for a level below 1', () => {
    expect(() => curve(0)).toThrow();
    expect(() => curve(-1)).toThrow();
  });

  for (const { n, expected } of VECTORS) {
    it(`returns the exact params for level ${n}`, () => {
      expect(curve(n)).toEqual(expected);
    });
  }

  it('ramps B7 colors 13 from level 601 and 14 from level 801', () => {
    expect(curve(601).colors).toBe(13);
    expect(curve(801).colors).toBe(14);
  });

  it('keeps B7 colors at 12 through level 600 and 13 through level 800', () => {
    expect(curve(600).colors).toBe(12);
    expect(curve(800).colors).toBe(13);
  });

  it('keeps colors + empty within the 16-tube cap for levels 1..1000', () => {
    for (let n = 1; n <= 1000; n += 1) {
      const params = curve(n);
      expect(params.colors + params.empty).toBeLessThanOrEqual(16);
      expect(params.colors).toBeGreaterThanOrEqual(3);
      expect(params.capacity).toBeGreaterThanOrEqual(4);
    }
  });

  it('is deterministic', () => {
    for (const n of [1, 37, 150, 333, 425, 999]) {
      expect(curve(n)).toEqual(curve(n));
    }
  });
});
