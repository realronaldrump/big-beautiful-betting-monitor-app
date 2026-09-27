# September 2026 audit remediation

The changes address all 30 findings from the audit of `f19165f`, plus the requested bet-history UI improvements. Tests use isolated SQLite and mocked exchange traffic; production verification must not enable automation or submit a test bet.

| # | Finding | Remediation | Evidence |
|---|---|---|---|
| 1 | Orders can leave the local queue after Auto-bet is switched off | Final guard executes inside signed HTTP dispatch after the shared queue; config revision is checked atomically. | polymarket-rest.test.ts |
| 2 | Saving a draft in a stale tab can silently re-enable Auto-bet | Settings-only mutations preserve enabled; stale revisions fail with 409. Off is a separate action. | automation/route.test.ts; automation-settings.test.ts |
| 3 | An unrelated rejection can allow a second bet in an already-filled market | Execution updates require the exact recorded order ID; filled stays terminal. | worker-integration.test.ts; safety-regressions.test.ts |
| 4 | Queued trading decisions use obsolete prices | Every stream quote updates the cache; evaluation and dispatch read the latest value. | worker-integration.test.ts |
| 5 | A new balance update during preview does not protect the cash reserve | Dispatch rereads streamed balances, including buying power and unresolved spending; REST cannot overwrite a newer stream event. | worker-integration.test.ts |
| 6 | Trading fees can take cash below the protected floor | Reserve validation includes conservative fees and any larger preview commission. | dispatch-regressions.test.ts |
| 7 | Work already in preview can submit after market removal or worker shutdown | Shutdown and market generation invalidation reach the dispatch guard and retry waits. | worker-integration.test.ts |
| 8 | Dashboard refreshes bypass account-wide request pacing | Web and worker requests use shared SQLite pacing, with cached/coalesced snapshots and event freshness. | polymarket-rest.test.ts; portfolio-cache.test.ts |
| 9 | Settled profit/loss excludes fees and overstates actual profit | Outcome cash accounting includes actual execution costs/proceeds, fees, and settlement payouts. | accounting-regressions.test.ts |
| 10 | NO-side trade amounts and total trading volume are incorrect | Use actual trade.cost and owned execution intent, including inverse prices for NO. | accounting-regressions.test.ts |
| 11 | The all-time P&L headline omits realized gains/losses on open positions | Headline uses full realized totals; realized event history includes partial exits. | accounting-regressions.test.ts |
| 12 | Interrupted order attempts remain “submitting” indefinitely | Recover preview-only reservations, reconcile known exchange IDs, flag unknown legacy dispatches for review without resubmitting. | dispatch-regressions.test.ts |
| 13 | HTTP responses can overwrite newer WebSocket order status | Buffer early order executions until the HTTP ID binds; acknowledgements cannot overwrite terminal outcomes. | worker-integration.test.ts; safety-regressions.test.ts |
| 14 | Preview network failures permanently exhaust markets that never received an order | Temporary preview failures defer without consuming the market rejection budget. | safety-regressions.test.ts |
| 15 | A quote-read failure after a known rejection is mislabeled as an ambiguous submission | Retry decisions read current streams, eliminating REST quote reads inside the submission catch. | dispatch-regressions.test.ts |
| 16 | Switching outcome on a later retry records the wrong side | Each retry records the actual outcome and its own local attempt identity. | safety-regressions.test.ts |
| 17 | An initial portfolio error permanently strands the page in demo mode | Initial failures return an explicit unavailable account, with live recovery enabled. | recovery.test.tsx |
| 18 | Account events arriving during a refresh are lost | Refresh queue retains one trailing update after events received in flight. | refresh-queue.test.ts |
| 19 | The master Off switch is disabled while settings are saving | Off remains enabled while saving, aborts the old UI operation, and rejects its delayed write by revision. | recovery.test.tsx; automation/route.test.ts |
| 20 | Server/browser timezone differences cause a production hydration failure | Shared Mountain-Time formatting and serialized health timestamps keep hydration deterministic. | Local/live browser console checks |
| 21 | Chart time filters measure from the last bet instead of now | Chart windows use the snapshot time and render an explicit empty state. | chart-range.test.ts; browser range check |
| 22 | The Auto-bet cash display remains stale while automation is off | Off clears worker cash; panel uses the current account balance. | worker-integration.test.ts; browser settings check |
| 23 | An empty live-market set triggers discovery every second | Empty discovery results keep their own fifteen-second cadence. | worker-integration.test.ts |
| 24 | Finished positions and settlement activity lose their original outcome | Retain meaningful pre-settlement outcome metadata. | accounting-regressions.test.ts |
| 25 | Long position lists remain invisible for many seconds | Paginate positions; remove row staggering, bound chart delays, and disable delayed animations for reduced motion. | Mobile/desktop browser and source checks |
| 26 | Documented demo startup fails without API credentials | Worker remains dormant without credentials instead of terminating the combined startup. | worker-integration.test.ts; combined dev startup |
| 27 | A stalled worker can continue to appear Armed and healthy | Expose heartbeat liveness/readiness and show stale workers as unavailable. | automation-status.test.ts |
| 28 | Order-rejection retry waits are not interruptible by settings changes | Retry waits check settings and cancellation every 250ms, without additional REST reads. | dispatch-regressions.test.ts |
| 29 | Fractional-cent reserves save successfully but show a false confirmation error | Shared cent normalization runs before both writes and confirmation. | automation-settings.test.ts; local browser save/read-back |
| 30 | Rejected market subscriptions are not recovered and their errors are hidden | Subscription failures invalidate work and reconnect; readiness requires actual subscription data. | worker-integration.test.ts |

## Additional accounting recovery

The ledger also recovers fully exited markets omitted by the positions API and excludes synthetic-short collateral from cash. A read-only replay of the captured account reconciled net trading P&L to available cash plus open value minus net account inflows. No account fixture or credentials are committed.

Legacy attempts with no exchange ID cannot be proven filled or rejected using an ID lookup. They now have an explicit review state and safe retry blocking rather than remaining submitting indefinitely.

## UI verification

Verified the local combined dev command with empty credentials and a separate SQLite path. Desktop and 390px mobile checks covered typo search, result filtering, amount ranges, sorting, expanded histories, empty time ranges, settings normalization/read-back, and CSV export. The exported file contained only the filtered rows. Console checks showed no errors. The local server was stopped after verification.

The automated suite covers transport signing/pacing/dispatch, worker lifecycle, CAS settings, account/fee calculations, snapshot cache freshness, UI recovery, search/operators/sorting/export, and chart windows.

## Host SQLite compatibility

The application uses SQLite 3.53, while the mini-PC Python maintenance tools use 3.45. The older integrity checker reports a false NULL constraint violation for an unmaterialized REAL default added to existing records. A minimal fixture reproduced this on the host despite ordinary reads finding zero NULL values; explicitly updating the field to its own value cleared the warning. Migration version 1 writes the reserve defaults into existing rows once, without changing their values or any settings/history. Regression coverage verifies both record preservation and one-time execution.
