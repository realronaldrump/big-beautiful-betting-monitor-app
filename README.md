# Big Beautiful Betting Monitor App

A private Polymarket US monitor for your record, P&L, positions, cash flow, and an optional automatic live-market strategy.

Production runs continuously on Davis's mini PC and is available inside the tailnet at [davis-mini-pc-1.tail59b3f5.ts.net/betting/](https://davis-mini-pc-1.tail59b3f5.ts.net/betting/). The Mac is the editing checkout, not an application host.

## Local checks

You need Node.js 20.9 or newer.

1. Create an API key at [polymarket.us/developer](https://polymarket.us/developer). Sign in the same way you sign in to the iPhone app.
2. In Terminal:

   ```bash
   cd /Users/davis/my-apps/big-beautiful-betting-monitor-app
   npm install
   cp .env.local.example .env.local
   ```

3. Add the key to `.env.local`:

   ```dotenv
   POLYMARKET_KEY_ID=your-key-id
   POLYMARKET_SECRET_KEY=your-secret-key
   ```

4. Run a short-lived local check when needed:

   ```bash
   npm run dev
   ```

5. Open [http://127.0.0.1:3000](http://127.0.0.1:3000), then stop the process when the check is complete. Do not leave the app running on the Mac.

Without credentials, the app uses labeled sample data.

## Automatic betting

Automation is **off by default**. Turn it on from the Auto-bet panel only when you want the app to place real orders without per-bet approval.

The strategy is:

- Live non-esports sports events only
- A configurable whole-cent trigger from 1¢ through 96¢ (95¢ by default) that cannot exceed the execution cap
- A configurable whole-cent execution cap from 1¢ through 99¢ (96¢ by default); the trigger cannot exceed it
- Up to $1 of contract value per order, aligned to each market's quantity increment
- Immediate-or-cancel limit orders marked `MANUAL_ORDER_INDICATOR_AUTOMATIC`
- One accepted bet per market, persisted across restarts
- Three retries after an explicit rejection, with 1, 2, and 4 second delays
- No retry after an ambiguous network failure, because the first order may have reached the exchange
- A configurable cash floor that protects available cash after contract cost, conservatively reserved fees, and unresolved orders
- Final settings, quote, market, and balance checks at HTTP dispatch; queued work is invalidated by Off or a settings change

The dashboard switch is the master control. Turning it off stops new orders; it does not cancel or reverse an order that Polymarket already accepted.

Trigger, execution-cap, and cash-floor edits remain drafts until you press **Save settings**. The panel reads the stored values back from SQLite and shows a timestamped **Bet settings locked in** confirmation only when that independent check matches the requested settings. The on/off switch remains immediate so Auto-bet can always be stopped without saving a draft first. Off supersedes an in-progress save. Settings edits use a revision check and never change the master switch; stale writes are rejected.

## Updates

The app uses Polymarket US's private WebSocket for immediate order, position, and account-balance events. When an event arrives, the server fetches a fresh account snapshot and updates the page automatically.

- Normal operation: event-driven, with no polling delay
- Connection lost: automatic reconnection plus a 15-second REST fallback
- Reconciliation: one background refresh every 60 seconds

When Auto-bet is armed, a separate local worker queries only events marked live by Polymarket and subscribes to their market-data WebSockets. Quotes are event-driven and the latest quote is retained while evaluation is in flight. The worker refreshes the live-event set every 15 seconds and reads the latest streamed quote and balance immediately before dispatch. Quote freshness and account subscription readiness gate all submissions. Rejection waits are interrupted by settings changes or shutdown.

The web process and worker share a SQLite-backed request budget (at most eight REST request starts per second for this app). Concurrent dashboard reads share a snapshot refresh; an event arriving during a refresh causes one trailing refresh. A failed initial account load shows an unavailable state and retries, rather than substituting sample money.

Polymarket's authenticated REST limit is 20 requests per second per API key. Their documentation recommends WebSocket subscriptions instead of frequent polling.

## Finding and comparing bets

The default **Bets** view contains the entire account history, grouped once per market.

- Filter All, Open, Wins, Losses, Ties/refunds, or all finished markets.
- Sort by newest/oldest, largest/smallest amount bet, highest profit/biggest loss, or market name. Amount, P&L, and date column headings are also sortable.
- Combine minimum/maximum stake and inclusive date filters. Dates use Mountain Time consistently on the server and in the browser.
- Search words in any order across teams, markets, outcomes, market IDs, and result labels. Minor spelling errors are tolerated. Quoted phrases are exact; `-word` excludes a term. Optional operators include `stake:>=5`, `pnl:<0`, and `result:win`.
- Every active filter is visible and removable. No-match views explain how to reset them.
- Expand a market to inspect stake, recorded fees, realized/open P&L, and its trade/settlement history.
- Page through 10/25/50/100 bets at a time, or export all matching results as CSV (not just the current page).

**Performance** retains P&L charts, results, and cash flow. **Activity** searches and pages through the full trade/cash history. Bet filters survive switching views. Auto-bet's master switch stays accessible while its detailed settings are collapsed.

## What it shows

- Wins, losses, pushes, and win rate
- Realized and estimated open P&L
- Cash, buying power, and open position value
- Deposits, withdrawals, rewards, rebates, and net funding
- Positions, activity, trading volume, and cumulative realized P&L

## Accounting

- Each closed market counts once.
- Positive final net P&L is a win; negative is a loss; within half a cent of zero is a push.
- Pushes do not count toward win rate.
- Stake and net P&L use executed cash costs/proceeds and resolution payouts, including charged fees. Settlement metadata retains the original outcome; fully exited markets omitted by the positions endpoint are recovered from trades.
- Estimated open P&L is current position value minus the remaining cost basis. Realized history includes partial exits on still-open positions.
- Cash excludes collateral reserved for synthetic shorts; this avoids counting collateral and the contract value twice.
- Missing historical cost information stays unavailable rather than becoming a zero-dollar stake.
- Net funding is completed deposits minus completed withdrawals.
- Advanced deposits are excluded to avoid counting a pending deposit twice.

## Security

- The API secret stays in `.env.local` and never reaches the browser.
- `.env.local` is ignored by Git.
- Automatic strategy state is stored locally in `.data/automation.sqlite`, which is also ignored by Git.
- Development and production commands bind to `127.0.0.1`.
- The browser receives only normalized account data.
- Settings changes require a same-origin request with a custom action header.
- Production is exposed only through the Tailscale tailnet; Docker binds the backend to mini-PC loopback.

## Production and updates

- Source of truth: `main` on `realronaldrump/big-beautiful-betting-monitor-app`
- Runtime: Docker on `davis-mini-pc-1` (`100.96.182.111`)
- Tailnet URL: `https://davis-mini-pc-1.tail59b3f5.ts.net/betting/`
- Route: Tailscale Serve → Caddy → mini-portal streaming proxy → `127.0.0.1:8720`
- Container image: `ghcr.io/realronaldrump/big-beautiful-betting-monitor-app:main`
- Compose file: `deploy/compose.yaml`
- Secrets: `/home/davis/.config/betting-monitor/betting-monitor.env` on the mini PC only
- State: `/home/davis/.local/share/betting-monitor/automation.sqlite` on the mini PC only

Every push to `main` runs tests, type checking, linting, and a production build in GitHub Actions. A successful run publishes a new `linux/amd64` container image. The mini PC's existing labeled Watchtower checks every five minutes, pulls that image, and restarts the container. Persistent credentials and automation state are mounted from the host and survive replacements.

For an infrastructure or Compose change:

```bash
ssh 100.96.182.111
cd /home/davis/big-beautiful-betting-monitor-app
git pull --ff-only origin main
docker compose -f deploy/compose.yaml pull
docker compose -f deploy/compose.yaml up -d
```

See `deploy/README.md` for health checks, route details, storage locations, and recovery notes.

## Commands

```bash
npm run dev
npm run build
npm start
npm test
npm run typecheck
npm run lint
```

## API references

- [Polymarket US private WebSocket](https://docs.polymarket.us/api-reference/websocket/private)
- [Polymarket US market WebSocket](https://docs.polymarket.us/api-reference/websocket/markets)
- [Polymarket US order entry](https://docs.polymarket.us/api-reference/orders/create-order)
- [Polymarket US order rules](https://docs.polymarket.us/api-reference/orders/overview)
- [Polymarket US rate limits](https://docs.polymarket.us/api-reference/rate-limits)
- [Portfolio API](https://docs.polymarket.us/api-reference/portfolio/overview)
- [Authentication](https://docs.polymarket.us/api-reference/authentication)

## Recovery and health

Attempts persist their local identity and pre-submit/dispatch phase. On restart, preview-only reservations are safe to reevaluate; known exchange IDs are reconciled through read-only order lookup. An interrupted legacy submission with no exchange ID is explicitly marked **Needs review** and remains blocked from automatic retries. It is not assumed to have failed and is never blindly resubmitted.

The health response includes storage availability and worker heartbeat/liveness/readiness. A stale heartbeat returns HTTP 503 and shows **Worker unavailable** instead of Armed. Failed subscriptions close the affected connections and retry; receiving a TCP/WebSocket connection alone does not establish subscription readiness.

Without credentials the worker remains dormant, so the documented combined dev/start commands can serve demo data. Production's secrets and SQLite path stay outside the repository. Migrations are additive and preserve existing switches, thresholds, and attempt history.

The September 2026 audit remediation and regression coverage are mapped in [docs/audit-remediation.md](docs/audit-remediation.md).
