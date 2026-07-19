import type { TrackedMarket } from "@/automation/engine";

interface RawMarketSide {
  description?: string;
  long?: boolean;
  tradable?: boolean;
}

interface RawLiveMarket {
  slug?: string;
  title?: string;
  question?: string;
  active?: boolean;
  closed?: boolean;
  hidden?: boolean;
  ep3Status?: string;
  minimumTradeQty?: number;
  orderPriceMinTickSize?: number;
  marketSides?: RawMarketSide[];
}

interface RawLiveEvent {
  slug?: string;
  title?: string;
  live?: boolean;
  ended?: boolean;
  active?: boolean;
  closed?: boolean;
  hidden?: boolean;
  markets?: RawLiveMarket[];
}

export interface RawLiveEventsResponse {
  events?: RawLiveEvent[];
}

export function extractLiveMarkets(
  response: RawLiveEventsResponse,
): TrackedMarket[] {
  const tracked = new Map<string, TrackedMarket>();

  for (const event of response.events || []) {
    if (
      !event.slug ||
      event.live !== true ||
      event.ended === true ||
      event.active === false ||
      event.closed === true ||
      event.hidden === true
    ) {
      continue;
    }

    for (const market of event.markets || []) {
      if (
        !market.slug ||
        market.active === false ||
        market.closed === true ||
        market.hidden === true ||
        (market.ep3Status && market.ep3Status !== "OPEN")
      ) {
        continue;
      }

      const longSide = market.marketSides?.find((side) => side.long === true);
      const shortSide = market.marketSides?.find((side) => side.long === false);
      if (longSide?.tradable === false || shortSide?.tradable === false) continue;

      tracked.set(market.slug, {
        marketSlug: market.slug,
        eventSlug: event.slug,
        eventTitle: event.title || event.slug,
        marketTitle: market.title || market.question || market.slug,
        longOutcome: longSide?.description || "Yes",
        shortOutcome: shortSide?.description || "No",
        minimumTradeQty:
          Number.isFinite(market.minimumTradeQty) &&
          Number(market.minimumTradeQty) > 0
            ? Number(market.minimumTradeQty)
            : 1,
        priceTickSize:
          Number.isFinite(market.orderPriceMinTickSize) &&
          Number(market.orderPriceMinTickSize) > 0
            ? Number(market.orderPriceMinTickSize)
            : 0.01,
        isLive: true,
        isOpen: true,
      });
    }
  }

  return [...tracked.values()];
}
