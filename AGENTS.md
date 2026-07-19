<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Deployment memory

- This repository is edited on Davis's Mac, but no long-lived development or production process should run there. Keep `.claude/launch.json` empty so workspace tooling cannot auto-start the app.
- Production runs 24/7 on `davis-mini-pc-1` (`100.96.182.111`) and is reachable only through Tailscale at `https://davis-mini-pc-1.tail59b3f5.ts.net/betting/`.
- `main` is the deployment branch. GitHub Actions validates it and publishes `ghcr.io/realronaldrump/big-beautiful-betting-monitor-app:main` for `linux/amd64`.
- The mini PC runs the image with `/home/davis/big-beautiful-betting-monitor-app/deploy/compose.yaml`. Docker binds the app only to `127.0.0.1:8720`. The existing Tailscale Serve root points to Caddy, Caddy sends unmatched paths to `mini-portal`, and `mini-portal` streams `/betting` and `/betting/*` to that loopback port while preserving forwarded host/protocol headers.
- The existing mini-PC Watchtower checks labeled containers every five minutes and deploys new `main` images automatically.
- Production secrets live only in `/home/davis/.config/betting-monitor/betting-monitor.env`. SQLite state lives only in `/home/davis/.local/share/betting-monitor/automation.sqlite`. Never commit or overwrite either with repository updates.
- App browser requests must go through `appPath()` so both root-path local checks and the production `/betting` base path work.
- Infrastructure changes require pulling `main` in `/home/davis/big-beautiful-betting-monitor-app` and re-running `docker compose -f deploy/compose.yaml up -d` on the mini PC. Ordinary application changes deploy through the image updater.
- The mini-portal integration is user-owned at `/home/davis/mini-portal/mini_portal.py` because general passwordless sudo is intentionally unavailable. It includes the Betting Monitor portal card and the `/betting` streaming reverse proxy; timestamped backups sit beside that file.
