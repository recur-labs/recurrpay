import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryStores, type Clock, type Stores } from "@recur/core";
import { buildServer } from "./server.js";

const KEY = "sk_test_123";
const PAYER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const PAYEE = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const clock: Clock = { now: () => new Date("2026-01-01T00:00:00.000Z") };

let stores: Stores;
let app: ReturnType<typeof buildServer>;

const auth = { "x-api-key": KEY };

async function createPlan(overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/v1/plans",
    headers: auth,
    payload: {
      name: "Pro monthly",
      amount: "10.5",
      asset: { code: "USDC", issuer: USDC_ISSUER },
      cycle: { interval: "month", intervalCount: 1 },
      trialDays: 0,
      ...overrides,
    },
  });
}

beforeEach(() => {
  stores = createMemoryStores();
  app = buildServer({
    stores,
    clock,
    apiKeys: new Map([[KEY, "mrc_1"]]),
  });
});

describe("auth", () => {
  it("serves health without a key", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
  });

  it("rejects requests without a known key", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/plans" })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/plans",
          headers: { "x-api-key": "nope" },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe("plans", () => {
  it("creates a plan and echoes a Stellar-precision amount", async () => {
    const response = await createPlan();
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: "Pro monthly",
      amount: "10.5000000",
      active: true,
    });
  });

  it("rejects an amount with more precision than Stellar supports", async () => {
    const response = await createPlan({ amount: "1.123456789" });
    expect(response.statusCode).toBe(422);
  });

  it("rejects an unknown interval", async () => {
    const response = await createPlan({ cycle: { interval: "fortnight", intervalCount: 1 } });
    expect(response.statusCode).toBe(422);
  });

  it("only lists the calling merchant's plans", async () => {
    await createPlan();
    const other = buildServer({
      stores,
      clock,
      apiKeys: new Map([["sk_other", "mrc_2"]]),
    });
    const response = await other.inject({
      method: "GET",
      url: "/v1/plans",
      headers: { "x-api-key": "sk_other" },
    });
    expect(response.json().data).toHaveLength(0);
  });
});

describe("subscriptions", () => {
  it("starts a subscription on the plan's cycle", async () => {
    const plan = (await createPlan()).json();
    const response = await app.inject({
      method: "POST",
      url: "/v1/subscriptions",
      headers: auth,
      payload: { planId: plan.id, payerAccount: PAYER, payeeAccount: PAYEE },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: "active",
      amount: "10.5000000",
      currentPeriodEnd: "2026-01-01T00:00:00.000Z",
      nextPeriodEnd: "2026-02-01T00:00:00.000Z",
    });
  });

  it("holds the first charge until a trial ends", async () => {
    const plan = (await createPlan({ trialDays: 14 })).json();
    const response = await app.inject({
      method: "POST",
      url: "/v1/subscriptions",
      headers: auth,
      payload: { planId: plan.id, payerAccount: PAYER, payeeAccount: PAYEE },
    });
    expect(response.json()).toMatchObject({
      status: "trialing",
      currentPeriodEnd: "2026-01-15T00:00:00.000Z",
    });
  });

  it("rejects a payer that is not a Stellar account", async () => {
    const plan = (await createPlan()).json();
    const response = await app.inject({
      method: "POST",
      url: "/v1/subscriptions",
      headers: auth,
      payload: { planId: plan.id, payerAccount: "not-an-account", payeeAccount: PAYEE },
    });
    expect(response.statusCode).toBe(422);
  });

  it("404s on another merchant's plan", async () => {
    const plan = (await createPlan()).json();
    const other = buildServer({
      stores,
      clock,
      apiKeys: new Map([["sk_other", "mrc_2"]]),
    });
    const response = await other.inject({
      method: "POST",
      url: "/v1/subscriptions",
      headers: { "x-api-key": "sk_other" },
      payload: { planId: plan.id, payerAccount: PAYER, payeeAccount: PAYEE },
    });
    expect(response.statusCode).toBe(404);
  });

  it("cancels once and refuses a second cancel", async () => {
    const plan = (await createPlan()).json();
    const subscription = (
      await app.inject({
        method: "POST",
        url: "/v1/subscriptions",
        headers: auth,
        payload: { planId: plan.id, payerAccount: PAYER, payeeAccount: PAYEE },
      })
    ).json();

    const first = await app.inject({
      method: "POST",
      url: `/v1/subscriptions/${subscription.id}/cancel`,
      headers: auth,
    });
    expect(first.json()).toMatchObject({ status: "canceled" });

    const second = await app.inject({
      method: "POST",
      url: `/v1/subscriptions/${subscription.id}/cancel`,
      headers: auth,
    });
    expect(second.statusCode).toBe(409);
  });
});

describe("webhooks", () => {
  it("returns the signing secret exactly once, at creation", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks",
      headers: auth,
      payload: { url: "https://merchant.example/hooks", types: ["invoice.paid"] },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().secret).toMatch(/^whsec_[0-9a-f]{48}$/);
  });

  it("rejects a non-URL endpoint", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks",
      headers: auth,
      payload: { url: "merchant.example", types: ["invoice.paid"] },
    });
    expect(response.statusCode).toBe(422);
  });
});
