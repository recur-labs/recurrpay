import type { Money } from "@recur/core";

/**
 * The engine never signs on behalf of a payer with an account signer. Pulling
 * funds is done through the SEP-41 token interface: the payer calls `approve`
 * once, granting the engine's spender account an allowance with an expiry, and
 * each charge is a `transfer_from` inside that allowance. A payer can revoke by
 * setting the allowance to zero, and the engine can never move more than the
 * approved amount. See docs/adr/0001-pull-payments.md.
 */

export interface PaymentRequest {
  /** Payer's Stellar account (the `from` of `transfer_from`). */
  readonly from: string;
  /** Merchant's Stellar account (the `to`). */
  readonly to: string;
  readonly amount: Money;
  /** SEP-41 token contract for the asset being charged. */
  readonly tokenContractId: string;
  /**
   * Stable key for this charge (the invoice id). Used to detect a charge that
   * was already submitted before a crash, so a retry cannot double-bill.
   */
  readonly idempotencyKey: string;
}

export type FailureCode =
  | "insufficient_allowance"
  | "insufficient_balance"
  | "allowance_expired"
  | "account_missing"
  | "network_error"
  | "simulation_failed"
  | "timeout"
  | "unknown";

export type PaymentResult =
  | { readonly ok: true; readonly txHash: string; readonly ledger?: number }
  | {
      readonly ok: false;
      readonly code: FailureCode;
      readonly message: string;
      /** True when charging again later could plausibly succeed. */
      readonly retryable: boolean;
    };

export interface PaymentExecutor {
  execute(request: PaymentRequest): Promise<PaymentResult>;
  /** Remaining allowance the engine may still pull, in stroops. */
  allowance(payer: string, tokenContractId: string): Promise<bigint>;
}

export function isRetryable(result: PaymentResult): boolean {
  return result.ok ? false : result.retryable;
}

const RETRYABLE: ReadonlySet<FailureCode> = new Set<FailureCode>([
  "insufficient_balance",
  "network_error",
  "timeout",
]);

export function failure(code: FailureCode, message: string): PaymentResult {
  return { ok: false, code, message, retryable: RETRYABLE.has(code) };
}
