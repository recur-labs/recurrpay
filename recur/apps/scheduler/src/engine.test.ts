import { beforeEach, describe, expect, it } from "vitest";
import {
  NATIVE,
  assetId,
  createMemoryStores,
  newId,
  parseAmount,
  type Clock,
  type Plan,
  type Stores,
  type Subscription,
} from "@recur/core";
import { Ledger } from "@recur/ledger";
import { MockExecutor } from "@recur/stellar";
import { runBillingCycle, type EngineDeps } from "./engine.js";

const TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const PAYER = "GPAYER";
const PAYEE = "GPAYEE";

class TestClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 86_400_000);
  }
  set(date: Date): void {
    this.current = date;
  }
}

let stores: Stores;
let executor: MockExecutor;
let ledger: Ledger;
let clock: TestClock;
let deps: EngineDeps;
let plan: Plan;
let subscription: Subscription;

const start = new Date("2026-01-01T00:00:00.000Z");

beforeEach(async () => {
  stores = createMemoryStores();
  executor = new MockExecutor();
  ledger = new Ledger();
  clock = new TestClock(start);

  deps = {
    stores,
    executor,
    ledger,
    clock,
    tokenContractFor: () => TOKEN,
  };

  plan = await stores.plans.create({
    id: newId("plan"),
    merchantId: "mrc_1",
    name: "Pro monthly",
    amount: parseAmount(NATIVE, "10"),
    cycle: { interval: "month", intervalCount: 1 },
    trialDays: 0,
    active: true,
    createdAt: start,
  });

  subscription = await stores.subscriptions.create({
    id: newId("sub"),
    planId: plan.id,
    payerAccount: PAYER,
    payeeAccount: PAYEE,
    status: "active",
    startedAt: start,
    currentPeriodEnd: start,
    failureCount: 0,
  });

  executor.approve(PAYER, TOKEN, parseAmount(NATIVE, "1000").stroops);
});

describe("runBillingCycle", () => {
  it("charges a due subscription and rolls the period forward", async () => {
    const report = await runBillingCycle(deps);
    expect(report).toMatchObject({ examined: 1, charged: 1, failed: 0 });

    const updated = await stores.subscriptions.get(subscription.id);
    expect(updated?.status).toBe("active");
    expect(updated?.currentPeriodEnd.toISOString()).toBe("2026-02-01T00:00:00.000Z");

    const invoices = await stores.invoices.listBySubscription(subscription.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.status).toBe("paid");
    expect(invoices[0]?.txHash).toMatch(/^mocktx/);
  });

  it("leaves nothing due until the next period arrives", async () => {
    await runBillingCycle(deps);
    const second = await runBillingCycle(deps);
    expect(second.examined).toBe(0);
    expect(executor.charges).toHaveLength(1);
  });

  it("charges exactly once per period across many ticks", async () => {
    for (let day = 0; day < 70; day += 1) {
      await runBillingCycle(deps);
      clock.advanceDays(1);
    }
    const invoices = await stores.invoices.listBySubscription(subscription.id);
    expect(invoices).toHaveLength(3); // Jan, Feb, Mar
    expect(invoices.every((i) => i.status === "paid")).toBe(true);
    expect(executor.charges).toHaveLength(3);
  });

  it("keeps the double-entry ledger balanced against settled invoices", async () => {
    await runBillingCycle(deps);
    const receivable = { kind: "merchant_receivable", ref: PAYEE } as const;
    expect(ledger.balance(receivable, assetId(NATIVE))).toBe(0n);
    expect(ledger.balance({ kind: "settled", ref: PAYEE }, assetId(NATIVE))).toBe(
      parseAmount(NATIVE, "10").stroops,
    );
  });

  it("backs off on a retryable failure instead of hammering the network", async () => {
    executor.failNext(1, "insufficient_balance");
    const first = await runBillingCycle(deps);
    expect(first.failed).toBe(1);

    const pastDue = await stores.subscriptions.get(subscription.id);
    expect(pastDue?.status).toBe("past_due");
    expect(pastDue?.failureCount).toBe(1);

    // Same day: the retry is not yet due.
    expect((await runBillingCycle(deps)).examined).toBe(0);

    clock.advanceDays(1);
    const retry = await runBillingCycle(deps);
    expect(retry.charged).toBe(1);

    const invoices = await stores.invoices.listBySubscription(subscription.id);
    expect(invoices).toHaveLength(1); // the same invoice, retried
    expect(invoices[0]?.attempts).toBe(2);
    expect(invoices[0]?.status).toBe("paid");
  });

  it("cancels the subscription after the retry schedule is exhausted", async () => {
    executor.failNext(99, "insufficient_balance");
    await runBillingCycle(deps);
    for (const days of [1, 3, 5]) {
      clock.advanceDays(days);
      await runBillingCycle(deps);
    }

    const dead = await stores.subscriptions.get(subscription.id);
    expect(dead?.status).toBe("canceled");
    expect(dead?.failureCount).toBe(4);

    const invoices = await stores.invoices.listBySubscription(subscription.id);
    expect(invoices[0]?.status).toBe("failed");
  });

  it("gives up immediately when the failure cannot be retried", async () => {
    executor.failNext(1, "allowance_expired");
    await runBillingCycle(deps);
    const dead = await stores.subscriptions.get(subscription.id);
    expect(dead?.status).toBe("canceled");
  });

  it("emits the events a merchant integration needs", async () => {
    await runBillingCycle(deps);
    const events = await stores.events.list(10);
    expect(events.map((e) => e.type)).toEqual(["invoice.paid", "invoice.created"]);
  });

  it("skips subscriptions whose plan has been archived", async () => {
    const archived = createMemoryStores();
    const inactivePlan = await archived.plans.create({ ...plan, active: false });
    await archived.subscriptions.create(subscription);
    const report = await runBillingCycle({
      ...deps,
      stores: archived,
    });
    expect(report).toMatchObject({ examined: 1, skipped: 1, charged: 0 });
    expect(inactivePlan.active).toBe(false);
  });
});
