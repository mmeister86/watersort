import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateSignedCookie } from 'hono/cookie';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { Store, type Player, type PlayerStore } from '../src/store';

const SECRET = 'secret123';
const FAMILY_CODE = 'test';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'watersort-api-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

type Setup = {
  app: ReturnType<typeof createApp>;
  store: Store;
  dataDir: string;
  cookie: string;
};

/** Builds a session cookie pair for a request, signed with the same secret. */
async function forgeCookie(secret: string): Promise<string> {
  const setCookie = await generateSignedCookie('ws_session', 'signed', secret, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });
  const pair = setCookie.split(';')[0];
  if (pair === undefined) {
    throw new Error('could not forge session cookie');
  }
  return pair;
}

function setup(options: { staticDir?: string } = {}): Setup {
  const dataDir = makeTempDir();
  const store = new Store({ dataDir });
  const app = createApp(store, {
    familyCode: FAMILY_CODE,
    cookieSecret: SECRET,
    ...(options.staticDir === undefined ? {} : { staticDir: options.staticDir }),
  });
  return { app, store, dataDir, cookie: '' };
}

/** Performs a JSON request with an optional session cookie. */
async function jsonRequest(
  setupResult: Setup,
  path: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  const cookie = await forgeCookie(SECRET);
  return setupResult.app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('health and session', () => {
  it('serves /api/health without auth', async () => {
    const { app } = setup();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects a wrong family code', async () => {
    const { app } = setup();
    const res = await app.request('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'nope' }),
    });
    expect(res.status).toBe(401);
  });

  it('sets a long-lived signed cookie for the right code', async () => {
    const { app } = setup();
    const res = await app.request('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: FAMILY_CODE }),
    });
    expect(res.status).toBe(204);

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('ws_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=31536000');

    const parsed = await app.request('/api/players', {
      headers: { cookie: setCookie.split(';')[0] ?? '' },
    });
    expect(parsed.status).toBe(200);
  });

  it('rejects a malformed session body', async () => {
    const { app } = setup();
    const res = await app.request('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('auth middleware', () => {
  const protectedRoutes: ReadonlyArray<[string, string]> = [
    ['GET', '/api/players'],
    ['POST', '/api/players'],
    ['PUT', '/api/players/p_abcde/progress'],
    ['DELETE', '/api/players/p_abcde'],
  ];

  it.each(protectedRoutes)('401s %s %s without a cookie', async (method, path) => {
    const { app } = setup();
    const res = await app.request(path, { method });
    expect(res.status).toBe(401);
  });

  it('401s a cookie signed with the wrong secret', async () => {
    const { app } = setup();
    const wrong = await forgeCookie('a completely different secret');
    const res = await app.request('/api/players', { headers: { cookie: wrong } });
    expect(res.status).toBe(401);
  });
});

describe('players', () => {
  it('lists players when authenticated', async () => {
    const ctx = setup();
    const res = await jsonRequest(ctx, '/api/players', 'GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('creates a player', async () => {
    const ctx = setup();
    const res = await jsonRequest(ctx, '/api/players', 'POST', {
      name: 'Papa',
      color: 'türkis',
    });
    expect(res.status).toBe(201);
    const player = (await res.json()) as Player;
    expect(player.id).toMatch(/^p_/);
    expect(player.name).toBe('Papa');
    expect(player.color).toBe('türkis');
    expect(player.level).toBe(1);
  });

  it('accepts every one of the 14 German color names', async () => {
    const ctx = setup();
    const names = [
      'rot', 'blau', 'grün', 'gelb', 'orange', 'violett', 'pink', 'türkis',
      'braun', 'hellblau', 'dunkelgrün', 'grau', 'schwarz', 'weiß',
    ];
    for (const [index, color] of names.entries()) {
      const res = await jsonRequest(ctx, '/api/players', 'POST', {
        name: `Spieler ${index}`,
        color,
      });
      expect(res.status, `color ${color}`).toBe(201);
    }
  });

  it('409s a duplicate name ignoring case', async () => {
    const ctx = setup();
    await jsonRequest(ctx, '/api/players', 'POST', { name: 'Papa', color: 'türkis' });
    const res = await jsonRequest(ctx, '/api/players', 'POST', {
      name: 'papa',
      color: 'rot',
    });
    expect(res.status).toBe(409);
  });

  it('400s invalid names and colors', async () => {
    const ctx = setup();
    const invalidNames = ['', '   ', 'x'.repeat(21), 42];
    for (const name of invalidNames) {
      const res = await jsonRequest(ctx, '/api/players', 'POST', { name, color: 'türkis' });
      expect(res.status, `name ${JSON.stringify(name)}`).toBe(400);
    }
    for (const color of ['', 'TEAL', 'not-a-color']) {
      const res = await jsonRequest(ctx, '/api/players', 'POST', {
        name: 'Papa',
        color,
      });
      expect(res.status, `color ${color}`).toBe(400);
    }
  });

  it('trims the name before storing it', async () => {
    const ctx = setup();
    const res = await jsonRequest(ctx, '/api/players', 'POST', {
      name: '  Papa  ',
      color: 'türkis',
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Player).name).toBe('Papa');
  });
});

describe('progress', () => {
  async function createPlayer(ctx: Setup): Promise<Player> {
    const res = await jsonRequest(ctx, '/api/players', 'POST', {
      name: 'Papa',
      color: 'türkis',
    });
    return (await res.json()) as Player;
  }

  it('merges level with max and adds stats', async () => {
    const ctx = setup();
    const player = await createPlayer(ctx);

    const first = await jsonRequest(
      ctx,
      `/api/players/${player.id}/progress`,
      'PUT',
      { level: 10, statsDelta: { solved: 9, moves: 100, undos: 3 } },
    );
    expect(first.status).toBe(200);

    const second = await jsonRequest(
      ctx,
      `/api/players/${player.id}/progress`,
      'PUT',
      { level: 4, statsDelta: { solved: 1, moves: 10 } },
    );
    expect(second.status).toBe(200);
    const merged = (await second.json()) as Player;
    expect(merged.level).toBe(10);
    expect(merged.stats).toEqual({ solved: 10, moves: 110, undos: 3 });
  });

  it('rejects a level jump greater than +100', async () => {
    const ctx = setup();
    const player = await createPlayer(ctx);
    const res = await jsonRequest(
      ctx,
      `/api/players/${player.id}/progress`,
      'PUT',
      { level: 300, statsDelta: {} },
    );
    expect(res.status).toBe(400);

    const allowed = await jsonRequest(
      ctx,
      `/api/players/${player.id}/progress`,
      'PUT',
      { level: 101, statsDelta: {} },
    );
    expect(allowed.status).toBe(200);
  });

  it('400s invalid levels and stats deltas', async () => {
    const ctx = setup();
    const player = await createPlayer(ctx);

    const badBodies: unknown[] = [
      { level: 0, statsDelta: {} },
      { level: 1.5, statsDelta: {} },
      { level: '3', statsDelta: {} },
      { level: 2, statsDelta: { solved: -1 } },
      { level: 2, statsDelta: { moves: 1.5 } },
      { level: 2, statsDelta: { undos: 'x' } },
    ];
    for (const body of badBodies) {
      const res = await jsonRequest(
        ctx,
        `/api/players/${player.id}/progress`,
        'PUT',
        body,
      );
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('404s an unknown player', async () => {
    const ctx = setup();
    const res = await jsonRequest(ctx, '/api/players/p_zzzzz/progress', 'PUT', {
      level: 2,
      statsDelta: {},
    });
    expect(res.status).toBe(404);
  });
});

describe('delete', () => {
  it('deletes and then 404s', async () => {
    const ctx = setup();
    const created = await jsonRequest(ctx, '/api/players', 'POST', {
      name: 'Papa',
      color: 'türkis',
    });
    const player = (await created.json()) as Player;

    const res = await jsonRequest(ctx, `/api/players/${player.id}`, 'DELETE');
    expect(res.status).toBe(204);

    const again = await jsonRequest(ctx, `/api/players/${player.id}`, 'DELETE');
    expect(again.status).toBe(404);
  });
});

describe('errors', () => {
  it('returns 500 { error: "internal" } when the store throws', async () => {
    const failing: PlayerStore = {
      listPlayers: async () => {
        throw new Error('boom');
      },
      createPlayer: async () => {
        throw new Error('boom');
      },
      updateProgress: async () => {
        throw new Error('boom');
      },
      deletePlayer: async () => {
        throw new Error('boom');
      },
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp(failing, {
      familyCode: FAMILY_CODE,
      cookieSecret: SECRET,
    });

    const res = await app.request('/api/players', {
      headers: { cookie: await forgeCookie(SECRET) },
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal' });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('400s malformed JSON', async () => {
    const ctx = setup();
    const res = await ctx.app.request('/api/players', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: await forgeCookie(SECRET),
      },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('static files', () => {
  it('serves the SPA index and falls back for unknown routes', async () => {
    const staticDir = makeTempDir();
    mkdirSync(join(staticDir, 'assets'), { recursive: true });
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Water Sort</title>');
    writeFileSync(join(staticDir, 'assets', 'app.js'), 'console.log(1)');

    const { app } = setup({ staticDir });

    const index = await app.request('/');
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('Water Sort');

    const asset = await app.request('/assets/app.js');
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain('console.log');

    const fallback = await app.request('/some/client/route');
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).toContain('Water Sort');

    const apiMiss = await app.request('/api/unknown', {
      headers: { cookie: await forgeCookie(SECRET) },
    });
    expect(apiMiss.status).toBe(404);
  });
});
