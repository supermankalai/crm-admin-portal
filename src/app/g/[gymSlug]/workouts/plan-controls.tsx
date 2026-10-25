"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { assignPlanAction, setPlanStatusAction } from "./actions";

type Status = "DRAFT" | "ACTIVE" | "ARCHIVED";

/** Move a plan between Active, Draft and Archived. */
export function StatusButtons({ gymSlug, planId, status }: { gymSlug: string; planId: string; status: Status }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const set = (next: Status, done: string) =>
    startTransition(async () => {
      const r = await setPlanStatusAction(gymSlug, { planId, status: next });
      if (!r.ok) return void toast.error(r.error);
      toast.success(done);
      router.refresh();
    });
  return (
    <>
      {status !== "ACTIVE" && (
        <Button variant="outline" disabled={pending} onClick={() => set("ACTIVE", "Plan is active — the client sees it.")}>
          {pending && <Loader2 className="animate-spin" aria-hidden />} Make active
        </Button>
      )}
      {status !== "ARCHIVED" && (
        <Button variant="outline" disabled={pending} onClick={() => set("ARCHIVED", "Plan archived.")}>
          Archive
        </Button>
      )}
    </>
  );
}

/** Copy a plan to one of your clients as their active plan. */
export function AssignPlan({ gymSlug, planId, clients }: { gymSlug: string; planId: string; clients: { memberId: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState(clients[0]?.memberId ?? "");
  const [pending, startTransition] = useTransition();
  const selectId = useId();
  const give = () =>
    startTransition(async () => {
      const r = await assignPlanAction(gymSlug, { planId, memberId });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Plan given to the client.");
      setOpen(false);
      router.push(`/g/${gymSlug}/workouts/${r.data.planId}`);
    });
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={!clients.length} title={clients.length ? undefined : "You have no assigned clients"}>
        <UserPlus aria-hidden /> Give to a client
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Give this plan to a client</DialogTitle>
            <DialogDescription>A copy becomes their active plan. Later changes to this one won&apos;t change theirs.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={selectId}>Client</Label>
            <NativeSelect id={selectId} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              {clients.map((c) => (
                <option key={c.memberId} value={c.memberId}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={give} disabled={pending || !memberId}>
              {pending && <Loader2 className="animate-spin" aria-hidden />} Give plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
