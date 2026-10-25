import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { StatusChip } from "@/components/status-chip";
import { EmptyState, FormError, Skeleton } from "@/components/ui";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { date, dateTime, money } from "@/lib/format";
import { useInvoices, usePayments } from "@/lib/member-queries";

const METHOD = { CASH: "Cash", CARD: "Card", TRANSFER: "Bank transfer / UPI" } as const;
const INVOICE_STATUS = {
  PAID: { label: "Paid", tone: "green" },
  OPEN: { label: "Due", tone: "amber" },
  OVERDUE: { label: "Overdue", tone: "red" },
  VOID: { label: "Void", tone: "zinc" },
} as const;

function Segmented({ value, onChange }: { value: "payments" | "invoices"; onChange: (v: "payments" | "invoices") => void }) {
  return (
    <View accessibilityRole="tablist" className="flex-row rounded-xl bg-zinc-200 p-1 dark:bg-zinc-800">
      {(["payments", "invoices"] as const).map((k) => (
        <Pressable
          key={k}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === k }}
          onPress={() => onChange(k)}
          className={`min-h-10 flex-1 items-center justify-center rounded-lg ${value === k ? "bg-white dark:bg-zinc-950" : ""}`}
        >
          <Text className="text-base font-medium text-zinc-900 dark:text-zinc-50">{k === "payments" ? "Payments" : "Invoices"}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Your payments and invoices (newest first, loads more as you scroll). */
export default function PaymentsScreen() {
  const [tab, setTab] = useState<"payments" | "invoices">("payments");
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const router = useRouter();
  const payments = usePayments();
  const invoices = useInvoices();
  const q = tab === "payments" ? payments : invoices;

  const header = (
    <View className="gap-3 pb-1">
      <Segmented value={tab} onChange={setTab} />
      {q.error ? <FormError message={errorMessage(q.error)} /> : null}
    </View>
  );

  const common = {
    className: "flex-1 bg-zinc-50 dark:bg-zinc-950",
    contentContainerClassName: "gap-2 p-4",
    refreshControl: <RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} />,
    onEndReached: () => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage(),
    onEndReachedThreshold: 0.5,
    ListHeaderComponent: header,
    ListFooterComponent: q.isFetchingNextPage ? <ActivityIndicator className="py-4" /> : null,
  };

  if (q.isPending)
    return (
      <View className="flex-1 gap-3 bg-zinc-50 p-4 dark:bg-zinc-950">
        {header}
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </View>
    );

  if (tab === "payments") {
    return (
      <FlatList
        {...common}
        data={payments.data?.pages.flatMap((p) => p.items) ?? []}
        keyExtractor={(p) => p.id}
        ListEmptyComponent={<EmptyState icon="wallet-outline" title="No payments yet" />}
        renderItem={({ item: p }) => (
          <Pressable
            disabled={!p.invoice}
            accessibilityRole={p.invoice ? "button" : undefined}
            accessibilityLabel={`${money(p.amountMinor, p.currency)} by ${METHOD[p.method]}, ${dateTime(p.receivedAt, tz)}${p.refundedMinor ? `, ${money(p.refundedMinor, p.currency)} refunded` : ""}`}
            onPress={() => p.invoice && router.push({ pathname: "/more/invoice/[invoiceId]", params: { invoiceId: p.invoice.id } })}
            className="flex-row items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 active:opacity-80 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <View className="flex-1">
              <Text className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{money(p.amountMinor, p.currency)}</Text>
              <Text className="text-sm text-zinc-500 dark:text-zinc-400">
                {METHOD[p.method]} · {dateTime(p.receivedAt, tz)}
                {p.invoice ? ` · ${p.invoice.number}` : ""}
              </Text>
              {p.refundedMinor ? <Text className="text-sm text-amber-700 dark:text-amber-400">{money(p.refundedMinor, p.currency)} refunded</Text> : null}
            </View>
          </Pressable>
        )}
      />
    );
  }

  return (
    <FlatList
      {...common}
      data={invoices.data?.pages.flatMap((p) => p.items) ?? []}
      keyExtractor={(i) => i.id}
      ListEmptyComponent={<EmptyState icon="document-text-outline" title="No invoices yet" />}
      renderItem={({ item: i }) => {
        const s = INVOICE_STATUS[i.status];
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Invoice ${i.number}, ${money(i.totalMinor, i.currency)}, ${s.label}`}
            onPress={() => router.push({ pathname: "/more/invoice/[invoiceId]", params: { invoiceId: i.id } })}
            className="flex-row items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 active:opacity-80 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <View className="flex-1">
              <Text className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                {i.number} · {money(i.totalMinor, i.currency)}
              </Text>
              <Text className="text-sm text-zinc-500 dark:text-zinc-400">
                {i.description ?? "Membership"} · due {date(i.dueDate)}
              </Text>
            </View>
            <StatusChip label={s.label} tone={s.tone} />
          </Pressable>
        );
      }}
    />
  );
}
