import { NextResponse } from "next/server";
import {
  createPrivateAccountStream,
  hasPolymarketCredentials,
} from "@/lib/polymarket-us";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEP_ALIVE_MS = 15_000;

export async function GET(request: Request): Promise<Response> {
  if (!hasPolymarketCredentials()) {
    return NextResponse.json(
      { error: "Polymarket US credentials are not configured." },
      { status: 503 },
    );
  }

  const encoder = new TextEncoder();
  const socket = createPrivateAccountStream();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let ended = false;

  function send(event: string, data: Record<string, string>): void {
    if (ended || !controllerRef) return;
    controllerRef.enqueue(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    );
  }

  function close(): void {
    if (ended) return;
    ended = true;
    if (keepAlive) clearInterval(keepAlive);
    socket.close();
    try {
      controllerRef?.close();
    } catch {
      // The browser may have already closed the stream.
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      controller.enqueue(encoder.encode("retry: 3000\n: connected\n\n"));

      keepAlive = setInterval(() => {
        if (!ended) controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, KEEP_ALIVE_MS);

      const notify = () => send("update", { at: new Date().toISOString() });

      socket.on("orderUpdate", notify);
      socket.on("positionUpdate", notify);
      socket.on("accountBalanceUpdate", notify);
      socket.on("error", (error) => {
        console.error("Polymarket US private stream failed", error);
        send("stream-error", { message: "Real-time connection interrupted." });
        close();
      });
      socket.on("close", close);

      request.signal.addEventListener("abort", close, { once: true });

      void socket
        .connect()
        .then(() => {
          if (ended) return;
          socket.subscribeOrders("bbbma-orders");
          socket.subscribePositions("bbbma-positions");
          socket.subscribeAccountBalance("bbbma-balance");
          send("ready", { at: new Date().toISOString() });
        })
        .catch((error) => {
          console.error("Polymarket US private stream could not connect", error);
          send("stream-error", { message: "Real-time connection could not start." });
          close();
        });
    },
    cancel: close,
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
