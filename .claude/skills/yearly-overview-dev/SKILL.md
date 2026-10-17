---
name: yearly-overview-dev
description: Develop, test and release the Yearly Overview codebase (SvelteKit app, Rust/axum/PostgreSQL server, REST + MCP agent API, Playwright e2e). Use when changing features, fixing bugs, adding API operations or tools, running the test suites, or building a Raspberry Pi release package in this repository.
---

# Developing Yearly Overview

## Map

| Path                                                                     | What                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `src/routes/+page.svelte`                                                | The app shell: toolbar, status bar, commands, dialogs wiring             |
| `src/lib/components/YearGrid.svelte`                                     | The calendar grid: keyboard handling, inline editing, clipboard          |
| `src/lib/planner.svelte.ts`                                              | Entries + settings store with undo/redo, persisted to localStorage       |
| `src/lib/sync.svelte.ts`                                                 | Offline queue, push/pull against `/api/entries`, first-contact merge     |
| `src/lib/{calendar,entries,selection,settings,holidays,ics,keyboard}.ts` | Pure logic, unit tested                                                  |
| `server/src/planner.rs`                                                  | **Every planner operation**; sync, REST and MCP all go through it        |
| `server/src/api_v1.rs` + `server/openapi.json`                           | REST API for agents and its OpenAPI document                             |
| `server/src/mcp.rs`                                                      | MCP server (tools, schemas, instructions)                                |
| `server/src/entries.rs`                                                  | Web-app sync endpoints, entry/settings validation                        |
| `server/src/lib.rs`                                                      | Router, Origin/Host checks, headers, static files                        |
| `server/migrations/`                                                     | PostgreSQL schema (one `planner` row + `entries` keyed by date)          |
| `e2e/`                                                                   | Playwright tests; `fixtures.ts` blocks `/api` unless `server_sync` is on |
| `deploy/`, `scripts/package.sh`                                          | Pi install files and release packaging                                   |
| `.claude/skills/`                                                        | Agent skills (planner use, Pi operations, this one)                      |

## Commands

Needs PostgreSQL (`docker compose up -d db` starts one) and `DATABASE_URL` pointing at it, with
a role that may create databases (tests make a throwaway database each).

```bash
npm ci                                   # once
export DATABASE_URL=postgres://USER:PASSWORD@localhost/yearly_overview
(cd server && cargo run)                 # API + app on :8080
npm run dev                              # app on :5173 with /api proxied to :8080

npm run lint && npm run check && npm test          # frontend: Prettier+ESLint, types, Vitest
(cd server && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test)
PGUSER=... PGPASSWORD=... npm run test:e2e   # builds, recreates yearly_overview_e2e, runs Playwright
```

Run all of these before committing; CI runs the same plus a Docker build and the Pi packages.

## Conventions

- `snake_case` for functions and variables in TypeScript too, matching the existing code.
- Validate everything read from outside (storage, server, backups, requests) on both sides; the
  server is the authority and returns JSON errors that say what to fix.
- Text limits are counted in code points (`truncate` in `entries.ts`, `chars()` in Rust).
- No accounts: the server holds one planner. Never add features that assume user identity, and
  keep the Origin check (`check_origin`) on every mutating route, including new ones.
- Keyboard first: every feature needs a shortcut or a command-palette entry
  (`base_commands` in `+page.svelte`), listed in `SHORTCUTS` (`keyboard.ts`) when it has a key.

## Adding a planner operation (end to end)

1. Implement it in `server/src/planner.rs` (validate input, write through `write()` so the
   revision bumps and browsers sync it). Unit-test pure parts there.
2. Expose it in `api_v1.rs`, document it in `server/openapi.json` (the
   `openapi_document_matches_the_routes` test fails if a documented path isn't routed).
3. Add an MCP tool in `mcp.rs`: entry in `tools()` with a clear description, schema and
   annotations, plus a branch in `call_tool`. Update the list asserted in `tests/mcp.rs`.
4. Add a command to `.claude/skills/yearly-overview/scripts/planner.py` and describe it in that
   skill's `SKILL.md` and `reference/api.md`.
5. Tests: `server/tests/agent_api.rs`, `server/tests/mcp.rs`, and README's agent section.

## Testing notes

- Server tests are `#[sqlx::test]`: each gets a fresh, migrated database (pass the `PgPool`).
  Queries cast at the boundary (`date::text`, `$1::date`, `settings::text`/`::jsonb`) so Rust
  keeps ISO-date strings.
- E2E pins today to 2026-10-17 (`TODAY` in `e2e/fixtures.ts`), locale en-US, Europe/Stockholm.
- Most e2e tests run with `/api` blocked (like a static host) so they can run in parallel. Tests
  that need the real server use `test.use({ server_sync: true })`, live in `e2e/sync.spec.ts`,
  run serially and reset the shared planner in `beforeEach`. Don't use `--repeat-each` on them
  with more than one worker.
- Every e2e test fails on unexpected console errors (network-failure logs are ignored).
- Verify UI changes in a real browser (Playwright screenshots) in light and dark mode.

## Releasing for the Pi

```bash
pip install ziglang && cargo install cargo-zigbuild    # once
scripts/package.sh            # dist/yearly-overview-<version>-aarch64.tar.gz
scripts/package.sh armv7      # 32-bit Raspberry Pi OS
```

The binary is static (musl), so it runs on any Pi OS. To smoke-test an ARM build on x86, run it
under `qemu-aarch64-static` and point Playwright at it (it reuses a server already on :4321).
Tag `vX.Y.Z` on main to publish packages as a GitHub release. Then use the `yearly-overview-pi`
skill to deploy.
