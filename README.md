# Yearly Overview

A keyboard-first planner that shows a whole year on one screen: one column per month, one row per
day, with ISO week numbers and a line between weeks. It works like a spreadsheet: select a day and
start typing.

## Using it

| Do this                         | Keys                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Move around                     | Arrow keys, <kbd>Home</kbd>/<kbd>End</kbd> (month), <kbd>Page Up/Down</kbd> (year) |
| Add or replace a title          | Just type, then <kbd>Enter</kbd> (saves and moves down) or <kbd>Tab</kbd> (right)  |
| Edit an existing title          | <kbd>Enter</kbd> or <kbd>F2</kbd>                                                  |
| Description and color           | <kbd>Shift</kbd>+<kbd>Enter</kbd>                                                  |
| Multi-day block (trip, holiday) | <kbd>Shift</kbd>+arrows to select, then type                                       |
| Color the day or block          | <kbd>Alt</kbd>+<kbd>1</kbd>–<kbd>6</kbd>, <kbd>Alt</kbd>+<kbd>0</kbd> removes      |
| Highlight one category          | <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>6</kbd>, <kbd>Esc</kbd> clears   |
| Clear                           | <kbd>Delete</kbd> / <kbd>Backspace</kbd>                                           |
| Copy, cut, paste, undo, redo    | The usual <kbd>Ctrl</kbd>/<kbd>⌘</kbd> shortcuts                                   |
| Search, go to a date, commands  | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> (try `14 mar`, `2027`, `vacation`)       |
| All shortcuts                   | <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>/</kbd>                                          |

Consecutive days with the same title, description and color are shown as one block. Edits,
colors and deletes apply to the whole block under the cursor; select part of it with
<kbd>Shift</kbd>+arrows to change only those days.

Paste works with lists from other apps too: each line of a copied spreadsheet column lands on
the next day.

Name the six colors ("Work", "Holiday", …) with **Name categories…** in the menu or palette;
named categories appear as a legend whose buttons highlight one category across the year.

**Hide months** you don't need right now with the **‹** in a month's header, or _Hide past
months_ in the palette; a hidden month shrinks to a narrow strip that brings it back when
clicked, and going to one of its days shows it again. Hidden months are remembered per year on
each device and aren't synced.

