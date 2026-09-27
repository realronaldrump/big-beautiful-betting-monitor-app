import type { PrivateWebSocket } from "polymarket-us";

/** ORDER is a change stream. The exchange requires a separate one-shot snapshot.
 * The installed 0.1.1 SDK can send it, but its type union predates this enum.
 * https://github.com/Polymarket/polymarket-us-typescript#websocket-real-time-data */
export function subscribeOrderSnapshot(
  socket: PrivateWebSocket,
  requestId: string,
) {
  socket.subscribe(
    requestId,
    "SUBSCRIPTION_TYPE_ORDER_SNAPSHOT" as Parameters<
      PrivateWebSocket["subscribe"]
    >[1],
  );
}
