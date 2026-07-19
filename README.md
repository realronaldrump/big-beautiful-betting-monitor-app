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

- Live sports events only
- A configurable whole-cent trigger from 1¢ through 96¢ (95¢ by default)
- Hard execution ceiling of 96¢
- Up to $1 of contract value per order, aligned to each market's quantity increment
- Immediate-or-cancel limit orders marked `MANUAL_ORDER_INDICATOR_AUTOMATIC`
- One accepted bet per market, persisted across restarts
- Three retries after an explicit rejection, with 1, 2, and 4 second delays
- No retry after an ambiguous network failure, because the first order may have reached the exchange
- A configurable cash floor; no bet fires if a $1 order could take the account below it

The dashboard switch is the master control. Turning it off stops new orders; it does not cancel or reverse an order that Polymarket already accepted.

Trigger and cash-floor edits remain drafts until you press **Save live bet settings**. The panel reads the stored values back from SQLite and shows a timestamped **Bet settings locked in** confirmation only when that independent check matches the requested settings. The on/off switch remains immediate so Auto-bet can always be stopped without saving a draft first.

## Updates

The app uses Polymarket US's private WebSocket for immediate order, position, and account-balance events. When an event arrives, the server fetches a fresh account snapshot and updates the page automatically.

- Normal operation: event-driven, with no polling delay
- Connection lost: automatic reconnection plus a 15-second REST fallback
- Reconciliation: one background refresh every 60 seconds

When Auto-bet is armed, a separate local worker queries only events marked live by Polymarket and subscribes to their market-data WebSockets. Quotes are event-driven. The worker refreshes the live-event set every 15 seconds and rechecks the latest quote and account balance immediately before an order.

Polymarket's authenticated REST limit is 20 requests per second per API key. Their documentation recommends WebSocket subscriptions instead of frequent polling.

## What it shows

- Wins, losses, pushes, and win rate
- Realized and estimated open P&L
- Cash, buying power, and open position value
- Deposits, withdrawals, rewards, rebates, and net funding
- Positions, activity, trading volume, and cumulative realized P&L

## Accounting

- Each closed market counts once.
- Positive final realized P&L is a win; negative is a loss; within half a cent of zero is a push.
- Pushes do not count toward win rate.
- Estimated open P&L is current cash value minus reported cost basis.
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
