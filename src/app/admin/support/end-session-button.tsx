"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { endSupportAction } from "../actions";

export function EndSessionButton({ sessionId }: { sessionId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await endSupportAction({ sessionId });
          if (result.ok) toast.success("Support session ended.");
          else toast.error(result.error);
        })
      }
    >
      End session
    </Button>
  );
}
