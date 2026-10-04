import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PlayerNameConflictError,
  Store,
  probeDataDir,
  type StoreData,
} from '../src/store';

const tempDirs: string[] = [];

/** Creates a fresh temp directory; removed again in `afterEach`. */
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'watersort-store-'));
  tempDirs.push(dir);
  return dir;
}

/** Reads and parses the store file. */
function readData(dataDir: string): StoreData {
  return JSON.parse(readFileSync(join(dataDir, 'data.json'), 'utf8')) as StoreData;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Store', () => {
  it('creates data.json with an empty player list on first open', () => {
    const dataDir = makeTempDir();
    new Store({ dataDir });

    expect(existsSync(join(dataDir, 'data.json'))).toBe(true);
    expect(readData(dataDir)).toEqual({ version: 1, players: [] });
  });

  it('creates a player with the exact shape and persists it', async () => {
    const dataDir = makeTempDir();
    const store = new Store({ dataDir });

    const player = await store.createPlayer({ name: 'Papa', color: 'teal' });

    expect(player.id).toMatch(/^p_[a-z0-9]{5}$/);
    expect(player.name).toBe('Papa');
    expect(player.color).toBe('teal');
    expect(player.level).toBe(1);
    expect(player.stats).toEqual({ solved: 0, moves: 0, undos: 0 });
    expect(Number.isNaN(Date.parse(player.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(player.updatedAt))).toBe(false);

    expect(readData(dataDir).players).toEqual([player]);
    expect(await store.listPlayers()).toEqual([player]);
  });

  it('gives every player a distinct id', async () => {
    const store = new Store({ dataDir: makeTempDir() });
    const players = await Promise.all([
      store.createPlayer({ name: 'A', color: 'rot' }),
      store.createPlayer({ name: 'B', color: 'blau' }),
      store.createPlayer({ name: 'C', color: 'grün' }),
    ]);

    expect(new Set(players.map((player) => player.id)).size).toBe(3);
  });

  it('serializes concurrent creates through the write queue', async () => {
    const dataDir = makeTempDir();
    const store = new Store({ dataDir });

    await Promise.all(
      Array.from({ length: 8 }, (_unused, index) =>
        store.createPlayer({ name: `Spieler ${index}`, color: 'rot' }),
      ),
    );

    const reloaded = new Store({ dataDir });
    expect(await reloaded.listPlayers()).toHaveLength(8);
    expect(readData(dataDir).players).toHaveLength(8);
  });

  it('writes atomically and leaves no tmp file behind', async () => {
    const dataDir = makeTempDir();
    const store = new Store({ dataDir });
    await store.createPlayer({ name: 'Papa', color: 'teal' });

    expect(existsSync(join(dataDir, 'data.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'data.json.tmp'))).toBe(false);
    expect(() => readData(dataDir)).not.toThrow();
  });

  it('rejects a duplicate name regardless of case', async () => {
    const store = new Store({ dataDir: makeTempDir() });
    await store.createPlayer({ name: 'Papa', color: 'teal' });

    await expect(
      store.createPlayer({ name: 'papa', color: 'rot' }),
    ).rejects.toBeInstanceOf(PlayerNameConflictError);
    expect(await store.listPlayers()).toHaveLength(1);
  });

  it('merges progress with max level and added stats', async () => {
    let clock = new Date('2026-01-01T00:00:00Z');
    const store = new Store({
      dataDir: makeTempDir(),
      now: () => {
        clock = new Date(clock.getTime() + 1000);
        return clock;
      },
    });
    const player = await store.createPlayer({ name: 'Papa', color: 'teal' });

    const first = await store.updateProgress(player.id, {
      level: 10,
      statsDelta: { solved: 9, moves: 100, undos: 3 },
    });
    expect(first?.level).toBe(10);
    expect(first?.stats).toEqual({ solved: 9, moves: 100, undos: 3 });

    const second = await store.updateProgress(player.id, {
      level: 4,
      statsDelta: { solved: 1, moves: 10 },
    });
    expect(second?.level).toBe(10);
    expect(second?.stats).toEqual({ solved: 10, moves: 110, undos: 3 });
    expect(second?.updatedAt).not.toBe(first?.updatedAt);
  });

  it('returns undefined when updating an unknown player', async () => {
    const store = new Store({ dataDir: makeTempDir() });
    expect(
      await store.updateProgress('p_zzzzz', {
        level: 2,
        statsDelta: {},
      }),
    ).toBeUndefined();
  });

  it('deletes a player and reports unknown ids', async () => {
    const dataDir = makeTempDir();
    const store = new Store({ dataDir });
    const player = await store.createPlayer({ name: 'Papa', color: 'teal' });

    await expect(store.deletePlayer(player.id)).resolves.toBe(true);
    expect(await store.listPlayers()).toEqual([]);
    await expect(store.deletePlayer(player.id)).resolves.toBe(false);
  });

  it('backs up once on the first write of a new day', async () => {
    const dataDir = makeTempDir();
    let clock = new Date('2026-10-01T10:00:00Z');
    const store = new Store({ dataDir, now: () => clock });

    await store.createPlayer({ name: 'Papa', color: 'teal' });

    clock = new Date('2026-10-02T08:00:00Z');
    await store.createPlayer({ name: 'Mama', color: 'rot' });

    const backup = JSON.parse(
      readFileSync(join(dataDir, 'data.json.bak'), 'utf8'),
    ) as StoreData;
    expect(backup.players).toHaveLength(1);
    expect(backup.players[0]?.name).toBe('Papa');

    // A second write on the same day must not overwrite the backup.
    await store.createPlayer({ name: 'Kind', color: 'blau' });
    const backupAgain = JSON.parse(
      readFileSync(join(dataDir, 'data.json.bak'), 'utf8'),
    ) as StoreData;
    expect(backupAgain.players).toHaveLength(1);
  });
});

describe('probeDataDir', () => {
  it('writes and removes a probe file in a writable directory', () => {
    const dataDir = makeTempDir();
    expect(() => probeDataDir(dataDir)).not.toThrow();
    expect(existsSync(join(dataDir, '.write-probe'))).toBe(false);
  });

  it('throws when the directory cannot be created', () => {
    const parent = makeTempDir();
    const blocker = join(parent, 'blocker');
    writeFileSync(blocker, 'not a directory');
    expect(() => probeDataDir(join(blocker, 'nested'))).toThrow();
  });
});
