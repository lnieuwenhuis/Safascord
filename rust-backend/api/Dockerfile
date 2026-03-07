FROM rust:1.94-bookworm AS build
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY core ./core
COPY api ./api
COPY realtime ./realtime
COPY contract-tests ./contract-tests
COPY migrations ./migrations

RUN cargo build --release --locked -p safascord-api

FROM debian:bookworm-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/target/release/safascord-api /usr/local/bin/safascord-api
COPY --from=build /app/migrations /app/migrations

EXPOSE 4000

CMD ["/usr/local/bin/safascord-api"]
