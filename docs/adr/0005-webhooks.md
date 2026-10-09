# ADR 0005 — Signed webhooks over polling

**Status:** accepted · 2026-09

## Context

A merchant needs to know when a subscription is paid, late, or dead — that is
what gates access in their product. Polling `/v1/events` is simple for us and
bad for them: latency, wasted requests, and a cursor to keep.

## Decision

Outbound webhooks, signed with `HMAC-SHA256(secret, "<timestamp>.<body>")` in a
`Recur-Signature` header, with the timestamp in `Recur-Timestamp`.

- The secret is shown once at endpoint creation and never readable afterwards.
- Verification rejects a timestamp older than 5 minutes, so a captured payload
  cannot be replayed later.
- Comparison is `timingSafeEqual`.
- Delivery retries on 5xx, on 429, and on transport errors, with 1s / 5s / 25s
  backoff. A 4xx other than 429 is not retried — the endpoint rejected the
  payload itself and will reject it identically next time.
- `/v1/events` still exists, as a reconciliation path for a merchant whose
  endpoint was down.

## Consequences

- Merchants implement one well-understood pattern; `verify()` in
  `apps/scheduler/src/webhooks.ts` is the reference and is unit-tested against
  tampering, replay, and wrong-secret cases.
- Delivery is currently in-process and at-most-a-few-attempts: if the process
  dies mid-delivery, that event is not redelivered. A durable outbox is the
  next step, and is why events are persisted through `EventStore` before any
  delivery is attempted rather than being fired and forgotten.
