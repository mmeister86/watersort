// Seeded randomness for deterministic level generation.

/**
 * The standard mulberry32 PRNG. Returns a function that yields floats in
 * [0, 1). The same seed always produces the same sequence.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIX_1 = 0x85ebca6b;
const MIX_2 = 0xc2b2ae35;
const GOLDEN = 0x9e3779b9;

/** Murmur3-style avalanche of a single 32-bit value. */
function finalize(value: number): number {
  let h = value | 0;
  h = Math.imul(h ^ (h >>> 16), MIX_1);
  h = Math.imul(h ^ (h >>> 13), MIX_2);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Deterministic 32-bit hash mixing three uint32 inputs with a murmur3-style
 * finalizer. Used as `hash32(n, attempt, GENERATOR_VERSION)`.
 */
export function hash32(a: number, b: number, c: number): number {
  let h = GOLDEN;
  h = Math.imul(h ^ (a >>> 0), MIX_1);
  h ^= h >>> 13;
  h = Math.imul(h ^ (b >>> 0), MIX_2);
  h ^= h >>> 16;
  h = Math.imul(h ^ (c >>> 0), MIX_1);
  return finalize(h);
}

/**
 * Fisher-Yates shuffle driven by `rand`. Returns a new array and leaves the
 * input untouched.
 */
export function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const current = out[i]!;
    out[i] = out[j]!;
    out[j] = current;
  }
  return out;
}
