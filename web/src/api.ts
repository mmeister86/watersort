// Typed fetch wrapper for the `/api` surface plus the concrete session, player
// and progress calls the UI uses.

import type { StatsDelta } from './game/state';

/** Thrown for any non-2xx API response. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Options accepted by {@link apiRequest}. */
export type ApiRequestInit = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (text.length > 0) {
    try {
      const data: unknown = JSON.parse(text);
      if (isRecord(data) && typeof data.error === 'string') {
        return data.error;
      }
    } catch {
      // Non-JSON error body: fall back to the status text below.
    }
  }
  return response.statusText || `HTTP ${response.status}`;
}

/**
 * Performs a JSON request against `/api` with the session cookie attached.
 * Returns the parsed body (or `undefined` for 204) and throws {@link ApiError}
 * on any non-2xx status.
 */
export async function apiRequest<T>(
  path: string,
  init: ApiRequestInit = {},
): Promise<T> {
  const headers = new Headers();
  let body: string | undefined;
  if (init.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.body);
  }

  const response = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers,
    body,
    credentials: 'same-origin',
    signal: init.signal,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const data: unknown = await response.json();
  return data as T;
}

/** Lifetime counters the server keeps per player. */
export type PlayerStats = {
  solved: number;
  moves: number;
  undos: number;
};

/** A player exactly as the server returns it. */
export type Player = {
  id: string;
  name: string;
  color: string;
  level: number;
  stats: PlayerStats;
  createdAt: string;
  updatedAt: string;
};

/** The counters reported when a level is solved (moves/undos are net). */
export type ProgressStatsDelta = StatsDelta;

/** Exchanges the family code for a session cookie (204 on success). */
export function setSession(code: string): Promise<void> {
  return apiRequest<void>('/session', { method: 'POST', body: { code } });
}

/** Lists the family's players. 401 when there is no valid session. */
export function listPlayers(): Promise<Player[]> {
  return apiRequest<Player[]>('/players');
}

/** Creates a player. 409 when the name is already taken. */
export function createPlayer(name: string, color: string): Promise<Player> {
  return apiRequest<Player>('/players', {
    method: 'POST',
    body: { name, color },
  });
}

/** Reports a solved level. Returns the server-merged player. */
export function updateProgress(
  id: string,
  level: number,
  statsDelta: ProgressStatsDelta,
): Promise<Player> {
  return apiRequest<Player>(`/players/${encodeURIComponent(id)}/progress`, {
    method: 'PUT',
    body: { level, statsDelta },
  });
}

/** Deletes a player. */
export function deletePlayer(id: string): Promise<void> {
  return apiRequest<void>(`/players/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
