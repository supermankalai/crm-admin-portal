"use client";

import { useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runExpiryAction } from "./actions";

export function RunExpiryButton() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await runExpiryAction({});
          if (result.ok) toast.success(result.data.expired ? `${result.data.expired} subscription(s) marked expired.` : "No subscriptions were due to expire.");
          else toast.error(result.error);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />} Run expiry check
    </Button>
  );
}
