"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { revokeInvitationAction } from "./actions";

export function RevokeInvitationButton({ gymSlug, invitationId, email }: { gymSlug: string; invitationId: string; email: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      title={`Withdraw the invitation to ${email}?`}
      description="The link stops working immediately."
      confirmLabel="Withdraw"
      trigger={(open) => (
        <Button size="sm" variant="ghost" className="text-destructive" onClick={open}>
          Withdraw
        </Button>
      )}
      onConfirm={async () => {
        const r = await revokeInvitationAction(gymSlug, { invitationId });
        if (!r.ok) {
          toast.error(r.error);
          return false;
        }
        toast.success("Invitation withdrawn.");
        router.refresh();
        return true;
      }}
    />
  );
}
