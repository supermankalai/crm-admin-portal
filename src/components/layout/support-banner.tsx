"use client";

import { useTransition } from "react";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { endSupportAction } from "@/app/admin/actions";

/** Always visible while a super admin is inside a gym under support access. */
export function SupportBanner({ gymName }: { gymName: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-red-500/40 bg-red-600 px-4 py-2 text-sm text-white md:px-6">
      <Eye className="size-4 shrink-0" aria-hidden />
      <p className="flex-1">
        <span className="font-semibold">Support access to {gymName}.</span> Read-only — every page you open is recorded in this gym&apos;s audit log.
      </p>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await endSupportAction({});
            if (result && !result.ok) toast.error(result.error);
          })
        }
      >
        {pending && <Loader2 className="animate-spin" aria-hidden />} End support session
      </Button>
    </div>
  );
}
