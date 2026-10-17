#!/usr/bin/env python3
"""Command-line client for a Yearly Overview server (standard library only).

Every command prints JSON. Exit status: 0 ok, 1 refused/failed (message on stderr), 2 usage.
The server URL comes from --url, then $YEARLY_OVERVIEW_URL, then http://127.0.0.1:8080.

Examples:
  planner.py today
  planner.py events --from 2026-07-01 --to 2026-08-31
  planner.py add 2026-07-06 2026-07-10 --title Vacation --category Holiday
  planner.py update 2026-07-08 --description "Rest day"
  planner.py move 2026-07-06 2026-07-10 2026-07-13
  planner.py clear 2026-07-06 2026-07-10
  planner.py settings --name red=Work --name green=Holiday --holiday-country SE
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_URL = "http://127.0.0.1:8080"


class ApiError(Exception):
    def __init__(self, status: int, message: str, details: object = None):
        super().__init__(message)
        self.status = status
        self.details = details


class Planner:
    def __init__(self, url: str):
        self.base = url.rstrip("/")

    def request(self, method: str, path: str, params: dict | None = None, body: object = None):
        query = {k: v for k, v in (params or {}).items() if v is not None}
        url = f"{self.base}/api/v1{path}"
        if query:
            url += "?" + urllib.parse.urlencode(query)
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("Accept", "application/json")
        if data is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read() or b"null")
        except urllib.error.HTTPError as error:
            try:
                payload = json.loads(error.read())
            except ValueError:
                payload = {"error": error.reason}
            raise ApiError(error.code, payload.get("error", str(error)), payload.get("details")) from None
        except urllib.error.URLError as error:
            raise ApiError(0, f"Can't reach {self.base}: {error.reason}") from None

    def days(self, **filters):
        return self.request("GET", "/days", filters)["days"]

    def events(self, **filters):
        return self.request("GET", "/events", filters)["events"]


def shift(date: str, days: int) -> str:
    return (dt.date.fromisoformat(date) + dt.timedelta(days=days)).isoformat()


def move(planner: Planner, start: str, end: str, new_start: str, overwrite: bool):
    """Moves everything planned from start..end so it begins on new_start."""
    offset = (dt.date.fromisoformat(new_start) - dt.date.fromisoformat(start)).days
    events = planner.events(**{"from": start, "to": end})
    if not events:
        raise ApiError(1, f"Nothing is planned between {start} and {end}")
    new_end = shift(end, offset)

    # Days already used by what we're moving don't count as conflicts.
    moving = {day["date"] for day in planner.days(**{"from": start, "to": end})}
    blocking = [d for d in planner.days(**{"from": shift(start, offset), "to": new_end}) if d["date"] not in moving]
    if blocking and not overwrite:
        raise ApiError(409, f"{len(blocking)} day(s) at the destination already have other plans; nothing was changed. Use --overwrite to replace them.", {"conflicts": blocking})

    planner.request("DELETE", "/days", {"from": start, "to": end})
    moved = []
    for event in events:
        body = {
            "start": shift(event["start"], offset),
            "end": shift(event["end"], offset),
            "title": event["title"],
            "description": event["description"],
            "overwrite": True,
        }
        if event.get("color"):
            body["color"] = event["color"]
        moved.append(planner.request("POST", "/events", body=body)["event"])
    return {"moved": moved, "replaced": blocking}


def backup(planner: Planner):
    """Everything, in the web app's backup format (restore it from the app's menu)."""
    request = urllib.request.Request(f"{planner.base}/api/entries?since=0")
    with urllib.request.urlopen(request, timeout=60) as response:
        data = json.loads(response.read())
    entries = {change["date"]: change["entry"] for change in data["changes"] if change["entry"]}
    settings = planner.request("GET", "/settings")
    return {
        "app": "yearly-overview",
        "version": 2,
        "exported_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "entries": entries,
        "settings": settings,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default=os.environ.get("YEARLY_OVERVIEW_URL", DEFAULT_URL))
    commands = parser.add_subparsers(dest="command", required=True)

    def filters(command):
        command.add_argument("--from", dest="from_", metavar="DATE")
        command.add_argument("--to", metavar="DATE")
        command.add_argument("--query", "-q")
        command.add_argument("--category", "-c")

    today = commands.add_parser("today", help="today's date, entry and upcoming events")
    today.add_argument("--date", help="pretend today is this date")

    summary = commands.add_parser("summary", help="a year at a glance")
    summary.add_argument("--year", type=int)

    filters(commands.add_parser("events", help="find events (consecutive identical days merged)"))
    filters(commands.add_parser("days", help="find individual days"))

    get = commands.add_parser("get", help="one day")
    get.add_argument("date")

    def entry_fields(command, title_required=False):
        command.add_argument("--title", "-t", required=title_required)
        command.add_argument("--description", "-d")
        command.add_argument("--category", "-c", help="category name or color; '' removes the color")

    add = commands.add_parser("add", help="plan something on a day or range")
    add.add_argument("start")
    add.add_argument("end", nargs="?")
    entry_fields(add, title_required=True)
    add.add_argument("--overwrite", action="store_true", help="replace days with other plans")

    set_ = commands.add_parser("set", help="replace a day's entry")
    set_.add_argument("date")
    entry_fields(set_)

    update = commands.add_parser("update", help="change some fields of a day")
    update.add_argument("date")
    entry_fields(update)

    clear = commands.add_parser("clear", help="clear a day or a range")
    clear.add_argument("start")
    clear.add_argument("end", nargs="?")

    mv = commands.add_parser("move", help="move everything in a range to a new start date")
    mv.add_argument("start")
    mv.add_argument("end")
    mv.add_argument("new_start")
    mv.add_argument("--overwrite", action="store_true")

    commands.add_parser("categories", help="colors, names and usage")

    settings = commands.add_parser("settings", help="show or change category names and holidays")
    settings.add_argument("--name", action="append", default=[], metavar="COLOR=NAME", help="name a color (empty NAME removes it)")
    settings.add_argument("--holiday-country", metavar="CODE", help="e.g. SE or DE-BY; 'none' turns holidays off")

    commands.add_parser("backup", help="print a full backup in the app's restore format")

    args = parser.parse_args(argv)
    planner = Planner(args.url)

    def filter_params():
        return {"from": args.from_, "to": args.to, "query": args.query, "category": args.category}

    def fields():
        return {k: v for k, v in {"title": args.title, "description": args.description, "category": args.category}.items() if v is not None}

    try:
        if args.command == "today":
            result = planner.request("GET", "/today", {"date": args.date})
        elif args.command == "summary":
            result = planner.request("GET", "/summary", {"year": args.year})
        elif args.command == "events":
            result = planner.request("GET", "/events", filter_params())
        elif args.command == "days":
            result = planner.request("GET", "/days", filter_params())
        elif args.command == "get":
            result = planner.request("GET", f"/days/{args.date}")
        elif args.command == "add":
            body = {"start": args.start, "end": args.end or args.start, **fields(), "overwrite": args.overwrite}
            result = planner.request("POST", "/events", body=body)
        elif args.command == "set":
            result = planner.request("PUT", f"/days/{args.date}", body=fields())
        elif args.command == "update":
            if not fields():
                parser.error("update needs --title, --description or --category")
            result = planner.request("PATCH", f"/days/{args.date}", body=fields())
        elif args.command == "clear":
            result = planner.request("DELETE", "/days", {"from": args.start, "to": args.end or args.start})
        elif args.command == "move":
            result = move(planner, args.start, args.end, args.new_start, args.overwrite)
        elif args.command == "categories":
            result = planner.request("GET", "/categories")
        elif args.command == "settings":
            body: dict = {}
            if args.name:
                names = dict(planner.request("GET", "/settings")["categories"])
                for pair in args.name:
                    color, _, name = pair.partition("=")
                    names[color.strip().lower()] = name.strip()
                body["categories"] = names
            if args.holiday_country is not None:
                body["holiday_country"] = None if args.holiday_country.lower() in ("", "none", "off") else args.holiday_country
            result = planner.request("PATCH", "/settings", body=body) if body else planner.request("GET", "/settings")
        elif args.command == "backup":
            result = backup(planner)
        else:  # pragma: no cover - argparse enforces the choices
            parser.error(f"unknown command {args.command}")
    except ApiError as error:
        print(f"error: {error}", file=sys.stderr)
        if error.details:
            print(json.dumps(error.details, indent=2, ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
