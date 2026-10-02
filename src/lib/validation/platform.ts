import { z } from "zod";

const id = z.string().trim().min(1).max(64);
const reason = z.string().trim().min(10, "Give a reason of at least 10 characters").max(500);

export const subscriptionChangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("activate"), gymId: id, months: z.coerce.number().int().min(1).max(36) }),
  z.object({ type: z.literal("extend"), gymId: id, days: z.coerce.number().int().min(1).max(365) }),
  z.object({ type: z.literal("changePlan"), gymId: id, planCode: z.string().trim().toUpperCase().regex(/^[A-Z_]{2,20}$/) }),
  z.object({ type: z.literal("suspend"), gymId: id, reason }),
  z.object({ type: z.literal("reactivate"), gymId: id }),
  z.object({ type: z.literal("cancel"), gymId: id, reason }),
]);
export type SubscriptionChangeInput = z.infer<typeof subscriptionChangeSchema>;

const positiveInt = (max: number) => z.coerce.number().int().min(1).max(max);

export const planUpdateSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z_]{2,20}$/),
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(200),
  priceMonthlyMinor: z.coerce.number().int().min(0).max(100_000_000),
  maxMembers: positiveInt(1_000_000),
  maxStaff: positiveInt(10_000),
  maxLocations: positiveInt(1_000),
  featureReports: z.boolean(),
  featureCsvExport: z.boolean(),
  featureClassBookings: z.boolean(),
  isActive: z.boolean(),
});
export type PlanUpdateInput = z.infer<typeof planUpdateSchema>;

export const supportStartSchema = z.object({ gymId: id, reason });
export type SupportStartInput = z.infer<typeof supportStartSchema>;
