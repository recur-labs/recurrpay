# Quickstart: zero to first charge on testnet

This walks through the same SEP-41 flow the scheduler runs in production —
`approve` once, `transfer_from` on every billing cycle — but by hand, against
Stellar testnet, with real transaction hashes at the end.

It uses [`scripts/testnet-e2e.ts`](../scripts/testnet-e2e.ts), which drives
the real `SorobanAllowanceExecutor` (the same class `apps/api` and
`apps/scheduler` use once `STELLAR_RPC_URL` is set), not the in-memory mock.

## What it does

1. Generates a **payer** and a **spender** keypair and funds both through
   [friendbot](https://friendbot.stellar.org).
2. Points at the SEP-41 token contract for native XLM. This is the Stellar
   Asset Contract wrapping the native asset — it is already deployed on
   testnet, so there is no contract to write or deploy here. Any SAC-wrapped
   asset works the same way; see
   [`docs/adr/0001-pull-payments.md`](adr/0001-pull-payments.md) for why the
   engine relies on SEP-41 instead of holding funds itself.
3. The payer signs `approve(spender, amount, expiration_ledger)` — the one
   step the engine can never do on the payer's behalf.
4. The spender key is handed to `SorobanAllowanceExecutor`, which then runs
   three `transfer_from` charges against that single allowance, exactly as
   `runBillingCycle` would call it once per billing period.

The payee is the spender account itself for this smoke test — a merchant
payout address is just `subscription.payeeAccount` configuration that the
executor never signs for, so reusing the spender keeps the run to the two
accounts the SEP-41 flow actually needs. Point `RECUR_E2E_TO` at a third
funded account to charge someone else instead.

## Run it

Requires Node 20+ and pnpm 10+, and outbound network access to testnet.

```bash
pnpm install
pnpm build          # scripts/testnet-e2e.ts imports the built @recur packages
pnpm testnet:e2e
```

A run takes about 20 seconds — most of it is waiting for friendbot's accounts
to land and for each transaction to close. Expect output like:

```
payer:   GB6W...JBSAV
spender: GCMX...W5TR7
payee:   GCMX...W5TR7
token:   CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC (native XLM SAC)
approve confirmed: 03375010efa6109bc38b3954b6d3348a8e559739e7956eb7dfa77ed81ccd94d6
allowance after approve: 5.0000000 XLM
charge 1/3 confirmed: e7fb4a7ef0c8dd762bd180442c69008293e3813468e26d0e54ea55af8d986c9f
charge 2/3 confirmed: 187c0dea954f7d85e9181f30e909cf4e2f3d7a5c50be2a31a551da023bd8164d
charge 3/3 confirmed: e1f6bf20505d5f74d8854ea0793a6881af687191ead10e7306d6ea5d9a937b56
allowance remaining: 2.0000000 XLM
```

Every run generates fresh keys, so it's safe to run repeatedly. To reuse
specific accounts instead (skips friendbot funding for whichever you supply):

```bash
RECUR_E2E_PAYER_SECRET=S...   \
RECUR_E2E_SPENDER_SECRET=S... \
pnpm testnet:e2e
```

Other knobs, all optional:

| Env var | Default | |
| --- | --- | --- |
| `STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` | |
| `STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | |
| `STELLAR_FRIENDBOT_URL` | `https://friendbot.stellar.org` | |
| `RECUR_E2E_CHARGE_AMOUNT` | `1` (XLM per charge) | |
| `RECUR_E2E_TO` | the spender account | pay a third account instead |

## Verifying the hashes yourself

Every hash the script prints is independently checkable on Horizon or
[stellar.expert](https://stellar.expert/explorer/testnet), without trusting
this script's own "confirmed" output:

```bash
curl -s https://horizon-testnet.stellar.org/transactions/<hash> | jq '.successful, .ledger'
```

## Wiring this into the API instead of the standalone script

`apps/api` picks the live executor over the mock automatically once
`STELLAR_RPC_URL`, `STELLAR_SPENDER_SECRET`, and `RECUR_TOKEN_CONTRACT_ID` are
all set (see `usesLiveNetwork` in `apps/api/src/config.ts`) — copy the
`STELLAR_SPENDER_SECRET` from a spender this script funded and
`RECUR_TOKEN_CONTRACT_ID` from the `token:` line it prints, then create a plan
and subscription against the running API as usual (see the main
[README](../README.md#quick-start)). The payer still has to submit their own
`approve` call once — the engine does not and cannot do that on their behalf.

## What running this for real found

Pinned `@stellar/stellar-sdk` was `^13.1.0`. Against testnet's current
protocol (28), that version fails to parse `getTransaction` responses at all
— `TypeError: Bad union switch: 4` decoding the transaction-meta XDR — so
every charge would report as an unconfirmed timeout even after succeeding
on-chain. The dependency is now `^17.0.1`, which reads it correctly; the
`transfer_from` call shape used by `SorobanAllowanceExecutor` was unaffected
by the major-version jump. This is why "written" and "exercised on testnet"
are different rows in the README status table.
