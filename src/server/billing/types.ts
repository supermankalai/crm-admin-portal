import type { HistoryAction, SubscriptionChange } from "@/domain/subscription-changes";
import type { RequestMeta } from "@/server/security/request-meta";

/**
 * Billing abstraction. Today only ManualBillingProvider exists: a super admin activates,
 * extends or changes a gym's subscription after receiving payment offline.
 *
 * Connecting Stripe later means adding a StripeBillingProvider that
 *  - creates Checkout / Billing Portal sessions for gym owners, and
 *  - handles webhooks (invoice.paid, customer.subscription.updated/deleted) by translating them
 *    into the same SubscriptionChange values and calling persistSubscriptionChange(),
 * so subscription history, audit and read-only mode keep working unchanged.
 */

/** Change as requested by an operator; plans are referenced by code. */
export type RequestedChange =
  | Exclude<SubscriptionChange, { type: "changePlan" }>
  | { type: "changePlan"; planCode: string };

export type ChangeRequest = {
  actorUserId: string;
  gymId: string;
  change: RequestedChange;
  meta: RequestMeta;
};

export type ChangeResult = {
  action: HistoryAction;
  gymStatus: string;
  status: string;
  currentPeriodEnd: Date;
  planCode: string;
};

export interface BillingProvider {
  readonly kind: "MANUAL" | "STRIPE";
  changeSubscription(request: ChangeRequest): Promise<ChangeResult>;
}
