// Pure keyboard mapping for the game screen.
//
// Kept DOM-free so the bindings can be unit-tested. The plan's ruling for the
// `R` conflict lives here: `R` restarts the level and is therefore *not* bound
// to tube 14, which is pointer-only.

/** Modifier and repeat flags read off a `KeyboardEvent`. */
export type KeyModifiers = {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  repeat: boolean;
};

/** What a key press asks the game screen to do. */
export type KeyAction =
  | { kind: 'select'; index: number }
  | { kind: 'undo' }
  | { kind: 'restart' }
  | { kind: 'deselect' };

/**
 * Digit and letter keys to zero-based tube index. `1`–`9` are tubes 1–9, `0` is
 * tube 10, and `Q W E T Y U I O P` are tubes 11, 12, 13, 15, 16, 17, 18, 19 and
 * 20. `R` is intentionally absent: it restarts the level (tube 14 is
 * pointer-only).
 */
export const TUBE_KEYS: Readonly<Record<string, number>> = {
  '1': 0,
  '2': 1,
  '3': 2,
  '4': 3,
  '5': 4,
  '6': 5,
  '7': 6,
  '8': 7,
  '9': 8,
  '0': 9,
  q: 10,
  w: 11,
  e: 12,
  t: 14,
  y: 15,
  u: 16,
  i: 17,
  o: 18,
  p: 19,
};

/** Whether no modifier that changes browser shortcuts is held. */
function isPlain(mods: KeyModifiers): boolean {
  return !mods.ctrl && !mods.meta && !mods.alt;
}

/**
 * Maps a key press to an action, or `null` when the key is not bound. Undo
 * accepts plain `Z`, `Ctrl+Z` and `Cmd+Z`; every other binding requires no
 * Ctrl/Cmd/Alt so browser shortcuts (notably `Ctrl+R` reload) keep working.
 * Auto-repeat is ignored.
 */
export function keyboardAction(
  key: string,
  mods: KeyModifiers,
): KeyAction | null {
  if (mods.repeat) {
    return null;
  }

  const lower = key.toLowerCase();

  if (lower === 'z' && !mods.alt) {
    return { kind: 'undo' };
  }

  if (!isPlain(mods)) {
    return null;
  }

  if (key === 'Escape') {
    return { kind: 'deselect' };
  }

  if (lower === 'r') {
    return { kind: 'restart' };
  }

  const index = TUBE_KEYS[lower];
  return index === undefined ? null : { kind: 'select', index };
}