**Public holidays** for 207 countries (and their regions) can be switched on under _Public
holidays…_; they show as red days with their names. Holiday data comes from
[date-holidays](https://github.com/commenthol/date-holidays) (CC BY 3.0) and is only downloaded
once a country is chosen.

The menu (or the command palette) also has **backup/restore** (JSON), **export to a calendar app**
(`.ics`, one all-day event per block) and **print** (landscape, one page).

## Sync

The app works on its own in the browser (`localStorage`). When it's served by the Rust server, it
also syncs with it automatically: there are no accounts, the server holds **one planner** for
everything that can reach it. That fits a personal server on a private network such as a
Tailscale tailnet; don't expose it to the internet.

- **Local-first.** Edits apply instantly and are queued; the queue survives reloads and offline
  periods and is sent when the server is reachable. Other devices' changes are pulled on focus,
  when coming back online and every 30 seconds. The toolbar shows the status; click it to sync now.
- **Merging.** The first time a device reaches the server, days that only exist on the device are
  uploaded and days the server already has come from the server. After that the last write for a
  day wins.
- **Server resets.** If the server's database is replaced by an empty one, devices notice and
  upload their copy again.
- If the app is hosted without the server, sync is hidden and the app works as before.

## Architecture

```
src/                  SvelteKit app (static build, client-side only)
  lib/calendar.ts     date maths, ISO weeks, date parsing for the palette
  lib/entries.ts      entry validation, local storage, backups
  lib/selection.ts    ranges and multi-day blocks
  lib/planner.svelte.ts  undo-able store
  lib/sync.svelte.ts  offline queue + push/pull against the API
  lib/components/     calendar grid, dialogs, command palette
server/               Rust API + static file server (axum, sqlx, PostgreSQL)
  src/planner.rs      every planner operation (shared by sync, REST and MCP)
  src/api_v1.rs       REST API for agents; openapi.json describes it
  src/mcp.rs          MCP server for agents
  migrations/         schema, applied automatically on startup
deploy/               systemd unit, settings and install script for bare-metal installs
scripts/package.sh    builds a Raspberry Pi release tarball
e2e/                  Playwright tests against the real server
```

### Sync API (used by the web app)

| Method | Path           | Body / query                                | Notes                                            |
| ------ | -------------- | ------------------------------------------- | ------------------------------------------------ |
| GET    | `/api/health`  |                                             | 200 when the database answers                    |
| GET    | `/api/entries` | `?since=<rev>`                              | `{ rev, changes: [{ date, entry }], settings? }` |
| PUT    | `/api/entries` | `{ changes: [{ date, entry }], settings? }` | `entry: null` deletes; returns `{ rev }`         |

Every write bumps a revision counter; deletions are kept as tombstones so other devices learn
about them. Without a login, two checks keep other websites out: writes with a foreign `Origin`
are refused, and `ALLOWED_HOSTS` (optional) refuses requests for unknown host names, which stops
DNS rebinding when the port is reachable from other machines.

## For AI agents

The server exposes the planner to agents in two ways. Both use the same operations, and changes
show up in open browsers within seconds.

**MCP** at `/mcp` (Streamable HTTP, stateless, no auth). Tools: `get_today`, `get_year_summary`,
`list_events`, `list_days`, `get_day`, `list_categories`, `add_event`, `update_day`,
`clear_days`, `update_settings`. Connect Claude Code (or any MCP client) from a device on your
tailnet:

```bash
claude mcp add --transport http yearly-overview https://raspberrypi.your-tailnet.ts.net/mcp
```

**REST** at `/api/v1`, described by an OpenAPI 3.1 document at
[`/api/v1/openapi.json`](server/openapi.json). Highlights:

| Method               | Path                    | Purpose                                                                       |
| -------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| GET                  | `/api/v1/today`         | Date, ISO week, today's entry, upcoming events (call first)                   |
| GET                  | `/api/v1/summary?year=` | A year's events by month, days per category                                   |
| GET                  | `/api/v1/events`        | Events (consecutive identical days merged); `from`, `to`, `query`, `category` |
| POST                 | `/api/v1/events`        | Plan a day or range; 409 with the conflicts unless `overwrite: true`          |
| GET/PUT/PATCH/DELETE | `/api/v1/days/{date}`   | Read, replace, partially update or clear one day                              |
| GET / DELETE         | `/api/v1/days`          | List days with the same filters / clear a `from`–`to` range                   |
| GET                  | `/api/v1/categories`    | Colors, their names and usage                                                 |
| GET / PATCH          | `/api/v1/settings`      | Category names and the public holiday country                                 |

Categories can be given by name (`"category": "Work"`) wherever a color is accepted. Errors are
always JSON (`{"error": "..."}`) and say what to fix. The repo's agent skills in
[`.claude/skills/`](.claude/skills) show how to use all of this.

## Development

Requires Node.js 20.19+ (see `.nvmrc`), a stable Rust toolchain and PostgreSQL (any recent
version; `docker compose up -d db` starts one).

```bash
npm ci
export DATABASE_URL=postgres://USER:PASSWORD@localhost/yearly_overview
(cd server && cargo run)  # API on http://localhost:8080 (applies migrations)
npm run dev               # app on http://localhost:5173, proxies /api to the server
```

Server tests (`cargo test`) create a throwaway database per test on the server in
`DATABASE_URL`, so that role needs `CREATEDB`. The e2e suite recreates a `yearly_overview_e2e`
database using the usual `PGHOST`/`PGUSER`/`PGPASSWORD` variables.

```bash
npm test             # frontend unit tests (Vitest)
npm run test:server  # server unit + integration tests
npm run test:e2e     # builds, starts the real server, runs Playwright
npm run check        # type-check
npm run lint         # Prettier + ESLint
```

The e2e suite covers keyboard navigation, editing, ranges, undo/redo, the clipboard, the command
palette, backups and `.ics` export, holidays, offline use, multi-tab and multi-device sync, and
WCAG A/AA checks with axe in light and dark mode. It pins "today" to 2026-10-17. Most tests block
the API (like a static host); the sync tests share the real server and run one at a time.

## Deploying on a Raspberry Pi (bare metal, Tailscale)

Works on 64-bit (Pi 3/4/5, Zero 2 W) and 32-bit Raspberry Pi OS. The release is a static binary
plus the built app: nothing else (no Node, no Rust, no Docker) is needed on the Pi.

**1. Get a release package.** Download `yearly-overview-<version>-aarch64.tar.gz` (or `-armv7`
for 32-bit) from the GitHub release or the _Release_ workflow's artifacts, or build it yourself:

```bash
pip install ziglang && cargo install cargo-zigbuild   # once
scripts/package.sh            # → dist/yearly-overview-1.0.0-aarch64.tar.gz
scripts/package.sh armv7      # 32-bit Raspberry Pi OS
```

**2. Install it on the Pi.**

```bash
scp dist/yearly-overview-1.0.0-aarch64.tar.gz pi@raspberrypi:
ssh pi@raspberrypi
tar xzf yearly-overview-1.0.0-aarch64.tar.gz
cd yearly-overview-1.0.0-aarch64
sudo ./install.sh --create-database
```

The planner stores its data in **PostgreSQL** on the Pi. `--create-database` creates a
`yearly_overview` role (with a generated password) and database in the local PostgreSQL and
writes the connection into `/etc/yearly-overview.env` (readable by root only). To use an existing
database instead, set `DATABASE_URL` in that file and run `sudo ./install.sh` without the flag.

This installs to `/opt/yearly-overview`, creates a hardened systemd service that starts on boot
(after PostgreSQL) and a nightly backup job. PostgreSQL, its `pg_dump` client, `curl` and
Python 3 (used to keep backup credentials out of process arguments) must already be installed.

**3. Serve it through Caddy.** Follow [the private Caddy setup](deploy/caddy.md) for
your own domain. The release includes `Caddyfile.yearly-overview` and `caddy.md`.
Caddy listens on the Pi's Tailscale address and proxies to `127.0.0.1:8080`; Cloudflare DNS
verification provides the HTTPS certificate. Any other sites Caddy serves stay on their own
routes. HTTPS enables the offline app and "install to home screen".

Alternatively, `--tailscale-serve` publishes at `https://<pi-name>.<tailnet>.ts.net` without
Caddy (enable MagicDNS and HTTPS certificates in the Tailscale admin console first).
Use one HTTPS proxy for the planner; both cannot own the same address and port.

**Upgrading** is the same: unpack the new version and run `sudo ./install.sh` again. Settings and
data are kept.

**Day to day:**

```bash
systemctl status yearly-overview          # is it running?
journalctl -u yearly-overview -f          # logs
sudo systemctl restart yearly-overview    # after editing /etc/yearly-overview.env
sudo systemctl start yearly-overview-backup   # back up now
sudo ls /var/lib/yearly-overview/backups      # nightly pg_dump files (newest 14 kept)
```

To restore a backup:

```bash
sudo systemctl stop yearly-overview
sudo bash -c 'set -a; . /etc/yearly-overview.env; pg_restore --clean --if-exists --no-owner \
  -d "$DATABASE_URL" /var/lib/yearly-overview/backups/<file>.dump'
sudo systemctl start yearly-overview
```

Devices reconcile with the restored data on their next sync.

### Configuration

Set in `/etc/yearly-overview.env` (or the environment):

| Variable        | Default           | Meaning                                                                          |
| --------------- | ----------------- | -------------------------------------------------------------------------------- |
| `BIND_ADDR`     | `127.0.0.1:$PORT` | Where to listen. Localhost suits `tailscale serve`                               |
| `PORT`          | `8080`            | Port, when `BIND_ADDR` isn't set                                                 |
| `DATABASE_URL`  | required          | PostgreSQL, e.g. `postgres://yearly_overview:PASSWORD@localhost/yearly_overview` |
| `STATIC_DIR`    | `build`           | Built frontend; API-only when missing                                            |
| `ALLOWED_HOSTS` | unset (any)       | Comma-separated host names to serve; set it if not bound to localhost            |
| `BACKUP_KEEP`   | `14`              | Nightly backups to keep (used by the backup job)                                 |
| `RUST_LOG`      | `info`            | Log level                                                                        |

The server sets security headers and long-lived caching for hashed assets, and shuts down
gracefully on `SIGTERM`.

### Other ways to run it

- **Docker:** `docker compose up -d` runs the app with its own PostgreSQL (see `compose.yaml`).
  The same no-accounts rules apply: keep it private.
- **Static only:** `npm run build` and upload `build/` to any static host; sync is then hidden
  and everything stays in the browser.
