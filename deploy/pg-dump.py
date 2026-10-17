#!/usr/bin/env python3
"""Run pg_dump without putting the database password in its argument list."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit


def connection(url):
    parsed = urlsplit(url)
    if parsed.scheme not in ("postgres", "postgresql"):
        raise ValueError("DATABASE_URL must be a PostgreSQL URL")
    password = unquote(parsed.password) if parsed.password is not None else None
    netloc = parsed.netloc
    if "@" in netloc:
        userinfo, host = netloc.rsplit("@", 1)
        netloc = userinfo.split(":", 1)[0] + "@" + host
    query = []
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        if key == "password":
            password = value
        else:
            query.append((key, value))
    if password is not None:
        if "\n" in password or "\r" in password:
            raise ValueError("Database passwords containing newlines are not supported")
        query = [(key, value) for key, value in query if key != "passfile"]
    return urlunsplit(parsed._replace(netloc=netloc, query=urlencode(query))), password


def main():
    env = os.environ.copy()
    url, password = connection(env.pop("DATABASE_URL"))
    with tempfile.TemporaryDirectory(prefix="yearly-overview-pg-") as directory:
        if password is not None:
            path = Path(directory) / "pgpass"
            escaped = password.replace("\\", "\\\\").replace(":", "\\:")
            # This private file is used only by this one pg_dump process.
            with open(path, "x", opener=lambda p, flags: os.open(p, flags, 0o600)) as file:
                file.write("*:*:*:*:" + escaped + "\n")
            env.pop("PGPASSWORD", None)
            env["PGPASSFILE"] = str(path)
        return subprocess.call(
            ["pg_dump", "--no-password", "--format=custom", "--no-owner",
             "--no-privileges", "--file=" + sys.argv[1], url],
            env=env,
        )


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (KeyError, ValueError):
        sys.exit("Invalid DATABASE_URL for backup (expected a PostgreSQL URL)")
