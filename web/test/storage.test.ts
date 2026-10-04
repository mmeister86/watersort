import { describe, expect, it } from 'vitest';

import { GENERATOR_VERSION } from '@shared/generator';

import {
  STORAGE_PREFIX,
  createStorage,
  type StorageLike,
} from '../src/storage';

/** Minimal in-memory localStorage stand-in for the node test environment. */
class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

describe('active player', () => {
  it('round-trips a player id under the namespaced key', () => {
    const backing = new MemoryStorage();
    const storage = createStorage(backing);

    expect(storage.getActivePlayer()).toBeNull();

    storage.setActivePlayer('p_k3x9');
    expect(storage.getActivePlayer()).toBe('p_k3x9');
    expect(backing.data.get(`${STORAGE_PREFIX}activePlayer`)).toBe('p_k3x9');

    storage.clearActivePlayer();
    expect(storage.getActivePlayer()).toBeNull();
  });
});

describe('player progress', () => {
  it('round-trips level, board, moves and history and stamps the version', () => {
    const storage = createStorage(new MemoryStorage());

    storage.setPlayerProgress('p1', {
      level: 5,
      board: [
        [1, 2],
        [2],
        [],
      ],
      moves: 3,
      history: [{ from: 0, to: 2 }],
    });

    expect(storage.getPlayerProgress('p1')).toEqual({
      level: 5,
      board: [
        [1, 2],
        [2],
        [],
      ],
      moves: 3,
      history: [{ from: 0, to: 2 }],
      version: GENERATOR_VERSION,
    });
  });

  it('returns null when no progress is stored', () => {
    const storage = createStorage(new MemoryStorage());
    expect(storage.getPlayerProgress('missing')).toBeNull();
  });

  it('discards an in-progress board from a different generator version but keeps the level', () => {
    const backing = new MemoryStorage();
    const storage = createStorage(backing);
    backing.data.set(
      `${STORAGE_PREFIX}player:p1`,
      JSON.stringify({
        level: 7,
        board: [
          [1, 2],
          [2],
          [],
        ],
        moves: 4,
        history: [{ from: 0, to: 2 }],
        version: GENERATOR_VERSION + 1,
      }),
    );

    expect(storage.getPlayerProgress('p1')).toEqual({
      level: 7,
      version: GENERATOR_VERSION,
    });
  });

  it('drops a corrupt progress entry and reports no progress', () => {
    const backing = new MemoryStorage();
    const storage = createStorage(backing);
    backing.data.set(`${STORAGE_PREFIX}player:p1`, '{not json');

    expect(storage.getPlayerProgress('p1')).toBeNull();
    expect(backing.data.has(`${STORAGE_PREFIX}player:p1`)).toBe(false);
  });
});

describe('pending sync', () => {
  it('defaults to an empty list', () => {
    const storage = createStorage(new MemoryStorage());
    expect(storage.getPendingSync()).toEqual([]);
  });

  it('round-trips queued entries', () => {
    const storage = createStorage(new MemoryStorage());
    const entries = [
      {
        playerId: 'p1',
        level: 3,
        statsDelta: { solved: 1, moves: 12, undos: 2 },
      },
      {
        playerId: 'p2',
        level: 8,
        statsDelta: { solved: 1, moves: 20, undos: 0 },
      },
    ];

    storage.setPendingSync(entries);

    expect(storage.getPendingSync()).toEqual(entries);
  });

  it('drops a corrupt queue and backfills an empty list', () => {
    const backing = new MemoryStorage();
    const storage = createStorage(backing);
    backing.data.set(`${STORAGE_PREFIX}pendingSync`, 'not json at all');

    expect(storage.getPendingSync()).toEqual([]);
    expect(backing.data.has(`${STORAGE_PREFIX}pendingSync`)).toBe(false);
  });
});

describe('removePlayer', () => {
  it('removes progress, queued entries and the active marker', () => {
    const backing = new MemoryStorage();
    const storage = createStorage(backing);
    storage.setActivePlayer('p1');
    storage.setPlayerProgress('p1', { level: 3 });
    storage.setPlayerProgress('p2', { level: 5 });
    storage.setPendingSync([
      { playerId: 'p1', level: 4, statsDelta: { solved: 1, moves: 1, undos: 0 } },
      { playerId: 'p2', level: 6, statsDelta: { solved: 1, moves: 1, undos: 0 } },
    ]);

    storage.removePlayer('p1');

    expect(storage.getPlayerProgress('p1')).toBeNull();
    expect(storage.getActivePlayer()).toBeNull();
    expect(storage.getPlayerProgress('p2')).toEqual({
      level: 5,
      version: GENERATOR_VERSION,
    });
    expect(storage.getPendingSync()).toEqual([
      { playerId: 'p2', level: 6, statsDelta: { solved: 1, moves: 1, undos: 0 } },
    ]);
  });

  it('leaves the active marker alone when another player is active', () => {
    const storage = createStorage(new MemoryStorage());
    storage.setActivePlayer('p2');
    storage.removePlayer('p1');
    expect(storage.getActivePlayer()).toBe('p2');
  });
});

describe('settings', () => {
  it('defaults to colorBlind disabled', () => {
    const storage = createStorage(new MemoryStorage());
    expect(storage.getSettings()).toEqual({ colorBlind: false });
  });

  it('round-trips settings', () => {
    const storage = createStorage(new MemoryStorage());
    storage.setSettings({ colorBlind: true });
    expect(storage.getSettings()).toEqual({ colorBlind: true });
  });

  it('drops corrupt settings and falls back to the default', () => {
    const backing = new MemoryStorage();
    const storage = createStorage(backing);
    backing.data.set(`${STORAGE_PREFIX}settings`, '{{{');

    expect(storage.getSettings()).toEqual({ colorBlind: false });
    expect(backing.data.has(`${STORAGE_PREFIX}settings`)).toBe(false);
  });
});

describe('write failures', () => {
  it('surfaces quota errors instead of swallowing them', () => {
    const quotaStorage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => undefined,
    };
    const storage = createStorage(quotaStorage);

    expect(() => storage.setActivePlayer('p1')).toThrow('quota exceeded');
  });
});
