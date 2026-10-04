// Color-blind symbol map. Pure: no DOM, no storage.
//
// Every color id 1..14 gets its own single-code-point glyph so the board stays
// readable without relying on hue. The glyphs are geometric shapes and
// monochrome dingbats with broad font coverage (no emoji presentation), chosen
// to remain distinct from each other by silhouette.

import type { ColorId } from '@shared/rules';

/**
 * Glyphs for color ids 1..14, matching the order in `shared/src/rules.ts`
 * `colorName`. Each entry is a single Unicode code point:
 * 1 ●, 2 ▲, 3 ■, 4 ★, 5 ◆, 6 ▼, 7 ✚, 8 ⬢, 9 ✖, 10 ◐, 11 ◇, 12 ○, 13 ✱, 14 ▬.
 */
export const COLOR_SYMBOLS: readonly string[] = [
  '\u25CF', // 1 ●
  '\u25B2', // 2 ▲
  '\u25A0', // 3 ■
  '\u2605', // 4 ★
  '\u25C6', // 5 ◆
  '\u25BC', // 6 ▼
  '\u271A', // 7 ✚
  '\u2B22', // 8 ⬢
  '\u2716', // 9 ✖
  '\u25D0', // 10 ◐
  '\u25C7', // 11 ◇
  '\u25CB', // 12 ○
  '\u2731', // 13 ✱
  '\u25AC', // 14 ▬
];

/** How many color ids have a dedicated symbol. */
export const COLOR_SYMBOL_COUNT = COLOR_SYMBOLS.length;

/**
 * Returns the symbol for a color id, or a neutral dot for an id outside the
 * 1..14 palette. Board rendering only ever sees ids the palette defines, so the
 * fallback is a safety net rather than a normal path.
 */
export function colorSymbol(id: ColorId): string {
  return COLOR_SYMBOLS[id - 1] ?? '\u25CF';
}
