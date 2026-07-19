import type { CSSProperties } from "react";
import type { ActivityKind, ActivityRow } from "@/lib/dashboard-types";
import { formatCurrency, formatDate } from "@/lib/format";

export type ActivityView = "all" | "markets" | "cash";

interface ActivityFeedProps {
  activities: ActivityRow[];
  view: ActivityView;
}

const KIND_GLYPHS: Record<ActivityKind, string> = {
  trade: "⇄",
  settlement: "◆",
  cash: "$",
  other: "·",
};

function kindMatchesView(kind: ActivityKind, view: ActivityView): boolean {
  if (view === "all") return true;
  if (view === "cash") return kind === "cash";
  return kind === "trade" || kind === "settlement";
}

export function ActivityFeed({ activities, view }: ActivityFeedProps) {
  const visibleActivities = activities
    .filter((activity) => kindMatchesView(activity.kind, view))
    .slice(0, 12);

  if (!visibleActivities.length) {
    return (
      <div className="table-empty">
        <span className="empty-glyph" aria-hidden="true">
          ◌
        </span>
        <p>No activity in this lane yet.</p>
      </div>
    );
  }

  return (
    <ol className="feed">
      {visibleActivities.map((activity, index) => {
        const displayAmount =
          activity.kind === "settlement" ? activity.realizedPnl : activity.amount;
        const isTradeNotional = activity.kind === "trade";
        return (
          <li
            className="feed__item"
            key={activity.id}
            style={{ "--row-index": index } as CSSProperties}
          >
            <span
              className={`feed__glyph feed__glyph--${activity.kind}`}
              aria-hidden="true"
            >
              {KIND_GLYPHS[activity.kind]}
            </span>
            <div className="feed__copy">
              <p className="feed__kicker">
                {activity.type.replace("ACTIVITY_TYPE_", "").replaceAll("_", " ")}
              </p>
              <h3>{activity.label}</h3>
              <p className="feed__detail">{activity.detail}</p>
            </div>
            <div className="feed__amount">
              {displayAmount !== null ? (
                <strong
                  className={
                    isTradeNotional
                      ? ""
                      : displayAmount >= 0
                        ? "is-positive"
                        : "is-negative"
                  }
                >
                  {formatCurrency(displayAmount, !isTradeNotional)}
                </strong>
              ) : (
                <strong>—</strong>
              )}
              <time dateTime={activity.occurredAt}>
                {formatDate(activity.occurredAt)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
