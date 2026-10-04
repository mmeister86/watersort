// Pure decision logic for the login / boot / player flows.
//
// The controllers and `main.ts` are DOM-bound and not unit-testable in the node
// test environment. They delegate every "what happened?" decision to the
// functions here so the offline, 401 and validation branches get real coverage
// without jsdom.

import { ApiError, type Player } from './api';

/** Progress is stored under a fixed pseudo-id when playing without a session. */
export const LOCAL_PLAYER_ID = 'local';

/**
 * Whether a solve for `playerId` should be queued for server sync. The offline
 * pseudo-player ({@link LOCAL_PLAYER_ID}) exists only in localStorage, so a
 * solve under it must never enqueue — `PUT /api/players/local/progress` would
 * 404 and (before the 404 handling) wedge the whole queue.
 */
export function shouldSyncProgress(playerId: string): boolean {
  return playerId !== LOCAL_PLAYER_ID;
}

/** Why an API call failed, as far as the UI cares. */
export type ApiFailure = 'unauthorized' | 'unreachable';

/**
 * Distinguishes an expired/rejected session (HTTP 401) from a transport or
 * server problem. Anything that is not a 401 ApiError counts as unreachable.
 */
export function classifyApiFailure(error: unknown): ApiFailure {
  return error instanceof ApiError && error.status === 401
    ? 'unauthorized'
    : 'unreachable';
}

/** What the app should show after probing the session at startup. */
export type BootOutcome =
  | { kind: 'session'; players: Player[] }
  | { kind: 'no-session' }
  | { kind: 'unreachable' };

/**
 * Probes the session by listing players. A 401 means no session (show the code
 * gate); any other failure means the server is unreachable (offer offline play).
 */
export async function resolveBoot(
  listPlayers: () => Promise<Player[]>,
): Promise<BootOutcome> {
  try {
    return { kind: 'session', players: await listPlayers() };
  } catch (error: unknown) {
    return classifyApiFailure(error) === 'unauthorized'
      ? { kind: 'no-session' }
      : { kind: 'unreachable' };
  }
}

/** The result of submitting the family code. */
export type LoginOutcome =
  | { kind: 'ok' }
  | { kind: 'wrong-code' }
  | { kind: 'unreachable' };

/** Submits a family code and turns any failure into a UI decision. */
export async function performLogin(
  code: string,
  login: (code: string) => Promise<void>,
): Promise<LoginOutcome> {
  try {
    await login(code);
    return { kind: 'ok' };
  } catch (error: unknown) {
    return classifyApiFailure(error) === 'unauthorized'
      ? { kind: 'wrong-code' }
      : { kind: 'unreachable' };
  }
}

/** Trims and validates a player name: 1–20 characters, else null. */
export function validatePlayerName(raw: string): string | null {
  const name = raw.trim();
  return name.length >= 1 && name.length <= 20 ? name : null;
}

/** The result of creating a player, mapped to the form message to show. */
export type CreatePlayerOutcome =
  | { kind: 'ok' }
  | { kind: 'invalid-name' }
  | { kind: 'name-taken' }
  | { kind: 'invalid' }
  | { kind: 'failed' };

/** Validates the name locally, then maps server errors to an outcome. */
export async function performCreatePlayer(
  rawName: string,
  color: string,
  create: (name: string, color: string) => Promise<unknown>,
): Promise<CreatePlayerOutcome> {
  const name = validatePlayerName(rawName);
  if (name === null) {
    return { kind: 'invalid-name' };
  }
  try {
    await create(name, color);
    return { kind: 'ok' };
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 409) {
      return { kind: 'name-taken' };
    }
    if (error instanceof ApiError && error.status === 400) {
      return { kind: 'invalid' };
    }
    return { kind: 'failed' };
  }
}

/** The result of deleting a player. */
export type DeletePlayerOutcome = 'deleted' | 'already-gone' | 'failed';

/**
 * Deletes a player and clears their local state. A 404 counts as success: the
 * player is gone on the server, so the local copy should go too. Any other
 * failure leaves local state untouched.
 */
export async function performDeletePlayer(
  id: string,
  remove: (id: string) => Promise<void>,
  removeLocal: (id: string) => void,
): Promise<DeletePlayerOutcome> {
  try {
    await remove(id);
    removeLocal(id);
    return 'deleted';
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 404) {
      removeLocal(id);
      return 'already-gone';
    }
    return 'failed';
  }
}
