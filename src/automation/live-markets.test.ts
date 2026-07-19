import { describe, expect, it } from "vitest";
import { extractLiveMarkets } from "@/automation/live-markets";

describe("extractLiveMarkets", () => {
  it("keeps only open tradable markets from events that are live now", () => {
    const markets = extractLiveMarkets({
      events: [
        {
          slug: "rockies-v-dodgers",
          title: "Rockies v Dodgers",
          live: true,
          ended: false,
          active: true,
          closed: false,
          markets: [
            {
              slug: "rockies-win",
              title: "Rockies win",
              active: true,
              closed: false,
              ep3Status: "OPEN",
              minimumTradeQty: 0.01,
              orderPriceMinTickSize: 0.01,
              marketSides: [
                { description: "Rockies", long: true, tradable: true },
                { description: "Dodgers", long: false, tradable: true },
              ],
            },
            {
              slug: "closed-market",
              title: "Already closed",
              active: true,
              closed: true,
              ep3Status: "EXPIRED",
              marketSides: [],
            },
          ],
        },
        {
          slug: "tomorrows-game",
          title: "Tomorrow's game",
          live: false,
          ended: false,
          active: true,
          closed: false,
          markets: [
            {
              slug: "future-market",
              title: "Future market",
              active: true,
              closed: false,
              ep3Status: "OPEN",
              marketSides: [],
            },
          ],
        },
      ],
    });

    expect(markets).toEqual([
      {
        marketSlug: "rockies-win",
        eventSlug: "rockies-v-dodgers",
        eventTitle: "Rockies v Dodgers",
        marketTitle: "Rockies win",
        longOutcome: "Rockies",
        shortOutcome: "Dodgers",
        minimumTradeQty: 0.01,
        priceTickSize: 0.01,
        isLive: true,
        isOpen: true,
      },
    ]);
  });

  it("excludes esports events before their markets are tracked", () => {
    const markets = extractLiveMarkets({
      events: [
        {
          slug: "valorant-team-one-v-team-two",
          title: "Team One vs. Team Two",
          live: true,
          active: true,
          closed: false,
          tags: [
            {
              slug: "esports",
              sport: { slug: "esports" },
            },
          ],
          markets: [
            {
              slug: "valorant-team-one-win",
              active: true,
              closed: false,
              ep3Status: "OPEN",
              marketSides: [
                { description: "Team One", long: true, tradable: true },
                { description: "Team Two", long: false, tradable: true },
              ],
            },
          ],
        },
      ],
    });

    expect(markets).toEqual([]);
  });
});
