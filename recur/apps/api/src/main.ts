import { createMemoryStores, systemClock } from "@recur/core";
import { Ledger } from "@recur/ledger";
import {
  MockExecutor,
  SorobanAllowanceExecutor,
  type PaymentExecutor,
} from "@recur/stellar";
import { runBillingCycle, deliver, subscribers } from "@recur/scheduler";
import { buildServer } from "./server.js";
import { loadConfig, usesLiveNetwork } from "./config.js";

/**
 * Development entrypoint: API plus, optionally, the billing loop in the same
 * process against in-memory stores. A deployment runs the two apps separately
 * against Postgres (see docs/adr/0002-storage.md).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const stores = createMemoryStores();
  const ledger = new Ledger();

  let executor: PaymentExecutor;
  if (usesLiveNetwork(config)) {
    executor = new SorobanAllowanceExecutor({
      rpcUrl: config.STELLAR_RPC_URL!,
      networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
      spenderSecret: config.STELLAR_SPENDER_SECRET!,
    });
  } else {
    executor = new MockExecutor();
    console.warn(
      "[recur] no Stellar credentials configured - charging against the mock executor",
    );
  }

  const app = buildServer({ stores, clock: systemClock, apiKeys: config.apiKeys });

  if (config.RECUR_EMBEDDED_SCHEDULER) {
    const timer = setInterval(() => {
      void runBillingCycle({
        stores,
        executor,
        ledger,
        clock: systemClock,
        tokenContractFor: () => config.RECUR_TOKEN_CONTRACT_ID ?? "mock-token",
        onEvent: async (event) => {
          const endpoints = subscribers(await stores.webhooks.active(), event);
          await Promise.all(endpoints.map((endpoint) => deliver(endpoint, event)));
        },
      }).catch((error: unknown) => {
        console.error("[recur] billing cycle failed", error);
      });
    }, config.RECUR_TICK_INTERVAL_MS);
    timer.unref();
  }

  await app.listen({ port: config.PORT, host: config.HOST });
  console.log(`[recur] api listening on ${config.HOST}:${config.PORT}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
