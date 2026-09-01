# ADR 0004 — Retries, dunning, and what happens when a charge fails

**Status:** accepted · 2026-09

## Context

Charges fail. On Stellar the reasons split cleanly into two groups, and treating
them the same produces either wasted fees or lost revenue.

## Decision

Every failure is classified into a `FailureCode` with a `retryable` flag.

**Retryable** — the state of the world may change on its own:
`insufficient_balance` (the payer gets paid on Friday), `network_error`,
`timeout`.

**Not retryable** — only the payer can act: `insufficient_allowance`,
`allowance_expired`, `account_missing`.

Retryable failures follow a fixed backoff of +1 day, +3 days, +5 days — four
attempts spanning nine days. The period stays open, the *same* invoice is
retried (attempts increment on it), the subscription sits in `past_due`, and a
`subscription.past_due` webhook fires each time so the merchant can chase.

After the schedule is exhausted, or immediately on a non-retryable failure, the
invoice is marked `failed`, the subscription is `canceled`, and
`invoice.failed` fires.

## Consequences

- A payer who is briefly short is not cancelled over one bad day.
- A payer who revoked their allowance is not retried for nine days against a
  charge that provably cannot succeed — they are told at once.
- The backoff is deliberately a constant (`RETRY_SCHEDULE_MS`), not a
  configurable per-merchant policy. Configurable dunning is a real feature
  request, but it needs to arrive with per-merchant settings storage rather
  than as an environment variable.
- Because the period is not advanced during dunning, a subscription can never
  "skip" a billing period silently: the unpaid invoice stays on the record.
