# Starter issue backlog

Fifty issues, each scoped to one pull request. `scripts/seed-issues.sh --apply`
creates them on GitHub with labels; this file is the readable copy.

**50 issues** — 11 trivial, 25 medium, 14 high.

Complexity here maps onto the tiers a Wave program uses: Trivial (100 points),
Medium (150), High (200). Do not tag every issue into a wave at once — tag only
what you can review inside the cycle.


## Storage and durability

| Complexity | Issue | Labels |
| --- | --- | --- |
| Medium | Add a Postgres adapter for PlanStore | storage, good first issue |
| High | Add a Postgres adapter for SubscriptionStore | storage |
| High | Add a Postgres adapter for InvoiceStore with a uniqueness guarantee | storage, correctness |
| Medium | Add Postgres adapters for EventStore and WebhookStore | storage |
| Medium | Write the initial SQL migrations and a migration runner | storage |
| Medium | Run the store test suite against both adapters in CI | storage, testing |
| High | Lock due subscriptions with SELECT … FOR UPDATE SKIP LOCKED | storage, correctness |

## API surface

| Complexity | Issue | Labels |
| --- | --- | --- |
| Medium | Support a configurable page size and cursor on list endpoints | api, storage |
| High | Add plan upgrade and downgrade endpoints | api |
| Medium | Accept idempotency keys on write endpoints | api, correctness |
| High | Back API keys with hashed storage and rotation | api, security |
| Medium | Generate an OpenAPI document from the Zod schemas | api, docs |
| Medium | Add rate limiting per API key | api, security, good first issue |
| Trivial | Return a consistent error envelope with a request id | api, good first issue |
| Medium | Validate that a plan's asset issuer exists on the network | api, stellar |
| Trivial | Add a subscriptions list endpoint with status filtering | api, good first issue |
| Medium | Add a pause and resume endpoint | api |
| Medium | Expose the payer's allowance state on the subscription resource | api, stellar |

## Ledger

| Complexity | Issue | Labels |
| --- | --- | --- |
| High | Persist the ledger instead of holding it in memory | ledger, storage |
| Trivial | Reject an unbalanced entry before any partial write | ledger, good first issue |
| Medium | Add a reconciliation report: ledger vs invoices | ledger, ops |

## Stellar and settlement

| Complexity | Issue | Labels |
| --- | --- | --- |
| High | Exercise the SEP-41 executor against Stellar testnet end to end | stellar, milestone:v0.2 |
| Medium | Verify allowance before charging and skip a charge that cannot succeed | stellar, good first issue |
| High | Classify contract errors from structured diagnostics, not message text | stellar, correctness |
| Medium | Warn merchants when a payer's allowance is running low | stellar, api |
| High | Add a Horizon classic-payment executor for non-Soroban assets | stellar |
| High | Handle a transaction that times out but later succeeds | stellar, correctness |
| Trivial | Make the confirm timeout and poll interval configurable | stellar, good first issue |
| Medium | Resolve the token contract per asset instead of a single env var | stellar, api |

## Webhooks

| Complexity | Issue | Labels |
| --- | --- | --- |
| High | Make webhook delivery durable with an outbox | webhooks, milestone:v0.2 |
| Medium | Add a webhook delivery log endpoint | webhooks, api |
| Medium | Add a manual redelivery endpoint | webhooks, api, good first issue |
| Medium | Disable an endpoint after sustained failure and tell the merchant | webhooks |
| Trivial | Publish a webhook verification snippet for other languages | webhooks, docs, good first issue |

## Operations

| Complexity | Issue | Labels |
| --- | --- | --- |
| Medium | Add structured logging with pino across the API | ops, good first issue |
| Medium | Add a /metrics endpoint | ops |
| Trivial | Add a readiness probe distinct from liveness | ops, good first issue |
| Trivial | Emit a warning when a billing cycle overruns the tick interval | ops, good first issue |
| Trivial | Add graceful shutdown to the API | ops, good first issue |

## Documentation

| Complexity | Issue | Labels |
| --- | --- | --- |
| Medium | Write docs/quickstart.md: zero to first charge on testnet | docs |
| Trivial | Document the failure codes and what a merchant should do about each | docs, good first issue |
| Trivial | Add a sequence diagram of a full billing cycle | docs, good first issue |
| Medium | Add a worked example merchant integration | docs, examples |

## Client SDK

| Complexity | Issue | Labels |
| --- | --- | --- |
| High | Publish a TypeScript client SDK | sdk |

## Tooling

| Complexity | Issue | Labels |
| --- | --- | --- |
| Medium | Set up eslint with a rule banning float arithmetic on amounts | tooling |
| Medium | Add a changeset-based release flow for the published packages | tooling |

## Testing

| Complexity | Issue | Labels |
| --- | --- | --- |
| High | Add property-based tests for billing period arithmetic | testing |
| Medium | Add a fuzz test for amount parsing | testing, good first issue |
| Trivial | Raise test coverage reporting and add a floor | testing, good first issue |
| High | Add a load test for the billing cycle | testing, ops |
