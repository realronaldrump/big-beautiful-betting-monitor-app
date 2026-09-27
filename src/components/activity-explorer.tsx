"use client";
import { useMemo, useState } from "react";
import { ActivityFeed, type ActivityView } from "./activity-feed";
import type { ActivityRow } from "@/lib/dashboard-types";

export function ActivityExplorer({
  activities,
}: {
  activities: ActivityRow[];
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ActivityView>("all");
  const [page, setPage] = useState(0);
  const filtered = useMemo(
    () =>
      activities.filter(
        (entry) =>
          (view === "all" ||
            (view === "cash"
              ? entry.kind === "cash"
              : entry.kind === "trade" || entry.kind === "settlement")) &&
          `${entry.label} ${entry.detail} ${entry.type} ${entry.marketSlug || ""}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [activities, view, query],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const active = Math.min(page, pages - 1);
  return (
    <section
      className="activity-explorer panel"
      aria-labelledby="activity-heading"
    >
      <header className="bets__heading">
        <div>
          <span className="section-eyebrow">The full account history</span>
          <h2 id="activity-heading">Activity</h2>
          <p>Trades, settlements, deposits, and rewards.</p>
        </div>
      </header>
      <div className="bets__search-row">
        <label className="bets__search">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Search activity</span>
          <input
            type="search"
            placeholder="Search account activity…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <div
          className="segmented"
          role="group"
          aria-label="Filter account activity"
        >
          {(
            [
              { value: "all", label: "All" },
              { value: "markets", label: "Bets" },
              { value: "cash", label: "Cash" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={view === option.value}
              onClick={() => {
                setView(option.value);
                setPage(0);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <p className="activity-explorer__count" role="status">
        {filtered.length} matching entries
      </p>
      <ActivityFeed
        activities={filtered.slice(active * 25, active * 25 + 25)}
        view="all"
        limit={25}
      />
      <footer className="bets__footer">
        <p>
          {filtered.length
            ? `${active * 25 + 1}–${Math.min(active * 25 + 25, filtered.length)} of ${filtered.length}`
            : "No results"}
        </p>
        <div className="pagination">
          <button
            type="button"
            disabled={active === 0}
            onClick={() => setPage(active - 1)}
            aria-label="Previous activity page"
          >
            ←
          </button>
          <span>
            {active + 1} / {pages}
          </span>
          <button
            type="button"
            disabled={active + 1 >= pages}
            onClick={() => setPage(active + 1)}
            aria-label="Next activity page"
          >
            →
          </button>
        </div>
      </footer>
    </section>
  );
}
