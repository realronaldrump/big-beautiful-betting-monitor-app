# Mini-PC deployment runbook

The production application runs only on `davis-mini-pc-1` (`100.96.182.111`). The Mac checkout is for editing, tests, and builds; `.claude/launch.json` intentionally has no launch configurations.

## Request path

1. Tailscale Serve terminates HTTPS for `davis-mini-pc-1.tail59b3f5.ts.net` and forwards the root service to Caddy on `127.0.0.1:8700`.
2. Caddy keeps the established app routes and sends unmatched paths to `mini-portal` on `127.0.0.1:8710`.
3. The user-owned `/home/davis/mini-portal/mini_portal.py` streams `/betting` and `/betting/*` to `127.0.0.1:8720`, preserving `Host`, `X-Forwarded-Host`, and `X-Forwarded-Proto: https` so protected settings writes remain same-origin.
4. Docker publishes the container's port 3000 only on mini-PC loopback port 8720.

The portal source also has a Betting Monitor card with its health URL set to `http://127.0.0.1:8720/betting/api/health`. Timestamped pre-change backups are stored as `/home/davis/mini-portal/mini_portal.py.bak-*`.

## Persistent host data

- Credentials: `/home/davis/.config/betting-monitor/betting-monitor.env`, mode 600
- Automation database: `/home/davis/.local/share/betting-monitor/automation.sqlite`, mode 600
- Repository checkout: `/home/davis/big-beautiful-betting-monitor-app`

Container replacement must never overwrite the credentials or SQLite paths. The Compose bind mount maps the state directory to `/data`, and `AUTOMATION_DB_PATH` points at `/data/automation.sqlite`.

## Updates

Pushing `main` runs the full GitHub Actions validation suite and publishes `ghcr.io/realronaldrump/big-beautiful-betting-monitor-app:main` for `linux/amd64`. The existing Watchtower instance monitors only labeled containers, polls every five minutes, uses rolling restarts, and removes superseded images. `deploy/compose.yaml` opts this app into that updater.

For Compose or host-infrastructure changes:

```bash
ssh 100.96.182.111
cd /home/davis/big-beautiful-betting-monitor-app
git pull --ff-only origin main
docker compose -f deploy/compose.yaml pull
docker compose -f deploy/compose.yaml up -d
```

## Verification

```bash
docker ps --filter name=betting-monitor
docker inspect --format '{{.State.Health.Status}}' betting-monitor
curl --fail http://127.0.0.1:8720/betting/api/health
curl --fail https://davis-mini-pc-1.tail59b3f5.ts.net/betting/api/health
curl --fail https://davis-mini-pc-1.tail59b3f5.ts.net/portal-api/status
```

The service should report `healthy`, the health response should include the deployed Git commit, and the portal should show Betting Monitor as available.
