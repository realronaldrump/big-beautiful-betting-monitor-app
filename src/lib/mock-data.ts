import { calculateDashboard } from "@/lib/calculate-dashboard";
import type { DashboardSnapshot } from "@/lib/dashboard-types";
import type {
  RawActivitiesResponse,
  RawBalancesResponse,
  RawPosition,
  RawPositionsResponse,
} from "@/lib/polymarket-types";

const usd = (value: number) => ({ value: value.toFixed(2), currency: "USD" });

const mockPositions: Record<string, RawPosition> = {
  "broncos-win-week-one": {
    netPositionDecimal: "48",
    qtyBoughtDecimal: "48",
    qtySoldDecimal: "0",
    cost: usd(28.8),
    realized: usd(0),
    cashValue: usd(37.92),
    expired: false,
    updateTime: "2026-07-17T22:14:00Z",
    marketMetadata: {
      title: "Will Denver win its opening game?",
      outcome: "YES",
      slug: "broncos-win-week-one",
    },
  },
  "fed-rate-cut-september": {
    netPositionDecimal: "75",
    qtyBoughtDecimal: "75",
    qtySoldDecimal: "0",
    cost: usd(58.2),
    realized: usd(0),
    cashValue: usd(65.28),
    expired: false,
    updateTime: "2026-07-16T16:08:00Z",
    marketMetadata: {
      title: "Will the Fed cut rates in September?",
      outcome: "YES",
      slug: "fed-rate-cut-september",
    },
  },
  "usa-reach-world-cup-quarterfinal": {
    netPositionDecimal: "0",
    qtyBoughtDecimal: "100",
    qtySoldDecimal: "100",
    cost: usd(0),
    realized: usd(42.5),
    cashValue: usd(0),
    expired: true,
    updateTime: "2026-07-10T02:15:00Z",
    marketMetadata: {
      title: "Will the USA reach the World Cup quarterfinal?",
      outcome: "YES",
      slug: "usa-reach-world-cup-quarterfinal",
    },
  },
  "inflation-below-three-june": {
    netPositionDecimal: "0",
    qtyBoughtDecimal: "60",
    qtySoldDecimal: "60",
    cost: usd(0),
    realized: usd(-18),
    cashValue: usd(0),
    expired: true,
    updateTime: "2026-07-02T13:30:00Z",
    marketMetadata: {
      title: "Will June inflation print below 3%?",
      outcome: "YES",
      slug: "inflation-below-three-june",
    },
  },
  "thunder-win-finals": {
    netPositionDecimal: "0",
    qtyBoughtDecimal: "80",
    qtySoldDecimal: "80",
    cost: usd(0),
    realized: usd(27),
    cashValue: usd(0),
    expired: true,
    updateTime: "2026-06-21T05:12:00Z",
    marketMetadata: {
      title: "Will Oklahoma City win the NBA Finals?",
      outcome: "YES",
      slug: "thunder-win-finals",
    },
  },
  "rain-denver-may-15": {
    netPositionDecimal: "0",
    qtyBoughtDecimal: "20",
    qtySoldDecimal: "20",
    cost: usd(0),
    realized: usd(0),
    cashValue: usd(0),
    expired: true,
    updateTime: "2026-05-16T14:00:00Z",
    marketMetadata: {
      title: "Will Denver record rain on May 15?",
      outcome: "YES",
      slug: "rain-denver-may-15",
    },
  },
  "nuggets-win-series": {
    netPositionDecimal: "0",
    qtyBoughtDecimal: "90",
    qtySoldDecimal: "90",
    cost: usd(0),
    realized: usd(63.2),
    cashValue: usd(0),
    expired: true,
    updateTime: "2026-05-05T04:40:00Z",
    marketMetadata: {
      title: "Will Denver win its first-round series?",
      outcome: "YES",
      slug: "nuggets-win-series",
    },
  },
  "bitcoin-above-150k-april": {
    netPositionDecimal: "0",
    qtyBoughtDecimal: "55",
    qtySoldDecimal: "55",
    cost: usd(0),
    realized: usd(-31.4),
    cashValue: usd(0),
    expired: true,
    updateTime: "2026-05-01T00:10:00Z",
    marketMetadata: {
      title: "Will Bitcoin finish April above $150K?",
      outcome: "YES",
      slug: "bitcoin-above-150k-april",
    },
  },
};

