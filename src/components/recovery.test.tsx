import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { AutomationStore } from "@/automation/store";
import { getMockDashboard } from "@/lib/mock-data";
const h = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  cursor: 0,
  refCursor: 0,
  effects: [] as (() => (() => void) | undefined)[],
  streams: [] as unknown[],
  store: null as AutomationStore | null,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const i = h.cursor++;
    if (!(i in h.values))
      h.values[i] = typeof initial === "function" ? initial() : initial;
    return [
      h.values[i],
      (next: unknown) => {
        h.values[i] = typeof next === "function" ? next(h.values[i]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const i = h.refCursor++;
    return (h.refs[i] ??= { current: initial });
  },
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => undefined) => h.effects.push(fn),
  useSyncExternalStore: (_: unknown, __: unknown, server: () => unknown) =>
    server(),
}));
vi.mock("@/lib/polymarket-us", () => ({
  getDashboardSnapshot: vi
    .fn()
    .mockRejectedValue(new Error("temporary API failure")),
  publicErrorMessage: () => "temporary API failure",
}));
vi.mock("@/automation/store", async (original) => ({
  ...(await original<typeof import("@/automation/store")>()),
  getAutomationStore: () => h.store!,
}));
import Home from "@/app/page";
import { Dashboard } from "./dashboard";
import { AutomationPanel } from "./automation-panel";

type Element = ReactElement<Record<string, unknown>>;
function find(
  node: unknown,
  predicate: (node: Element) => boolean,
): Element | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  }
  const element = node as Element;
  if (predicate(element)) return element;
  return find(element.props?.children, predicate);
}
beforeEach(() => {
  vi.useFakeTimers();
  h.values = [];
  h.refs = [];
  h.cursor = 0;
  h.refCursor = 0;
  h.effects = [];
  h.streams = [];
  h.store = new AutomationStore(":memory:");
  vi.stubGlobal(
    "EventSource",
    class {
      constructor() {
        h.streams.push(this);
      }
      addEventListener() {}
      close() {}
    },
  );
});
afterEach(() => {
  h.store?.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("keeps an initial live failure recoverable without substituting sample money", async () => {
  const page = await Home();
  expect(page.props.initialSnapshot).toBeNull();
  const live = { ...getMockDashboard(), mode: "live" };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => live });
  vi.stubGlobal("fetch", fetch);
  Dashboard(page.props);
  const cleanup = h.effects[0]();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.streams).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(h.values[0]).toEqual(live);
  cleanup?.();
});
it("allows Off to supersede a slow save and ignores its late response", async () => {
  h.store!.updateConfig({
    enabled: true,
    balanceFloor: 100,
    triggerPrice: 0.95,
    executionCap: 0.96,
  });
  const initial = h.store!.getSnapshot();
  let release!: (value: unknown) => void;
  const calls: {
    body?: Record<string, unknown>;
    signal?: AbortSignal | null;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_: unknown, options?: RequestInit) => {
      const body = options?.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ body, signal: options?.signal });
      if (body?.action === "settings")
        return new Promise((resolve) => (release = resolve));
      if (body?.action === "disable") h.store!.setEnabled(false);
      return { ok: true, json: async () => h.store!.getSnapshot() };
    }),
  );
  const render = () => {
    h.cursor = 0;
    h.refCursor = 0;
    return AutomationPanel({ initialSnapshot: initial, accountBalance: 250 });
  };
  let tree = render();
  const field = find(tree, (n) => n.props?.id === "balance-floor")!;
  (field.props.onChange as (event: unknown) => void)({
    target: { value: "110" },
  });
  tree = render();
  const save = find(
    tree,
    (n) => n.props?.className === "automation__save-button",
  )!;
  (save.props.onClick as () => void)();
  tree = render();
  const off = find(tree, (n) => n.props?.role === "switch")!;
  expect(off.props.disabled).toBe(false);
  (off.props.onClick as () => void)();
  await vi.advanceTimersByTimeAsync(0);
  expect(calls[0].signal?.aborted).toBe(true);
  expect(calls[1].body).toEqual({ action: "disable" });
  expect(h.store!.getConfig().enabled).toBe(false);
  release({ ok: true, json: async () => initial });
  await vi.advanceTimersByTimeAsync(0);
  tree = render();
  expect(
    find(tree, (n) => n.props?.role === "switch")!.props["aria-checked"],
  ).toBe(false);
});
