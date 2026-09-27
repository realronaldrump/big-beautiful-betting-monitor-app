import { expect, it, vi } from "vitest";
import { createRefreshQueue } from "./refresh-queue";
it("coalesces a burst during a fetch into one trailing refresh", async () => {
  let release!: () => void;
  const first = new Promise<void>((r) => (release = r));
  const refresh = vi
    .fn()
    .mockImplementationOnce(() => first)
    .mockResolvedValue(undefined);
  const queue = createRefreshQueue(refresh);
  const task = queue.request(1);
  void queue.request(2);
  void queue.request(3);
  expect(refresh).toHaveBeenCalledTimes(1);
  release();
  await task;
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(refresh.mock.calls[1][0]).toBe(3);
  queue.stop();
});
it("aborts a pending request and never starts queued work after unmount", async () => {
  let release!: () => void;
  const refresh = vi
    .fn()
    .mockImplementation(() => new Promise<void>((r) => (release = r)));
  const queue = createRefreshQueue(refresh);
  const task = queue.request(1);
  void queue.request(2);
  const signal = refresh.mock.calls[0][1] as AbortSignal;
  queue.stop();
  expect(signal.aborted).toBe(true);
  release();
  await task;
  expect(refresh).toHaveBeenCalledTimes(1);
});
