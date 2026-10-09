# ADR 0002 — Storage behind ports, in-memory first

**Status:** accepted · 2026-09

## Context

The engine needs durable storage. Adding Postgres on day one would mean every
contributor needs Docker running before a single test passes, and would bake
query details into logic that is still moving.

## Decision

All storage sits behind narrow interfaces in `packages/core/src/ports.ts`
(`PlanStore`, `SubscriptionStore`, `InvoiceStore`, `EventStore`,
`WebhookStore`). An in-memory adapter ships in `@recur/core` and is what the
tests and `pnpm dev` use. A Postgres adapter implements the same interfaces.

`Clock` is a port for the same reason: the billing tests move a fake clock
through three months in milliseconds.

## Consequences

- `pnpm test` is green on a clean checkout with no services running, which is
  the single biggest factor in whether a first-time contributor finishes their
  first pull request.
- The in-memory adapter is a real, tested implementation, not a stub — so its
  semantics define the contract the Postgres adapter must satisfy. The same
  suite runs against both.
- The engine is currently not safe to run as two processes: correctness relies
  on one scheduler at a time. Row-level locking (`SELECT … FOR UPDATE SKIP
  LOCKED` over due subscriptions) arrives with the Postgres adapter, and until
  then the deployment guidance is a single scheduler.
- `findByPeriod` exists on `InvoiceStore` purely so a retried tick reuses the
  invoice it already raised. Idempotency is a storage-level concern here, and
  it belongs in the port rather than in a lock held in memory.
