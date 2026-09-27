import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AutomationStore } from "@/automation/store";
const state = vi.hoisted(() => ({
  store: null as AutomationStore | null,
  request: vi.fn(),
}));
vi.mock("@/automation/store", async (original) => ({
  ...(await original<typeof import("@/automation/store")>()),
  getAutomationStore: () => state.store!,
}));
vi.mock("@/lib/polymarket-rest", () => ({
  PolymarketRestClient: class {
    request = state.request;
  },
}));
import { getDashboardSnapshot } from "./polymarket-us";
beforeEach(() => {
  vi.useFakeTimers();
  state.store = new AutomationStore(":memory:");
  vi.stubEnv("POLYMARKET_KEY_ID", "mock");
  vi.stubEnv("POLYMARKET_SECRET_KEY", "mock");
  state.request.mockReset();
  state.request.mockImplementation(async (path: string) => {
    await new Promise((r) => setTimeout(r, 5000));
    return path.endsWith("positions")
      ? { positions: {}, eof: true }
      : path.endsWith("activities")
        ? { activities: [], eof: true }
        : { balances: [] };
  });
});
afterEach(() => {
  state.store?.close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("shares a slow snapshot across callers without expiring it during the fetch", async () => {
  const pending = Promise.all([getDashboardSnapshot(), getDashboardSnapshot()]);
  await vi.advanceTimersByTimeAsync(5100);
  const [a, b] = await pending;
  expect(a).toEqual(b);
  expect(state.request).toHaveBeenCalledTimes(3);
});
it("fetches again for an event that occurred after the cached request began", async () => {
  let pending = getDashboardSnapshot();
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  pending = getDashboardSnapshot(false, Date.now());
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  expect(state.request).toHaveBeenCalledTimes(6);
});
