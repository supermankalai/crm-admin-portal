"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MemberPicker, type PickedMember } from "@/components/members/member-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { addDays } from "@/domain/dates";
import { calculateTax, formatMoney } from "@/domain/money";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, sellMembershipSchema, type SellMembershipFormValues, type SellMembershipInput } from "@/lib/validation/payments";
import { sellMembershipAction, suggestStartDateAction } from "../actions";

type Plan = { id: string; name: string; type: string; priceMinor: number; durationDays: number; classCredits: number | null };

export function SellForm({
  gymSlug,
  plans,
  currency,
  taxRateBps,
  today,
  initialMember,
  initialStart,
}: {
  gymSlug: string;
  plans: Plan[];
  currency: string;
  taxRateBps: number;
  today: string;
  initialMember: PickedMember | null;
  initialStart: string;
}) {
  const router = useRouter();
  const [member, setMember] = useState<PickedMember | null>(initialMember);
  const [pending, startTransition] = useTransition();
  const form = useForm<SellMembershipFormValues, unknown, SellMembershipInput>({
    resolver: zodResolver(sellMembershipSchema),
    defaultValues: { memberId: initialMember?.id ?? "", planId: plans[0]?.id ?? "", startDate: initialStart, payNow: "full", amount: "", method: "CASH", reference: "" },
  });
  const [planId, startDate, payNow, method] = useWatch({ control: form.control, name: ["planId", "startDate", "payNow", "method"] });
  const plan = plans.find((p) => p.id === planId);
  const tax = plan ? calculateTax(plan.priceMinor, taxRateBps) : 0;
  const total = plan ? plan.priceMinor + tax : 0;
  const money = (v: number) => formatMoney(v, currency);
  const errors = form.formState.errors;

  const pickMember = (m: PickedMember | null) => {
    setMember(m);
    form.setValue("memberId", m?.id ?? "", { shouldValidate: !!m });
    if (m) {
      startTransition(async () => {
        const r = await suggestStartDateAction(gymSlug, { memberId: m.id });
        if (r.ok) form.setValue("startDate", r.data);
      });
    }
  };

  const submit = form.handleSubmit(() =>
    startTransition(async () => {
      const r = await sellMembershipAction(gymSlug, form.getValues()); // raw values; the server re-validates
      if (!r.ok) {
        for (const [field, messages] of Object.entries(r.fieldErrors ?? {})) {
          if (messages?.[0]) form.setError(field as keyof SellMembershipFormValues, { message: messages[0] });
        }
        return void toast.error(r.error);
      }
      toast.success(`Membership sold — invoice INV-${String(r.data.invoiceNumber).padStart(6, "0")}.`);
      router.push(`/g/${gymSlug}/invoices/${r.data.invoiceId}`);
    })
  );

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 lg:grid-cols-3">
      <div className="grid gap-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Member</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            <MemberPicker gymSlug={gymSlug} value={member} onChange={pickMember} invalid={!!errors.memberId} />
            {errors.memberId && <p className="text-sm text-destructive">Choose a member</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Membership</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="planId">Plan</Label>
              <NativeSelect id="planId" {...form.register("planId")}>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {money(p.priceMinor)}
                  </option>
                ))}
              </NativeSelect>
              {errors.planId && <p className="text-sm text-destructive">{errors.planId.message}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="startDate">Start date</Label>
              <Input id="startDate" type="date" min={addDays(today, -7)} max={addDays(today, 90)} {...form.register("startDate")} aria-invalid={!!errors.startDate} />
              {errors.startDate ? (
                <p className="text-sm text-destructive">{errors.startDate.message}</p>
              ) : (
                <p className="text-xs text-muted-foreground">Renewals start the day after the current membership ends.</p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="sr-only">Payment now</legend>
              {(
                [
                  ["full", "Paid in full now"],
                  ["partial", "Part payment now"],
                  ["none", "Invoice only (pay later)"],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="flex items-center gap-2">
                  <input type="radio" value={v} {...form.register("payNow")} /> {label}
                </label>
              ))}
            </fieldset>
            {payNow !== "none" && (
              <div className="grid gap-4 sm:grid-cols-3">
                {payNow === "partial" && (
                  <div className="grid gap-2">
                    <Label htmlFor="amount">Amount received ({currency})</Label>
                    <Input id="amount" inputMode="decimal" {...form.register("amount")} aria-invalid={!!errors.amount} />
                    {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="method">Method</Label>
                  <NativeSelect id="method" {...form.register("method")}>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="reference">Reference {method === "TRANSFER" ? "" : "(optional)"}</Label>
                  <Input id="reference" placeholder={method === "TRANSFER" ? "UTR / UPI ref" : method === "CARD" ? "POS slip no." : ""} {...form.register("reference")} aria-invalid={!!errors.reference} />
                  {errors.reference && <p className="text-sm text-destructive">{errors.reference.message}</p>}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {plan && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{plan.name}</span>
                <span className="tabular-nums">{money(plan.priceMinor)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax ({(taxRateBps / 100).toFixed(2)}%)</span>
                <span className="tabular-nums">{money(tax)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{money(total)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Valid {startDate} – {startDate ? addDays(startDate, plan.durationDays - 1) : ""}
                {plan.classCredits ? ` · ${plan.classCredits} classes` : ""}
              </p>
            </>
          )}
          <Button type="submit" className="mt-2" disabled={pending || !plans.length}>
            {pending && <Loader2 className="animate-spin" aria-hidden />} Sell membership
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
