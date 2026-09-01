import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import {
  advance,
  createPlanSchema,
  createSubscriptionSchema,
  createWebhookSchema,
  firstPeriod,
  formatAmount,
  newId,
  parseAmount,
  systemClock,
  type Clock,
  type Invoice,
  type Plan,
  type Stores,
  type Subscription,
} from "@recur/core";

export interface ApiDeps {
  readonly stores: Stores;
  readonly clock?: Clock;
  /** Maps an API key to the merchant it authenticates. */
  readonly apiKeys: ReadonlyMap<string, string>;
}

declare module "fastify" {
  interface FastifyRequest {
    merchantId: string;
  }
}

export function buildServer(deps: ApiDeps): FastifyInstance {
  const clock = deps.clock ?? systemClock;
  const app = Fastify({ logger: false });

  app.decorateRequest("merchantId", "");

  app.get("/health", async () => ({ status: "ok", time: clock.now().toISOString() }));

  app.addHook("onRequest", async (request: FastifyRequest, reply) => {
    if (request.url === "/health") return;
    const key = request.headers["x-api-key"];
    const merchantId = typeof key === "string" ? deps.apiKeys.get(key) : undefined;
    if (!merchantId) {
      return reply.code(401).send({ error: "unauthorized", message: "missing or unknown API key" });
    }
    request.merchantId = merchantId;
  });

  app.post("/v1/plans", async (request, reply) => {
    const parsed = createPlanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: "invalid_request", issues: parsed.error.issues });
    }
    const input = parsed.data;
    const plan: Plan = {
      id: newId("plan"),
      merchantId: request.merchantId,
      name: input.name,
      amount: parseAmount(input.asset, input.amount),
      cycle: input.cycle,
      trialDays: input.trialDays,
      active: true,
      createdAt: clock.now(),
    };
    await deps.stores.plans.create(plan);
    return reply.code(201).send(serializePlan(plan));
  });

  app.get("/v1/plans", async (request) => {
    const plans = await deps.stores.plans.list(request.merchantId);
    return { data: plans.map(serializePlan) };
  });

  app.get<{ Params: { id: string } }>("/v1/plans/:id", async (request, reply) => {
    const plan = await deps.stores.plans.get(request.params.id);
    if (!plan || plan.merchantId !== request.merchantId) {
      return reply.code(404).send({ error: "not_found" });
    }
    return serializePlan(plan);
  });

  app.post("/v1/subscriptions", async (request, reply) => {
    const parsed = createSubscriptionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: "invalid_request", issues: parsed.error.issues });
    }
    const input = parsed.data;
    const plan = await deps.stores.plans.get(input.planId);
    if (!plan || plan.merchantId !== request.merchantId) {
      return reply.code(404).send({ error: "not_found", message: "unknown plan" });
    }
    if (!plan.active) {
      return reply.code(409).send({ error: "plan_archived" });
    }

    const startedAt = input.startAt ? new Date(input.startAt) : clock.now();
    const period = firstPeriod(startedAt, plan.cycle, plan.trialDays);
    const subscription: Subscription = {
      id: newId("sub"),
      planId: plan.id,
      payerAccount: input.payerAccount,
      payeeAccount: input.payeeAccount,
      status: plan.trialDays > 0 ? "trialing" : "active",
      startedAt,
      currentPeriodEnd: period.start,
      failureCount: 0,
    };
    await deps.stores.subscriptions.create(subscription);
    await deps.stores.events.append({
      id: newId("evt"),
      type: "subscription.created",
      createdAt: clock.now(),
      data: { subscription: subscription.id, plan: plan.id },
    });
    return reply.code(201).send(serializeSubscription(subscription, plan));
  });

  app.get<{ Params: { id: string } }>("/v1/subscriptions/:id", async (request, reply) => {
    const found = await loadSubscription(deps, request.params.id, request.merchantId);
    if (!found) return reply.code(404).send({ error: "not_found" });
    return serializeSubscription(found.subscription, found.plan);
  });

  app.post<{ Params: { id: string } }>(
    "/v1/subscriptions/:id/cancel",
    async (request, reply) => {
      const found = await loadSubscription(deps, request.params.id, request.merchantId);
      if (!found) return reply.code(404).send({ error: "not_found" });
      if (found.subscription.status === "canceled") {
        return reply.code(409).send({ error: "already_canceled" });
      }
      const updated = await deps.stores.subscriptions.update(found.subscription.id, {
        status: "canceled",
        canceledAt: clock.now(),
      });
      await deps.stores.events.append({
        id: newId("evt"),
        type: "subscription.canceled",
        createdAt: clock.now(),
        data: { subscription: updated.id },
      });
      return serializeSubscription(updated, found.plan);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/subscriptions/:id/invoices",
    async (request, reply) => {
      const found = await loadSubscription(deps, request.params.id, request.merchantId);
      if (!found) return reply.code(404).send({ error: "not_found" });
      const invoices = await deps.stores.invoices.listBySubscription(found.subscription.id);
      return { data: invoices.map(serializeInvoice) };
    },
  );

  app.post("/v1/webhooks", async (request, reply) => {
    const parsed = createWebhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: "invalid_request", issues: parsed.error.issues });
    }
    const secret = `whsec_${randomBytes(24).toString("hex")}`;
    const endpoint = await deps.stores.webhooks.create({
      id: newId("whk"),
      merchantId: request.merchantId,
      url: parsed.data.url,
      secret,
      types: parsed.data.types,
      active: true,
    });
    // The secret is returned once, at creation, and never read back.
    return reply.code(201).send({
      id: endpoint.id,
      url: endpoint.url,
      types: endpoint.types,
      secret,
    });
  });

  app.get("/v1/events", async () => {
    const events = await deps.stores.events.list(50);
    return {
      data: events.map((e) => ({
        id: e.id,
        type: e.type,
        created: e.createdAt.toISOString(),
        data: e.data,
      })),
    };
  });

  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({ error: "not_found" }),
  );

  return app;
}

async function loadSubscription(
  deps: ApiDeps,
  id: string,
  merchantId: string,
): Promise<{ subscription: Subscription; plan: Plan } | null> {
  const subscription = await deps.stores.subscriptions.get(id);
  if (!subscription) return null;
  const plan = await deps.stores.plans.get(subscription.planId);
  if (!plan || plan.merchantId !== merchantId) return null;
  return { subscription, plan };
}

function serializePlan(plan: Plan) {
  return {
    id: plan.id,
    name: plan.name,
    amount: formatAmount(plan.amount),
    asset: plan.amount.asset,
    cycle: plan.cycle,
    trialDays: plan.trialDays,
    active: plan.active,
    created: plan.createdAt.toISOString(),
  };
}

function serializeSubscription(subscription: Subscription, plan: Plan) {
  return {
    id: subscription.id,
    plan: plan.id,
    status: subscription.status,
    payer: subscription.payerAccount,
    payee: subscription.payeeAccount,
    amount: formatAmount(plan.amount),
    started: subscription.startedAt.toISOString(),
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    nextPeriodEnd: advance(subscription.currentPeriodEnd, plan.cycle).toISOString(),
    canceled: subscription.canceledAt?.toISOString() ?? null,
  };
}

function serializeInvoice(invoice: Invoice) {
  return {
    id: invoice.id,
    subscription: invoice.subscriptionId,
    amount: formatAmount(invoice.amount),
    status: invoice.status,
    periodStart: invoice.periodStart.toISOString(),
    periodEnd: invoice.periodEnd.toISOString(),
    attempts: invoice.attempts,
    txHash: invoice.txHash ?? null,
    failureReason: invoice.failureReason ?? null,
  };
}
