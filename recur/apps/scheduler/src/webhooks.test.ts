import { describe, expect, it, vi } from "vitest";
import type { Event, WebhookEndpoint } from "@recur/core";
import { deliver, sign, subscribers, verify } from "./webhooks.js";

const endpoint: WebhookEndpoint = {
  id: "whk_1",
  merchantId: "mrc_1",
  url: "https://merchant.example/hooks",
  secret: "whsec_test",
  types: ["invoice.paid"],
  active: true,
};

const event: Event = {
  id: "evt_1",
  type: "invoice.paid",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  data: { invoiceId: "in_1" },
};

const noSleep = async () => {};

describe("signatures", () => {
  it("verifies a signature it produced", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ hello: "world" });
    expect(verify(endpoint.secret, timestamp, body, sign(endpoint.secret, timestamp, body))).toBe(
      true,
    );
  });

  it("rejects a tampered body", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = sign(endpoint.secret, timestamp, '{"amount":"10"}');
    expect(verify(endpoint.secret, timestamp, '{"amount":"1000"}', signature)).toBe(false);
  });

  it("rejects a replayed old timestamp", () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    const body = "{}";
    expect(verify(endpoint.secret, old, body, sign(endpoint.secret, old, body))).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    expect(verify(endpoint.secret, timestamp, "{}", sign("other", timestamp, "{}"))).toBe(
      false,
    );
  });
});

describe("deliver", () => {
  it("posts a signed payload and stops on success", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const attempt = await deliver(endpoint, event, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(attempt.ok).toBe(true);
    expect(attempt.attempt).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["recur-signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(init.body as string)).toMatchObject({ type: "invoice.paid" });
  });

  it("retries a 500 up to the backoff schedule", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }));
    const attempt = await deliver(endpoint, event, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      backoffMs: [1, 1],
    });
    expect(attempt.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 400 the endpoint will reject again", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 400 }));
    await deliver(endpoint, event, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a 429", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 }));
    await deliver(endpoint, event, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      backoffMs: [1],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("survives a transport error and reports the last attempt", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const attempt = await deliver(endpoint, event, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      backoffMs: [1],
    });
    expect(attempt).toMatchObject({ ok: false, status: null, attempt: 2 });
  });
});

describe("subscribers", () => {
  it("matches only active endpoints subscribed to the event type", () => {
    const inactive = { ...endpoint, id: "whk_2", active: false };
    const other = { ...endpoint, id: "whk_3", types: ["invoice.failed"] as const };
    expect(subscribers([endpoint, inactive, other], event).map((e) => e.id)).toEqual([
      "whk_1",
    ]);
  });
});
