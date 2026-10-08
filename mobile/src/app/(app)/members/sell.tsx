import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { priceMembershipSale, renewalStartDate } from "@fitcrm/shared/domain/billing";
import { isDateString } from "@fitcrm/shared/domain/dates";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, sellMembershipSchema } from "@fitcrm/shared/validation/payments";
import { Button, Card, ChipGroup, EmptyState, FormError, Skeleton, TextField } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { errorMessage, fieldErrorsOf } from "@/lib/errors";
import { date, localDay, money } from "@/lib/format";
import { useSellMembership, useStaffMember, useStaffPlans, type StaffMemberProfile } from "@/lib/staff-queries";

type Values = z.input<typeof sellMembershipSchema>;
const METHODS = PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }));
const PAY_NOW = [
  { value: "full", label: "Paid in full" },
  { value: "partial", label: "Part payment" },
  { value: "none", label: "Pay later" },
] as const;

/** Sell or renew: pick a plan, see the price with tax, and take payment now or later. */
export default function SellMembership() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const plans = useStaffPlans();
  const member = useStaffMember(memberId);
  const { gym } = useSession();
  const [today] = useState(() => localDay(new Date().toISOString(), gym?.timezone ?? "UTC"));
  // Render the form once the member is known, so the start date defaults to the day after their
  // current membership ends (a renewal never overlaps).
  if (plans.isPending || member.isPending) {
    return (
      <View className="flex-1 gap-3 bg-zinc-50 p-4 dark:bg-zinc-950">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </View>
    );
  }
  if (!plans.data || !member.data) return <EmptyState icon="card-outline" title="Couldn't load plans" description={errorMessage(plans.error ?? member.error)} />;
  if (plans.data.plans.length === 0) return <EmptyState icon="card-outline" title="No plans to sell" description="Create a membership plan in the web portal first." />;
  return <SellForm memberId={memberId} profile={member.data} plans={plans.data} today={today} />;
}

function SellForm({ memberId, profile, plans, today }: { memberId: string; profile: StaffMemberProfile; plans: NonNullable<ReturnType<typeof useStaffPlans>["data"]>; today: string }) {
  const router = useRouter();
  const online = useOnline();
  const sell = useSellMembership();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const latestEnd = profile.memberships.filter((m) => m.state === "active" || m.state === "frozen" || m.state === "upcoming").reduce<string | null>((acc, m) => (!acc || m.endDate > acc ? m.endDate : acc), null);
  const form = useForm<Values, unknown, z.output<typeof sellMembershipSchema>>({
    resolver: zodResolver(sellMembershipSchema),
    defaultValues: { memberId, planId: plans.plans[0].id, startDate: renewalStartDate(today, latestEnd), payNow: "full", amount: "", method: "CASH", reference: "" },
  });
  const [planId, startDate, payNow, method] = useWatch({ control: form.control, name: ["planId", "startDate", "payNow", "method"] });
  const plan = plans.plans.find((p) => p.id === planId) ?? plans.plans[0];
  const price = isDateString(startDate) ? priceMembershipSale(plan, plans.taxRateBps, startDate, today) : null;

  const submit = form.handleSubmit(async () => {
    setError(null);
    try {
      const r = await sell.mutateAsync(form.getValues());
      setDone(`${plan.name} sold, ${date(r.startDate)} – ${date(r.endDate)}. Invoice ${r.invoiceNumber}: ${money(r.paidMinor, plans.currency)} of ${money(r.totalMinor, plans.currency)} paid.`);
    } catch (e) {
      for (const [k, v] of Object.entries(fieldErrorsOf(e))) form.setError(k as keyof Values, { message: v });
      setError(errorMessage(e));
    }
  });

  if (done) {
    return (
      <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4">
        <View accessibilityRole="alert" className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950">
          <Text className="text-base text-emerald-900 dark:text-emerald-200">{done}</Text>
        </View>
        <Button label="Back to member" onPress={() => router.dismissTo({ pathname: "/members/[memberId]", params: { memberId } })} />
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled">
      <Text className="text-base text-zinc-600 dark:text-zinc-400">For {profile.member.name}</Text>
      <Controller
        control={form.control}
        name="planId"
        render={({ field: f }) => <ChipGroup label="Plan" options={plans.plans.map((p) => ({ value: p.id, label: `${p.name} · ${money(p.priceMinor, plans.currency)}` }))} value={f.value} onChange={f.onChange} />}
      />
      <Controller
        control={form.control}
        name="startDate"
        render={({ field: f, fieldState }) => <TextField label="Start date" value={f.value} onChangeText={f.onChange} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" error={fieldState.error?.message} />}
      />
      {price ? (
        <Card className="gap-1">
          <Text className="text-base text-zinc-700 dark:text-zinc-300">
            {date(price.startDate)} – {date(price.endDate)}
            {price.classCredits !== null ? ` · ${price.classCredits} classes` : ""}
          </Text>
          <Text className="text-sm text-zinc-500 dark:text-zinc-400">
            {money(price.subtotalMinor, plans.currency)} + tax {money(price.taxMinor, plans.currency)}
          </Text>
          <Text className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{money(price.totalMinor, plans.currency)}</Text>
        </Card>
      ) : null}
      <Controller control={form.control} name="payNow" render={({ field: f }) => <ChipGroup label="Payment" options={PAY_NOW} value={f.value} onChange={f.onChange} />} />
      {payNow === "partial" ? (
        <Controller
          control={form.control}
          name="amount"
          render={({ field: f, fieldState }) => <TextField label={`Amount received (${plans.currency})`} value={f.value} onChangeText={f.onChange} keyboardType="decimal-pad" error={fieldState.error?.message} />}
        />
      ) : null}
      {payNow !== "none" ? (
        <>
          <Controller control={form.control} name="method" render={({ field: f }) => <ChipGroup label="Method" options={METHODS} value={f.value} onChange={f.onChange} />} />
          <Controller
            control={form.control}
            name="reference"
            render={({ field: f, fieldState }) => (
              <TextField label={method === "TRANSFER" ? "Transfer / UPI reference" : "Reference (optional)"} value={f.value} onChangeText={f.onChange} autoCapitalize="characters" error={fieldState.error?.message} />
            )}
          />
        </>
      ) : null}
      <FormError message={error} />
      {!online ? <FormError message="You're offline. Selling needs a connection." /> : null}
      <Button label={price ? `Sell for ${money(price.totalMinor, plans.currency)}` : "Sell membership"} icon="card-outline" onPress={submit} loading={sell.isPending} disabled={!online} />
    </ScrollView>
  );
}
