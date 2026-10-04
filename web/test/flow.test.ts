import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  createPlayer,
  deletePlayer,
  listPlayers,
  setSession,
  type Player,
} from '../src/api';
import {
  classifyApiFailure,
  LOCAL_PLAYER_ID,
  performCreatePlayer,
  performDeletePlayer,
  performLogin,
  resolveBoot,
  shouldSyncProgress,
  validatePlayerName,
} from '../src/flow';

const PLAYER: Player = {
  id: 'p1',
  name: 'Papa',
  color: 'rot',
  level: 1,
  stats: { solved: 0, moves: 0, undos: 0 },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Replaces the global fetch with `handler` for one test. */
function stubFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
): void {
  vi.stubGlobal('fetch', vi.fn(handler));
}

function stubTransportFailure(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('classifyApiFailure', () => {
  it('separates a 401 from every other failure', () => {
    expect(classifyApiFailure(new ApiError(401, 'nope'))).toBe('unauthorized');
    expect(classifyApiFailure(new ApiError(500, 'boom'))).toBe('unreachable');
    expect(classifyApiFailure(new TypeError('Failed to fetch'))).toBe(
      'unreachable',
    );
    expect(classifyApiFailure(new Error('x'))).toBe('unreachable');
  });
});

describe('shouldSyncProgress', () => {
  it('never syncs the offline pseudo-player', () => {
    expect(shouldSyncProgress(LOCAL_PLAYER_ID)).toBe(false);
  });

  it('syncs every real player, including one named like the pseudo-id only in part', () => {
    expect(shouldSyncProgress('p_k3x9')).toBe(true);
    expect(shouldSyncProgress('local-two')).toBe(true);
  });
});

describe('resolveBoot', () => {
  it('returns the players for a valid session', async () => {
    stubFetch(() => jsonResponse([PLAYER]));
    expect(await resolveBoot(listPlayers)).toEqual({
      kind: 'session',
      players: [PLAYER],
    });
  });

  it('treats a 401 as no session', async () => {
    stubFetch(() => jsonResponse({ error: 'unauthorized' }, 401));
    expect(await resolveBoot(listPlayers)).toEqual({ kind: 'no-session' });
  });

  it('treats a transport error as unreachable', async () => {
    stubTransportFailure();
    expect(await resolveBoot(listPlayers)).toEqual({ kind: 'unreachable' });
  });

  it('treats a 500 as unreachable', async () => {
    stubFetch(() => jsonResponse({ error: 'internal' }, 500));
    expect(await resolveBoot(listPlayers)).toEqual({ kind: 'unreachable' });
  });
});

describe('performLogin', () => {
  it('succeeds on 204', async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    expect(await performLogin('dev', setSession)).toEqual({ kind: 'ok' });
  });

  it('reports a wrong code for 401', async () => {
    stubFetch(() => jsonResponse({ error: 'unauthorized' }, 401));
    expect(await performLogin('nope', setSession)).toEqual({
      kind: 'wrong-code',
    });
  });

  it('reports unreachable for a transport error', async () => {
    stubTransportFailure();
    expect(await performLogin('dev', setSession)).toEqual({
      kind: 'unreachable',
    });
  });
});

describe('validatePlayerName', () => {
  it('trims and accepts 1–20 characters', () => {
    expect(validatePlayerName('  Papa ')).toBe('Papa');
    expect(validatePlayerName('x'.repeat(20))).toBe('x'.repeat(20));
  });

  it('rejects empty, whitespace-only and over-long names', () => {
    expect(validatePlayerName('')).toBeNull();
    expect(validatePlayerName('   ')).toBeNull();
    expect(validatePlayerName('x'.repeat(21))).toBeNull();
  });
});

describe('performCreatePlayer', () => {
  it('creates with the trimmed name and chosen color', async () => {
    const calls: Array<[string, string]> = [];
    const outcome = await performCreatePlayer(
      '  Mama ',
      'pink',
      async (name, color) => {
        calls.push([name, color]);
      },
    );

    expect(outcome).toEqual({ kind: 'ok' });
    expect(calls).toEqual([['Mama', 'pink']]);
  });

  it('rejects a blank name without calling the server', async () => {
    const create = vi.fn(async () => undefined);
    const outcome = await performCreatePlayer('   ', 'pink', create);

    expect(outcome).toEqual({ kind: 'invalid-name' });
    expect(create).not.toHaveBeenCalled();
  });

  it('maps 409 to name-taken', async () => {
    stubFetch(() => jsonResponse({ error: 'name taken' }, 409));
    expect(await performCreatePlayer('Papa', 'rot', createPlayer)).toEqual({
      kind: 'name-taken',
    });
  });

  it('maps 400 to invalid', async () => {
    stubFetch(() => jsonResponse({ error: 'invalid' }, 400));
    expect(await performCreatePlayer('Papa', 'rot', createPlayer)).toEqual({
      kind: 'invalid',
    });
  });

  it('maps a transport error to failed', async () => {
    stubTransportFailure();
    expect(await performCreatePlayer('Papa', 'rot', createPlayer)).toEqual({
      kind: 'failed',
    });
  });
});

describe('performDeletePlayer', () => {
  it('removes local state after a successful delete', async () => {
    const removed: string[] = [];
    const outcome = await performDeletePlayer(
      'p1',
      async () => undefined,
      (id) => {
        removed.push(id);
      },
    );

    expect(outcome).toBe('deleted');
    expect(removed).toEqual(['p1']);
  });

  it('treats a 404 as already gone and still cleans up locally', async () => {
    stubFetch(() => jsonResponse({ error: 'not found' }, 404));
    const removed: string[] = [];
    const outcome = await performDeletePlayer('p1', deletePlayer, (id) => {
      removed.push(id);
    });

    expect(outcome).toBe('already-gone');
    expect(removed).toEqual(['p1']);
  });

  it('leaves local state untouched when deletion fails', async () => {
    stubFetch(() => jsonResponse({ error: 'internal' }, 500));
    const removeLocal = vi.fn();
    const outcome = await performDeletePlayer('p1', deletePlayer, removeLocal);

    expect(outcome).toBe('failed');
    expect(removeLocal).not.toHaveBeenCalled();
  });
});
