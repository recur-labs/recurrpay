# Recur

**Recurring payments and subscription billing infrastructure for Stellar.**

Stellar settles a payment in five seconds for a fraction of a cent, which makes
it a good rail for small repeating charges — a $3/month API plan, a $0.50/week
data feed, a payroll run. What it does not have is the layer above the payment:
plans, billing periods, trials, proration, retries when a charge fails, an
audit trail, and a webhook telling the merchant what happened.

Recur is that layer. It is a self-hostable billing engine that turns a Stellar
account into a subscription backend.

```
POST /v1/plans          → "USDC 10.00, every month, 14-day trial"
POST /v1/subscriptions  → binds a payer to a plan
                        → the engine charges on schedule, retries on failure,
                          and posts a webhook on every outcome
```

## Why pull payments work on Stellar without a custom contract

The engine never holds a payer's keys and never becomes a signer on their
account. Charging uses the SEP-41 token interface that the Stellar Asset
Contract already implements:

1. The payer calls `approve(spender = engine, amount, expiration_ledger)` once.
2. Each billing period the engine calls `transfer_from(payer → merchant)` for
   exactly the plan amount, inside that allowance.
3. The payer revokes at any time by approving `0`, with no involvement from the
   merchant or from us.

The engine can therefore never move more than the payer approved, and never
after the approval expires. See
[`docs/adr/0001-pull-payments.md`](docs/adr/0001-pull-payments.md) for the
alternatives that were rejected.

## Status

**Early. v0.1, and honest about it.** What works today:

| Area | State |
| --- | --- |
| Plans, subscriptions, invoices, cancellation API | working |
| Billing cycle: periods, trials, month-end clamping, proration | working, tested |
| Retry and dunning (3 backoff attempts, then cancel) | working, tested |
| Double-entry ledger with balance invariants | working, tested |
| Signed webhooks with retry | working, tested |
| SEP-41 `transfer_from` executor | written, **not yet exercised on testnet** |
| Storage | in-memory only — Postgres adapter is [#1](../../issues) |
| Merchant dashboard | not started |

66 tests pass on a clean checkout. Nothing here has handled real money yet.

## Quick start

Requires Node 20+ and pnpm 10+.

```bash
pnpm install
pnpm test          # 66 tests, no network or database needed
pnpm typecheck
pnpm dev:api       # http://localhost:3000, mock executor, in-memory stores
```

Create a plan and a subscription against the local server:

```bash
curl -s localhost:3000/v1/plans \
  -H 'x-api-key: sk_test_local' -H 'content-type: application/json' \
  -d '{"name":"Pro monthly","amount":"10.00",
       "asset":{"code":"USDC","issuer":"GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"},
       "cycle":{"interval":"month","intervalCount":1},"trialDays":14}'
```

To run against Stellar testnet instead of the mock executor, set
`STELLAR_RPC_URL`, `STELLAR_SPENDER_SECRET` and `RECUR_TOKEN_CONTRACT_ID` (see
[`.env.example`](.env.example)).

## Layout

```
packages/core       domain model, money in stroops, billing-period arithmetic
packages/ledger     append-only double-entry ledger
packages/stellar    payment executors: SEP-41 allowance, and a mock for tests
apps/api            REST API (Fastify)
apps/scheduler      billing loop + outbound webhook delivery
docs/adr            architecture decisions, and what was rejected
```

Every amount is a `bigint` of stroops. No float ever touches a balance.

## API

| Method | Path | |
| --- | --- | --- |
| `POST` | `/v1/plans` | create a plan |
| `GET` | `/v1/plans` | list your plans |
| `POST` | `/v1/subscriptions` | subscribe a payer to a plan |
| `GET` | `/v1/subscriptions/:id` | read a subscription |
| `POST` | `/v1/subscriptions/:id/cancel` | cancel |
| `GET` | `/v1/subscriptions/:id/invoices` | invoice history |
| `POST` | `/v1/webhooks` | register an endpoint (secret returned once) |
| `GET` | `/v1/events` | recent events |

Webhooks are signed `HMAC-SHA256(secret, "<timestamp>.<body>")` in the
`Recur-Signature` header; `verify()` in `apps/scheduler/src/webhooks.ts` is the
reference implementation.

## Contributing

Good first issues are labelled [`good first issue`](../../issues). Start with
[CONTRIBUTING.md](CONTRIBUTING.md) — it covers the setup, the test conventions,
and what a reviewable pull request looks like here.

Issues are scoped so that one is one pull request. If an issue looks bigger than
that when you open it, say so on the issue and it will be split.

## Licence

MIT — see [LICENSE](LICENSE).
