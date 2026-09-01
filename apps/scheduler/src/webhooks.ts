import { createHmac, timingSafeEqual } from "node:crypto";
import type { Event, WebhookEndpoint } from "@recur/core";

/**
 * Outbound webhook delivery.
 *
 * Payloads are signed with an HMAC over `timestamp.body` so a merchant can
 * verify the call came from their Recur deployment and reject replays, the same
 * shape merchants already implement for other billing providers.
 */

export const SIGNATURE_HEADER = "recur-signature";
export const TIMESTAMP_HEADER = "recur-timestamp";

export function sign(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verify(
  secret: string,
  timestamp: number,
  body: string,
  signature: string,
  toleranceSeconds = 300,
): boolean {
  const age = Math.abs(Date.now() / 1000 - timestamp);
  if (age > toleranceSeconds) return false;

  const expected = Buffer.from(sign(secret, timestamp, body), "utf8");
  const received = Buffer.from(signature, "utf8");
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export interface DeliveryAttempt {
  readonly endpointId: string;
  readonly eventId: string;
  readonly status: number | null;
  readonly attempt: number;
  readonly ok: boolean;
}

export interface DeliveryOptions {
  readonly maxAttempts?: number;
  readonly backoffMs?: readonly number[];
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const DEFAULT_BACKOFF = [1000, 5000, 25000] as const;

export async function deliver(
  endpoint: WebhookEndpoint,
  event: Event,
  options: DeliveryOptions = {},
): Promise<DeliveryAttempt> {
  const doFetch = options.fetchImpl ?? fetch;
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF;
  const maxAttempts = options.maxAttempts ?? backoff.length + 1;
  const wait = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = options.now ?? (() => Date.now());

  const body = JSON.stringify({
    id: event.id,
    type: event.type,
    created: event.createdAt.toISOString(),
    data: event.data,
  });

  let last: DeliveryAttempt = {
    endpointId: endpoint.id,
    eventId: event.id,
    status: null,
    attempt: 0,
    ok: false,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const timestamp = Math.floor(now() / 1000);
    try {
      const response = await doFetch(endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [TIMESTAMP_HEADER]: String(timestamp),
          [SIGNATURE_HEADER]: sign(endpoint.secret, timestamp, body),
        },
        body,
      });
      last = {
        endpointId: endpoint.id,
        eventId: event.id,
        status: response.status,
        attempt,
        ok: response.ok,
      };
      // 4xx other than 429 means the endpoint rejected the payload itself;
      // repeating an identical request will not change that.
      if (response.ok) return last;
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return last;
      }
    } catch {
      last = {
        endpointId: endpoint.id,
        eventId: event.id,
        status: null,
        attempt,
        ok: false,
      };
    }

    const delay = backoff[attempt - 1];
    if (delay !== undefined && attempt < maxAttempts) await wait(delay);
  }

  return last;
}

export function subscribers(
  endpoints: readonly WebhookEndpoint[],
  event: Event,
): WebhookEndpoint[] {
  return endpoints.filter((e) => e.active && e.types.includes(event.type));
}
