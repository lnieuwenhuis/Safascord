FROM rust:1.94-bookworm AS build
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY core ./core
COPY api ./api
COPY realtime ./realtime
COPY contract-tests ./contract-tests

RUN cargo build --release --locked -p safascord-realtime

FROM debian:bookworm-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/target/release/safascord-realtime /usr/local/bin/safascord-realtime

EXPOSE 4001

CMD ["/usr/local/bin/safascord-realtime"]
