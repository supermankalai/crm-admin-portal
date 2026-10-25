import { Sparkles } from "lucide-react";

/** Shown wherever a plan limit or feature flag blocks something. */
export function UpgradeNotice({ message, canManageBilling }: { message: string; canManageBilling: boolean }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-violet-500/30 bg-violet-500/10 p-4 text-sm">
      <Sparkles className="mt-0.5 size-4 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
      <div>
        <p className="font-medium">{message}</p>
        <p className="mt-1 text-muted-foreground">
          {canManageBilling
            ? "To upgrade, contact the FitCRM team. Plan changes take effect immediately."
            : "Ask your gym owner to upgrade the plan."}
        </p>
      </div>
    </div>
  );
}
