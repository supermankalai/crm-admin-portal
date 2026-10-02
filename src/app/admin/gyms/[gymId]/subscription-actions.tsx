"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { subscriptionChangeSchema, type SubscriptionChangeInput } from "@/lib/validation/platform";
import { changeSubscriptionAction } from "../../actions";

type Mode = SubscriptionChangeInput["type"];

const COPY: Record<Mode, { title: string; description: string; submit: string; destructive?: boolean }> = {
  activate: { title: "Activate paid subscription", description: "Use after receiving payment. Starts a paid period now (or extends the current paid period).", submit: "Activate" },
  extend: { title: "Extend subscription", description: "Adds days to the current period or trial, counted from the later of today and the current end date.", submit: "Extend" },
  changePlan: { title: "Change plan", description: "Limits and features change immediately. Existing data above the new limits is kept, but nothing new can be added beyond them.", submit: "Change plan" },
  suspend: { title: "Suspend gym", description: "The gym becomes read-only immediately. Staff keep their logins and all data is kept.", submit: "Suspend gym", destructive: true },
  reactivate: { title: "Reactivate gym", description: "Lifts the suspension or cancellation. The gym is writable again if its period has not ended.", submit: "Reactivate" },
  cancel: { title: "Cancel subscription", description: "The gym becomes read-only and its subscription is cancelled. Data is kept.", submit: "Cancel subscription", destructive: true },
};

export function SubscriptionActions({
  gymId,
  gymStatus,
  currentPlanCode,
  plans,
}: {
  gymId: string;
  gymStatus: string;
  currentPlanCode: string | null;
  plans: { code: string; name: string; isActive: boolean }[];
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.input<typeof subscriptionChangeSchema>, unknown, SubscriptionChangeInput>({ resolver: zodResolver(subscriptionChangeSchema) });

  const open = (next: Mode) => {
    const defaults: Record<Mode, z.input<typeof subscriptionChangeSchema>> = {
      activate: { type: "activate", gymId, months: 1 },
      extend: { type: "extend", gymId, days: 14 },
      changePlan: { type: "changePlan", gymId, planCode: plans.find((p) => p.code !== currentPlanCode && p.isActive)?.code ?? "" },
      suspend: { type: "suspend", gymId, reason: "" },
      reactivate: { type: "reactivate", gymId },
      cancel: { type: "cancel", gymId, reason: "" },
    };
    form.reset(defaults[next]);
    setMode(next);
  };

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await changeSubscriptionAction(values);
      if (result.ok) {
        toast.success(`${COPY[values.type].title}: done.`);
        setMode(null);
      } else {
        toast.error(result.error);
      }
    })
  );

  const suspendedOrCancelled = gymStatus === "SUSPENDED" || gymStatus === "CANCELLED";
  const errors = form.formState.errors as Partial<Record<"months" | "days" | "planCode" | "reason", { message?: string }>>;
  const copy = mode ? COPY[mode] : null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => open("activate")} disabled={suspendedOrCancelled}>
          Activate
        </Button>
        <Button variant="outline" onClick={() => open("extend")} disabled={gymStatus === "CANCELLED"}>
          Extend
        </Button>
        <Button variant="outline" onClick={() => open("changePlan")}>
          Change plan
        </Button>
        {suspendedOrCancelled ? (
          <Button variant="outline" onClick={() => open("reactivate")}>
            Reactivate
          </Button>
        ) : (
          <Button variant="outline" className="text-destructive" onClick={() => open("suspend")}>
            Suspend
          </Button>
        )}
        {gymStatus !== "CANCELLED" && (
          <Button variant="ghost" className="text-destructive" onClick={() => open("cancel")}>
            Cancel subscription
          </Button>
        )}
      </div>

      <Dialog open={mode !== null} onOpenChange={(o) => !o && !pending && setMode(null)}>
        <DialogContent>
          {copy && (
            <form onSubmit={submit} className="grid gap-4" noValidate>
              <DialogHeader>
                <DialogTitle>{copy.title}</DialogTitle>
                <DialogDescription>{copy.description}</DialogDescription>
              </DialogHeader>
              {mode === "activate" && (
                <div className="grid gap-2">
                  <Label htmlFor="sub-months">Paid months</Label>
                  <NativeSelect id="sub-months" {...form.register("months")}>
                    {[1, 3, 6, 12, 24].map((m) => (
                      <option key={m} value={m}>
                        {m} month{m > 1 ? "s" : ""}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
              {mode === "extend" && (
                <div className="grid gap-2">
                  <Label htmlFor="sub-days">Days to add</Label>
                  <Input id="sub-days" type="number" min={1} max={365} {...form.register("days")} aria-invalid={!!errors.days} />
                  {errors.days && <p className="text-sm text-destructive">{errors.days.message}</p>}
                </div>
              )}
              {mode === "changePlan" && (
                <div className="grid gap-2">
                  <Label htmlFor="sub-planCode">New plan</Label>
                  <NativeSelect id="sub-planCode" {...form.register("planCode")}>
                    {plans
                      .filter((p) => p.isActive)
                      .map((p) => (
                        <option key={p.code} value={p.code} disabled={p.code === currentPlanCode}>
                          {p.name}
                          {p.code === currentPlanCode ? " (current)" : ""}
                        </option>
                      ))}
                  </NativeSelect>
                  {errors.planCode && <p className="text-sm text-destructive">{errors.planCode.message}</p>}
                </div>
              )}
              {(mode === "suspend" || mode === "cancel") && (
                <div className="grid gap-2">
                  <Label htmlFor="sub-reason">Reason (recorded in the subscription history)</Label>
                  <Textarea id="sub-reason" rows={3} {...form.register("reason")} aria-invalid={!!errors.reason} />
                  {errors.reason && <p className="text-sm text-destructive">{errors.reason.message}</p>}
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setMode(null)} disabled={pending}>
                  Back
                </Button>
                <Button type="submit" variant={copy.destructive ? "destructive" : "default"} disabled={pending}>
                  {pending && <Loader2 className="animate-spin" aria-hidden />}
                  {copy.submit}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
