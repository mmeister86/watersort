// Client-side progress sync queue.
//
// A solved level is reported to `PUT /api/players/:id/progress`. When that call
// fails (offline, server down, expired session) the update is appended to
// `watersort.pendingSync` and retried on the `online` event and on app start.
// The queue is flushed strictly in order: the first failure stops the flush so
// later updates for the same player are never applied out of order.
//
// The queue operations are injected with the sender and the storage, so the
// tests can drive them with a fetch stub and an in-memory storage.

import { updateProgress } from './api';
import type { AppStorage, PendingSyncEntry } from './storage';

/** Sends one queued update; resolves with the server-merged player level. */
export type ProgressSender = (
  entry: PendingSyncEntry,
) => Promise<{ level: number }>;

/** Default sender: the real progress endpoint. */
export function sendProgress(entry: PendingSyncEntry): Promise<{ level: number }> {
  return updateProgress(entry.playerId, entry.level, entry.statsDelta);
}

/** The level to display: the higher of the local and the server level. */
export function mergeLevel(local: number, server: number): number {
  return Math.max(local, server);
}

/** Appends one update to the durable queue, preserving order. */
export function enqueueProgress(
  storage: AppStorage,
  entry: PendingSyncEntry,
): void {
  const queue = storage.getPendingSync();
  queue.push(entry);
  storage.setPendingSync(queue);
}

export type FlushOptions = {
  /** When false, skip the network entirely and keep the queue untouched. */
  online?: boolean;
  /**
   * Server-confirmed levels per player, e.g. from a fresh `GET /players`.
   * Entries at or below a player's confirmed level are redundant and dropped.
   */
  serverLevels?: ReadonlyMap<string, number>;
};

export type FlushResult = {
  sent: number;
  dropped: number;
  remaining: number;
};

/**
 * Flushes the queue in order. A successful send records the returned level and
 * lets later redundant entries for that player be dropped; a failed send
 * retains that entry and every entry after it and ends the flush.
 */
export async function flushPendingSync(
  storage: AppStorage,
  send: ProgressSender = sendProgress,
  options: FlushOptions = {},
): Promise<FlushResult> {
  const entries = storage.getPendingSync();
  if (entries.length === 0) {
    return { sent: 0, dropped: 0, remaining: 0 };
  }
  if (options.online === false) {
    return { sent: 0, dropped: 0, remaining: entries.length };
  }

  const confirmed = new Map(options.serverLevels ?? []);
  const remaining: PendingSyncEntry[] = [];
  let sent = 0;
  let dropped = 0;
  let stopped = false;

  for (const entry of entries) {
    if (stopped) {
      remaining.push(entry);
      continue;
    }

    const known = confirmed.get(entry.playerId);
    if (known !== undefined && known >= entry.level) {
      dropped += 1;
      continue;
    }

    try {
      const player = await send(entry);
      sent += 1;
      confirmed.set(
        entry.playerId,
        Math.max(known ?? 0, player.level),
      );
    } catch {
      stopped = true;
      remaining.push(entry);
    }
  }

  storage.setPendingSync(remaining);
  return { sent, dropped, remaining: remaining.length };
}
