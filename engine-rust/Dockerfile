# Stage 1: Build binary using official Rust Alpine image
FROM rust:1.85-alpine AS builder

RUN apk add --no-cache musl-dev

WORKDIR /app
COPY Cargo.toml Cargo.lock clippy.toml ./
COPY src ./src

RUN cargo build --release

# Stage 2: Minimal runtime image
FROM alpine:latest

WORKDIR /app
COPY --from=builder /app/target/release/clio-engine /app/clio-engine

ENV PORT=8088
ENV CLIO_ENGINE_HOST=0.0.0.0

EXPOSE 8088

CMD ["/app/clio-engine"]
