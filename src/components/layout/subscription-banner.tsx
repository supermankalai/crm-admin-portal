import { Clock, Lock } from "lucide-react";
import { READ_ONLY_MESSAGES, type SubscriptionAccess } from "@/domain/subscription-access";

/** Read-only banner (expired / suspended) or a trial countdown. Rendered by the gym layout. */
export function SubscriptionBanner({ access, canManageBilling }: { access: SubscriptionAccess; canManageBilling: boolean }) {
  if (!access.writable && access.reason) {
    return (
      <div role="status" className="flex items-start gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 md:px-6 dark:text-amber-200">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          <span className="font-semibold">Read-only mode. </span>
          {READ_ONLY_MESSAGES[access.reason]}
          {canManageBilling ? " Contact the platform team to renew." : " Ask your gym owner to renew the subscription."}
        </p>
      </div>
    );
  }
  if (access.isTrial && access.daysRemaining !== null) {
    const days = Math.max(access.daysRemaining, 0);
    return (
      <div role="status" className="flex items-center gap-3 border-b bg-sky-500/10 px-4 py-2 text-sm text-sky-900 md:px-6 dark:text-sky-200">
        <Clock className="size-4 shrink-0" aria-hidden />
        <p>
          Free trial: <span className="font-semibold">{days === 0 ? "ends today" : `${days} day${days === 1 ? "" : "s"} left`}</span>.
        </p>
      </div>
    );
  }
  return null;
}
