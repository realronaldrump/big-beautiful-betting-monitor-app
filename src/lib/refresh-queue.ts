/** Collapse bursts while guaranteeing one fresh pass after an update during a request. */
export function createRefreshQueue(
  refresh: (since: number, signal: AbortSignal) => Promise<void>,
) {
  let inFlight: Promise<void> | null = null;
  let pending: number | null = null;
  let stopped = false;
  const controller = new AbortController();
  const request = (since = 0): Promise<void> => {
    if (stopped) return Promise.resolve();
    pending = Math.max(pending ?? 0, since);
    if (!inFlight) {
      inFlight = (async () => {
        while (pending !== null && !stopped) {
          const next = pending;
          pending = null;
          await refresh(next, controller.signal);
        }
      })().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
  return {
    request,
    stop: () => {
      stopped = true;
      pending = null;
      controller.abort();
    },
  };
}
