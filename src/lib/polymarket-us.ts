import "server-only";

import { randomUUID } from "node:crypto";
import { getAutomationStore } from "@/automation/store";
import { PolymarketRestClient } from "@/lib/polymarket-rest";
import { PolymarketUS, type PrivateWebSocket } from "polymarket-us";
import { calculateDashboard } from "@/lib/calculate-dashboard";
import type { DashboardSnapshot } from "@/lib/dashboard-types";
import { getMockDashboard } from "@/lib/mock-data";
import type {
  RawActivitiesResponse,
  RawBalancesResponse,
  RawPositionsResponse,
} from "@/lib/polymarket-types";

const PAGE_LIMIT = 100;
const MAX_PAGES = 100;

let restClient: PolymarketRestClient | null = null;
function getRestClient() {
  return (restClient ??= new PolymarketRestClient());
}

let polymarketClient: PolymarketUS | null = null;

export function hasPolymarketCredentials(): boolean {
  return Boolean(
    process.env.POLYMARKET_KEY_ID && process.env.POLYMARKET_SECRET_KEY,
  );
}

function getPolymarketClient(): PolymarketUS {
  if (polymarketClient) return polymarketClient;

  const keyId = process.env.POLYMARKET_KEY_ID;
  const secretKey = process.env.POLYMARKET_SECRET_KEY;

  if (!keyId || !secretKey) {
    throw new Error("Polymarket US credentials are not configured.");
  }

  polymarketClient = new PolymarketUS({
    keyId,
    secretKey,
    timeout: 20_000,
  });

  return polymarketClient;
}

async function fetchAllPositions(
  signal: AbortSignal,
): Promise<RawPositionsResponse> {
  const positions: RawPositionsResponse["positions"] = {};
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await getRestClient().request<RawPositionsResponse>(
      "/v1/portfolio/positions",
      { query: { limit: PAGE_LIMIT, cursor }, signal },
    );

    Object.assign(positions, response.positions || {});

    if (
      response.eof ||
      !response.nextCursor ||
      seenCursors.has(response.nextCursor)
    ) {
      return { positions, eof: true };
    }

    seenCursors.add(response.nextCursor);
    cursor = response.nextCursor;
  }

  throw new Error(
    "Position history exceeded the dashboard pagination safety limit.",
  );
}

async function fetchAllActivities(
  signal: AbortSignal,
): Promise<RawActivitiesResponse> {
  const activities: NonNullable<RawActivitiesResponse["activities"]> = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await getRestClient().request<RawActivitiesResponse>(
      "/v1/portfolio/activities",
      {
        query: {
          limit: PAGE_LIMIT,
          cursor,
          sortOrder: "SORT_ORDER_DESCENDING",
        },
        signal,
      },
    );

    activities.push(...(response.activities || []));

    if (
      response.eof ||
      !response.nextCursor ||
      seenCursors.has(response.nextCursor)
    ) {
      return { activities, eof: true };
    }

    seenCursors.add(response.nextCursor);
    cursor = response.nextCursor;
  }

  throw new Error(
    "Activity history exceeded the dashboard pagination safety limit.",
  );
}

export async function getDashboardSnapshot(
  forceDemo = false,
  since = 0,
): Promise<DashboardSnapshot> {
  if (forceDemo || !hasPolymarketCredentials()) return getMockDashboard();
  const store = getAutomationStore();
  const owner = randomUUID();
  const deadline = Date.now() + 65_000;
  const minimumStartedAt = Math.min(since, Date.now());
  while (Date.now() < deadline) {
    const cached = store.readPortfolioCache();
    if (
      cached.payload &&
      cached.startedAt >= minimumStartedAt &&
      Date.now() - cached.completedAt < 3_000
    ) {
      return JSON.parse(cached.payload) as DashboardSnapshot;
    }
    if (store.claimPortfolioRefresh(owner, Date.now())) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      try {
        const [positions, activities, balances] = await Promise.all([
          fetchAllPositions(controller.signal),
          fetchAllActivities(controller.signal),
          getRestClient().request<RawBalancesResponse>("/v1/account/balances", {
            signal: controller.signal,
          }),
        ]);
        const snapshot = calculateDashboard({
          mode: "live",
          positions,
          activities,
          balances,
        });
        store.finishPortfolioRefresh(
          owner,
          JSON.stringify(snapshot),
          startedAt,
        );
        return snapshot;
      } finally {
        clearTimeout(timer);
        controller.abort();
        store.finishPortfolioRefresh(owner);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Portfolio refresh timed out. Automatic updates will retry.");
}

export function createPrivateAccountStream(): PrivateWebSocket {
  return getPolymarketClient().ws.private();
}

export function publicErrorMessage(error: unknown): string {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : 0;

  if (status === 401 || status === 403) {
    return "Polymarket rejected the API credentials. Confirm the key belongs to the same email sign-in used in the US app.";
  }
  if (status === 429)
    return "Polymarket is rate-limiting requests. Automatic updates will retry.";
  if (status >= 500)
    return "Polymarket US is temporarily unavailable. Automatic updates will retry.";

  if (
    error instanceof Error &&
    error.message.includes("pagination safety limit")
  ) {
    return error.message;
  }

  return "The Polymarket US portfolio could not be loaded. Check the server logs for details.";
}
