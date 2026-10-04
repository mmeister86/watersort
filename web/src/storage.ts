// Typed localStorage wrapper for the Water Sort client.
//
// All keys are namespaced with `STORAGE_PREFIX`. Reads are defensive: corrupt
// JSON or a malformed shape drops just that key and returns the default, so a
// single bad entry can never brick the app. Writes are intentionally not
// caught — a quota error propagates to the caller.

import { GENERATOR_VERSION } from '@shared/generator';
import type { Board, Move } from '@shared/rules';

import type { StatsDelta } from './game/state';

/** Namespace for every storage key owned by the app. */
export const STORAGE_PREFIX = 'watersort.';

const KEYS = {
  activePlayer: `${STORAGE_PREFIX}activePlayer`,
  player: (id: string): string => `${STORAGE_PREFIX}player:${id}`,
  pendingSync: `${STORAGE_PREFIX}pendingSync`,
  settings: `${STORAGE_PREFIX}settings`,
} as const;

/** The saved progress of one player. `version` is the generator version. */
export type PlayerProgress = {
  level: number;
  board?: Board;
  moves?: number;
  history?: Move[];
  version: number;
};

/** What callers write; the wrapper stamps the current generator version. */
export type PlayerProgressInput = Omit<PlayerProgress, 'version'>;

/** One queued progress update waiting for a reachable server. */
export type PendingSyncEntry = {
  playerId: string;
  level: number;
  statsDelta: StatsDelta;
};

/** User preferences. */
export type Settings = {
  colorBlind: boolean;
};

/** The subset of the Storage API this wrapper needs. */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** The typed storage facade consumed by the UI and sync layers. */
export type AppStorage = {
  getActivePlayer(): string | null;
  setActivePlayer(id: string): void;
  clearActivePlayer(): void;
  getPlayerProgress(id: string): PlayerProgress | null;
  setPlayerProgress(id: string, progress: PlayerProgressInput): void;
  getPendingSync(): PendingSyncEntry[];
  setPendingSync(entries: PendingSyncEntry[]): void;
  getSettings(): Settings;
  setSettings(settings: Settings): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoard(value: unknown): value is Board {
  return (
    Array.isArray(value) &&
    value.every(
      (tube) =>
        Array.isArray(tube) && tube.every((unit) => typeof unit === 'number'),
    )
  );
}

function isMoveArray(value: unknown): value is Move[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.from === 'number' &&
        typeof entry.to === 'number',
    )
  );
}

function isStatsDelta(value: unknown): value is StatsDelta {
  return (
    isRecord(value) &&
    typeof value.solved === 'number' &&
    typeof value.moves === 'number' &&
    typeof value.undos === 'number'
  );
}

function isPendingSyncEntry(value: unknown): value is PendingSyncEntry {
  return (
    isRecord(value) &&
    typeof value.playerId === 'string' &&
    typeof value.level === 'number' &&
    isStatsDelta(value.statsDelta)
  );
}

function isPendingSync(value: unknown): value is PendingSyncEntry[] {
  return Array.isArray(value) && value.every(isPendingSyncEntry);
}

function isSettings(value: unknown): value is Settings {
  return isRecord(value) && typeof value.colorBlind === 'boolean';
}

/**
 * Reads and JSON-parses a key. A parse error or a value that fails `guard`
 * removes the offending key and returns null; a missing key returns null
 * without touching storage.
 */
function readJson<T>(
  storage: StorageLike,
  key: string,
  guard: (value: unknown) => value is T,
): T | null {
  const raw = storage.getItem(key);
  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    storage.removeItem(key);
    return null;
  }

  if (guard(parsed)) {
    return parsed;
  }
  storage.removeItem(key);
  return null;
}

/**
 * A progress record is valid when `level` and `version` are numbers and any
 * optional in-progress fields have the right shape.
 */
function isStoredProgress(value: unknown): value is PlayerProgress {
  if (!isRecord(value)) return false;
  if (typeof value.level !== 'number' || typeof value.version !== 'number') {
    return false;
  }
  if (value.board !== undefined && !isBoard(value.board)) return false;
  if (value.moves !== undefined && typeof value.moves !== 'number') return false;
  if (value.history !== undefined && !isMoveArray(value.history)) return false;
  return true;
}

/** Creates the typed storage facade around `storage`. */
export function createStorage(
  storage: StorageLike = globalThis.localStorage,
): AppStorage {
  return {
    getActivePlayer(): string | null {
      return storage.getItem(KEYS.activePlayer);
    },

    setActivePlayer(id: string): void {
      storage.setItem(KEYS.activePlayer, id);
    },

    clearActivePlayer(): void {
      storage.removeItem(KEYS.activePlayer);
    },

    getPlayerProgress(id: string): PlayerProgress | null {
      const stored = readJson(storage, KEYS.player(id), isStoredProgress);
      if (stored === null) {
        return null;
      }
      if (stored.version !== GENERATOR_VERSION) {
        // The generated board no longer matches: keep the level, drop the
        // in-progress state so the client regenerates from scratch.
        return { level: stored.level, version: GENERATOR_VERSION };
      }
      return stored;
    },

    setPlayerProgress(id: string, progress: PlayerProgressInput): void {
      const stored: PlayerProgress = {
        ...progress,
        version: GENERATOR_VERSION,
      };
      storage.setItem(KEYS.player(id), JSON.stringify(stored));
    },

    getPendingSync(): PendingSyncEntry[] {
      return readJson(storage, KEYS.pendingSync, isPendingSync) ?? [];
    },

    setPendingSync(entries: PendingSyncEntry[]): void {
      storage.setItem(KEYS.pendingSync, JSON.stringify(entries));
    },

    getSettings(): Settings {
      return readJson(storage, KEYS.settings, isSettings) ?? { colorBlind: false };
    },

    setSettings(settings: Settings): void {
      storage.setItem(KEYS.settings, JSON.stringify(settings));
    },
  };
}
