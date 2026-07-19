import { describe, expect, it } from "vitest";
import { extractOrderExecution } from "@/automation/websocket-parsers";

describe("extractOrderExecution", () => {
  it("reads both documented and newer SDK order-update envelopes", () => {
    const execution = {
      type: "EXECUTION_TYPE_FILL",
      order: { id: "order-1", marketSlug: "market-1", state: "ORDER_STATE_FILLED" },
    };

    expect(
      extractOrderExecution({ orderSubscriptionUpdate: { execution } }),
    ).toEqual(execution);
    expect(extractOrderExecution({ orderUpdate: { execution } })).toEqual(execution);
  });

  it("returns null for unrelated or incomplete messages", () => {
    expect(extractOrderExecution({ accountBalancesSnapshot: {} })).toBeNull();
    expect(extractOrderExecution({ orderUpdate: {} })).toBeNull();
  });
});
