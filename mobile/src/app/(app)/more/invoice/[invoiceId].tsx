import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { StatusChip } from "@/components/status-chip";
import { Card, FormError, Skeleton } from "@/components/ui";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { date, dateTime, money } from "@/lib/format";
import { useInvoice } from "@/lib/member-queries";

const STATUS = { PAID: { label: "Paid", tone: "green" }, OPEN: { label: "Due", tone: "amber" }, OVERDUE: { label: "Overdue", tone: "red" }, VOID: { label: "Void", tone: "zinc" } } as const;
const METHOD = { CASH: "Cash", CARD: "Card", TRANSFER: "Bank transfer / UPI" } as const;

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View className="flex-row justify-between py-1">
      <Text className={`text-base ${strong ? "font-semibold text-zinc-900 dark:text-zinc-50" : "text-zinc-600 dark:text-zinc-400"}`}>{label}</Text>
      <Text className={`text-base tabular-nums ${strong ? "font-semibold text-zinc-900 dark:text-zinc-50" : "text-zinc-900 dark:text-zinc-100"}`}>{value}</Text>
    </View>
  );
}

/** One of your invoices with its payments. */
export default function InvoiceScreen() {
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const q = useInvoice(invoiceId);
  const i = q.data;

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4">
      {q.isPending ? (
        <Card className="gap-2">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton />
          <Skeleton />
        </Card>
      ) : q.error || !i ? (
        <FormError message={errorMessage(q.error)} />
      ) : (
        <>
          <Card className="gap-1">
            <View className="flex-row items-start justify-between">
              <View>
                <Text accessibilityRole="header" className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                  {i.number}
                </Text>
                <Text className="text-sm text-zinc-500 dark:text-zinc-400">
                  Issued {dateTime(i.issuedAt, tz)} · due {date(i.dueDate)}
                </Text>
              </View>
              <StatusChip label={STATUS[i.status].label} tone={STATUS[i.status].tone} />
            </View>
            <Text className="mt-2 text-base text-zinc-700 dark:text-zinc-300">{i.description ?? "Membership"}</Text>
          </Card>
          <Card>
            <Row label="Subtotal" value={money(i.subtotalMinor, i.currency)} />
            <Row label="Tax" value={money(i.taxMinor, i.currency)} />
            <Row label="Total" value={money(i.totalMinor, i.currency)} strong />
            <Row label="Paid" value={money(i.amountPaidMinor, i.currency)} />
            {i.totalMinor > i.amountPaidMinor && i.status !== "VOID" ? <Row label="Still to pay" value={money(i.totalMinor - i.amountPaidMinor, i.currency)} strong /> : null}
          </Card>
          {i.payments.length ? (
            <Card className="gap-2">
              <Text className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Payments</Text>
              {i.payments.map((p) => (
                <View key={p.id} className="flex-row justify-between">
                  <Text className="text-base text-zinc-600 dark:text-zinc-400">
                    {dateTime(p.receivedAt, tz)} · {METHOD[p.method]}
                  </Text>
                  <Text className="text-base tabular-nums text-zinc-900 dark:text-zinc-100">{money(p.amountMinor, p.currency)}</Text>
                </View>
              ))}
            </Card>
          ) : null}
          <Card className="gap-0.5">
            <Text className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{i.gym.name}</Text>
            {i.gym.address ? <Text className="text-sm text-zinc-500 dark:text-zinc-400">{i.gym.address}</Text> : null}
            {i.gym.email ? <Text className="text-sm text-zinc-500 dark:text-zinc-400">{i.gym.email}</Text> : null}
            {i.gym.phone ? <Text className="text-sm text-zinc-500 dark:text-zinc-400">{i.gym.phone}</Text> : null}
          </Card>
        </>
      )}
    </ScrollView>
  );
}
