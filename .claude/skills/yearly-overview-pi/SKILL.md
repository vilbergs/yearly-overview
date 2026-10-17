---
name: yearly-overview-pi
description: Install, upgrade, check, back up, restore or troubleshoot the Yearly Overview server on a Raspberry Pi (bare metal, systemd, PostgreSQL, Tailscale). Use when the user wants to deploy a new version, asks whether the planner is up, wants logs, a backup or a restore, or wants to change how it's exposed on their tailnet.
---

# Operating Yearly Overview on a Raspberry Pi

The Pi runs one static binary as the systemd service `yearly-overview`, storing its data in the
Pi's **PostgreSQL**, published on the user's tailnet by `tailscale serve`. Everything below runs
**on the Pi** (over `ssh`), most of it with `sudo`. Ask before restarting the service or
restoring data; both briefly interrupt the user's planner.

| What                | Where                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| Program and web app | `/opt/yearly-overview/` (`yearly-overview-server`, `backup.sh`, `build/`)                             |
| Settings            | `/etc/yearly-overview.env` (root-only; has the database password; kept on upgrade)                    |
| Data                | PostgreSQL database `yearly_overview`, owned by role `yearly_overview`                                |
| Nightly backups     | `/var/lib/yearly-overview/backups/yearly-overview-<UTC time>.dump` (newest `BACKUP_KEEP`, default 14) |
| Units               | `yearly-overview.service`, `yearly-overview-backup.service` + `.timer`                                |

Never print the contents of `/etc/yearly-overview.env` back to the user in full: it contains the
database password. Use `sudo grep -v DATABASE_URL /etc/yearly-overview.env` to show the rest.

## Is it working?

```bash
systemctl status yearly-overview --no-pager
curl -fsS http://127.0.0.1:8080/api/health          # "ok" when the database answers
journalctl -u yearly-overview -n 100 --no-pager      # recent logs
systemctl status postgresql --no-pager               # the database
systemctl list-timers yearly-overview-backup.timer   # next/last backup
tailscale serve status                               # how it's published
```

From another device on the tailnet: `curl -fsS https://<pi>.<tailnet>.ts.net/api/health`.
If that fails but the local check works, the problem is Tailscale (serve not configured, or
HTTPS certificates not enabled in the admin console). If the service won't start, the log
usually names the cause; a wrong `DATABASE_URL` or PostgreSQL not running are the common ones.

## Install or upgrade

1. Get a package for the Pi's architecture (`uname -m`: `aarch64` → `-aarch64`, `armv7l` →
   `-armv7`): from the GitHub release / "Release" workflow artifacts, or build it in the repo
   with `scripts/package.sh [armv7]` (needs zig and cargo-zigbuild; see the dev skill).
2. Copy and install:

```bash
scp dist/yearly-overview-<version>-aarch64.tar.gz <user>@<pi>:
ssh <user>@<pi>
tar xzf yearly-overview-<version>-aarch64.tar.gz && cd yearly-overview-<version>-aarch64
sudo ./install.sh --create-database --tailscale-serve   # first install
sudo ./install.sh                                       # upgrades
```

`--create-database` creates the `yearly_overview` role (generated password) and database in the
local PostgreSQL and writes `DATABASE_URL`; it never changes a URL that's already set. Without it,
`DATABASE_URL` in the env file must already point at a database. `install.sh` refuses a package
for the wrong architecture, keeps settings and data, installs the backup timer, restarts the
service and waits for the health check. Migrations run automatically on start. Open browsers
pick up the new version and offer a reload.

## Configuration

Edit `/etc/yearly-overview.env` (`sudo nano ...`), then `sudo systemctl restart yearly-overview`.
Settings: `DATABASE_URL`, `BIND_ADDR` (default `127.0.0.1:8080`; keep it on localhost when using
`tailscale serve`), `ALLOWED_HOSTS` (comma-separated host names; set it whenever `BIND_ADDR`
isn't localhost), `BACKUP_KEEP`, `RUST_LOG`. The planner has **no login**: never expose it
beyond the tailnet (no `tailscale funnel`, no port forwarding).

## Backups and restore

```bash
sudo systemctl start yearly-overview-backup     # back up now
journalctl -u yearly-overview-backup -n 20      # did it work?
sudo ls -lt /var/lib/yearly-overview/backups/
```

Copy backups off the Pi regularly (`scp`/`rsync` that directory). An app-level JSON backup is
also available via the planner skill (`planner.py backup`).

To restore (confirm with the user first; changes made since the backup are lost on the server,
though devices that were offline may re-send their own unsynced edits):

```bash
sudo systemctl stop yearly-overview
sudo bash -c 'set -a; . /etc/yearly-overview.env; pg_restore --clean --if-exists --no-owner \
  -d "$DATABASE_URL" /var/lib/yearly-overview/backups/<file>.dump'
sudo systemctl start yearly-overview
```

If the database is ever replaced by an empty one, connected devices notice and upload their own
copies again.

## Exposure on the tailnet

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:8080   # publish at https://<pi>.<tailnet>.ts.net
sudo tailscale serve reset                                    # stop publishing
```

HTTPS is required for the offline app and "install to home screen". MCP clients connect to
`https://<pi>.<tailnet>.ts.net/mcp`.

## Uninstall

```bash
sudo systemctl disable --now yearly-overview yearly-overview-backup.timer
sudo rm /etc/systemd/system/yearly-overview{,-backup}.service /etc/systemd/system/yearly-overview-backup.timer
sudo systemctl daemon-reload
sudo rm -rf /opt/yearly-overview /etc/yearly-overview.env
# Data: the yearly_overview database and role, and /var/lib/yearly-overview (backups).
# Remove them only deliberately:
#   sudo -u postgres psql -c 'DROP DATABASE yearly_overview' -c 'DROP ROLE yearly_overview'
```
