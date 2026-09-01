import {
  advance,
  assetId,
  newId,
  nextRetryAt,
  type Clock,
  type Event,
  type EventType,
  type Invoice,
  type Plan,
  type Stores,
  type Subscription,
} from "@recur/core";
import { Ledger, invoiceRaised, invoiceSettled } from "@recur/ledger";
import type { PaymentExecutor } from "@recur/stellar";

/**
 * The billing cycle.
 *
 * `runBillingCycle` is a pure-ish function of (stores, clock): it can be called
 * every minute by a cron loop, or once by a test with a fixed clock, and it is
 * safe to call twice for the same period — an invoice already recorded for a
 * period is never raised or charged a second time.
 */

export const MAX_ATTEMPTS = 4;

export interface EngineDeps {
  readonly stores: Stores;
  readonly executor: PaymentExecutor;
  readonly ledger: Ledger;
  readonly clock: Clock;
  /** Resolves the SEP-41 token contract that settles a given asset. */
  readonly tokenContractFor: (asset: string) => string;
  readonly onEvent?: (event: Event) => Promise<void> | void;
}

export interface CycleReport {
  readonly examined: number;
  readonly charged: number;
  readonly failed: number;
  readonly skipped: number;
}

export async function runBillingCycle(deps: EngineDeps): Promise<CycleReport> {
  const now = deps.clock.now();
  const due = await deps.stores.subscriptions.due(now);

  let charged = 0;
  let failed = 0;
  let skipped = 0;

  for (const subscription of due) {
    const plan = await deps.stores.plans.get(subscription.planId);
    if (!plan || !plan.active) {
      skipped += 1;
      continue;
    }
    const outcome = await chargeSubscription(deps, subscription, plan, now);
    if (outcome === "charged") charged += 1;
    else if (outcome === "failed") failed += 1;
    else skipped += 1;
  }

  return { examined: due.length, charged, failed, skipped };
}

type Outcome = "charged" | "failed" | "skipped";

async function chargeSubscription(
  deps: EngineDeps,
  subscription: Subscription,
  plan: Plan,
  now: Date,
): Promise<Outcome> {
  const periodStart = subscription.currentPeriodEnd;
  const periodEnd = advance(periodStart, plan.cycle);

  const existing = await deps.stores.invoices.findByPeriod(subscription.id, periodStart);
  if (existing?.status === "paid") {
    // A previous run already settled this period; just move the clock forward.
    await deps.stores.subscriptions.update(subscription.id, {
      currentPeriodEnd: periodEnd,
      status: "active",
      failureCount: 0,
    });
    return "skipped";
  }

  const invoice: Invoice =
    existing ??
    (await deps.stores.invoices.create({
      id: newId("in"),
      subscriptionId: subscription.id,
      amount: plan.amount,
      status: "open",
      periodStart,
      periodEnd,
      attempts: 0,
      createdAt: now,
    }));

  if (!existing) {
    deps.ledger.post(
      invoiceRaised(
        now,
        invoice.id,
        subscription.payeeAccount,
        subscription.payerAccount,
        plan.amount,
      ),
    );
    await emit(deps, "invoice.created", { invoiceId: invoice.id, subscription: subscription.id });
  }

  const result = await deps.executor.execute({
    from: subscription.payerAccount,
    to: subscription.payeeAccount,
    amount: plan.amount,
    tokenContractId: deps.tokenContractFor(assetId(plan.amount.asset)),
    idempotencyKey: invoice.id,
  });

  const attempts = invoice.attempts + 1;

  if (result.ok) {
    await deps.stores.invoices.update(invoice.id, {
      status: "paid",
      attempts,
      txHash: result.txHash,
    });
    deps.ledger.post(
      invoiceSettled(
        now,
        invoice.id,
        subscription.payeeAccount,
        plan.amount,
        result.txHash,
      ),
    );
    await deps.stores.subscriptions.update(subscription.id, {
      status: "active",
      currentPeriodEnd: periodEnd,
      nextAttemptAt: undefined,
      failureCount: 0,
    });
    await emit(deps, "invoice.paid", {
      invoiceId: invoice.id,
      subscription: subscription.id,
      txHash: result.txHash,
    });
    return "charged";
  }

  await deps.stores.invoices.update(invoice.id, {
    attempts,
    failureReason: `${result.code}: ${result.message}`,
    status: attempts >= MAX_ATTEMPTS || !result.retryable ? "failed" : "open",
  });

  const retryAt = result.retryable ? nextRetryAt(now, attempts) : null;

  if (retryAt) {
    await deps.stores.subscriptions.update(subscription.id, {
      status: "past_due",
      // The period stays open so the same invoice is reused; only the next
      // attempt moves, following the backoff schedule in @recur/core.
      nextAttemptAt: retryAt,
      failureCount: attempts,
    });
    await emit(deps, "subscription.past_due", {
      subscription: subscription.id,
      invoiceId: invoice.id,
      retryAt: retryAt.toISOString(),
      reason: result.code,
    });
  } else {
    await deps.stores.subscriptions.update(subscription.id, {
      status: "canceled",
      canceledAt: now,
      failureCount: attempts,
    });
    await emit(deps, "invoice.failed", {
      invoiceId: invoice.id,
      subscription: subscription.id,
      reason: result.code,
    });
  }

  return "failed";
}

async function emit(deps: EngineDeps, type: EventType, data: unknown): Promise<void> {
  const event: Event = {
    id: newId("evt"),
    type,
    createdAt: deps.clock.now(),
    data,
  };
  await deps.stores.events.append(event);
  await deps.onEvent?.(event);
}
