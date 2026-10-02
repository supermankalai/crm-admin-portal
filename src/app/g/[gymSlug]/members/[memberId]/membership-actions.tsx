"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Snowflake, Sun, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/domain/money";
import { cancelMembershipSchema, freezeSchema } from "@/lib/validation/members";
import { cancelMembershipAction, freezeMembershipAction, unfreezeMembershipAction } from "../actions";

type Props = {
  gymSlug: string;
  memberId: string;
  membershipId: string;
  state: string;
  cancelling: boolean;
  freeze: { allowed: boolean; maxDays: number; usedDays: number };
  cancellation: { noticeDays: number; feeMinor: number };
  currency: string;
};

export function MembershipActions(props: Props) {
  const { gymSlug, memberId, membershipId, state, cancelling, freeze, cancellation, currency } = props;
  const router = useRouter();
  const [dialog, setDialog] = useState<"freeze" | "cancel" | null>(null);
  const [pending, startTransition] = useTransition();
  const freezeLeft = Math.max(freeze.maxDays - freeze.usedDays, 0);

  const freezeForm = useForm<z.input<typeof freezeSchema>, unknown, z.output<typeof freezeSchema>>({
    resolver: zodResolver(freezeSchema),
    defaultValues: { membershipId, days: Math.min(7, freezeLeft) || 1 },
  });
  const cancelForm = useForm<z.input<typeof cancelMembershipSchema>, unknown, z.output<typeof cancelMembershipSchema>>({
    resolver: zodResolver(cancelMembershipSchema),
    defaultValues: { membershipId, reason: "" },
  });

  const done = (message: string) => {
    toast.success(message);
    setDialog(null);
    router.refresh();
  };

  if (state === "frozen") {
    return (
      <ConfirmDialog
        destructive={false}
        title="Unfreeze this membership?"
        description="The member can check in again from today. Unused freeze days are given back and the end date moves back accordingly."
        confirmLabel="Unfreeze"
        trigger={(open) => (
          <Button size="sm" variant="outline" onClick={open}>
            <Sun aria-hidden /> Unfreeze
          </Button>
        )}
        onConfirm={async () => {
          const r = await unfreezeMembershipAction(gymSlug, { membershipId, memberId });
          if (!r.ok) {
            toast.error(r.error);
            return false;
          }
          done("Membership unfrozen.");
          return true;
        }}
      />
    );
  }
  if (state !== "active" && state !== "upcoming") return null;

  return (
    <div className="flex flex-wrap gap-2">
      {state === "active" && freeze.allowed && !cancelling && (
        <Button size="sm" variant="outline" onClick={() => setDialog("freeze")} disabled={freezeLeft === 0} title={freezeLeft === 0 ? "No freeze days left" : undefined}>
          <Snowflake aria-hidden /> Freeze
        </Button>
      )}
      {!cancelling && (
        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDialog("cancel")}>
          <XCircle aria-hidden /> Cancel
        </Button>
      )}

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && !pending && setDialog(null)}>
        <DialogContent>
          {dialog === "freeze" && (
            <form
              noValidate
              className="grid gap-4"
              onSubmit={freezeForm.handleSubmit((values) =>
                startTransition(async () => {
                  const r = await freezeMembershipAction(gymSlug, { ...values, memberId });
                  if (!r.ok) return void toast.error(r.error);
                  done(`Frozen until ${r.data.freezeEnd}. New end date ${r.data.newEndDate}.`);
                })
              )}
            >
              <DialogHeader>
                <DialogTitle>Freeze membership</DialogTitle>
                <DialogDescription>
                  Starts today. The end date moves out by the same number of days. {freezeLeft} of {freeze.maxDays} freeze days left.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor={`freeze-days-${membershipId}`}>Days</Label>
                <Input id={`freeze-days-${membershipId}`} type="number" min={1} max={freezeLeft} {...freezeForm.register("days")} aria-invalid={!!freezeForm.formState.errors.days} />
                {freezeForm.formState.errors.days && <p className="text-sm text-destructive">{freezeForm.formState.errors.days.message}</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={pending}>
                  Back
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending && <Loader2 className="animate-spin" aria-hidden />} Freeze
                </Button>
              </DialogFooter>
            </form>
          )}
          {dialog === "cancel" && (
            <form
              noValidate
              className="grid gap-4"
              onSubmit={cancelForm.handleSubmit((values) =>
                startTransition(async () => {
                  const r = await cancelMembershipAction(gymSlug, { ...values, memberId });
                  if (!r.ok) return void toast.error(r.error);
                  done(r.data.endsImmediately ? "Membership cancelled." : `Membership cancelled. Access continues until ${r.data.effectiveEnd}.`);
                })
              )}
            >
              <DialogHeader>
                <DialogTitle>Cancel membership</DialogTitle>
                <DialogDescription>
                  {cancellation.noticeDays > 0
                    ? `This plan has a ${cancellation.noticeDays}-day notice period: access continues until then (never past the paid end date).`
                    : "This plan has no notice period: access ends today."}
                  {cancellation.feeMinor > 0 && ` A cancellation fee of ${formatMoney(cancellation.feeMinor, currency)} applies.`}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                <Label htmlFor={`cancel-reason-${membershipId}`}>Reason</Label>
                <Textarea id={`cancel-reason-${membershipId}`} rows={3} {...cancelForm.register("reason")} aria-invalid={!!cancelForm.formState.errors.reason} />
                {cancelForm.formState.errors.reason && <p className="text-sm text-destructive">{cancelForm.formState.errors.reason.message}</p>}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={pending}>
                  Keep membership
                </Button>
                <Button type="submit" variant="destructive" disabled={pending}>
                  {pending && <Loader2 className="animate-spin" aria-hidden />} Cancel membership
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
