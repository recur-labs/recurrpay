# Security Policy

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting
(**Security → Report a vulnerability** on this repository), or email the
maintainer address listed on the repository profile.

Please include what you found, how to reproduce it, and what an attacker gets
out of it. You will get an acknowledgement within 72 hours and an assessment
within a week.

## Scope

Recur moves money. The following are treated as high severity:

- Anything that lets a charge exceed the payer's approved allowance.
- Anything that lets the same invoice settle twice.
- Anything that leaks or logs a spender secret, an API key, or a webhook
  signing secret.
- A webhook signature that verifies when it should not, including replay of an
  old signed payload.
- Loss of the ledger's balance invariant (debits ≠ credits) through any public
  path.

## Operational notes for self-hosters

- The spender key can only ever move what payers have explicitly approved, but
  it should still be held in a KMS or an HSM, not in an environment variable,
  outside of local development.
- Run the API and the scheduler with the same database and clock source; two
  schedulers on different clocks against one database can double-charge.
  Postgres-backed locking is tracked in the storage issue.
- API keys in `RECUR_API_KEYS` are for local development only. A deployment
  should back keys with hashed storage and per-merchant rotation.
