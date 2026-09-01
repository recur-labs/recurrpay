# Roadmap

Dates are intentions, not promises. Each milestone is a set of issues.

## v0.1 — engine correctness (done)

Billing periods, trials, proration maths, retry and dunning, double-entry
ledger, signed webhooks, REST API, 66 tests green with no external services.

## v0.2 — durable and provable *(current)*

The point of v0.2 is that a charge survives a crash and can be shown to have
happened on testnet.

- Postgres adapter behind the existing store ports, running the same suite
- Unique index on `(subscription_id, period_start)`
- `SELECT … FOR UPDATE SKIP LOCKED` so two schedulers are safe
- Testnet end-to-end: `approve` → three monthly `transfer_from` charges, with
  the transaction hashes in the README
- Webhook outbox with durable redelivery
- Structured logging and a `/metrics` endpoint

## v0.3 — merchant-usable

- Plan upgrade and downgrade endpoints on the existing proration maths
- Usage-based and metered pricing
- API keys backed by hashed storage, with rotation
- Idempotency keys on write endpoints
- OpenAPI document generated from the Zod schemas
- A TypeScript client SDK

## v0.4 — operator-usable

- Merchant dashboard: subscriptions, invoices, failed charges, webhook attempts
- Payer-facing page showing allowance state, with a revoke button
- Multi-asset plans and a path-payment settlement option
- CSV export and a reconciliation report against Horizon

## Later

- Anchor integration so a merchant can settle to fiat via SEP-6/24
- Soroban contract for on-chain subscription state, for merchants who want the
  schedule itself to be verifiable rather than trusted
- Grace periods and configurable dunning policy per merchant
