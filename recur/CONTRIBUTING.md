# Contributing to Recur

Thanks for taking the time. This document is short on ceremony and specific
about what gets a pull request merged quickly.

## Setup

```bash
git clone https://github.com/<owner>/recur.git
cd recur
pnpm install
pnpm test        # should be green on a clean checkout, no network needed
pnpm typecheck
```

Node 20+ and pnpm 10+. Nothing else — no database, no Stellar account, no
funded testnet keys are needed to run the suite. If `pnpm test` is red before
you have changed anything, that is a bug: open an issue.

## Claiming an issue

- Comment on the issue before you start. One issue is assigned to one person.
- If you go quiet for a week the assignment is released, no hard feelings.
- Do not open a pull request for an issue assigned to someone else.
- If the issue turns out to be bigger than it looked, say so on the issue
  rather than growing the pull request. It will be split.

## What a good pull request looks like

- **One issue, one pull request.** A drive-by fix in an unrelated file makes a
  change harder to review, not more valuable.
- **A test that fails before your change and passes after.** For a bug fix,
  write the failing test first and put it in the same commit.
- **No new dependency without saying why on the issue first.** This is payments
  infrastructure; every dependency is a supply-chain surface.
- **Money stays in `bigint` stroops.** A pull request that introduces a `number`
  for an amount, or a `parseFloat` on one, will be sent back.
- **Comments explain why, not what.** If a line needs a comment to say what it
  does, rename something instead.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

```
fix(scheduler): stop re-charging a period after a crash mid-cycle
```

## Tests

`vitest`, colocated as `*.test.ts` next to the code they cover.

- Time is injected. Use the `Clock` port — never `new Date()` inside logic you
  want to test, and never `setTimeout` to wait for something in a test.
- The network is injected. Use `MockExecutor` for charges and pass `fetchImpl`
  to `deliver()` for webhooks.
- Test behaviour at the boundary that matters: an amount that cannot be
  represented, a month that has 28 days, a retry that arrives twice.

## Review

A maintainer reviews within 72 hours. Reviews are direct about the code and
never about the person. If something in a review is unclear, ask — a question
on the pull request is faster than a guess.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
