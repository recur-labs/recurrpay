import { describe, expect, it } from "vitest";
import { advance, firstPeriod, nextRetryAt, prorate } from "./billing.js";
import { NATIVE, formatAmount, parseAmount } from "./money.js";

const iso = (d: Date) => d.toISOString();

describe("advance", () => {
  it("advances by days and weeks", () => {
    const from = new Date("2026-01-01T12:00:00.000Z");
    expect(iso(advance(from, { interval: "day", intervalCount: 1 }))).toBe(
      "2026-01-02T12:00:00.000Z",
    );
    expect(iso(advance(from, { interval: "week", intervalCount: 2 }))).toBe(
      "2026-01-15T12:00:00.000Z",
    );
  });

  it("clamps month-end anchors instead of overflowing", () => {
    const jan31 = new Date("2026-01-31T00:00:00.000Z");
    const feb = advance(jan31, { interval: "month", intervalCount: 1 });
    expect(iso(feb)).toBe("2026-02-28T00:00:00.000Z");
  });

  it("handles leap years", () => {
    const jan31 = new Date("2028-01-31T00:00:00.000Z");
    expect(iso(advance(jan31, { interval: "month", intervalCount: 1 }))).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("supports quarterly and yearly cycles", () => {
    const from = new Date("2026-03-15T00:00:00.000Z");
    expect(iso(advance(from, { interval: "month", intervalCount: 3 }))).toBe(
      "2026-06-15T00:00:00.000Z",
    );
    expect(iso(advance(from, { interval: "year", intervalCount: 1 }))).toBe(
      "2027-03-15T00:00:00.000Z",
    );
  });

  it("rejects a non-positive interval count", () => {
    expect(() => advance(new Date(), { interval: "day", intervalCount: 0 })).toThrow();
  });
});

describe("firstPeriod", () => {
  it("starts immediately with no trial", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const period = firstPeriod(start, { interval: "month", intervalCount: 1 }, 0);
    expect(iso(period.start)).toBe("2026-01-01T00:00:00.000Z");
    expect(iso(period.end)).toBe("2026-02-01T00:00:00.000Z");
  });

  it("defers the first charge past the trial", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const period = firstPeriod(start, { interval: "month", intervalCount: 1 }, 14);
    expect(iso(period.start)).toBe("2026-01-15T00:00:00.000Z");
    expect(iso(period.end)).toBe("2026-02-15T00:00:00.000Z");
  });
});

describe("prorate", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const end = new Date("2026-02-01T00:00:00.000Z");

  it("charges the difference for the unused remainder on an upgrade", () => {
    const half = new Date("2026-01-16T12:00:00.000Z"); // exactly half
    const owed = prorate(
      parseAmount(NATIVE, "10"),
      parseAmount(NATIVE, "30"),
      start,
      end,
      half,
    );
    expect(formatAmount(owed)).toBe("10.0000000");
  });

  it("charges nothing on a downgrade", () => {
    const half = new Date("2026-01-16T12:00:00.000Z");
    const owed = prorate(
      parseAmount(NATIVE, "30"),
      parseAmount(NATIVE, "10"),
      start,
      end,
      half,
    );
    expect(formatAmount(owed)).toBe("0.0000000");
  });

  it("charges the full new amount when the change lands on the period start", () => {
    const owed = prorate(
      parseAmount(NATIVE, "10"),
      parseAmount(NATIVE, "30"),
      start,
      end,
      start,
    );
    expect(formatAmount(owed)).toBe("30.0000000");
  });

  it("rejects an inverted period", () => {
    expect(() =>
      prorate(parseAmount(NATIVE, "1"), parseAmount(NATIVE, "1"), end, start, end),
    ).toThrow();
  });
});

describe("nextRetryAt", () => {
  const failedAt = new Date("2026-01-01T00:00:00.000Z");

  it("backs off over three attempts then gives up", () => {
    expect(iso(nextRetryAt(failedAt, 1)!)).toBe("2026-01-02T00:00:00.000Z");
    expect(iso(nextRetryAt(failedAt, 2)!)).toBe("2026-01-04T00:00:00.000Z");
    expect(iso(nextRetryAt(failedAt, 3)!)).toBe("2026-01-06T00:00:00.000Z");
    expect(nextRetryAt(failedAt, 4)).toBeNull();
  });
});
