import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Source-scan guard for the game-logic purity rule: `shared/src` must never
 * call `Math.random`. This lives in the server workspace because shared tests
 * must stay pure (no Node fs), while this test needs Node fs to read sources.
 */
const SHARED_SRC = fileURLToPath(new URL('../../shared/src', import.meta.url));

/** Recursively collects every `.ts` file under `dir`. */
function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

describe('shared sources', () => {
  it('contain no Math.random call', () => {
    const files = collectTsFiles(SHARED_SRC);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source.includes('Math.random'), `${file} must not use Math.random`).toBe(
        false,
      );
    }
  });
});
