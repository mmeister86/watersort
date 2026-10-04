import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createStorage,
  type AppStorage,
  type PendingSyncEntry,
  type StorageLike,
} from '../src/storage';
import { enqueueProgress, flushPendingSync, mergeLevel } from '../src/sync';

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

function makeStorage(entries: PendingSyncEntry[] = []): AppStorage {
  const storage = createStorage(new MemoryStorage());
  storage.setPendingSync(entries);
  return storage;
}

function entry(playerId: string, level: number): PendingSyncEntry {
  return { playerId, level, statsDelta: { solved: 1, moves: 10, undos: 1 } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fetch stub that records calls and answers with a merged player. */
function recordFetch(
  calls: string[],
  fail?: (url: string) => boolean,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (fail?.(url) === true) {
      return jsonResponse({ error: 'boom' }, 500);
    }
    const body = init?.body;
    const parsed: unknown =
      typeof body === 'string' ? JSON.parse(body) : undefined;
    const level =
      typeof parsed === 'object' &&
      parsed !== null &&
      'level' in parsed &&
      typeof (parsed as { level: unknown }).level === 'number'
        ? (parsed as { level: number }).level
        : 1;
    return jsonResponse({ id: 'p_x', level });
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mergeLevel', () => {
  it('keeps the larger of the local and server level', () => {
    expect(mergeLevel(3, 5)).toBe(5);
    expect(mergeLevel(7, 2)).toBe(7);
    expect(mergeLevel(4, 4)).toBe(4);
  });

  it('treats a missing level as 1', () => {
    expect(mergeLevel(0, 1)).toBe(1);
  });
});

describe('enqueueProgress', () => {
  it('appends in order and preserves earlier entries', () => {
    const storage = makeStorage([entry('p1', 2)]);

    enqueueProgress(storage, entry('p2', 3));
    enqueueProgress(storage, entry('p1', 4));

    expect(storage.getPendingSync()).toEqual([
      entry('p1', 2),
      entry('p2', 3),
      entry('p1', 4),
    ]);
  });
});

describe('flushPendingSync', () => {
  it('sends every entry in order and clears the queue', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', recordFetch(calls));
    const storage = makeStorage([
      entry('p1', 3),
      entry('p2', 4),
      entry('p1', 5),
    ]);

    const result = await flushPendingSync(storage);

    expect(result).toEqual({ sent: 3, dropped: 0, remaining: 0 });
    expect(calls).toEqual([
      'PUT /api/players/p1/progress',
      'PUT /api/players/p2/progress',
      'PUT /api/players/p1/progress',
    ]);
    expect(storage.getPendingSync()).toEqual([]);
  });

  it('stops at the first failure and retains it and everything after it', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      recordFetch(calls, (url) => url.includes('/p3/')),
    );
    const storage = makeStorage([
      entry('p1', 2),
      entry('p2', 3),
      entry('p3', 4),
      entry('p4', 5),
    ]);

    const result = await flushPendingSync(storage);

    expect(result).toEqual({ sent: 2, dropped: 0, remaining: 2 });
    expect(calls).toEqual([
      'PUT /api/players/p1/progress',
      'PUT /api/players/p2/progress',
      'PUT /api/players/p3/progress',
    ]);
    expect(storage.getPendingSync()).toEqual([entry('p3', 4), entry('p4', 5)]);
  });

  it('skips the network entirely when offline and keeps the queue', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const queued = [entry('p1', 2), entry('p2', 3)];
    const storage = makeStorage(queued);

    const result = await flushPendingSync(storage, undefined, { online: false });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, dropped: 0, remaining: 2 });
    expect(storage.getPendingSync()).toEqual(queued);
  });

  it('drops entries the server has already passed', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', recordFetch(calls));
    const storage = makeStorage([entry('p1', 3), entry('p2', 4)]);

    const result = await flushPendingSync(storage, undefined, {
      serverLevels: new Map([['p1', 3]]),
    });

    expect(result).toEqual({ sent: 1, dropped: 1, remaining: 0 });
    expect(calls).toEqual(['PUT /api/players/p2/progress']);
    expect(storage.getPendingSync()).toEqual([]);
  });

  it('drops later entries once a successful send confirms the level', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', recordFetch(calls));
    const storage = makeStorage([entry('p1', 5), entry('p1', 5)]);

    const result = await flushPendingSync(storage);

    expect(result).toEqual({ sent: 1, dropped: 1, remaining: 0 });
    expect(calls).toEqual(['PUT /api/players/p1/progress']);
    expect(storage.getPendingSync()).toEqual([]);
  });

  it('does nothing for an empty queue', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await flushPendingSync(makeStorage());

    expect(result).toEqual({ sent: 0, dropped: 0, remaining: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
