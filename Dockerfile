# syntax=docker/dockerfile:1

# ── Frontend ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

# ── Server ─────────────────────────────────────────────────────────────────────
FROM rust:1.97-slim-bookworm AS server
WORKDIR /app
# Build dependencies first so they are cached between source changes.
COPY server/Cargo.toml server/Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && touch src/lib.rs \
    && cargo build --release --locked \
    && rm -rf src
COPY server/ ./
RUN touch src/main.rs src/lib.rs && cargo build --release --locked

# ── Runtime ────────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim
RUN useradd --system --uid 10001 app
COPY --from=server /app/target/release/yearly-overview-server /usr/local/bin/yearly-overview-server
COPY --from=frontend /app/build /app/build

# DATABASE_URL must be provided (see compose.yaml).
ENV BIND_ADDR=0.0.0.0:8080 \
    STATIC_DIR=/app/build
WORKDIR /app
USER app
EXPOSE 8080
CMD ["yearly-overview-server"]
