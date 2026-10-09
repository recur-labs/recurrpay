import { z } from "zod";

/** Stellar public keys are 56-character base32 strings starting with G. */
export const stellarAccount = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, "must be a Stellar public key (G…)");

export const assetSchema = z.object({
  code: z.string().min(1).max(12),
  issuer: stellarAccount.optional(),
});

export const amountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,7})?$/, "must be a decimal with at most 7 places");

export const cycleSchema = z.object({
  interval: z.enum(["day", "week", "month", "year"]),
  intervalCount: z.number().int().min(1).max(365).default(1),
});

export const createPlanSchema = z.object({
  name: z.string().min(1).max(120),
  amount: amountSchema,
  asset: assetSchema,
  cycle: cycleSchema,
  trialDays: z.number().int().min(0).max(365).default(0),
});

export const createSubscriptionSchema = z.object({
  planId: z.string().min(1),
  payerAccount: stellarAccount,
  payeeAccount: stellarAccount,
  /** Optional ISO timestamp to backdate or delay the first period. */
  startAt: z.string().datetime().optional(),
});

export const createWebhookSchema = z.object({
  url: z.string().url(),
  types: z
    .array(
      z.enum([
        "subscription.created",
        "subscription.canceled",
        "invoice.created",
        "invoice.paid",
        "invoice.failed",
        "subscription.past_due",
      ]),
    )
    .min(1),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
