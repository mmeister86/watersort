// Minimal typed fetch wrapper for the `/api` surface.
//
// Task 7 only provides the transport skeleton; Task 10 layers the concrete
// session, player and progress calls on top of `apiRequest`.

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
