-- One planner per server: the server is meant to be reachable only by its owner (e.g. over a
-- private tailnet), so there are no accounts.

-- A single row with the revision counter and the synced settings.
CREATE TABLE planner (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    -- Bumped on every write; clients pull entries with a newer `rev`.
    rev BIGINT NOT NULL DEFAULT 0,
    -- Category names and the public holiday country.
    settings JSONB NOT NULL DEFAULT '{}',
    settings_rev BIGINT NOT NULL DEFAULT 0
);

INSERT INTO planner (id) VALUES (1);

CREATE TABLE entries (
    date DATE PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    color TEXT,
    -- Deleted days are kept as tombstones so other devices learn about the deletion.
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    rev BIGINT NOT NULL
);

CREATE INDEX entries_rev ON entries (rev);
