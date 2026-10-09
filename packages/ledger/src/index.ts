import { assetId, type Money } from "@recur/core";

/**
 * A minimal double-entry ledger.
 *
 * Every movement of value the engine performs is written here before and after
 * it touches the network, so "what did we bill, what settled, and what is still
 * in flight" is answerable from our own records rather than by replaying
 * Horizon. Entries are append-only; corrections are new entries, never edits.
 */

export type AccountKind = "merchant_receivable" | "payer_payable" | "settled" | "fees";

export interface Account {
  readonly kind: AccountKind;
  /** Stellar account or internal identifier this balance belongs to. */
  readonly ref: string;
}

export function accountKey(account: Account): string {
  return `${account.kind}:${account.ref}`;
}

export interface Posting {
  readonly account: Account;
  /** Positive credits the account, negative debits it. */
  readonly amount: Money;
  readonly direction: "debit" | "credit";
}

export interface JournalEntry {
  readonly id: string;
  readonly at: Date;
  readonly memo: string;
  readonly reference: string;
  readonly postings: readonly Posting[];
}

export class LedgerError extends Error {
  override name = "LedgerError";
}

/**
 * Throws unless debits equal credits per asset. Called on every write; an
 * unbalanced entry is a bug in the caller, not a recoverable condition.
 */
export function assertBalanced(postings: readonly Posting[]): void {
  if (postings.length < 2) {
    throw new LedgerError("an entry needs at least two postings");
  }
  const net = new Map<string, bigint>();
  for (const posting of postings) {
    const key = assetId(posting.amount.asset);
    const signed =
      posting.direction === "debit" ? posting.amount.stroops : -posting.amount.stroops;
    net.set(key, (net.get(key) ?? 0n) + signed);
  }
  for (const [asset, balance] of net) {
    if (balance !== 0n) {
      throw new LedgerError(
        `entry does not balance for ${asset}: net ${balance} stroops`,
      );
    }
  }
}

export class Ledger {
  private readonly entries: JournalEntry[] = [];
  private sequence = 0;

  post(input: Omit<JournalEntry, "id">): JournalEntry {
    assertBalanced(input.postings);
    this.sequence += 1;
    const entry: JournalEntry = { id: `je_${this.sequence}`, ...input };
    this.entries.push(entry);
    return entry;
  }

  /** Net balance of one account in one asset, in stroops. */
  balance(account: Account, asset: string): bigint {
    let total = 0n;
    for (const entry of this.entries) {
      for (const posting of entry.postings) {
        if (
          accountKey(posting.account) === accountKey(account) &&
          assetId(posting.amount.asset) === asset
        ) {
          total +=
            posting.direction === "debit"
              ? posting.amount.stroops
              : -posting.amount.stroops;
        }
      }
    }
    return total;
  }

  /** All entries carrying a given reference (an invoice id, usually). */
  byReference(reference: string): JournalEntry[] {
    return this.entries.filter((e) => e.reference === reference);
  }

  all(): readonly JournalEntry[] {
    return [...this.entries];
  }

  get size(): number {
    return this.entries.length;
  }
}

/** Invoice raised: the merchant is owed money that has not settled yet. */
export function invoiceRaised(
  at: Date,
  invoiceId: string,
  merchant: string,
  payer: string,
  amount: Money,
): Omit<JournalEntry, "id"> {
  return {
    at,
    memo: `invoice ${invoiceId} raised`,
    reference: invoiceId,
    postings: [
      {
        account: { kind: "merchant_receivable", ref: merchant },
        amount,
        direction: "debit",
      },
      { account: { kind: "payer_payable", ref: payer }, amount, direction: "credit" },
    ],
  };
}

/** Invoice settled on-chain: the receivable is cleared into settled funds. */
export function invoiceSettled(
  at: Date,
  invoiceId: string,
  merchant: string,
  amount: Money,
  txHash: string,
): Omit<JournalEntry, "id"> {
  return {
    at,
    memo: `invoice ${invoiceId} settled in ${txHash}`,
    reference: invoiceId,
    postings: [
      { account: { kind: "settled", ref: merchant }, amount, direction: "debit" },
      {
        account: { kind: "merchant_receivable", ref: merchant },
        amount,
        direction: "credit",
      },
    ],
  };
}
