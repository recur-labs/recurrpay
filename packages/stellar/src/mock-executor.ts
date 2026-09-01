import type {
  FailureCode,
  PaymentExecutor,
  PaymentRequest,
  PaymentResult,
} from "./executor.js";
import { failure } from "./executor.js";

/**
 * Deterministic executor for tests and `pnpm dev`. Tracks allowances in memory
 * and can be told to fail the next N charges, which is how the retry and
 * dunning tests drive the scheduler without a network.
 */
export class MockExecutor implements PaymentExecutor {
  readonly charges: PaymentRequest[] = [];
  private readonly allowances = new Map<string, bigint>();
  private failuresRemaining = 0;
  private failureCode: FailureCode = "insufficient_balance";
  private counter = 0;

  approve(payer: string, tokenContractId: string, stroops: bigint): void {
    this.allowances.set(`${payer}:${tokenContractId}`, stroops);
  }

  failNext(times: number, code: FailureCode = "insufficient_balance"): void {
    this.failuresRemaining = times;
    this.failureCode = code;
  }

  async allowance(payer: string, tokenContractId: string): Promise<bigint> {
    return this.allowances.get(`${payer}:${tokenContractId}`) ?? 0n;
  }

  async execute(request: PaymentRequest): Promise<PaymentResult> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      return failure(this.failureCode, `mock failure for ${request.idempotencyKey}`);
    }

    const key = `${request.from}:${request.tokenContractId}`;
    const available = this.allowances.get(key) ?? 0n;
    if (available < request.amount.stroops) {
      return failure(
        "insufficient_allowance",
        `allowance ${available} < ${request.amount.stroops}`,
      );
    }
    this.allowances.set(key, available - request.amount.stroops);

    this.charges.push(request);
    this.counter += 1;
    return { ok: true, txHash: `mocktx${this.counter.toString().padStart(58, "0")}` };
  }
}
