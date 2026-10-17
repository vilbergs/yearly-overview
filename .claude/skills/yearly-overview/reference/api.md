# Yearly Overview HTTP API (`/api/v1`)

No authentication; JSON in and out; every error is `{"error": "...", "details"?: {...}}` with a
message that says what to fix. Full schema: `GET /api/v1/openapi.json`.

| Method | Path           | Body / query                                                        | Returns                                                                                          |
| ------ | -------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| GET    | `/today`       | `?date=` (pretend today)                                            | `{date, weekday, iso_week, day_of_year, days_left_in_year, today: Day\|null, upcoming: Event[]}` |
| GET    | `/summary`     | `?year=`                                                            | `{year, planned_days, events, by_category[], months[{month, name, planned_days, events[]}]}`     |
| GET    | `/events`      | `?from=&to=&query=&category=`                                       | `{events: Event[]}`                                                                              |
| POST   | `/events`      | `{start, end?, title, description?, category?\|color?, overwrite?}` | 201 `{event, replaced: Day[]}`; 409 `details.conflicts`                                          |
| GET    | `/days`        | same filters as events                                              | `{days: Day[]}`                                                                                  |
| DELETE | `/days`        | `?from=&to=` (both required)                                        | `{cleared: n}`                                                                                   |
| GET    | `/days/{date}` |                                                                     | `{date, day: Day\|null}`                                                                         |
| PUT    | `/days/{date}` | `{title?, description?, category?\|color?}` (replaces)              | `{day: Day\|null}`                                                                               |
| PATCH  | `/days/{date}` | same, only given fields change; `""` category removes color         | `{day}`                                                                                          |
| DELETE | `/days/{date}` |                                                                     | `{deleted: bool}`                                                                                |
| GET    | `/categories`  |                                                                     | `{categories: [{color, name?, days}]}`                                                           |
| GET    | `/settings`    |                                                                     | `{categories: {color: name}, holiday_country?}`                                                  |
| PATCH  | `/settings`    | `{categories?: {color: name}, holiday_country?: "SE"\|null}`        | settings                                                                                         |

`Day = {date, title, description, color?, category?}`;
`Event = {start, end, days, title, description, color?, category?}`.

Example:

```bash
curl -s -X POST "$YEARLY_OVERVIEW_URL/api/v1/events" -H 'Content-Type: application/json' \
  -d '{"start":"2026-07-06","end":"2026-07-10","title":"Vacation","category":"Holiday"}'
```

## MCP

`POST /mcp` speaks the Model Context Protocol (Streamable HTTP, stateless). Tools:
`get_today`, `get_year_summary`, `list_events`, `list_days`, `get_day`, `list_categories`,
`add_event`, `update_day`, `clear_days`, `update_settings`. Add it to Claude Code with:

```bash
claude mcp add --transport http yearly-overview https://<pi>.<tailnet>.ts.net/mcp
```
