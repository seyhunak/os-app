import { ApiError, PROBE_TIMEOUT_MS } from './api';

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`No answer within ${ms} ms.`);
  }
}

/** Rejects after `ms` even if the underlying request ignores its abort signal. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * True when the server answered within the limit. Any answer counts, even an error like
 * "signed out", because that still means the Mac is up. Only silence or a dead tunnel is offline.
 */
export async function probe(ping: () => Promise<unknown>, ms = PROBE_TIMEOUT_MS): Promise<boolean> {
  try {
    await withTimeout(ping(), ms);
    return true;
  } catch (error) {
    if (error instanceof TimeoutError) return false;
    return !(error instanceof ApiError && error.status === 0);
  }
}
