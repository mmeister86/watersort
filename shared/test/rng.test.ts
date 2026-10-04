import { describe, expect, it } from 'vitest';

import { hash32, mulberry32, shuffled } from '../src/rng';

describe('mulberry32', () => {
  it('produces an identical sequence for the same seed', () => {
    const first = mulberry32(12345);
    const second = mulberry32(12345);
    const sequenceA = Array.from({ length: 10 }, () => first());
    const sequenceB = Array.from({ length: 10 }, () => second());
    expect(sequenceA).toEqual(sequenceB);
  });

  it('produces a different sequence for a different seed', () => {
    const first = mulberry32(1);
    const second = mulberry32(2);
    const sequenceA = Array.from({ length: 5 }, () => first());
    const sequenceB = Array.from({ length: 5 }, () => second());
    expect(sequenceA).not.toEqual(sequenceB);
  });

  it('returns floats in [0, 1)', () => {
    const rand = mulberry32(99);
    for (let i = 0; i < 1000; i += 1) {
      const value = rand();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('matches the known first values for seed 0', () => {
    const rand = mulberry32(0);
    expect(rand()).toBe(0.26642920868471265);
    expect(rand()).toBe(0.0003297457005828619);
    expect(rand()).toBe(0.2232720274478197);
  });
});

describe('hash32', () => {
  it('is deterministic', () => {
    expect(hash32(7, 3, 1)).toBe(hash32(7, 3, 1));
  });

  it('returns an unsigned 32-bit integer', () => {
    const hash = hash32(7, 2, 1);
    expect(Number.isInteger(hash)).toBe(true);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThan(2 ** 32);
  });

  it('changes when any of the three inputs changes', () => {
    const base = hash32(10, 0, 1);
    expect(hash32(11, 0, 1)).not.toBe(base);
    expect(hash32(10, 1, 1)).not.toBe(base);
    expect(hash32(10, 0, 2)).not.toBe(base);
  });
});

describe('shuffled', () => {
  it('returns a permutation of the input', () => {
    const input = [1, 2, 3, 4, 5, 6];
    const result = shuffled(input, mulberry32(42));
    expect([...result].sort((a, b) => a - b)).toEqual(input);
  });

  it('is deterministic for the same rand function', () => {
    const input = [1, 2, 3, 4, 5];
    expect(shuffled(input, mulberry32(7))).toEqual(
      shuffled(input, mulberry32(7)),
    );
  });

  it('does not mutate the input array', () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    shuffled(input, mulberry32(1));
    expect(input).toEqual(copy);
  });

  it('reorders the items', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(shuffled(input, mulberry32(123))).not.toEqual(input);
  });
});