const positions: RawPositionsResponse = {
  positions: mockPositions,
  eof: true,
};

const activities: RawActivitiesResponse = {
  activities: [
    {
      type: "ACTIVITY_TYPE_TRADE",
      trade: {
        id: "demo-trade-1",
        marketSlug: "broncos-win-week-one",
        state: "TRADE_STATE_CLEARED",
        createTime: "2026-07-17T22:14:00Z",
        updateTime: "2026-07-17T22:14:03Z",
        price: usd(0.6),
        qtyDecimal: "48",
        costBasis: usd(28.8),
        realizedPnl: usd(0),
      },
    },
    {
      type: "ACTIVITY_TYPE_TRADE",
      trade: {
        id: "demo-trade-2",
        marketSlug: "fed-rate-cut-september",
        state: "TRADE_STATE_CLEARED",
        createTime: "2026-07-16T16:08:00Z",
        updateTime: "2026-07-16T16:08:01Z",
        price: usd(0.776),
        qtyDecimal: "75",
        costBasis: usd(58.2),
        realizedPnl: usd(0),
      },
    },
    {
      type: "ACTIVITY_TYPE_POSITION_RESOLUTION",
      positionResolution: {
        marketSlug: "usa-reach-world-cup-quarterfinal",
        afterPosition: mockPositions["usa-reach-world-cup-quarterfinal"],
        side: "LONG",
        tradeId: "demo-resolution-1",
        updateTime: "2026-07-10T02:15:00Z",
      },
    },
    {
      type: "ACTIVITY_TYPE_POSITION_RESOLUTION",
      positionResolution: {
        marketSlug: "inflation-below-three-june",
        afterPosition: mockPositions["inflation-below-three-june"],
        side: "LONG",
        tradeId: "demo-resolution-2",
        updateTime: "2026-07-02T13:30:00Z",
      },
    },
    {
      type: "ACTIVITY_TYPE_TAKER_FEE_REBATE",
      accountBalanceChange: {
        transactionId: "demo-rebate-1",
        status: "COMPLETED",
        amount: usd(3.2),
        updateTime: "2026-06-30T17:00:00Z",
      },
    },
    {
      type: "ACTIVITY_TYPE_ACCOUNT_WITHDRAWAL",
      accountBalanceChange: {
        transactionId: "demo-withdrawal-1",
        status: "COMPLETED",
        amount: usd(180),
        updateTime: "2026-06-27T19:25:00Z",
      },
    },
    {
      type: "ACTIVITY_TYPE_REFERRAL_BONUS",
      accountBalanceChange: {
        transactionId: "demo-referral-1",
        status: "COMPLETED",
        amount: usd(9.5),
        updateTime: "2026-06-02T18:20:00Z",
      },
    },
    {
      type: "ACTIVITY_TYPE_ACCOUNT_DEPOSIT",
      accountBalanceChange: {
        transactions: [
          {
            transactionId: "demo-deposit-2",
            status: "COMPLETED",
            amount: usd(250),
            updateTime: "2026-05-20T16:12:00Z",
          },
        ],
      },
    },
    {
      type: "ACTIVITY_TYPE_ACCOUNT_ADVANCED_DEPOSIT",
      accountBalanceChange: {
        transactionId: "demo-advance-1",
        status: "COMPLETED",
        amount: usd(100),
        updateTime: "2026-05-20T16:10:00Z",
      },
    },
    {
      type: "ACTIVITY_TYPE_ACCOUNT_DEPOSIT",
      accountBalanceChange: {
        transactionId: "demo-deposit-1",
        status: "COMPLETED",
        amount: usd(750),
        updateTime: "2026-04-10T14:30:00Z",
      },
    },
  ],
  eof: true,
};

const balances: RawBalancesResponse = {
  balances: [
    {
      currentBalance: 428.65,
      buyingPower: 351.2,
      currency: "USD",
      assetNotional: 103.2,
      assetAvailable: 42.55,
      openOrders: 120,
      unsettledFunds: 25,
      marginRequirement: 0,
      lastUpdated: "2026-07-18T19:10:00Z",
    },
  ],
};

export function getMockDashboard(): DashboardSnapshot {
  return calculateDashboard({
    mode: "demo",
    positions,
    activities,
    balances,
    generatedAt: "2026-07-18T19:10:00Z",
  });
}
