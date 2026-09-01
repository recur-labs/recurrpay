# ADR 0001 — How a recurring charge is pulled

**Status:** accepted · 2026-09

## Context

Stellar has no native recurring payment. Something has to move funds from the
payer to the merchant on a schedule without the payer being present, and
without the engine being able to take more than was agreed.

## Options considered

**1. Payer pushes each payment.** The merchant sends an invoice, the payer signs
a payment. Safe, and useless: the whole point of a subscription is that nobody
is present at 03:00 on the 1st.

**2. Engine becomes an additional signer on the payer's account.** A low-weight
signer plus thresholds could, in principle, be constrained. In practice signer
weights gate *operations*, not *amounts*: a signer that can send 10 USDC can
send 10,000. Rejected — the blast radius of a compromised spender key is the
payer's whole balance.

**3. Pre-authorised transactions.** The payer signs the next N charges in
advance and the engine submits them on schedule. Amounts and dates are fixed at
signing, which breaks usage-based pricing, proration, and retries after a failed
charge (the sequence number is consumed). Rejected.

**4. A custom escrow contract holding funds.** The engine holds the payer's
money and releases it monthly. This makes the engine a custodian, with the
regulatory and security weight that implies, and strands the payer's capital.
Rejected.

**5. SEP-41 allowance (`approve` / `transfer_from`).** Chosen.

## Decision

The payer calls `approve(spender = engine_account, amount, expiration_ledger)`
on the token contract once. Each period the engine calls
`transfer_from(payer → merchant, plan_amount)` within that allowance.

Consequences:

- The engine cannot move more than the approved amount, ever, and cannot move
  anything after `expiration_ledger`.
- The payer revokes unilaterally with `approve(0)`. The merchant is not in the
  loop, which is what a cancel button should mean.
- Funds stay in the payer's account until the moment of the charge, so they
  keep custody and any yield.
- No custom contract to write, audit, or deploy: the Stellar Asset Contract
  already implements SEP-41, so every SAC-wrapped asset works on day one.
- The cost is a real failure mode: an allowance that runs out or expires. That
  is why `insufficient_allowance` and `allowance_expired` are non-retryable
  failure codes that raise a webhook immediately rather than being retried into
  a dunning cycle — only the payer can fix them.
