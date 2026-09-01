import type { Money } from "./money.js";

export type Interval = "day" | "week" | "month" | "year";

export interface BillingCycle {
  readonly interval: Interval;
  /** Charge every `intervalCount` intervals. `month` + 3 = quarterly. */
  readonly intervalCount: number;
}

export interface Plan {
  readonly id: string;
  readonly merchantId: string;
  readonly name: string;
  readonly amount: Money;
  readonly cycle: BillingCycle;
  /** Days of free access before the first charge. */
  readonly trialDays: number;
  readonly active: boolean;
  readonly createdAt: Date;
}

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "ended";

export interface Subscription {
  readonly id: string;
  readonly planId: string;
  /** Stellar account the funds are pulled from. */
  readonly payerAccount: string;
  /** Stellar account the funds are delivered to. */
  readonly payeeAccount: string;
  readonly status: SubscriptionStatus;
  readonly startedAt: Date;
  /** Timestamp of the next charge attempt. */
  readonly currentPeriodEnd: Date;
  readonly canceledAt?: Date;
  /**
   * When a charge fails retryably the period is held open and the next attempt
   * is deferred to this time, so a failing subscription is not re-attempted on
   * every scheduler tick.
   */
  readonly nextAttemptAt?: Date;
  /** Consecutive failed charge attempts for the current period. */
  readonly failureCount: number;
}

export type InvoiceStatus = "open" | "paid" | "failed" | "voided";

export interface Invoice {
  readonly id: string;
  readonly subscriptionId: string;
  readonly amount: Money;
  readonly status: InvoiceStatus;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly attempts: number;
  /** Stellar transaction hash once settled. */
  readonly txHash?: string;
  readonly failureReason?: string;
  readonly createdAt: Date;
}

export type EventType =
  | "subscription.created"
  | "subscription.canceled"
  | "invoice.created"
  | "invoice.paid"
  | "invoice.failed"
  | "subscription.past_due";

export interface Event<T = unknown> {
  readonly id: string;
  readonly type: EventType;
  readonly createdAt: Date;
  readonly data: T;
}

export interface WebhookEndpoint {
  readonly id: string;
  readonly merchantId: string;
  readonly url: string;
  /** Used to compute the `Recur-Signature` HMAC header. */
  readonly secret: string;
  readonly types: readonly EventType[];
  readonly active: boolean;
}
