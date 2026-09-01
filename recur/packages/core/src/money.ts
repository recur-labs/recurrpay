/**
 * Money handling for Stellar assets.
 *
 * Stellar amounts have a fixed precision of 7 decimal places; the smallest
 * indivisible unit is a "stroop" (1 XLM = 10_000_000 stroops). Every amount in
 * Recur is carried as a bigint number of stroops so that no floating point
 * value ever touches a balance. Formatting to a decimal string happens only at
 * the edges (API responses, Horizon transaction envelopes).
 */

export const STROOPS_PER_UNIT = 10_000_000n;
export const ASSET_DECIMALS = 7;

/** A Stellar asset: either native XLM or a `CODE:ISSUER` credit asset. */
export interface Asset {
  readonly code: string;
  /** `undefined` for the native asset. */
  readonly issuer?: string;
}

export const NATIVE: Asset = { code: "XLM" };

export function isNative(asset: Asset): boolean {
  return asset.issuer === undefined && asset.code === "XLM";
}

export function assetId(asset: Asset): string {
  return isNative(asset) ? "native" : `${asset.code}:${asset.issuer}`;
}

export function parseAssetId(id: string): Asset {
  if (id === "native") return NATIVE;
  const [code, issuer] = id.split(":");
  if (!code || !issuer) {
    throw new MoneyError(`invalid asset id: ${id}`);
  }
  return { code, issuer };
}

export class MoneyError extends Error {
  override name = "MoneyError";
}

/** An amount of a single asset, held in stroops. */
export interface Money {
  readonly asset: Asset;
  readonly stroops: bigint;
}

export function money(asset: Asset, stroops: bigint): Money {
  if (stroops < 0n) throw new MoneyError("amount cannot be negative");
  return { asset, stroops };
}

/**
 * Parse a human decimal string ("12.5000000") into Money.
 * Rejects anything with more than 7 decimal places rather than rounding, so a
 * caller never silently loses value.
 */
export function parseAmount(asset: Asset, decimal: string): Money {
  const trimmed = decimal.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new MoneyError(`invalid amount: ${decimal}`);
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > ASSET_DECIMALS) {
    throw new MoneyError(
      `amount ${decimal} has more than ${ASSET_DECIMALS} decimal places`,
    );
  }
  const padded = fraction.padEnd(ASSET_DECIMALS, "0");
  return money(asset, BigInt(whole) * STROOPS_PER_UNIT + BigInt(padded));
}

/** Format Money as the decimal string Horizon expects. */
export function formatAmount(value: Money): string {
  const whole = value.stroops / STROOPS_PER_UNIT;
  const fraction = value.stroops % STROOPS_PER_UNIT;
  return `${whole}.${fraction.toString().padStart(ASSET_DECIMALS, "0")}`;
}

function assertSameAsset(a: Money, b: Money): void {
  if (assetId(a.asset) !== assetId(b.asset)) {
    throw new MoneyError(
      `asset mismatch: ${assetId(a.asset)} vs ${assetId(b.asset)}`,
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSameAsset(a, b);
  return money(a.asset, a.stroops + b.stroops);
}

export function subtract(a: Money, b: Money): Money {
  assertSameAsset(a, b);
  return money(a.asset, a.stroops - b.stroops);
}

export function multiply(a: Money, factor: number): Money {
  if (!Number.isFinite(factor) || factor < 0) {
    throw new MoneyError(`invalid factor: ${factor}`);
  }
  // Scale through a bigint ratio to avoid float drift on the stroop value.
  const scale = 1_000_000n;
  const scaled = BigInt(Math.round(factor * Number(scale)));
  return money(a.asset, (a.stroops * scaled) / scale);
}

export function isZero(a: Money): boolean {
  return a.stroops === 0n;
}
