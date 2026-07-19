export interface ParsedOrderExecution {
  type?: string;
  text?: string;
  orderRejectReason?: string;
  order: {
    id?: string;
    marketSlug: string;
    state?: string;
    cumQuantity?: number;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractAccountBalances(message: unknown) {
  const envelope = record(message);
  if (!envelope) return null;

  const payload = record(
    envelope.accountBalanceSubscriptionSnapshot ||
      envelope.accountBalancesSnapshot ||
      envelope.accountBalanceSubscriptionUpdate ||
      envelope.accountBalanceUpdate,
  );
  if (!payload) return null;

  const balances = Array.isArray(payload.balances) ? payload.balances : [];
  const usd =
    balances.map(record).find((balance) => balance?.currency === "USD") ||
    balances.map(record).find(Boolean) ||
    payload;
  if (!usd) return null;

  const currentBalance = finiteNumber(usd.currentBalance ?? usd.balance);
  const buyingPower = finiteNumber(usd.buyingPower);
  if (currentBalance === null || buyingPower === null) return null;

  return { currentBalance, buyingPower };
}

export function extractOrderExecution(
  message: unknown,
): ParsedOrderExecution | null {
  const envelope = record(message);
  if (!envelope) return null;

  const update = record(
    envelope.orderSubscriptionUpdate || envelope.orderUpdate,
  );
  if (!update) return null;
  const execution = record(update.execution);
  const order = record(execution?.order);
  if (!execution || !order || typeof order.marketSlug !== "string") return null;

  return {
    type: typeof execution.type === "string" ? execution.type : undefined,
    text: typeof execution.text === "string" ? execution.text : undefined,
    orderRejectReason:
      typeof execution.orderRejectReason === "string"
        ? execution.orderRejectReason
        : undefined,
    order: {
      id: typeof order.id === "string" ? order.id : undefined,
      marketSlug: order.marketSlug,
      state: typeof order.state === "string" ? order.state : undefined,
      cumQuantity:
        typeof order.cumQuantity === "number" ? order.cumQuantity : undefined,
    },
  };
}
