import { useState, type ReactNode } from "react";
import { Linking, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { usePreventScreenCapture } from "expo-screen-capture";
import { progressSummary, seriesFor } from "@fitcrm/shared/domain/progress";
import { ProgressChart } from "@/components/progress-chart";
import { StatusChip } from "@/components/status-chip";
import { Button, Card, EmptyState, FormError, ListRow, Skeleton, TextField } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { absoluteUrl } from "@/lib/config";
import { errorMessage } from "@/lib/errors";
import { changeText, formatValue, PT_STATUS } from "@/lib/fitness";
import { useAddNote, useTrainerClient } from "@/lib/fitness-queries";
import { date, dateTime, dayLabel, time } from "@/lib/format";
import { MEMBER_STATUS } from "@/lib/staff";

/**
 * A client for their trainer: membership and visits, progress and photos, plans, workouts done,
 * PT sessions and private notes. Sensitive: memory only, screenshots blocked.
 */
export default function ClientDetail() {
  usePreventScreenCapture();
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const router = useRouter();
  const online = useOnline();
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const writable = !!gym?.access.writable;
  const q = useTrainerClient(memberId);
  const addNote = useAddNote(memberId);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<{ url: string; takenOn: string } | null>(null);

  if (q.isPending) {
    return (
      <View className="flex-1 gap-3 bg-zinc-50 p-4 dark:bg-zinc-950">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </View>
    );
  }
  if (!q.data) return <EmptyState icon="person-outline" title="Couldn't load this client" description={errorMessage(q.error)} />;
  const c = q.data;
  const s = MEMBER_STATUS[c.status];
  const summary = progressSummary(c.progress);
  const weight = seriesFor(c.progress, "weightKg");
  const upcoming = c.sessions.filter((x) => x.status === "SCHEDULED");
  const past = c.sessions.filter((x) => x.status !== "SCHEDULED").reverse();

  return (
    <ScrollView className="flex-1 bg-zinc-50 dark:bg-zinc-950" contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled">
      <Card className="gap-2">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1">
            <Text accessibilityRole="header" className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {c.member.name}
            </Text>
            <Text className="text-base text-zinc-500 dark:text-zinc-400">
              #{c.member.memberNumber}
              {c.membership ? ` · ${c.membership.planName} until ${date(c.membership.endDate)}` : ""}
            </Text>
          </View>
          <StatusChip label={s.label} tone={s.tone} />
        </View>
        <Text className="text-base text-zinc-700 dark:text-zinc-300">
          {c.visits.last30Days} visits in 30 days{c.visits.lastVisit ? ` · last ${dayLabel(c.visits.lastVisit, tz)}` : ""}
        </Text>
        {!c.isMyClient ? <Text className="text-sm text-zinc-500 dark:text-zinc-400">You&apos;re viewing as a manager. Progress photos are visible to the client&apos;s own trainers only.</Text> : null}
      </Card>

      {c.isMyClient ? (
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button label="Book PT" icon="calendar-outline" onPress={() => router.push({ pathname: "/clients/session", params: { memberId, name: c.member.name } })} disabled={!online || !writable} />
          </View>
          <View className="flex-1">
            <Button label="New plan" variant="secondary" icon="clipboard-outline" onPress={() => router.push({ pathname: "/plans/edit", params: { memberId, memberName: c.member.name } })} disabled={!online || !writable} />
          </View>
        </View>
      ) : null}
      {c.member.phone ? <Button label={`Call ${c.member.phone}`} variant="ghost" icon="call-outline" onPress={() => Linking.openURL(`tel:${c.member.phone}`)} /> : null}

      <Section title="Progress">
        {summary.length === 0 ? (
          <Text className="p-4 text-base text-zinc-500 dark:text-zinc-400">No measurements logged yet.</Text>
        ) : (
          <View className="gap-3 p-4">
            {summary.map((m) => (
              <Text key={m.key} className="text-base text-zinc-800 dark:text-zinc-200">
                {m.label}: <Text className="font-semibold">{formatValue(m.key, m.latest)}</Text>
                {m.change !== null ? <Text className="text-zinc-500 dark:text-zinc-400">{`  (${changeText(m.key, m.change)} since ${date(m.since)})`}</Text> : null}
              </Text>
            ))}
            {weight.length > 1 ? <ProgressChart points={weight} unit="kg" label="Weight" /> : null}
          </View>
        )}
      </Section>

      {c.photos?.length ? (
        <Section title="Photos">
          <View className="flex-row flex-wrap gap-2 p-3">
            {c.photos.map((p) => (
              <Pressable key={p.id} accessibilityRole="imagebutton" accessibilityLabel={`Progress photo from ${date(p.takenOn)}`} onPress={() => setPhoto(p)} className="w-[31%] overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800">
                <Image source={{ uri: absoluteUrl(p.url)! }} style={{ width: "100%", aspectRatio: 3 / 4 }} contentFit="cover" cachePolicy="memory" accessibilityIgnoresInvertColors />
                <Text className="px-1.5 py-1 text-xs text-zinc-600 dark:text-zinc-300">{date(p.takenOn)}</Text>
              </Pressable>
            ))}
          </View>
        </Section>
      ) : null}

      <Section title="Workout plans">
        {c.plans.length === 0 ? (
          <Text className="p-4 text-base text-zinc-500 dark:text-zinc-400">No plans yet.</Text>
        ) : (
          c.plans.map((p) => (
            <ListRow
              key={p.id}
              title={p.title}
              subtitle={`${p.dayCount} ${p.dayCount === 1 ? "day" : "days"} · updated ${dayLabel(p.updatedAt, tz)}`}
              right={<StatusChip label={p.status === "ACTIVE" ? "Active" : p.status === "DRAFT" ? "Draft" : "Archived"} tone={p.status === "ACTIVE" ? "green" : "zinc"} />}
              onPress={() => router.push({ pathname: "/plans/[planId]", params: { planId: p.id } })}
            />
          ))
        )}
      </Section>

      <Section title="Workouts done">
        {c.completions.length === 0 ? (
          <Text className="p-4 text-base text-zinc-500 dark:text-zinc-400">None logged yet.</Text>
        ) : (
          c.completions.map((x) => <ListRow key={x.id} icon="checkmark-done-outline" title={`${x.plan} · ${x.day}`} subtitle={`${dateTime(x.completedAt, tz)}${x.note ? ` — “${x.note}”` : ""}`} />)
        )}
      </Section>

      <Section title="PT sessions">
        {c.sessions.length === 0 ? (
          <Text className="p-4 text-base text-zinc-500 dark:text-zinc-400">No sessions in the last 30 days.</Text>
        ) : (
          [...upcoming, ...past].map((x) => (
            <ListRow
              key={x.id}
              title={`${dayLabel(x.startsAt, tz)} ${time(x.startsAt, tz)}`}
              subtitle={[x.focus, `with ${x.trainer}`].filter(Boolean).join(" · ")}
              right={<StatusChip label={PT_STATUS[x.status].label} tone={PT_STATUS[x.status].tone} />}
            />
          ))
        )}
      </Section>

      <Section title="Private notes">
        <View className="gap-3 p-4">
          <Text className="text-sm text-zinc-500 dark:text-zinc-400">Only you and the gym&apos;s managers can read these — never the client.</Text>
          {c.notes.map((n) => (
            <View key={n.id} className="gap-0.5 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800">
              <Text className="text-base text-zinc-900 dark:text-zinc-50">{n.body}</Text>
              <Text className="text-xs text-zinc-500 dark:text-zinc-400">
                {n.mine ? "You" : n.author} · {dateTime(n.createdAt, tz)}
              </Text>
            </View>
          ))}
          {c.isMyClient || gym?.role === "OWNER" || gym?.role === "MANAGER" ? (
            <>
              <TextField label="Add a note" value={note} onChangeText={setNote} multiline maxLength={2000} placeholder="Injuries, goals, how sessions are going…" />
              <FormError message={addNote.error ? errorMessage(addNote.error) : null} />
              <Button label="Save note" variant="secondary" onPress={() => addNote.mutate(note.trim(), { onSuccess: () => setNote("") })} loading={addNote.isPending} disabled={!online || !writable || !note.trim()} />
            </>
          ) : null}
        </View>
      </Section>

      <Modal visible={!!photo} animationType="fade" onRequestClose={() => setPhoto(null)}>
        {photo ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Close photo" onPress={() => setPhoto(null)} className="flex-1 bg-black p-4">
            <Image source={{ uri: absoluteUrl(photo.url)! }} style={{ flex: 1 }} contentFit="contain" cachePolicy="memory" accessibilityIgnoresInvertColors />
            <Text className="py-3 text-center text-base text-white">{date(photo.takenOn)} · tap to close</Text>
          </Pressable>
        ) : null}
      </Modal>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="px-1 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {title}
      </Text>
      <View className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">{children}</View>
    </View>
  );
}
