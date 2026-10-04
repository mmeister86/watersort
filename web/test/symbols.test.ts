import { describe, expect, it } from 'vitest';

import { colorSymbol } from '../src/ui/symbols';

const COLOR_IDS = Array.from({ length: 14 }, (_, index) => index + 1);

describe('colorSymbol', () => {
  it('maps every color id 1..14 to a non-empty glyph', () => {
    for (const id of COLOR_IDS) {
      const glyph = colorSymbol(id);
      expect(typeof glyph).toBe('string');
      expect(glyph.length).toBeGreaterThan(0);
    }
  });

  it('uses one distinct code point per color id', () => {
    const glyphs = COLOR_IDS.map((id) => colorSymbol(id));
    expect(new Set(glyphs).size).toBe(COLOR_IDS.length);
    for (const glyph of glyphs) {
      // A single code point keeps the symbols font-size predictable and avoids
      // accidental emoji sequences.
      expect(Array.from(glyph)).toHaveLength(1);
    }
  });
});
