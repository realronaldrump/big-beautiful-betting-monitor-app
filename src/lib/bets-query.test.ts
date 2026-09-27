import { describe, expect, it } from "vitest";
import {
  betsCsv,
  EMPTY_BET_FILTERS,
  queryBets,
  type BetFilters,
} from "./bets-query";
import type { PositionRow } from "./dashboard-types";
const bets: PositionRow[] = [
  {
    marketSlug: "mlb-yankees",
    title: "New York Yankees vs. Boston Red Sox",
    outcome: "Yankees",
    side: "no",
    result: "win",
    isOpen: false,
    quantity: 0,
    costBasis: 0,
    marketValue: 0,
    realizedPnl: 4,
    openPnl: 0,
    updatedAt: "2026-09-27T02:00:00Z",
    amountBet: 10,
  },
  {
    marketSlug: "nfl-broncos",
    title: "Denver Broncos vs. Chiefs",
    outcome: "Broncos",
    side: "yes",
    result: "loss",
    isOpen: false,
    quantity: 0,
    costBasis: 0,
    marketValue: 0,
    realizedPnl: -5,
    openPnl: 0,
    updatedAt: "2026-09-25T02:00:00Z",
    amountBet: 5,
  },
  {
    marketSlug: "nfl-bills",
    title: "Buffalo Bills",
    outcome: "No",
    side: "no",
    result: "open",
    isOpen: true,
    quantity: -2,
    costBasis: 1,
    marketValue: 1.5,
    realizedPnl: 0.2,
    openPnl: 0.5,
    updatedAt: "2026-09-27T10:00:00Z",
    amountBet: 2,
  },
  {
    marketSlug: "unknown",
    title: "Other market",
    outcome: "Yes",
    result: "push",
    isOpen: false,
    quantity: 0,
    costBasis: 0,
    marketValue: 0,
    realizedPnl: 0,
    openPnl: 0,
    updatedAt: "2026-09-24T00:00:00Z",
    amountBet: null,
  },
];
const search = (patch: Partial<BetFilters> = {}) =>
  queryBets(bets, { ...EMPTY_BET_FILTERS, ...patch }, "newest").bets;
describe("bet discovery", () => {
  it("finds team names in any order", () =>
    expect(
      search({ query: "Boston Yankees" }).map((x) => x.marketSlug),
    ).toEqual(["mlb-yankees"]));
  it("tolerates a missing letter", () =>
    expect(search({ query: "Yankes" })).toHaveLength(1));
  it("keeps quoted phrases together and excludes words", () => {
    expect(search({ query: '"new york" -boston' })).toEqual([]);
    expect(search({ query: '"new york" -denver' })).toHaveLength(1);
  });
  it("searches outcome direction even with team-specific outcome names", () =>
    expect(search({ query: "no yankees" })).toHaveLength(1));
  it("combines numeric operators and result filters", () => {
    expect(
      search({ query: "stake:>=5 pnl:<0" }).map((x) => x.marketSlug),
    ).toEqual(["nfl-broncos"]);
    expect(search({ query: "result:win" })).toHaveLength(1);
  });
  it("includes both realized and open P&L when sorting", () =>
    expect(
      queryBets(bets, EMPTY_BET_FILTERS, "profit-desc").bets.map(
        (x) => x.marketSlug,
      ),
    ).toEqual(["mlb-yankees", "nfl-bills", "unknown", "nfl-broncos"]));
  it("sorts unknown amounts last in both directions", () => {
    for (const sort of ["stake-asc", "stake-desc"] as const)
      expect(
        queryBets(bets, EMPTY_BET_FILTERS, sort).bets.at(-1)?.marketSlug,
      ).toBe("unknown");
  });
  it("filters result, amount, and Mountain-Time dates together", () =>
    expect(
      search({
        result: "win",
        minStake: "10",
        maxStake: "10",
        from: "2026-09-26",
        to: "2026-09-26",
      }),
    ).toHaveLength(1));
  it("reports invalid ranges and malformed numeric search", () => {
    expect(
      queryBets(
        bets,
        { ...EMPTY_BET_FILTERS, minStake: "20", maxStake: "10" },
        "newest",
      ).error,
    ).toBeTruthy();
    expect(
      queryBets(bets, { ...EMPTY_BET_FILTERS, query: "stake:>abc" }, "newest")
        .error,
    ).toBeTruthy();
  });
  it("does not mutate source order", () => {
    const before = bets.map((x) => x.marketSlug);
    queryBets(bets, EMPTY_BET_FILTERS, "oldest");
    expect(bets.map((x) => x.marketSlug)).toEqual(before);
  });
  it("exports filtered records and escapes spreadsheet formula strings", () => {
    const csv = betsCsv([{ ...bets[0], title: '=HYPERLINK("bad")' }]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('""bad""');
    expect(betsCsv(search({ result: "loss" }))).not.toContain("Yankees");
  });
});
