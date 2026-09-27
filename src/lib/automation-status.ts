import type { AutomationSnapshot } from "@/automation/store";

export const WORKER_HEARTBEAT_MAX_AGE_MS = 35_000;
export function workerHealth(
  snapshot: Pick<AutomationSnapshot, "config" | "runtime">,
  now = Date.now(),
) {
  const heartbeat = Date.parse(snapshot.runtime.heartbeatAt || "");
  const age = now - heartbeat;
  const alive =
    Number.isFinite(age) && age >= -5_000 && age <= WORKER_HEARTBEAT_MAX_AGE_MS;
  const state: AutomationSnapshot["runtime"]["state"] | "unavailable" =
    !snapshot.config.enabled
      ? "off"
      : !alive
        ? "unavailable"
        : snapshot.runtime.state === "off"
          ? "starting"
          : snapshot.runtime.state;
  return {
    alive,
    ready:
      alive &&
      (!snapshot.config.enabled ||
        ["watching", "stopped"].includes(snapshot.runtime.state)),
    state,
    heartbeatAgeMs: Number.isFinite(age) ? Math.max(0, age) : null,
  };
}
