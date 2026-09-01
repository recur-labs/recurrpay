import { createMemoryStores, systemClock } from "@recur/core";
import { Ledger } from "@recur/ledger";
import { MockExecutor } from "@recur/stellar";
import pino from "pino";
import { runBillingCycle } from "./engine.js";
import { deliver, subscribers } from "./webhooks.js";

/**
 * Standalone worker. It currently boots against in-memory stores, which means
 * it is only useful next to the API's embedded scheduler for local experiments;
 * pointing it at Postgres is what turns it into a deployable worker.
 */
const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
const TICK_MS = Number(process.env.RECUR_TICK_INTERVAL_MS ?? 60_000);

async function main(): Promise<void> {
  const stores = createMemoryStores();
  const ledger = new Ledger();
  const executor = new MockExecutor();

  log.info({ tickMs: TICK_MS }, "scheduler started");

  let stopping = false;
  const shutdown = () => {
    stopping = true;
    log.info("scheduler stopping");
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (!stopping) {
    const report = await runBillingCycle({
      stores,
      executor,
      ledger,
      clock: systemClock,
      tokenContractFor: () => process.env.RECUR_TOKEN_CONTRACT_ID ?? "mock-token",
      onEvent: async (event) => {
        const endpoints = subscribers(await stores.webhooks.active(), event);
        for (const endpoint of endpoints) {
          const attempt = await deliver(endpoint, event);
          log.info({ attempt }, "webhook delivered");
        }
      },
    });
    if (report.examined > 0) log.info({ report }, "billing cycle complete");
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
}

main().catch((error: unknown) => {
  log.error({ error }, "scheduler crashed");
  process.exit(1);
});
