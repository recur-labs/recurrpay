import { describe, expect, it } from "vitest";
import { NATIVE, parseAmount } from "@recur/core";
import { MockExecutor } from "./mock-executor.js";
import { failure, isRetryable } from "./executor.js";
import { classify } from "./soroban-executor.js";

const TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const PAYER = "GPAYER";
const PAYEE = "GPAYEE";

const request = (amount: string, key = "in_1") => ({
  from: PAYER,
  to: PAYEE,
  amount: parseAmount(NATIVE, amount),
  tokenContractId: TOKEN,
  idempotencyKey: key,
});

describe("MockExecutor", () => {
  it("charges within the approved allowance and draws it down", async () => {
    const executor = new MockExecutor();
    executor.approve(PAYER, TOKEN, parseAmount(NATIVE, "30").stroops);

    const first = await executor.execute(request("10"));
    expect(first.ok).toBe(true);
    expect(await executor.allowance(PAYER, TOKEN)).toBe(
      parseAmount(NATIVE, "20").stroops,
    );
  });

  it("refuses to charge beyond the allowance", async () => {
    const executor = new MockExecutor();
    executor.approve(PAYER, TOKEN, parseAmount(NATIVE, "5").stroops);

    const result = await executor.execute(request("10"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("insufficient_allowance");
  });

  it("can be told to fail a fixed number of times", async () => {
    const executor = new MockExecutor();
    executor.approve(PAYER, TOKEN, parseAmount(NATIVE, "100").stroops);
    executor.failNext(2);

    expect((await executor.execute(request("1", "a"))).ok).toBe(false);
    expect((await executor.execute(request("1", "b"))).ok).toBe(false);
    expect((await executor.execute(request("1", "c"))).ok).toBe(true);
    expect(executor.charges).toHaveLength(1);
  });
});

describe("failure classification", () => {
  it("marks transient conditions retryable and permanent ones not", () => {
    expect(isRetryable(failure("insufficient_balance", ""))).toBe(true);
    expect(isRetryable(failure("network_error", ""))).toBe(true);
    expect(isRetryable(failure("timeout", ""))).toBe(true);
    expect(isRetryable(failure("insufficient_allowance", ""))).toBe(false);
    expect(isRetryable(failure("allowance_expired", ""))).toBe(false);
  });

  it("maps contract and transport errors onto codes", () => {
    const cases: Array<[string, string]> = [
      ["allowance has expired", "allowance_expired"],
      ["insufficient allowance for spender", "insufficient_allowance"],
      ["balance too low", "insufficient_balance"],
      ["account not found", "account_missing"],
      ["ECONNREFUSED 127.0.0.1:8000", "network_error"],
      ["something else entirely", "unknown"],
    ];
    for (const [message, code] of cases) {
      const result = classify(new Error(message));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
    }
  });
});
