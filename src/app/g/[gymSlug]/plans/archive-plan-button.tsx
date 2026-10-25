"use client";

import { useRouter } from "next/navigation";
import { Archive } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { archiveMembershipPlanAction } from "./actions";

export function ArchivePlanButton({ gymSlug, planId, name, activeMemberships }: { gymSlug: string; planId: string; name: string; activeMemberships: number }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      title={`Archive ${name}?`}
      description={
        activeMemberships > 0
          ? `${activeMemberships} member${activeMemberships === 1 ? " is" : "s are"} on this plan. Their memberships continue unchanged; the plan just can't be sold any more.`
          : "The plan can't be sold any more. Past memberships keep their history."
      }
      confirmLabel="Archive plan"
      trigger={(open) => (
        <Button variant="ghost" size="sm" className="text-destructive" onClick={open} aria-label={`Archive ${name}`}>
          <Archive aria-hidden /> Archive
        </Button>
      )}
      onConfirm={async () => {
        const r = await archiveMembershipPlanAction(gymSlug, { planId });
        if (!r.ok) {
          toast.error(r.error);
          return false;
        }
        toast.success(`${name} archived.`);
        router.refresh();
        return true;
      }}
    />
  );
}
