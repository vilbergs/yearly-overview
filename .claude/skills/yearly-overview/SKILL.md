---
name: yearly-overview
description: Read and change the user's Yearly Overview planner (their personal year calendar, self-hosted on a Raspberry Pi). Use whenever the user asks what's planned, when something is, how busy a month or year is, or wants to plan, move, rename, recategorize or remove days, trips, vacations or other events, or to name categories or set public holidays.
---

# Yearly Overview planner

The planner holds **one entry per day**: a title, an optional description and an optional
color. The six colors (red, orange, yellow, green, blue, purple) can be named as **categories**
(e.g. red = "Work", green = "Holiday"); wherever a color is accepted, a category name works too.
**Consecutive days with identical entries form an event** (a trip, a conference week).

Changes show up in the user's open planner within seconds. There is no undo for agent changes
(the user can only undo their own edits in the browser), so be careful with writes.

## How to connect

Use the first that works:

1. **MCP tools** named `get_today`, `list_events`, `add_event`, ... (if a `yearly-overview` MCP
   server is connected). Prefer these.
2. **The bundled CLI**: `python3 scripts/planner.py <command>` (standard library only). It reads
   the server from `--url` or `$YEARLY_OVERVIEW_URL` (default `http://127.0.0.1:8080`), e.g.
   `https://raspberrypi.<tailnet>.ts.net`. Every command prints JSON; failures exit 1 with the
   reason on stderr.
3. **Plain HTTP** against `/api/v1` — the OpenAPI document is at `/api/v1/openapi.json`; see
   [reference/api.md](reference/api.md).

If nothing answers, ask the user for the planner's address (often their Pi's tailnet name) instead
of guessing.

## Workflows

**Always start with context.** `get_today` / `planner.py today` gives today's date in the
planner's time zone, the ISO week, today's entry and upcoming events. Resolve relative dates
("next Friday", "week 32", "the summer") against that date, never your own assumption of today.
State the concrete dates you chose when you report back.

**Looking things up.** Use `list_events` / `planner.py events` with `--from/--to`, `--query`
(searches titles, descriptions and category names) and `--category`. Events beat days for reading:
a 10-day trip is one item. For "how does my year look", use `get_year_summary` /
`planner.py summary --year Y`.

**Planning something** (one day or a range):

```bash
python3 scripts/planner.py add 2026-07-06 2026-07-10 --title "Vacation" --category Holiday
```

If any day already holds something else, **nothing is written** and the conflicts are listed.
Show them to the user and only retry with `--overwrite` (MCP: `overwrite: true`) once they agree.
Re-adding an identical event is fine and not a conflict.

**Changing one day:** `update_day` / `planner.py update DATE --title/--description/--category`
changes only the given fields. Note that changing one day of a multi-day event splits it (the
days are no longer identical).

**Changing a whole event** (rename, recolor, new description): re-add it over its full range
with overwrite, e.g. `planner.py add 2026-07-06 2026-07-10 --title "Lake trip" --category
Holiday --overwrite`. Look up its exact range with `events` first.

**Moving an event:** `planner.py move START END NEW_START` (refuses if the destination has other
plans; `--overwrite` to replace). Over MCP or HTTP: list the event, `clear_days` the old range,
then `add_event` at the new dates — check the destination for conflicts _before_ clearing.

**Removing plans:** `clear_days` / `planner.py clear START [END]`. Confirm with the user before
clearing more than a few days, and say how many were cleared.

**Recurring things** (every Monday, every other week): the planner has no recurrence. Compute the
dates and add each one; for many dates, tell the user how many you're about to create first.

**Categories and holidays:** `list_categories` shows colors, names and usage.
`planner.py settings --name red=Work --name blue=Sport` names colors (`--name red=` removes a
name). `--holiday-country SE` (or `DE-BY` for a region, `none` to turn off) chooses whose public
holidays the app shows; the server stores the choice but holiday dates are only shown in the
app, not returned by the API.

**Backups:** `planner.py backup > backup.json` writes everything in the format the app's
"Restore backup…" menu accepts.

## Limits

- Titles up to 200 characters, descriptions up to 5000, category names up to 40.
- One request can fill or clear at most 3660 days.
- Dates are `YYYY-MM-DD`; years 1900–9999.
