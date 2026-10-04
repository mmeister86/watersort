import { describe, expect, it } from 'vitest';

import { stars } from '../src/game/stars';

describe('stars', () => {
  it('awards 3 stars within optimal + 3 moves', () => {
    expect(stars(10, 10)).toBe(3);
    expect(stars(13, 10)).toBe(3);
    expect(stars(10, 7)).toBe(3);
    expect(stars(9, 7)).toBe(3);
  });

  it('drops to 2 stars just above optimal + 3', () => {
    expect(stars(14, 10)).toBe(2);
    expect(stars(15, 10)).toBe(2);
    expect(stars(11, 7)).toBe(2);
    expect(stars(16, 12)).toBe(2);
    expect(stars(18, 12)).toBe(2);
  });

  it('drops to 1 star above ceil(optimal * 1.5)', () => {
    expect(stars(16, 10)).toBe(1);
    expect(stars(19, 12)).toBe(1);
    expect(stars(12, 7)).toBe(1);
  });

  it('rounds the 2-star ceiling up', () => {
    // ceil(7 * 1.5) = 11 and optimal + 3 = 10, so 11 is still 2 stars.
    expect(stars(11, 7)).toBe(2);
    // optimal 10 -> ceil(15) = 15 is the last 2-star score.
    expect(stars(15, 10)).toBe(2);
  });

  it('handles a zero-length optimal solution gracefully', () => {
    expect(stars(0, 0)).toBe(3);
    expect(stars(3, 0)).toBe(3);
    expect(stars(4, 0)).toBe(1);
  });
});
