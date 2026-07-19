import "server-only";

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

type PortfolioClient = PolymarketUS["portfolio"];

let polymarketClient: PolymarketUS | null = null;

export function hasPolymarketCredentials(): boolean {
  return Boolean(process.env.POLYMARKET_KEY_ID && process.env.POLYMARKET_SECRET_KEY);
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

async function fetchAllPositions(portfolio: PortfolioClient): Promise<RawPositionsResponse> {
  const positions: RawPositionsResponse["positions"] = {};
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = (await portfolio.positions({
      limit: PAGE_LIMIT,
      cursor,
    })) as unknown as RawPositionsResponse;

    Object.assign(positions, response.positions || {});

    if (response.eof || !response.nextCursor || seenCursors.has(response.nextCursor)) {
      return { positions, eof: true };
    }

    seenCursors.add(response.nextCursor);
    cursor = response.nextCursor;
  }

  throw new Error("Position history exceeded the dashboard pagination safety limit.");
}

async function fetchAllActivities(portfolio: PortfolioClient): Promise<RawActivitiesResponse> {
  const activities: NonNullable<RawActivitiesResponse["activities"]> = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = (await portfolio.activities({
      limit: PAGE_LIMIT,
      cursor,
      sortOrder: "SORT_ORDER_DESCENDING",
    })) as unknown as RawActivitiesResponse;

    activities.push(...(response.activities || []));

    if (response.eof || !response.nextCursor || seenCursors.has(response.nextCursor)) {
      return { activities, eof: true };
    }

    seenCursors.add(response.nextCursor);
    cursor = response.nextCursor;
  }

  throw new Error("Activity history exceeded the dashboard pagination safety limit.");
}

export async function getDashboardSnapshot(forceDemo = false): Promise<DashboardSnapshot> {
  if (forceDemo || !hasPolymarketCredentials()) return getMockDashboard();

  const client = getPolymarketClient();
  const [positions, activities, balances] = await Promise.all([
    fetchAllPositions(client.portfolio),
    fetchAllActivities(client.portfolio),
    client.account.balances() as unknown as Promise<RawBalancesResponse>,
  ]);

  return calculateDashboard({
    mode: "live",
    positions,
    activities,
    balances,
  });
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
  if (status === 429) return "Polymarket is rate-limiting requests. Automatic updates will retry.";
  if (status >= 500) return "Polymarket US is temporarily unavailable. Automatic updates will retry.";

  if (error instanceof Error && error.message.includes("pagination safety limit")) {
    return error.message;
  }

  return "The Polymarket US portfolio could not be loaded. Check the server logs for details.";
}
