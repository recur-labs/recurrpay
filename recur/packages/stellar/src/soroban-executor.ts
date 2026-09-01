import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import type { PaymentExecutor, PaymentRequest, PaymentResult } from "./executor.js";
import { failure } from "./executor.js";

export interface SorobanExecutorConfig {
  /** Soroban RPC endpoint, e.g. https://soroban-testnet.stellar.org */
  readonly rpcUrl: string;
  readonly networkPassphrase: string;
  /** Secret key of the spender account the payer has approved. */
  readonly spenderSecret: string;
  /** Seconds to wait for a submitted transaction to reach a final status. */
  readonly confirmTimeoutSeconds?: number;
}

const DEFAULT_CONFIRM_TIMEOUT = 30;

/**
 * Charges a subscription by invoking `transfer_from` on a SEP-41 token
 * contract. Every call is simulated first, so a missing allowance or an
 * insufficient balance is classified before anything is submitted and the
 * merchant is not charged a network fee for a charge that cannot succeed.
 */
export class SorobanAllowanceExecutor implements PaymentExecutor {
  private readonly server: rpc.Server;
  private readonly spender: Keypair;

  constructor(private readonly config: SorobanExecutorConfig) {
    this.server = new rpc.Server(config.rpcUrl, {
      allowHttp: config.rpcUrl.startsWith("http://"),
    });
    this.spender = Keypair.fromSecret(config.spenderSecret);
  }

  get spenderAccount(): string {
    return this.spender.publicKey();
  }

  async allowance(payer: string, tokenContractId: string): Promise<bigint> {
    const contract = new Contract(tokenContractId);
    const source = await this.server.getAccount(this.spender.publicKey());
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "allowance",
          new Address(payer).toScVal(),
          new Address(this.spender.publicKey()).toScVal(),
        ),
      )
      .setTimeout(30)
      .build();

    const simulated = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulated)) {
      throw new Error(`allowance simulation failed: ${simulated.error}`);
    }
    const retval = simulated.result?.retval;
    if (!retval) return 0n;
    return BigInt(scValToNative(retval) as string | number | bigint);
  }

  async execute(request: PaymentRequest): Promise<PaymentResult> {
    let prepared;
    try {
      const contract = new Contract(request.tokenContractId);
      const source = await this.server.getAccount(this.spender.publicKey());
      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: this.config.networkPassphrase,
      })
        .addOperation(
          contract.call(
            "transfer_from",
            new Address(this.spender.publicKey()).toScVal(),
            new Address(request.from).toScVal(),
            new Address(request.to).toScVal(),
            nativeToScVal(request.amount.stroops, { type: "i128" }),
          ),
        )
        .setTimeout(this.config.confirmTimeoutSeconds ?? DEFAULT_CONFIRM_TIMEOUT)
        .build();

      prepared = await this.server.prepareTransaction(tx);
    } catch (error) {
      return classify(error);
    }

    prepared.sign(this.spender);

    try {
      const sent = await this.server.sendTransaction(prepared);
      if (sent.status === "ERROR") {
        return failure("network_error", `submission rejected: ${sent.hash}`);
      }
      return await this.confirm(sent.hash);
    } catch (error) {
      return classify(error);
    }
  }

  private async confirm(hash: string): Promise<PaymentResult> {
    const deadline =
      Date.now() + (this.config.confirmTimeoutSeconds ?? DEFAULT_CONFIRM_TIMEOUT) * 1000;

    while (Date.now() < deadline) {
      const result = await this.server.getTransaction(hash);
      if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return { ok: true, txHash: hash, ledger: result.ledger };
      }
      if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
        return failure("unknown", `transaction ${hash} failed on-chain`);
      }
      await sleep(1000);
    }
    return failure("timeout", `transaction ${hash} did not confirm in time`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Map an SDK/simulation error onto a failure code the scheduler can act on.
 * Contract errors surface as text, so this matches on the SEP-41 error names
 * rather than on error codes we do not get back structurally.
 */
export function classify(error: unknown): PaymentResult {
  const message = error instanceof Error ? error.message : String(error);
  const text = message.toLowerCase();

  if (text.includes("allowance") && text.includes("expire")) {
    return failure("allowance_expired", message);
  }
  if (text.includes("allowance")) {
    return failure("insufficient_allowance", message);
  }
  if (text.includes("balance")) {
    return failure("insufficient_balance", message);
  }
  if (text.includes("not found") || text.includes("missing")) {
    return failure("account_missing", message);
  }
  if (text.includes("simulation")) {
    return failure("simulation_failed", message);
  }
  if (
    text.includes("timeout") ||
    text.includes("econnrefused") ||
    text.includes("fetch") ||
    text.includes("network")
  ) {
    return failure("network_error", message);
  }
  return failure("unknown", message);
}
