import { describe, expect, it } from "vitest";
import { NATIVE, assetId, parseAmount } from "@recur/core";
import {
  Ledger,
  LedgerError,
  assertBalanced,
  invoiceRaised,
  invoiceSettled,
} from "./index.js";

const at = new Date("2026-01-01T00:00:00.000Z");
const MERCHANT = "GMERCHANT";
const PAYER = "GPAYER";
const ten = parseAmount(NATIVE, "10");

describe("assertBalanced", () => {
  it("accepts a balanced pair", () => {
    expect(() =>
      assertBalanced(invoiceRaised(at, "in_1", MERCHANT, PAYER, ten).postings),
    ).not.toThrow();
  });

  it("rejects a single posting", () => {
    expect(() =>
      assertBalanced([
        {
          account: { kind: "settled", ref: MERCHANT },
          amount: ten,
          direction: "debit",
        },
      ]),
    ).toThrow(LedgerError);
  });

  it("rejects debits that do not equal credits", () => {
    expect(() =>
      assertBalanced([
        {
          account: { kind: "settled", ref: MERCHANT },
          amount: ten,
          direction: "debit",
        },
        {
          account: { kind: "payer_payable", ref: PAYER },
          amount: parseAmount(NATIVE, "9"),
          direction: "credit",
        },
      ]),
    ).toThrow(/does not balance/);
  });
});

describe("Ledger", () => {
  it("clears the receivable once the invoice settles", () => {
    const ledger = new Ledger();
    ledger.post(invoiceRaised(at, "in_1", MERCHANT, PAYER, ten));

    const receivable = { kind: "merchant_receivable", ref: MERCHANT } as const;
    expect(ledger.balance(receivable, assetId(NATIVE))).toBe(ten.stroops);

    ledger.post(invoiceSettled(at, "in_1", MERCHANT, ten, "abc123"));
    expect(ledger.balance(receivable, assetId(NATIVE))).toBe(0n);
    expect(ledger.balance({ kind: "settled", ref: MERCHANT }, assetId(NATIVE))).toBe(
      ten.stroops,
    );
  });

  it("keeps entries append-only and retrievable by reference", () => {
    const ledger = new Ledger();
    ledger.post(invoiceRaised(at, "in_1", MERCHANT, PAYER, ten));
    ledger.post(invoiceRaised(at, "in_2", MERCHANT, PAYER, ten));
    expect(ledger.size).toBe(2);
    expect(ledger.byReference("in_2")).toHaveLength(1);
    expect(ledger.all()[0]?.id).toBe("je_1");
  });

  it("refuses to record an unbalanced entry", () => {
    const ledger = new Ledger();
    expect(() =>
      ledger.post({
        at,
        memo: "bad",
        reference: "in_x",
        postings: [
          {
            account: { kind: "settled", ref: MERCHANT },
            amount: ten,
            direction: "debit",
          },
        ],
      }),
    ).toThrow(LedgerError);
    expect(ledger.size).toBe(0);
  });
});
