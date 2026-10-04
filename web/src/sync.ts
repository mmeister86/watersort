// Client-side progress sync queue.
//
// A solved level is reported to `PUT /api/players/:id/progress`. When that call
// fails (offline, server down, expired session) the update is appended to
// `watersort.pendingSync` and retried on the `online` event and on app start.
// The queue is flushed strictly in order: the first failure stops the flush so
// later updates for the same player are never applied out of order.
//
// Flushes are serialized through `createSyncCoordinator`: because the server
// ADDS each statsDelta, two overlapping flushes must never PUT the same entry.
// The writeback also re-reads the live queue, so an update enqueued while a
// send was awaiting is never dropped by an older snapshot.
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

/** True when two queued entries are byte-for-byte the same update. */
function sameEntry(a: PendingSyncEntry, b: PendingSyncEntry): boolean {
  return (
    a.playerId === b.playerId &&
    a.level === b.level &&
    a.statsDelta.solved === b.statsDelta.solved &&
    a.statsDelta.moves === b.statsDelta.moves &&
    a.statsDelta.undos === b.statsDelta.undos
  );
}

/**
 * Removes one occurrence of each consumed entry from `queue`, preserving order.
 * Entries appended after the flush started stay in place even when a snapshot
 * writeback would otherwise overwrite them.
 */
function removeConsumed(
  queue: readonly PendingSyncEntry[],
  consumed: readonly PendingSyncEntry[],
): PendingSyncEntry[] {
  if (consumed.length === 0) {
    return queue.slice();
  }
  const pool = consumed.map((entry) => ({ entry, used: false }));
  return queue.filter((candidate) => {
    const match = pool.find(
      (slot) => !slot.used && sameEntry(slot.entry, candidate),
    );
    if (match === undefined) {
      return true;
    }
    match.used = true;
    return false;
  });
}

/**
 * Flushes the queue in order. A successful send records the returned level and
 * lets later redundant entries for that player be dropped; a failed send
 * retains that entry and every entry after it and ends the flush.
 *
 * Prefer {@link createSyncCoordinator} so overlapping triggers cannot run two
 * flushes at once.
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
  const consumed: PendingSyncEntry[] = [];
  let sent = 0;
  let dropped = 0;

  for (const entry of entries) {
    const known = confirmed.get(entry.playerId);
    if (known !== undefined && known >= entry.level) {
      consumed.push(entry);
      dropped += 1;
      continue;
    }

    try {
      const player = await send(entry);
      consumed.push(entry);
      sent += 1;
      confirmed.set(entry.playerId, Math.max(known ?? 0, player.level));
    } catch {
      // Offline or server error: keep this entry and everything after it. The
      // queue is retried on the next flush and later entries must not overtake
      // a failed earlier one, so stop here.
      break;
    }
  }

  // Re-read before writing so an entry enqueued while a send was awaiting is
  // not clobbered by the snapshot; remove only what we actually consumed.
  const remainingQueue = removeConsumed(storage.getPendingSync(), consumed);
  storage.setPendingSync(remainingQueue);
  return { sent, dropped, remaining: remainingQueue.length };
}

/** Serialized front end for the queue, used by the app. */
export type SyncCoordinator = {
  /** Appends one update to the durable queue. */
  enqueue(entry: PendingSyncEntry): void;
  /** Flushes, waiting for any in-flight flush first. */
  flush(options?: FlushOptions): Promise<FlushResult>;
};

/**
 * Wraps {@link flushPendingSync} in a promise chain so overlapping triggers
 * (boot, the `online` event, a solved level) run one after another. Without
 * this, two flushes could PUT the same entry and the server would add its
 * statsDelta twice.
 */
export function createSyncCoordinator(
  storage: AppStorage,
  send: ProgressSender = sendProgress,
): SyncCoordinator {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    enqueue(entry: PendingSyncEntry): void {
      enqueueProgress(storage, entry);
    },
    flush(options: FlushOptions = {}): Promise<FlushResult> {
      const run = chain.then(() => flushPendingSync(storage, send, options));
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
