import { useState } from "react";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MEMBERSHIP_STATE, StatusChip } from "@/components/status-chip";
import { Button, Card, EmptyState, FormError, ListRow, Skeleton } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { date, dateTime, money } from "@/lib/format";
import { MEMBER_STATUS } from "@/lib/staff";
import { useInviteToApp, useStaffMember } from "@/lib/staff-queries";

/** A member at a glance: status, memberships, open invoices, payments and visits, plus actions. */
export default function MemberProfile() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const router = useRouter();
  const online = useOnline();
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const q = useStaffMember(memberId);
  const invite = useInviteToApp(memberId);
  const [inviteResult, setInviteResult] = useState<string | null>(null);

  if (q.isPending) {
    return (
      <View className="flex-1 gap-3 bg-zinc-50 p-4 dark:bg-zinc-950">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </View>
    );
  }
  if (!q.data) return <EmptyState icon="person-outline" title="Couldn't load this member" description={errorMessage(q.error)} />;
  const p = q.data;
  const s = MEMBER_STATUS[p.status];

  const sendInvite = (channel: "EMAIL" | "SMS" | "CODE") => {
    setInviteResult(null);
    invite.mutate(channel, {
      onSuccess: (r) => setInviteResult(r.code ? `Invite code: ${r.code}\nAsk the member to enter it in the app under “I have an invite”. It works once.` : `Invite sent to ${r.sentTo ?? "the member"}.`),
    });
  };
  const chooseInvite = () => {
    const options = [
      ...(p.member.email ? [{ text: "Email a link", onPress: () => sendInvite("EMAIL") }] : []),
      ...(p.member.phone ? [{ text: "Text a link", onPress: () => sendInvite("SMS") }] : []),
      { text: "Show a code", onPress: () => sendInvite("CODE") },
      { text: "Cancel", style: "cancel" as const },
    ];
    Alert.alert("Invite to the member app", "They'll set up their own login.", options);
  };

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4 pb-10" refreshControl={undefined}>
      <Card className="gap-2">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1">
            <Text accessibilityRole="header" className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {p.member.name}
            </Text>
            <Text className="text-base text-zinc-500 dark:text-zinc-400">
              #{p.member.memberNumber} · joined {date(p.member.joinedAt.slice(0, 10))}
            </Text>
          </View>
          <StatusChip label={s.label} tone={s.tone} />
        </View>
        <Text className="text-base text-zinc-700 dark:text-zinc-300">
          {p.visits.last30Days} visits in the last 30 days · {p.visits.total} in total
        </Text>
        {p.appAccount ? <Text className="text-sm text-zinc-500 dark:text-zinc-400">{p.appAccount.status === "ACTIVE" ? "Uses the member app" : "Member app access turned off"}</Text> : null}
      </Card>

      <View className="gap-2">
        {p.can.sellMembership ? <Button label={p.status === "none" ? "Sell a membership" : "Renew / sell membership"} icon="card-outline" onPress={() => router.push({ pathname: "/members/sell", params: { memberId } })} disabled={!online} /> : null}
        {p.can.inviteToApp ? <Button label="Invite to the member app" variant="secondary" icon="phone-portrait-outline" onPress={chooseInvite} loading={invite.isPending} disabled={!online} /> : null}
        <FormError message={invite.error ? errorMessage(invite.error) : null} />
        {inviteResult ? (
          <View accessibilityRole="alert" className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950">
            <Text selectable className="text-base text-emerald-900 dark:text-emerald-200">
              {inviteResult}
            </Text>
          </View>
        ) : null}
      </View>

      {p.openInvoices && p.openInvoices.length ? (
        <Section title="Open invoices">
          {p.openInvoices.map((i) => (
            <ListRow
              key={i.id}
              icon="document-text-outline"
              title={`${i.number} · ${money(i.totalMinor - i.amountPaidMinor, p.currency)} due`}
              subtitle={`${i.overdue ? "Overdue since" : "Due"} ${date(i.dueDate)}`}
              right={i.overdue ? <StatusChip label="Overdue" tone="red" /> : undefined}
              onPress={p.can.recordPayment ? () => router.push({ pathname: "/members/pay", params: { memberId, invoiceId: i.id, number: i.number, due: String(i.totalMinor - i.amountPaidMinor), currency: p.currency } }) : undefined}
              accessibilityHint={p.can.recordPayment ? "Record a payment" : undefined}
            />
          ))}
        </Section>
      ) : null}

      <Section title="Memberships">
        {p.memberships.length === 0 ? (
          <Text className="p-4 text-base text-zinc-500 dark:text-zinc-400">No memberships yet.</Text>
        ) : (
          p.memberships.map((m) => {
            const st = MEMBERSHIP_STATE[m.state] ?? { label: m.state, tone: "zinc" as const };
            return (
              <ListRow
                key={m.id}
                title={m.planName}
                subtitle={`${date(m.startDate)} – ${date(m.endDate)}${m.classCreditsRemaining !== null ? ` · ${m.classCreditsRemaining} credits left` : ""}`}
                right={<StatusChip label={st.label} tone={st.tone} />}
              />
            );
          })
        )}
      </Section>

      <Section title="Contact">
        {p.member.phone ? <ListRow icon="call-outline" title={p.member.phone} onPress={() => Linking.openURL(`tel:${p.member.phone}`)} accessibilityHint="Calls the member" /> : null}
        {p.member.email ? <ListRow icon="mail-outline" title={p.member.email} onPress={() => Linking.openURL(`mailto:${p.member.email}`)} accessibilityHint="Writes an email" /> : null}
        {p.member.address ? <ListRow icon="home-outline" title={p.member.address} /> : null}
        {p.member.emergencyContact ? (
          <ListRow
            icon="medkit-outline"
            title={`Emergency: ${p.member.emergencyContact.name}${p.member.emergencyContact.relation ? ` (${p.member.emergencyContact.relation})` : ""}`}
            subtitle={p.member.emergencyContact.phone ?? undefined}
            onPress={p.member.emergencyContact.phone ? () => Linking.openURL(`tel:${p.member.emergencyContact!.phone}`) : undefined}
          />
        ) : null}
        {!p.member.phone && !p.member.email && !p.member.address && !p.member.emergencyContact ? <Text className="p-4 text-base text-zinc-500 dark:text-zinc-400">No contact details.</Text> : null}
      </Section>

      {p.payments ? (
        <Section title="Recent payments">
          {p.payments.length === 0 ? (
            <Text className="p-4 text-base text-zinc-500 dark:text-zinc-400">No payments yet.</Text>
          ) : (
            p.payments.map((x) => (
              <ListRow
                key={x.id}
                title={money(x.amountMinor, p.currency)}
                subtitle={`${dateTime(x.receivedAt, tz)} · ${x.method.toLowerCase()}${x.invoiceNumber ? ` · ${x.invoiceNumber}` : ""}`}
                right={x.refundedMinor ? <StatusChip label={x.refundedMinor >= x.amountMinor ? "Refunded" : "Part refunded"} tone="zinc" /> : undefined}
              />
            ))
          )}
        </Section>
      ) : null}

      <Section title="Recent visits">
        {p.recentCheckIns.length === 0 ? (
          <Text className="p-4 text-base text-zinc-500 dark:text-zinc-400">No visits yet.</Text>
        ) : (
          p.recentCheckIns.map((c) => <ListRow key={c.id} title={dateTime(c.checkedInAt, tz)} subtitle={c.location} right={<StatusChip label={c.allowed ? "Allowed" : "Denied"} tone={c.allowed ? "green" : "red"} />} />)
        )}
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="px-1 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {title}
      </Text>
      <View className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">{children}</View>
    </View>
  );
}
