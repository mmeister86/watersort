// Screen Wake Lock helper for keeping the display on while a level is open.
//
// Entirely best-effort: when the API is missing (most desktop browsers) or the
// request is denied, every call is a silent no-op. The lock is re-requested
// after the tab becomes visible again, because the browser drops it on hide.

export type WakeLockSentinelLike = {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
};

type WakeLockApiLike = {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
};

export type WakeLockController = {
  /** Starts holding the lock (idempotent). */
  acquire(): void;
  /** Releases the lock and stops re-acquiring it. */
  release(): void;
};

/** Narrows the optional Wake Lock API without relying on newer DOM lib types. */
function getWakeLockApi(): WakeLockApiLike | null {
  const nav: unknown = globalThis.navigator;
  if (typeof nav !== 'object' || nav === null) {
    return null;
  }
  const api = (nav as { wakeLock?: unknown }).wakeLock;
  if (typeof api !== 'object' || api === null) {
    return null;
  }
  const request = (api as { request?: unknown }).request;
  if (typeof request !== 'function') {
    return null;
  }
  return api as WakeLockApiLike;
}

/** Creates a controller bound to one game session. */
export function createWakeLock(
  doc: Document = globalThis.document,
): WakeLockController {
  let sentinel: WakeLockSentinelLike | null = null;
  let wanted = false;

  const acquireLock = async (): Promise<void> => {
    const api = getWakeLockApi();
    if (api === null || sentinel !== null || !wanted) {
      return;
    }
    try {
      const held = await api.request('screen');
      if (!wanted) {
        // Released while the request was in flight; drop the fresh lock.
        void held.release().catch(() => undefined);
        return;
      }
      sentinel = held;
      held.addEventListener('release', () => {
        sentinel = null;
      });
    } catch {
      // Unsupported, denied or not focused: silently continue without a lock.
      sentinel = null;
    }
  };

  const releaseLock = (): void => {
    wanted = false;
    doc.removeEventListener('visibilitychange', onVisibility);
    const held = sentinel;
    sentinel = null;
    if (held !== null && !held.released) {
      // A failed release only means it is already gone; nothing to recover.
      void held.release().catch(() => undefined);
    }
  };

  function onVisibility(): void {
    if (doc.visibilityState === 'visible' && wanted) {
      void acquireLock();
    }
  }

  return {
    acquire(): void {
      if (wanted) {
        return;
      }
      wanted = true;
      doc.addEventListener('visibilitychange', onVisibility);
      void acquireLock();
    },

    release(): void {
      releaseLock();
    },
  };
}
