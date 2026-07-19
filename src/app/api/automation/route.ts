import { NextRequest, NextResponse } from "next/server";
import { parseAutomationConfig } from "@/automation/config-validation";
import { getAutomationStore } from "@/automation/store";

export const dynamic = "force-dynamic";

function noStore<T>(body: T, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function isProtectedSameOriginRequest(request: NextRequest) {
  if (request.headers.get("x-bbbm-action") !== "automation-config") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const requestHost =
      request.headers.get("x-forwarded-host") || request.headers.get("host");
    const requestProtocol =
      request.headers.get("x-forwarded-proto") ||
      new URL(request.url).protocol.slice(0, -1);
    return originUrl.host === requestHost && originUrl.protocol === `${requestProtocol}:`;
  } catch {
    return false;
  }
}

export async function GET() {
  return noStore(getAutomationStore().getSnapshot());
}

export async function POST(request: NextRequest) {
  if (!isProtectedSameOriginRequest(request)) {
    return noStore({ error: "This settings request was blocked." }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 1_024) {
    return noStore({ error: "Settings request is too large." }, { status: 413 });
  }

  try {
    const config = parseAutomationConfig(await request.json());
    const store = getAutomationStore();
    store.updateConfig(config);
    store.updateRuntime(
      config.enabled
        ? {
            state: "starting",
            lastError: null,
            stopReason: "Connecting to live Polymarket US markets.",
          }
        : {
            state: "off",
            lastError: null,
            stopReason: null,
            liveEvents: 0,
            monitoredMarkets: 0,
          },
    );
    return noStore(store.getSnapshot());
  } catch (error) {
    return noStore(
      {
        error:
          error instanceof Error
            ? error.message
            : "Automation settings could not be saved.",
      },
      { status: 400 },
    );
  }
}
