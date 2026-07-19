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
