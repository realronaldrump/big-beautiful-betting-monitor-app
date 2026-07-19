import {
  PolymarketUS,
  type CreateOrderParams,
  type CreateOrderResponse,
} from "polymarket-us";
import type {
  AccountBalances,
  MarketQuote,
  TradingAdapter,
} from "@/automation/engine";

export class ApiPacer {
  private tail: Promise<unknown> = Promise.resolve();
  private lastStartedAt = 0;

  constructor(private readonly minimumSpacingMs = 100) {}

  run<T>(request: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      const waitFor = this.minimumSpacingMs - (Date.now() - this.lastStartedAt);
      if (waitFor > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitFor));
      }
      this.lastStartedAt = Date.now();
      return request();
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export class PolymarketTradingAdapter implements TradingAdapter {
  constructor(
    private readonly client: PolymarketUS,
    private readonly pacer: ApiPacer,
  ) {}

  previewOrder(order: CreateOrderParams) {
    return this.pacer.run(() => this.client.orders.preview({ request: order }));
  }

  createOrder(order: CreateOrderParams): Promise<CreateOrderResponse> {
    return this.pacer.run(() => this.client.orders.create(order));
  }

  async getQuote(marketSlug: string): Promise<MarketQuote> {
    const quote = await this.pacer.run(() => this.client.markets.bbo(marketSlug));
    return {
      bestBid: quote.bestBid ? Number(quote.bestBid.value) : undefined,
      bestAsk: quote.bestAsk ? Number(quote.bestAsk.value) : undefined,
    };
  }

  async getBalances(): Promise<AccountBalances> {
    const response = await this.pacer.run(() => this.client.account.balances());
    const usd =
      response.balances.find((balance) => balance.currency === "USD") ||
      response.balances[0];
    if (!usd) throw new Error("Polymarket returned no USD account balance.");
    return {
      currentBalance: Number(usd.currentBalance) || 0,
      buyingPower: Number(usd.buyingPower) || 0,
    };
  }

  sleep(milliseconds: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}

export function createPolymarketTradingClient() {
  const keyId = process.env.POLYMARKET_KEY_ID;
  const secretKey = process.env.POLYMARKET_SECRET_KEY;
  if (!keyId || !secretKey) {
    throw new Error("Polymarket US API credentials are not configured.");
  }

  return new PolymarketUS({ keyId, secretKey, timeout: 20_000 });
}
