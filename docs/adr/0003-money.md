# ADR 0003 — Money is a bigint of stroops

**Status:** accepted · 2026-09

## Context

Stellar amounts have exactly 7 decimal places. JavaScript's `number` is a
double: `0.1 + 0.2 !== 0.3`, and above 2^53 integers stop being exact. A
billing engine that rounds a fraction of a cent per charge, per subscriber, per
month, is a billing engine that will eventually be wrong in a way someone
notices.

## Decision

`Money` is `{ asset, stroops: bigint }`. Amounts enter the system as decimal
strings and are parsed to stroops at the edge; they are formatted back to
strings only for API responses and transaction envelopes.

- `parseAmount` **rejects** more than 7 decimal places rather than rounding —
  a caller that meant `0.00000001` should be told, not silently charged zero.
- `multiply` (used only by proration) scales through a `bigint` ratio, so the
  float never reaches the stored value.
- Adding two different assets throws. There is no implicit conversion anywhere.
- Negative money cannot be constructed. A refund is a separate, explicitly
  authorised operation, not a negative charge.

## Consequences

- Every arithmetic path is exact and the invariants are unit-tested.
- `bigint` does not survive `JSON.stringify`, so every serialiser goes through
  `formatAmount`. That is deliberate: a raw stroop count should never leak into
  an API response where a merchant might read it as a decimal.
- Proration truncates rather than rounds, at 1e-7 precision. In the merchant's
  favour never, in the payer's favour by at most a stroop.
