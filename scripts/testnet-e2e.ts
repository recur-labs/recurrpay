/**
 * scripts/testnet-e2e.ts
 *
 * Exercises the SEP-41 executor against Stellar testnet, for real:
 *
 *   1. Generates a payer and a spender (the engine's operating account) and
 *      funds both through friendbot.
 *   2. Points at the native-XLM Stellar Asset Contract, which is a SEP-41
 *      token and is already deployed on testnet, so there is no contract to
 *      write or deploy for this smoke test.
 *   3. The payer calls `approve(spender = engine, amount, expiration_ledger)`
 *      once, signed with the payer's own key — the engine never holds it.
 *   4. The scheduler's real `SorobanAllowanceExecutor` (not `MockExecutor`)
 *      then runs three successive `transfer_from` charges against that one
 *      allowance, exactly as `runBillingCycle` would call it once a period.
 *
 * The payee for this smoke test is the spender account itself: a merchant
 * payout account is just configuration (`subscription.payeeAccount`) that
 * the executor never signs for, so reusing the spender keeps the run down to
 * the two funded accounts the flow actually needs. Point RECUR_E2E_TO at a
 * third funded account to charge someone else instead.
 *
 * Usage:
 *   pnpm testnet:e2e
 *
 * Every run generates fresh keys, so it is safe to run repeatedly; nothing
 * needs to be reset between runs. Set RECUR_E2E_PAYER_SECRET /
 * RECUR_E2E_SPENDER_SECRET to reuse specific already-funded testnet accounts
 * instead (friendbot funding is skipped for a supplied key).
 */

import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import { NATIVE, formatAmount, parseAmount } from "@recur/core";
import { SorobanAllowanceExecutor } from "@recur/stellar";

const RPC_URL = process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const FRIENDBOT_URL = process.env.STELLAR_FRIENDBOT_URL ?? "https://friendbot.stellar.org";

const CHARGE_AMOUNT = parseAmount(NATIVE, process.env.RECUR_E2E_CHARGE_AMOUNT ?? "1");
const CHARGE_COUNT = 3;
// Headroom above the three charges so the last one isn't a knife-edge on fees
// paid out of the same balance.
const APPROVE_AMOUNT = CHARGE_AMOUNT.stroops * BigInt(CHARGE_COUNT) + parseAmount(NATIVE, "2").stroops;
// ~100k ledgers is on the order of a week on testnet's ~5s close time — far
// more than this script needs, but expiry math belongs to the payer, not us.
const EXPIRATION_LEDGER_WINDOW = 100_000;

const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });

interface StepResult {
  readonly label: string;
  readonly hash: string;
}

async function main(): Promise<void> {
  const results: StepResult[] = [];

  const payer = await account("RECUR_E2E_PAYER_SECRET");
  const spender = await account("RECUR_E2E_SPENDER_SECRET");
  const payee = process.env.RECUR_E2E_TO ?? spender.publicKey();

  console.log(`payer:   ${payer.publicKey()}`);
  console.log(`spender: ${spender.publicKey()}`);
  console.log(`payee:   ${payee}`);

  const tokenContractId = Asset.native().contractId(NETWORK_PASSPHRASE);
  console.log(`token:   ${tokenContractId} (native XLM SAC)`);

  const approveHash = await approve(payer, spender.publicKey(), tokenContractId);
  results.push({ label: "approve", hash: approveHash });
  console.log(`approve confirmed: ${approveHash}`);

  const executor = new SorobanAllowanceExecutor({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    spenderSecret: spender.secret(),
  });

  const allowanceBefore = await executor.allowance(payer.publicKey(), tokenContractId);
  console.log(`allowance after approve: ${formatAmount({ asset: NATIVE, stroops: allowanceBefore })} XLM`);

  for (let i = 1; i <= CHARGE_COUNT; i++) {
    const result = await executor.execute({
      from: payer.publicKey(),
      to: payee,
      amount: CHARGE_AMOUNT,
      tokenContractId,
      idempotencyKey: `testnet-e2e-${Date.now()}-${i}`,
    });

    if (!result.ok) {
      throw new Error(`charge ${i} failed: ${result.code}: ${result.message}`);
    }
    results.push({ label: `charge ${i}`, hash: result.txHash });
    console.log(`charge ${i}/${CHARGE_COUNT} confirmed: ${result.txHash}`);
  }

  const allowanceAfter = await executor.allowance(payer.publicKey(), tokenContractId);
  console.log(`allowance remaining: ${formatAmount({ asset: NATIVE, stroops: allowanceAfter })} XLM`);

  console.log("\n## Testnet run — tx hashes\n");
  for (const r of results) {
    console.log(`- ${r.label}: \`${r.hash}\``);
  }
}

/** Loads an account from a secret in `envVar`, or generates and funds a fresh one. */
async function account(envVar: string): Promise<Keypair> {
  const secret = process.env[envVar];
  if (secret) {
    return Keypair.fromSecret(secret);
  }
  const keypair = Keypair.random();
  await fund(keypair.publicKey());
  await waitForAccount(keypair.publicKey());
  return keypair;
}

async function fund(publicKey: string): Promise<void> {
  const response = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(publicKey)}`);
  // Friendbot answers 400 "account already funded to starting balance" for an
  // address it has already funded in this test cycle — harmless, not a bug.
  if (!response.ok && response.status !== 400) {
    throw new Error(`friendbot funding failed (${response.status}): ${await response.text()}`);
  }
}

async function waitForAccount(publicKey: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await server.getAccount(publicKey);
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(`account ${publicKey} never appeared on the network: ${String(error)}`);
      }
      await sleep(2000);
    }
  }
}

/**
 * Payer-signed `approve(spender, amount, expiration_ledger)`. This is the one
 * step the executor deliberately cannot do on the payer's behalf — see
 * docs/adr/0001-pull-payments.md.
 */
async function approve(payer: Keypair, spender: string, tokenContractId: string): Promise<string> {
  const contract = new Contract(tokenContractId);
  const latestLedger = await server.getLatestLedger();
  const source = await server.getAccount(payer.publicKey());

  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "approve",
        new Address(payer.publicKey()).toScVal(),
        new Address(spender).toScVal(),
        nativeToScVal(APPROVE_AMOUNT, { type: "i128" }),
        nativeToScVal(latestLedger.sequence + EXPIRATION_LEDGER_WINDOW, { type: "u32" }),
      ),
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(payer);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`approve submission rejected: ${JSON.stringify(sent.errorResult)}`);
  }
  return confirm(sent.hash);
}

async function confirm(hash: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await server.getTransaction(hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`transaction ${hash} failed on-chain`);
    }
    await sleep(1000);
  }
  throw new Error(`transaction ${hash} did not confirm within ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  console.error("testnet e2e run failed:", error);
  process.exitCode = 1;
});
