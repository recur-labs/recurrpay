import { describe, expect, it } from "vitest";
import {
  NATIVE,
  add,
  assetId,
  formatAmount,
  money,
  multiply,
  parseAmount,
  parseAssetId,
  subtract,
} from "./money.js";

const USDC = {
  code: "USDC",
  issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
};

describe("parseAmount", () => {
  it("parses whole and fractional amounts to stroops", () => {
    expect(parseAmount(NATIVE, "1").stroops).toBe(10_000_000n);
    expect(parseAmount(NATIVE, "0.0000001").stroops).toBe(1n);
    expect(parseAmount(NATIVE, "12.5").stroops).toBe(125_000_000n);
  });

  it("rejects more precision than Stellar can represent", () => {
    expect(() => parseAmount(NATIVE, "0.00000001")).toThrow(/decimal places/);
  });

  it("rejects garbage rather than coercing it to zero", () => {
    for (const bad of ["", "abc", "-1", "1.2.3", "1e5"]) {
      expect(() => parseAmount(NATIVE, bad)).toThrow();
    }
  });
});

describe("formatAmount", () => {
  it("round-trips through parseAmount", () => {
    for (const value of ["0.0000000", "1.0000000", "9999.1234567"]) {
      expect(formatAmount(parseAmount(USDC, value))).toBe(value);
    }
  });
});

describe("arithmetic", () => {
  it("adds and subtracts within one asset", () => {
    const a = parseAmount(USDC, "10");
    const b = parseAmount(USDC, "2.5");
    expect(formatAmount(add(a, b))).toBe("12.5000000");
    expect(formatAmount(subtract(a, b))).toBe("7.5000000");
  });

  it("refuses to mix assets", () => {
    expect(() => add(parseAmount(USDC, "1"), parseAmount(NATIVE, "1"))).toThrow(
      /asset mismatch/,
    );
  });

  it("refuses to go negative", () => {
    expect(() =>
      subtract(parseAmount(USDC, "1"), parseAmount(USDC, "2")),
    ).toThrow(/negative/);
  });

  it("multiplies without float drift", () => {
    expect(formatAmount(multiply(parseAmount(USDC, "0.1"), 3))).toBe(
      "0.3000000",
    );
    expect(formatAmount(multiply(parseAmount(USDC, "100"), 1 / 3))).toBe(
      "33.3333000",
    );
  });
});

describe("asset ids", () => {
  it("round-trips native and credit assets", () => {
    expect(assetId(NATIVE)).toBe("native");
    expect(parseAssetId("native")).toEqual(NATIVE);
    expect(parseAssetId(assetId(USDC))).toEqual(USDC);
  });

  it("rejects malformed ids", () => {
    expect(() => parseAssetId("USDC")).toThrow(/invalid asset id/);
  });
});

describe("money", () => {
  it("rejects negative construction", () => {
    expect(() => money(NATIVE, -1n)).toThrow();
  });
});
