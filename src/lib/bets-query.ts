import type { BetResult, PositionRow } from "./dashboard-types";
import { dateKey } from "./format";

export type BetSort =
  | "newest"
  | "oldest"
  | "stake-desc"
  | "stake-asc"
  | "profit-desc"
  | "profit-asc"
  | "name";
export type BetFilter = "all" | "closed" | BetResult;
export interface BetFilters {
  query: string;
  result: BetFilter;
  minStake: string;
  maxStake: string;
  from: string;
  to: string;
}
export const EMPTY_BET_FILTERS: BetFilters = {
  query: "",
  result: "all",
  minStake: "",
  maxStake: "",
  from: "",
  to: "",
};
export const BET_SORTS: { value: BetSort; label: string }[] = [
  { value: "newest", label: "Most recent" },
  { value: "oldest", label: "Oldest first" },
  { value: "stake-desc", label: "Largest amount bet" },
  { value: "stake-asc", label: "Smallest amount bet" },
  { value: "profit-desc", label: "Highest profit" },
  { value: "profit-asc", label: "Biggest loss" },
  { value: "name", label: "Market A–Z" },
];
export function betPnl(bet: PositionRow) {
  return bet.realizedPnl + bet.openPnl;
}
const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
function oneEditApart(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 1) return false;
  let edits = 0,
    i = 0,
    j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (left.length >= right.length) i++;
    if (right.length >= left.length) j++;
  }
  return edits + (i < left.length || j < right.length ? 1 : 0) <= 1;
}
function searchable(bet: PositionRow) {
  const status = {
    win: "win wins won winner",
    loss: "loss losses lost loser",
    push: "push tie ties refund refunded",
    open: "open pending unsettled",
  }[bet.result];
  const side =
    bet.side === "no" ? "no short" : bet.side === "yes" ? "yes long" : "";
  return normalize(
    [
      bet.title,
      bet.outcome,
      bet.marketSlug,
      bet.eventSlug || "",
      status,
      side,
      dateKey(bet.updatedAt),
    ].join(" "),
  );
}
function textMatches(haystack: string, query: string, exact: boolean) {
  const needle = normalize(query);
  if (!needle) return true;
  if (exact || needle.includes(" ")) return haystack.includes(needle);
  const words = haystack.split(" ");
  return words.some(
    (word) =>
      word === needle ||
      (needle.length > 2 && word.startsWith(needle)) ||
      (needle.length >= 5 && oneEditApart(word, needle)),
  );
}
const compareNumber = (value: number, operator: string, target: number) =>
  operator === ">"
    ? value > target
    : operator === ">="
      ? value >= target
      : operator === "<"
        ? value < target
        : operator === "<="
          ? value <= target
          : value === target;

export function queryBets(
  bets: PositionRow[],
  filters: BetFilters,
  sort: BetSort,
) {
  const minimum = filters.minStake === "" ? null : Number(filters.minStake);
  const maximum = filters.maxStake === "" ? null : Number(filters.maxStake);
  let error: string | null = null;
  if (
    (minimum !== null && (!Number.isFinite(minimum) || minimum < 0)) ||
    (maximum !== null && (!Number.isFinite(maximum) || maximum < 0))
  )
    error = "Enter a valid amount of zero or more.";
  else if (minimum !== null && maximum !== null && minimum > maximum)
    error = "Minimum amount cannot exceed maximum amount.";
  else if (filters.from && filters.to && filters.from > filters.to)
    error = "Start date must be on or before end date.";
  const tokens = [
    ...filters.query.matchAll(/(-?)(?:"([^"]+)"|'([^']+)'|(\S+))/g),
  ];
  const predicates: ((bet: PositionRow, text: string) => boolean)[] = [];
  for (const token of tokens) {
    const value = token[2] || token[3] || token[4];
    const numeric =
      /^(stake|amount|pnl|profit):?(>=|<=|>|<|=)(\$?-?\d+(?:\.\d+)?)$/i.exec(
        value,
      );
    const result =
      /^(?:result|status):(win|wins|loss|losses|open|push|tie|closed)$/i.exec(
        value,
      );
    let predicate: (bet: PositionRow, text: string) => boolean;
    if (numeric) {
      predicate = (bet) => {
        const amount = /stake|amount/i.test(numeric[1])
          ? bet.amountBet
          : betPnl(bet);
        return (
          amount !== null &&
          amount !== undefined &&
          compareNumber(amount, numeric[2], Number(numeric[3].replace("$", "")))
        );
      };
    } else if (result) {
      const choice =
        (
          { wins: "win", losses: "loss", tie: "push" } as Record<string, string>
        )[result[1].toLowerCase()] || result[1].toLowerCase();
      predicate = (bet) =>
        choice === "closed" ? !bet.isOpen : bet.result === choice;
    } else {
      if (/^(stake|amount|pnl|profit)[:<>=]/i.test(value))
        error = "Use an amount such as stake:>=5 or pnl:<0.";
      predicate = (_, text) =>
        textMatches(text, value, Boolean(token[2] || token[3]));
    }
    predicates.push(
      token[1] ? (bet, text) => !predicate(bet, text) : predicate,
    );
  }
  const matches = error
    ? []
    : bets.filter((bet) => {
        if (
          filters.result !== "all" &&
          (filters.result === "closed"
            ? bet.isOpen
            : bet.result !== filters.result)
        )
          return false;
        if (
          minimum !== null &&
          (bet.amountBet == null || bet.amountBet < minimum)
        )
          return false;
        if (
          maximum !== null &&
          (bet.amountBet == null || bet.amountBet > maximum)
        )
          return false;
        const day = dateKey(bet.updatedAt);
        if ((filters.from || filters.to) && !day) return false;
        if (
          (filters.from && day < filters.from) ||
          (filters.to && day > filters.to)
        )
          return false;
        const text = searchable(bet);
        return predicates.every((predicate) => predicate(bet, text));
      });
  matches.sort((a, b) => {
    let difference = 0;
    if (sort.startsWith("stake")) {
      if (a.amountBet == null || b.amountBet == null)
        difference = Number(a.amountBet == null) - Number(b.amountBet == null);
      else
        difference =
          (a.amountBet - b.amountBet) * (sort.endsWith("asc") ? 1 : -1);
    } else if (sort.startsWith("profit"))
      difference = (betPnl(a) - betPnl(b)) * (sort.endsWith("asc") ? 1 : -1);
    else if (sort === "name") difference = a.title.localeCompare(b.title);
    else
      difference =
        ((Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0)) *
        (sort === "oldest" ? 1 : -1);
    return difference || a.marketSlug.localeCompare(b.marketSlug);
  });
  return { bets: matches, error };
}

export function betsCsv(bets: PositionRow[]) {
  const cell = (value: string | number | null | undefined) => {
    let text = value == null ? "" : String(value);
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text))
      text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows: (string | number | null | undefined)[][] = [
    [
      "Market",
      "Outcome",
      "Result",
      "Amount bet USD",
      "Profit loss USD",
      "Realized USD",
      "Open P&L USD",
      "Fees USD",
      "Last update",
      "Market ID",
    ],
  ];
  for (const bet of bets)
    rows.push([
      bet.title,
      bet.outcome,
      bet.result,
      bet.amountBet,
      betPnl(bet),
      bet.realizedPnl,
      bet.openPnl,
      bet.feesPaid,
      bet.updatedAt,
      bet.marketSlug,
    ]);
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
