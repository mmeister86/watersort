import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { serveStatic } from '@hono/node-server/serve-static';
import { colorName } from '@shared/rules';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';

import {
  PlayerNameConflictError,
  type PlayerStore,
  type StatsDelta,
} from './store';

export type AppEnv = {
  familyCode: string;
  cookieSecret: string;
  /** Absolute path to a built SPA directory; when absent, only the API runs. */
  staticDir?: string;
};

/**
 * Validates the auth env. Returns a human-readable error when a required
 * secret is missing, else `undefined`. The process entry point turns this into
 * a hard exit; keeping it pure makes it testable without exiting.
 */
export function validateAppEnv(env: AppEnv): string | undefined {
  if (env.familyCode === '') {
    return 'FAMILY_CODE must be set and non-empty';
  }
  if (env.cookieSecret === '') {
    return 'COOKIE_SECRET must be set and non-empty';
  }
  return undefined;
}

const COOKIE_NAME = 'ws_session';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** The 14 allowed player colors, derived from the shared palette names. */
const ALLOWED_COLORS: ReadonlySet<string> = new Set(
  Array.from({ length: 14 }, (_unused, index) => colorName(index + 1)),
);

/** Constant-time string comparison that tolerates differing lengths. */
function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}

/**
 * Reads a JSON object body. Returns `undefined` for malformed JSON or any
 * non-object payload so the caller can answer 400.
 */
async function readJsonObject(
  c: Context,
): Promise<Record<string, unknown> | undefined> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/** Trims and validates a player name (1–20 chars). */
function parseName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 20) {
    return undefined;
  }
  return trimmed;
}

/** Validates a color against the shared palette. */
function parseColor(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ALLOWED_COLORS.has(value)) {
    return undefined;
  }
  return value;
}

/** Validates a level: an integer >= 1. */
function parseLevel(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

/** Validates optional non-negative integer stat deltas. */
function parseStatsDelta(value: unknown): StatsDelta | undefined {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const delta: StatsDelta = {};
  for (const key of ['solved', 'moves', 'undos'] as const) {
    const field = record[key];
    if (field === undefined) {
      continue;
    }
    if (typeof field !== 'number' || !Number.isInteger(field) || field < 0) {
      return undefined;
    }
    delta[key] = field;
  }
  return delta;
}

/** Builds the Hono app. Does not listen; callers pass it to a server. */
export function createApp(store: PlayerStore, env: AppEnv): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    console.error('unhandled server error:', error);
    return c.json({ error: 'internal' }, 500);
  });

  // Auth: everything under /api except health and the login route.
  app.use('/api/*', async (c, next) => {
    const isHealth = c.req.path === '/api/health';
    const isSession = c.req.path === '/api/session' && c.req.method === 'POST';
    if (isHealth || isSession) {
      await next();
      return;
    }
    const session = await getSignedCookie(c, env.cookieSecret, COOKIE_NAME);
    if (typeof session !== 'string' || session.length === 0) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.post('/api/session', async (c) => {
    const body = await readJsonObject(c);
    const code = body?.code;
    if (typeof code !== 'string') {
      return c.json({ error: 'invalid' }, 400);
    }
    // Never mint a session from an empty code, even if FAMILY_CODE is unset.
    if (code.length === 0 || !safeEqual(code, env.familyCode)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await setSignedCookie(
      c,
      COOKIE_NAME,
      `session:${Date.now()}`,
      env.cookieSecret,
      {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        maxAge: COOKIE_MAX_AGE_SECONDS,
        path: '/',
      },
    );
    return c.body(null, 204);
  });

  app.get('/api/players', async (c) => c.json(await store.listPlayers()));

  app.post('/api/players', async (c) => {
    const body = await readJsonObject(c);
    if (body === undefined) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const name = parseName(body.name);
    if (name === undefined) {
      return c.json({ error: 'invalid name' }, 400);
    }
    const color = parseColor(body.color);
    if (color === undefined) {
      return c.json({ error: 'invalid color' }, 400);
    }
    try {
      const player = await store.createPlayer({ name, color });
      return c.json(player, 201);
    } catch (error) {
      if (error instanceof PlayerNameConflictError) {
        return c.json({ error: 'name taken' }, 409);
      }
      throw error;
    }
  });

  app.put('/api/players/:id/progress', async (c) => {
    const id = c.req.param('id');
    const body = await readJsonObject(c);
    if (body === undefined) {
      return c.json({ error: 'invalid body' }, 400);
    }
    const level = parseLevel(body.level);
    if (level === undefined) {
      return c.json({ error: 'invalid level' }, 400);
    }
    const statsDelta = parseStatsDelta(body.statsDelta);
    if (statsDelta === undefined) {
      return c.json({ error: 'invalid stats delta' }, 400);
    }

    const existing = (await store.listPlayers()).find((player) => player.id === id);
    if (existing === undefined) {
      return c.json({ error: 'not found' }, 404);
    }
    if (level > existing.level + 100) {
      return c.json({ error: 'level jump too large' }, 400);
    }

    const updated = await store.updateProgress(id, { level, statsDelta });
    if (updated === undefined) {
      return c.json({ error: 'not found' }, 404);
    }
    return c.json(updated);
  });

  app.delete('/api/players/:id', async (c) => {
    const deleted = await store.deletePlayer(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'not found' }, 404);
    }
    return c.body(null, 204);
  });

  const staticDir = env.staticDir;
  if (staticDir !== undefined) {
    app.use('*', serveStatic({ root: staticDir }));
    app.get('*', async (c) => {
      if (c.req.path.startsWith('/api/')) {
        return c.notFound();
      }
      const html = await readFile(join(staticDir, 'index.html'), 'utf8');
      return c.html(html);
    });
  }

  return app;
}
