import "server-only";
import { manualBillingProvider } from "./manual";
import type { BillingProvider } from "./types";

export type { BillingProvider, ChangeRequest, ChangeResult, RequestedChange } from "./types";

/** The active billing provider. Swap in a StripeBillingProvider here when it exists. */
export function getBillingProvider(): BillingProvider {
  return manualBillingProvider;
}
