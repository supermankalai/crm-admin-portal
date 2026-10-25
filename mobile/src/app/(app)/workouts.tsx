import { useState } from "react";
import { Text, View } from "react-native";
import { Screen } from "@/components/screen";
import { StatusChip } from "@/components/status-chip";
import { Button, Card, EmptyState, FormError, Skeleton, TextField } from "@/components/ui";
import { useOnline } from "@/hooks/use-online";
import { useSession } from "@/hooks/use-session";
import { errorMessage } from "@/lib/errors";
import { exerciseLine } from "@/lib/fitness";
import { useCompleteWorkout, useMemberSessions, useMemberWorkouts, type MemberWorkouts } from "@/lib/fitness-queries";
import { dateTime, dayLabel, time } from "@/lib/format";

type Day = MemberWorkouts["plans"][number]["days"][number];

/** The member's plans from their trainer, day by day, with "mark as done" and their PT sessions. */
export default function WorkoutsTab() {
  const { gym } = useSession();
  const tz = gym?.timezone ?? "UTC";
  const q = useMemberWorkouts();
  const sessions = useMemberSessions();
  const upcoming = (sessions.data?.sessions ?? []).filter((s) => s.status === "SCHEDULED");

  return (
    <Screen title="Workouts" onRefresh={() => Promise.all([q.refetch(), sessions.refetch()])}>
      {upcoming.length ? (
        <Card className="gap-2">
          <Text accessibilityRole="header" className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Personal training
          </Text>
          {upcoming.map((s) => (
            <View key={s.id} accessible className="gap-0.5">
              <Text className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                {dayLabel(s.startsAt, tz)} · {time(s.startsAt, tz)}
              </Text>
              <Text className="text-sm text-zinc-500 dark:text-zinc-400">
                With {s.trainer}
                {s.focus ? ` · ${s.focus}` : ""}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      {q.isPending ? (
        [0, 1].map((i) => <Skeleton key={i} className="h-40 w-full" />)
      ) : q.error && !q.data ? (
        <FormError message={errorMessage(q.error)} />
      ) : !q.data?.plans.length ? (
        <EmptyState icon="fitness-outline" title="No workout plan yet" description="When your trainer gives you a plan, it shows up here with every exercise, set and rep." />
      ) : (
        <>
          <Text className="px-1 text-base text-zinc-600 dark:text-zinc-400">
            {q.data.thisWeek === 0 ? "No workouts logged in the last 7 days." : `${q.data.thisWeek} ${q.data.thisWeek === 1 ? "workout" : "workouts"} in the last 7 days — keep it up.`}
          </Text>
          {q.data.plans.map((p) => (
            <View key={p.id} className="gap-3">
              <View className="px-1">
                <Text accessibilityRole="header" className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
                  {p.title}
                </Text>
                <Text className="text-sm text-zinc-500 dark:text-zinc-400">From {p.trainer}</Text>
                {p.notes ? <Text className="mt-1 text-base text-zinc-700 dark:text-zinc-300">{p.notes}</Text> : null}
              </View>
              {p.days.map((d) => (
                <DayCard key={d.id} day={d} tz={tz} />
              ))}
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}

function DayCard({ day, tz }: { day: Day; tz: string }) {
  const online = useOnline();
  const { gym } = useSession();
  const complete = useCompleteWorkout();
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const writable = !!gym?.access.writable;

  const save = () =>
    complete.mutate(
      { dayId: day.id, note },
      {
        onSuccess: () => {
          setDone(true);
          setNoting(false);
          setNote("");
        },
      }
    );

  return (
    <Card className="gap-3">
      <View className="flex-row items-start justify-between gap-2">
        <Text className="flex-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{day.title}</Text>
        {day.timesCompleted ? <StatusChip label={`Done ${day.timesCompleted}×`} tone="green" /> : null}
      </View>
      {day.exercises.map((e, i) => (
        <View key={e.id} accessible className="flex-row gap-3">
          <Text className="w-6 text-base text-zinc-400">{i + 1}.</Text>
          <View className="flex-1">
            <Text className="text-base text-zinc-900 dark:text-zinc-50">{e.name}</Text>
            {exerciseLine(e) ? <Text className="text-sm text-zinc-500 dark:text-zinc-400">{exerciseLine(e)}</Text> : null}
            {e.notes ? <Text className="text-sm italic text-zinc-500 dark:text-zinc-400">{e.notes}</Text> : null}
          </View>
        </View>
      ))}
      {day.lastCompletedAt ? <Text className="text-sm text-zinc-500 dark:text-zinc-400">Last done {dateTime(day.lastCompletedAt, tz)}</Text> : null}
      {done ? (
        <View accessibilityRole="alert" className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950">
          <Text className="text-base text-emerald-900 dark:text-emerald-200">Nice work — logged.</Text>
        </View>
      ) : null}
      <FormError message={complete.error ? errorMessage(complete.error) : null} />
      {noting ? <TextField label="Note (only you and your trainer see it)" value={note} onChangeText={setNote} placeholder="How did it feel?" maxLength={500} multiline /> : null}
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button label="Mark as done" icon="checkmark-done-outline" onPress={save} loading={complete.isPending} disabled={!online || !writable} />
        </View>
        {!noting ? <Button label="Add note" variant="secondary" onPress={() => setNoting(true)} disabled={!online || !writable} /> : null}
      </View>
    </Card>
  );
}
