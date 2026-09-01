import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  /** Comma-separated `key:merchantId` pairs. Replace with a real key store. */
  RECUR_API_KEYS: z.string().default("sk_test_local:mrc_local"),
  /** Run the billing loop inside the API process. Convenient for local dev. */
  RECUR_EMBEDDED_SCHEDULER: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  RECUR_TICK_INTERVAL_MS: z.coerce.number().int().min(1000).default(60_000),
  /** Omit to run against the in-memory mock executor (no network, no keys). */
  STELLAR_RPC_URL: z.string().url().optional(),
  STELLAR_NETWORK_PASSPHRASE: z
    .string()
    .default("Test SDF Network ; September 2015"),
  STELLAR_SPENDER_SECRET: z
    .string()
    .regex(/^S[A-Z2-7]{55}$/)
    .optional(),
  /** SEP-41 contract used to settle the default asset. */
  RECUR_TOKEN_CONTRACT_ID: z.string().optional(),
});

export type Config = z.infer<typeof envSchema> & {
  apiKeys: ReadonlyMap<string, string>;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  const apiKeys = new Map<string, string>();
  for (const pair of parsed.RECUR_API_KEYS.split(",")) {
    const [key, merchantId] = pair.split(":");
    if (key && merchantId) apiKeys.set(key.trim(), merchantId.trim());
  }
  if (apiKeys.size === 0) {
    throw new Error("RECUR_API_KEYS must contain at least one key:merchantId pair");
  }
  return { ...parsed, apiKeys };
}

export function usesLiveNetwork(config: Config): boolean {
  return Boolean(
    config.STELLAR_RPC_URL &&
      config.STELLAR_SPENDER_SECRET &&
      config.RECUR_TOKEN_CONTRACT_ID,
  );
}
