import type {
  Event,
  Invoice,
  Plan,
  Subscription,
  WebhookEndpoint,
} from "./types.js";

/**
 * Storage ports. The engine depends only on these interfaces; an in-memory
 * adapter ships in `@recur/core` for tests and local development, and a
 * Postgres adapter lives behind the same contract (see docs/adr/0002).
 */

export interface PlanStore {
  create(plan: Plan): Promise<Plan>;
  get(id: string): Promise<Plan | null>;
  list(merchantId: string): Promise<Plan[]>;
}

export interface SubscriptionStore {
  create(subscription: Subscription): Promise<Subscription>;
  get(id: string): Promise<Subscription | null>;
  update(
    id: string,
    patch: Partial<Omit<Subscription, "id">>,
  ): Promise<Subscription>;
  /** Subscriptions whose current period ends at or before `at`. */
  due(at: Date): Promise<Subscription[]>;
  listByPlan(planId: string): Promise<Subscription[]>;
}

export interface InvoiceStore {
  create(invoice: Invoice): Promise<Invoice>;
  get(id: string): Promise<Invoice | null>;
  update(id: string, patch: Partial<Omit<Invoice, "id">>): Promise<Invoice>;
  listBySubscription(subscriptionId: string): Promise<Invoice[]>;
  /**
   * Returns the open invoice for a subscription period if one already exists.
   * The scheduler uses this to stay idempotent when a tick is retried.
   */
  findByPeriod(subscriptionId: string, periodStart: Date): Promise<Invoice | null>;
}

export interface EventStore {
  append(event: Event): Promise<Event>;
  list(limit: number): Promise<Event[]>;
}

export interface WebhookStore {
  create(endpoint: WebhookEndpoint): Promise<WebhookEndpoint>;
  listByMerchant(merchantId: string): Promise<WebhookEndpoint[]>;
  active(): Promise<WebhookEndpoint[]>;
}

export interface Stores {
  plans: PlanStore;
  subscriptions: SubscriptionStore;
  invoices: InvoiceStore;
  events: EventStore;
  webhooks: WebhookStore;
}

/** Injectable clock so scheduler behaviour is testable without waiting. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
