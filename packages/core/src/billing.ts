import type { BillingCycle, Interval } from "./types.js";
import { type Money, money, multiply } from "./money.js";

const MS_PER_DAY = 86_400_000;

/**
 * Advance a date by one billing cycle.
 *
 * Month and year arithmetic clamps to the last valid day of the target month,
 * so a subscription anchored on the 31st bills on the 28th (or 29th) in
 * February and returns to the 31st afterwards, which is what merchants expect
 * and what Stripe-style billing does.
 */
export function advance(from: Date, cycle: BillingCycle): Date {
  const { interval, intervalCount } = cycle;
  if (!Number.isInteger(intervalCount) || intervalCount < 1) {
    throw new RangeError(`intervalCount must be a positive integer`);
  }

  switch (interval) {
    case "day":
      return new Date(from.getTime() + intervalCount * MS_PER_DAY);
    case "week":
      return new Date(from.getTime() + intervalCount * 7 * MS_PER_DAY);
    case "month":
      return addMonths(from, intervalCount);
    case "year":
      return addMonths(from, intervalCount * 12);
    default: {
      const exhaustive: never = interval;
      throw new RangeError(`unsupported interval: ${String(exhaustive)}`);
    }
  }
}

function addMonths(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  const day = from.getUTCDate();
  const target = new Date(
    Date.UTC(
      year,
      month + months,
      1,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
  const lastDay = daysInMonth(target.getUTCFullYear(), target.getUTCMonth());
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The billing period a subscription enters when it starts at `startedAt`. */
export function firstPeriod(
  startedAt: Date,
  cycle: BillingCycle,
  trialDays: number,
): { start: Date; end: Date } {
  if (trialDays < 0) throw new RangeError("trialDays cannot be negative");
  const start =
    trialDays === 0
      ? startedAt
      : new Date(startedAt.getTime() + trialDays * MS_PER_DAY);
  return { start, end: advance(start, cycle) };
}

/**
 * Amount owed when a subscription changes mid-period.
 *
 * The unused remainder of the current period is credited at the old rate and
 * the remainder of the period is charged at the new rate. The result is never
 * negative — a downgrade produces a zero charge rather than a refund, because
 * Stellar payments are irreversible and refunds have to be an explicit,
 * separately authorised operation.
 */
export function prorate(
  oldAmount: Money,
  newAmount: Money,
  periodStart: Date,
  periodEnd: Date,
  changeAt: Date,
): Money {
  const total = periodEnd.getTime() - periodStart.getTime();
  if (total <= 0) throw new RangeError("period end must be after period start");

  const elapsed = changeAt.getTime() - periodStart.getTime();
  if (elapsed <= 0) return newAmount;
  if (elapsed >= total) return money(newAmount.asset, 0n);

  const remainingFraction = (total - elapsed) / total;
  const credit = multiply(oldAmount, remainingFraction).stroops;
  const charge = multiply(newAmount, remainingFraction).stroops;
  const owed = charge - credit;
  return money(newAmount.asset, owed > 0n ? owed : 0n);
}

/**
 * Backoff schedule for a failed charge, in milliseconds.
 * Four attempts over roughly a week, then the subscription is marked past_due.
 */
export const RETRY_SCHEDULE_MS: readonly number[] = [
  1 * MS_PER_DAY,
  3 * MS_PER_DAY,
  5 * MS_PER_DAY,
];

export function nextRetryAt(failedAt: Date, attempt: number): Date | null {
  const delay = RETRY_SCHEDULE_MS[attempt - 1];
  if (delay === undefined) return null;
  return new Date(failedAt.getTime() + delay);
}

export function describeCycle(cycle: BillingCycle): string {
  const unit: Record<Interval, string> = {
    day: "day",
    week: "week",
    month: "month",
    year: "year",
  };
  return cycle.intervalCount === 1
    ? `every ${unit[cycle.interval]}`
    : `every ${cycle.intervalCount} ${unit[cycle.interval]}s`;
}
