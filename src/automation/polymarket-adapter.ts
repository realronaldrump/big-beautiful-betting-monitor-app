import {
  PolymarketUS,
  type CreateOrderParams,
  type CreateOrderResponse,
  type PreviewOrderResponse,
} from "polymarket-us";
import type { AccountBalances, TradingAdapter } from "@/automation/engine";
import { PolymarketRestClient } from "@/lib/polymarket-rest";
import type { RawBalancesResponse } from "@/lib/polymarket-types";
import { availableCash } from "@/lib/balances";
import type { ParsedOrderExecution } from "./websocket-parsers";
export { ApiPacer } from "@/lib/polymarket-rest";

export class PolymarketTradingAdapter implements TradingAdapter {
  constructor(private readonly rest = new PolymarketRestClient()) {}
  previewOrder(order: CreateOrderParams, check?: () => void) {
    return this.rest.request<PreviewOrderResponse>("/v1/order/preview", {
      method: "POST",
      body: { request: order },
      beforeSend: check,
    });
  }
  createOrder(
    order: CreateOrderParams,
    beforeSend: () => void,
  ): Promise<CreateOrderResponse> {
    return this.rest.request<CreateOrderResponse>("/v1/orders", {
      method: "POST",
      body: order,
      beforeSend,
    });
  }
  async getOrder(orderId: string) {
    const response = await this.rest.request<{
      order: ParsedOrderExecution["order"];
    }>(`/v1/order/${encodeURIComponent(orderId)}`);
    return { order: response.order };
  }
  async getBalances(): Promise<AccountBalances> {
    const response = await this.rest.request<RawBalancesResponse>(
      "/v1/account/balances",
    );
    const usd = response.balances?.find(
      (balance) => balance.currency === "USD",
    );
    if (!usd) throw new Error("Polymarket returned no USD account balance.");
    return {
      currentBalance: availableCash(usd),
      buyingPower: Number(usd.buyingPower) || 0,
    };
  }
  sleep(milliseconds: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}

export function createPolymarketTradingClient() {
  return new PolymarketUS({
    keyId: process.env.POLYMARKET_KEY_ID,
    secretKey: process.env.POLYMARKET_SECRET_KEY,
    timeout: 20_000,
  });
}
