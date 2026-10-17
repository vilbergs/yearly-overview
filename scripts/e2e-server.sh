#!/usr/bin/env bash
# Starts the server for Playwright on a freshly created database.
# Connection settings come from the usual libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD).
set -euo pipefail

export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=yearly_overview_e2e

psql -v ON_ERROR_STOP=1 -q -d postgres \
	-c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" \
	-c "CREATE DATABASE $DB"

export DATABASE_URL="postgres://${PGUSER}${PGPASSWORD:+:$PGPASSWORD}@${PGHOST}:${PGPORT}/$DB"
exec cargo run --quiet --manifest-path server/Cargo.toml
