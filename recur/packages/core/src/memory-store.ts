import type {
  EventStore,
  InvoiceStore,
  PlanStore,
  Stores,
  SubscriptionStore,
  WebhookStore,
} from "./ports.js";
import type {
  Event,
  Invoice,
  Plan,
  Subscription,
  WebhookEndpoint,
} from "./types.js";

/**
 * In-memory adapters. Used by the test suite and by `pnpm dev` so a contributor
 * can run the whole engine without Postgres or a Stellar account. Not durable —
 * never point a deployment at these.
 */

class MemoryPlanStore implements PlanStore {
  private readonly rows = new Map<string, Plan>();

  async create(plan: Plan): Promise<Plan> {
    this.rows.set(plan.id, plan);
    return plan;
  }

  async get(id: string): Promise<Plan | null> {
    return this.rows.get(id) ?? null;
  }

  async list(merchantId: string): Promise<Plan[]> {
    return [...this.rows.values()].filter((p) => p.merchantId === merchantId);
  }
}

class MemorySubscriptionStore implements SubscriptionStore {
  private readonly rows = new Map<string, Subscription>();

  async create(subscription: Subscription): Promise<Subscription> {
    this.rows.set(subscription.id, subscription);
    return subscription;
  }

  async get(id: string): Promise<Subscription | null> {
    return this.rows.get(id) ?? null;
  }

  async update(
    id: string,
    patch: Partial<Omit<Subscription, "id">>,
  ): Promise<Subscription> {
    const current = this.rows.get(id);
    if (!current) throw new Error(`subscription not found: ${id}`);
    const next = { ...current, ...patch };
    this.rows.set(id, next);
    return next;
  }

  async due(at: Date): Promise<Subscription[]> {
    return [...this.rows.values()]
      .filter(
        (s) =>
          (s.status === "active" || s.status === "trialing" || s.status === "past_due") &&
          s.currentPeriodEnd.getTime() <= at.getTime() &&
          (s.nextAttemptAt === undefined || s.nextAttemptAt.getTime() <= at.getTime()),
      )
      .sort((a, b) => a.currentPeriodEnd.getTime() - b.currentPeriodEnd.getTime());
  }

  async listByPlan(planId: string): Promise<Subscription[]> {
    return [...this.rows.values()].filter((s) => s.planId === planId);
  }
}

class MemoryInvoiceStore implements InvoiceStore {
  private readonly rows = new Map<string, Invoice>();

  async create(invoice: Invoice): Promise<Invoice> {
    this.rows.set(invoice.id, invoice);
    return invoice;
  }

  async get(id: string): Promise<Invoice | null> {
    return this.rows.get(id) ?? null;
  }

  async update(
    id: string,
    patch: Partial<Omit<Invoice, "id">>,
  ): Promise<Invoice> {
    const current = this.rows.get(id);
    if (!current) throw new Error(`invoice not found: ${id}`);
    const next = { ...current, ...patch };
    this.rows.set(id, next);
    return next;
  }

  async listBySubscription(subscriptionId: string): Promise<Invoice[]> {
    return [...this.rows.values()]
      .filter((i) => i.subscriptionId === subscriptionId)
      .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());
  }

  async findByPeriod(
    subscriptionId: string,
    periodStart: Date,
  ): Promise<Invoice | null> {
    return (
      [...this.rows.values()].find(
        (i) =>
          i.subscriptionId === subscriptionId &&
          i.periodStart.getTime() === periodStart.getTime(),
      ) ?? null
    );
  }
}

class MemoryEventStore implements EventStore {
  private readonly rows: Event[] = [];

  async append(event: Event): Promise<Event> {
    this.rows.push(event);
    return event;
  }

  async list(limit: number): Promise<Event[]> {
    return this.rows.slice(-limit).reverse();
  }
}

class MemoryWebhookStore implements WebhookStore {
  private readonly rows = new Map<string, WebhookEndpoint>();

  async create(endpoint: WebhookEndpoint): Promise<WebhookEndpoint> {
    this.rows.set(endpoint.id, endpoint);
    return endpoint;
  }

  async listByMerchant(merchantId: string): Promise<WebhookEndpoint[]> {
    return [...this.rows.values()].filter((w) => w.merchantId === merchantId);
  }

  async active(): Promise<WebhookEndpoint[]> {
    return [...this.rows.values()].filter((w) => w.active);
  }
}

export function createMemoryStores(): Stores {
  return {
    plans: new MemoryPlanStore(),
    subscriptions: new MemorySubscriptionStore(),
    invoices: new MemoryInvoiceStore(),
    events: new MemoryEventStore(),
    webhooks: new MemoryWebhookStore(),
  };
}
