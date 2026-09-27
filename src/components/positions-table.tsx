"use client";

import { Fragment, useDeferredValue, useMemo, useState } from "react";
import type { ActivityRow, PositionRow } from "@/lib/dashboard-types";
import {
  BET_SORTS,
  EMPTY_BET_FILTERS,
  betPnl,
  betsCsv,
  queryBets,
  type BetFilter,
  type BetFilters,
  type BetSort,
} from "@/lib/bets-query";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";

const RESULTS: { value: BetFilter; label: string }[] = [
  { value: "all", label: "All bets" },
  { value: "open", label: "Open" },
  { value: "win", label: "Wins" },
  { value: "loss", label: "Losses" },
  { value: "push", label: "Ties / refunds" },
  { value: "closed", label: "All finished" },
];
const RESULT_LABELS = {
  win: "Win",
  loss: "Loss",
  push: "Tie / refund",
  open: "Open",
};

export function BetsExplorer({
  positions,
  activities,
}: {
  positions: PositionRow[];
  activities: ActivityRow[];
}) {
  const [filters, setFilters] = useState<BetFilters>(EMPTY_BET_FILTERS);
  const [sort, setSort] = useState<BetSort>("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [expanded, setExpanded] = useState<string | null>(null);
  const query = useDeferredValue(filters.query);
  const selected = useMemo(
    () => queryBets(positions, { ...filters, query }, sort),
    [positions, filters, query, sort],
  );
  const totalPages = Math.max(1, Math.ceil(selected.bets.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * pageSize;
  const visible = selected.bets.slice(start, start + pageSize);
  const stake = selected.bets.reduce(
    (total, bet) => total + (bet.amountBet || 0),
    0,
  );
  const knownAmounts = selected.bets.filter(
    (bet) => bet.amountBet != null,
  ).length;
  const pnl = selected.bets.reduce((total, bet) => total + betPnl(bet), 0);
  const filterCount = Object.values(filters).filter(
    (value) => value !== "" && value !== "all",
  ).length;
  const counts = useMemo(
    () => ({
      all: positions.length,
      open: positions.filter((p) => p.isOpen).length,
      closed: positions.filter((p) => !p.isOpen).length,
      win: positions.filter((p) => p.result === "win").length,
      loss: positions.filter((p) => p.result === "loss").length,
      push: positions.filter((p) => p.result === "push").length,
    }),
    [positions],
  );
  const change = (patch: Partial<BetFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(0);
  };
  const changeSort = (next: BetSort) => {
    setSort(next);
    setPage(0);
  };
  const clear = () => {
    setFilters(EMPTY_BET_FILTERS);
    setPage(0);
  };
  const exportResults = () => {
    const url = URL.createObjectURL(
      new Blob([betsCsv(selected.bets)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "betting-monitor-bets.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };
  const activeChips = [
    ...(filters.query
      ? [{ label: `Search: ${filters.query}`, patch: { query: "" } }]
      : []),
    ...(filters.result !== "all"
      ? [
          {
            label: RESULTS.find((r) => r.value === filters.result)!.label,
            patch: { result: "all" as const },
          },
        ]
      : []),
    ...(filters.minStake
      ? [{ label: `At least $${filters.minStake}`, patch: { minStake: "" } }]
      : []),
    ...(filters.maxStake
      ? [{ label: `Up to $${filters.maxStake}`, patch: { maxStake: "" } }]
      : []),
    ...(filters.from
      ? [{ label: `From ${filters.from}`, patch: { from: "" } }]
      : []),
    ...(filters.to
      ? [{ label: `Through ${filters.to}`, patch: { to: "" } }]
      : []),
  ];

  return (
    <section className="bets panel" aria-labelledby="bets-heading">
      <header className="bets__heading">
        <div>
          <span className="section-eyebrow">Every position. Every result.</span>
          <h2 id="bets-heading">Your bets</h2>
          <p>
            Search the full history, find your biggest bets, and compare
            results.
          </p>
        </div>
        <button
          className="quiet-button"
          type="button"
          onClick={exportResults}
          disabled={!selected.bets.length}
        >
          Export results <span aria-hidden="true">↗</span>
        </button>
      </header>
      <div className="bets__search-row">
        <label className="bets__search">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Search bets</span>
          <input
            type="search"
            placeholder="Search teams, markets, or outcomes…"
            value={filters.query}
            onChange={(event) => change({ query: event.target.value })}
            aria-describedby="bet-search-help"
          />
        </label>
        <button
          className="quiet-button"
          type="button"
          aria-expanded={showFilters}
          aria-controls="bet-filters"
          onClick={() => setShowFilters(!showFilters)}
        >
          Filters{filterCount ? ` · ${filterCount}` : ""}
        </button>
        <label className="bets__sort">
          <span>Sort by</span>
          <select
            aria-label="Sort bets"
            value={sort}
            onChange={(event) => changeSort(event.target.value as BetSort)}
          >
            {BET_SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="bets__result-tabs"
        role="group"
        aria-label="Filter bet results"
      >
        {RESULTS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filters.result === option.value}
            onClick={() => change({ result: option.value })}
          >
            {option.label}
            <span>{counts[option.value]}</span>
          </button>
        ))}
      </div>
      {showFilters ? (
        <div className="bets__filters" id="bet-filters">
          <label>
            Minimum amount bet
            <div className="money-input">
              <span>$</span>
              <input
                aria-label="Minimum amount bet"
                type="number"
                min="0"
                step="0.01"
                placeholder="Any"
                value={filters.minStake}
                onChange={(event) => change({ minStake: event.target.value })}
              />
            </div>
          </label>
          <label>
            Maximum amount bet
            <div className="money-input">
              <span>$</span>
              <input
                aria-label="Maximum amount bet"
                type="number"
                min="0"
                step="0.01"
                placeholder="Any"
                value={filters.maxStake}
                onChange={(event) => change({ maxStake: event.target.value })}
              />
            </div>
          </label>
          <label>
            Updated from
            <input
              aria-label="Bets updated from"
              type="date"
              value={filters.from}
              onChange={(event) => change({ from: event.target.value })}
            />
          </label>
          <label>
            Updated through
            <input
              aria-label="Bets updated through"
              type="date"
              value={filters.to}
              onChange={(event) => change({ to: event.target.value })}
            />
          </label>
        </div>
      ) : null}
      <details className="search-help" id="bet-search-help">
        <summary>Search tips</summary>
        <p>
          Combine words in any order. Minor typos are tolerated. Use quotes for
          an exact phrase, or a minus sign to exclude a word. You can also enter{" "}
          <code>stake:&gt;=5</code>, <code>pnl:&lt;0</code>, or{" "}
          <code>result:win</code>. Dates use Mountain Time.
        </p>
      </details>
      {activeChips.length ? (
        <div className="filter-chips" aria-label="Active bet filters">
          {activeChips.map((chip) => (
            <button
              type="button"
              key={chip.label}
              onClick={() => change(chip.patch)}
              aria-label={`Remove ${chip.label} filter`}
            >
              {chip.label}
              <span aria-hidden="true">×</span>
            </button>
          ))}
          <button className="clear-filters" type="button" onClick={clear}>
            Clear all
          </button>
        </div>
      ) : null}
      {selected.error ? (
        <p className="bets__error" role="alert">
          {selected.error}
        </p>
      ) : null}
      <div className="bets__summary" role="status" aria-live="polite">
        <span>
          <strong>{selected.bets.length}</strong>{" "}
          {selected.bets.length === 1 ? "bet" : "bets"}
          {filterCount ? ` of ${positions.length}` : ""}
        </span>
        <span>
          <strong>{knownAmounts ? formatCurrency(stake) : "—"}</strong>{" "}
          {knownAmounts < selected.bets.length
            ? "known amount bet"
            : "amount bet"}
        </span>
        <span>
          <strong className={pnl >= 0 ? "is-positive" : "is-negative"}>
            {formatCurrency(pnl, true)}
          </strong>{" "}
          total P&amp;L
        </span>
        {query !== filters.query ? <span>Searching…</span> : null}
      </div>
      {visible.length ? (
        <div className="bets__table-wrap" aria-busy={query !== filters.query}>
          <table className="bets__table">
            <thead>
              <tr>
                <th scope="col">Market &amp; outcome</th>
                <th scope="col">Result</th>
                <th
                  scope="col"
                  aria-sort={
                    sort.startsWith("stake")
                      ? sort.endsWith("asc")
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      changeSort(
                        sort === "stake-desc" ? "stake-asc" : "stake-desc",
                      )
                    }
                  >
                    Amount bet{" "}
                    {sort.startsWith("stake")
                      ? sort.endsWith("asc")
                        ? "↑"
                        : "↓"
                      : "↕"}
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={
                    sort.startsWith("profit")
                      ? sort.endsWith("asc")
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      changeSort(
                        sort === "profit-desc" ? "profit-asc" : "profit-desc",
                      )
                    }
                  >
                    Profit / loss{" "}
                    {sort.startsWith("profit")
                      ? sort.endsWith("asc")
                        ? "↑"
                        : "↓"
                      : "↕"}
                  </button>
                </th>
                <th
                  scope="col"
                  aria-sort={
                    sort === "newest"
                      ? "descending"
                      : sort === "oldest"
                        ? "ascending"
                        : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      changeSort(sort === "newest" ? "oldest" : "newest")
                    }
                  >
                    Updated{" "}
                    {sort === "newest" ? "↓" : sort === "oldest" ? "↑" : "↕"}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((bet) => {
                const value = betPnl(bet);
                const isExpanded = expanded === bet.marketSlug;
                const history = activities.filter(
                  (activity) => activity.marketSlug === bet.marketSlug,
                );
                return (
                  <Fragment key={bet.marketSlug}>
                    <tr
                      className="bet-row"
                      data-expanded={isExpanded || undefined}
                    >
                      <td className="bet-row__market">
                        <button
                          type="button"
                          className="bet-row__title"
                          aria-expanded={isExpanded}
                          aria-controls={`detail-${bet.marketSlug}`}
                          onClick={() =>
                            setExpanded(isExpanded ? null : bet.marketSlug)
                          }
                        >
                          {bet.title}
                          <span aria-hidden="true">
                            {isExpanded ? "−" : "+"}
                          </span>
                        </button>
                        <div className="bet-row__outcome">
                          <span
                            className={`outcome-dot outcome-dot--${bet.side || "yes"}`}
                            aria-hidden="true"
                          />
                          {bet.outcome}
                          {bet.side &&
                          bet.side !== "mixed" &&
                          !["yes", "no"].includes(bet.outcome.toLowerCase()) ? (
                            <small>{bet.side.toUpperCase()}</small>
                          ) : null}
                        </div>
                      </td>
                      <td className="bet-row__result">
                        <span
                          className={`result-tag result-tag--${bet.result}`}
                        >
                          {RESULT_LABELS[bet.result]}
                        </span>
                      </td>
                      <td data-label="Amount bet">
                        <strong>
                          {bet.amountBet == null
                            ? "—"
                            : formatCurrency(bet.amountBet)}
                        </strong>
                        <small>
                          {bet.tradeCount || 0}{" "}
                          {(bet.tradeCount || 0) === 1 ? "trade" : "trades"}
                        </small>
                      </td>
                      <td data-label="Profit / loss">
                        <strong
                          className={value >= 0 ? "is-positive" : "is-negative"}
                        >
                          {formatCurrency(value, true)}
                        </strong>
                        <small>
                          {bet.isOpen ? "includes open value" : "after fees"}
                        </small>
                      </td>
                      <td className="bet-row__date" data-label="Updated">
                        <time dateTime={bet.updatedAt}>
                          {formatDate(bet.updatedAt)}
                        </time>
                        <small>
                          {isExpanded
                            ? "Details open"
                            : "Select market for details"}
                        </small>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr className="bet-detail-row">
                        <td colSpan={5}>
                          <div
                            className="bet-detail"
                            id={`detail-${bet.marketSlug}`}
                          >
                            <dl>
                              <div>
                                <dt>Amount bet</dt>
                                <dd>
                                  {bet.amountBet == null
                                    ? "Unavailable"
                                    : formatCurrency(bet.amountBet)}
                                </dd>
                              </div>
                              <div>
                                <dt>Recorded fees</dt>
                                <dd>{formatCurrency(bet.feesPaid || 0)}</dd>
                              </div>
                              <div>
                                <dt>Realized P&amp;L</dt>
                                <dd>{formatCurrency(bet.realizedPnl, true)}</dd>
                              </div>
                              <div>
                                <dt>Open P&amp;L</dt>
                                <dd>{formatCurrency(bet.openPnl, true)}</dd>
                              </div>
                              <div>
                                <dt>Contracts held</dt>
                                <dd>
                                  {formatNumber(Math.abs(bet.quantity), 2)}
                                </dd>
                              </div>
                              <div>
                                <dt>First entry</dt>
                                <dd>
                                  {formatDate(
                                    bet.openedAt || bet.updatedAt,
                                    true,
                                  )}
                                </dd>
                              </div>
                            </dl>
                            {history.length ? (
                              <>
                                <h3>Trade &amp; settlement history</h3>
                                <ol className="bet-history">
                                  {history.slice(0, 50).map((entry, index) => (
                                    <li key={`${entry.id}-${index}`}>
                                      <div>
                                        <strong>
                                          {entry.kind === "settlement"
                                            ? "Settled"
                                            : "Trade"}
                                        </strong>
                                        <span>{entry.detail}</span>
                                        <time dateTime={entry.occurredAt}>
                                          {formatDate(entry.occurredAt, true)}
                                        </time>
                                      </div>
                                      <strong>
                                        {entry.kind === "settlement" &&
                                        entry.realizedPnl !== null
                                          ? formatCurrency(
                                              entry.realizedPnl,
                                              true,
                                            )
                                          : entry.amount !== null
                                            ? formatCurrency(entry.amount)
                                            : "—"}
                                      </strong>
                                    </li>
                                  ))}
                                </ol>
                                {history.length > 50 ? (
                                  <p>Showing the latest 50 entries.</p>
                                ) : null}
                              </>
                            ) : (
                              <p>
                                No detailed trade history was returned for this
                                market.
                              </p>
                            )}
                            <p className="bet-detail__id">
                              Market ID: {bet.marketSlug}
                            </p>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bets__empty">
          <span aria-hidden="true">⌕</span>
          <h3>
            {positions.length
              ? "No bets match these filters"
              : "Your first bet starts here"}
          </h3>
          <p>
            {positions.length
              ? "Try fewer words, a wider date range, or a different result."
              : "Your account history will appear automatically."}
          </p>
          {filterCount ? (
            <button type="button" className="quiet-button" onClick={clear}>
              Clear filters
            </button>
          ) : null}
        </div>
      )}
      <footer className="bets__footer">
        <p>
          {selected.bets.length
            ? `${start + 1}–${Math.min(start + pageSize, selected.bets.length)} of ${selected.bets.length}`
            : "0 results"}
          <span>
            {" "}
            · Amount bet includes entry fees. Each market appears once.
          </span>
        </p>
        <div className="pagination">
          <label>
            <span className="sr-only">Bets per page</span>
            <select
              aria-label="Bets per page"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(0);
              }}
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size} per page
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-label="Previous page of bets"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            ←
          </button>
          <span>
            {currentPage + 1} / {totalPages}
          </span>
          <button
            type="button"
            aria-label="Next page of bets"
            disabled={currentPage + 1 >= totalPages}
            onClick={() => setPage(currentPage + 1)}
          >
            →
          </button>
        </div>
      </footer>
    </section>
  );
}
