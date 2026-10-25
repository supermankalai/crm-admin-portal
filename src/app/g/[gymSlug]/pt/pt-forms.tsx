"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useForm, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarPlus, Check, Loader2, Pencil, UserMinus, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { LineChart } from "@/components/charts/line-chart";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MemberPicker, type PickedMember } from "@/components/members/member-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { MEASUREMENTS, seriesFor, type MeasurementKey, type ProgressPoint } from "@/domain/progress";
import { PT_GOAL_LABELS, PT_GOALS, PT_SESSION_MINUTES, type PtGoal, type PtTargets } from "@/domain/pt";
import { assignTrainerSchema, bookPtSessionSchema, updateGoalSchema } from "@/lib/validation/pt";
import { addPtNoteAction, assignTrainerAction, bookPtSessionAction, endAssignmentAction, ptSessionStatusAction, updateGoalAction } from "./actions";

type Trainer = { id: string; name: string; clients?: number };
type ActionResult = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-sm text-destructive">{message}</p> : null;
}

/** Show a failed action: field messages on the form, the summary as a toast. */
function report(r: ActionResult, setError?: (field: string, message: string) => void) {
  if (r.ok) return true;
  for (const [f, m] of Object.entries(r.fieldErrors ?? {})) if (m?.[0]) setError?.(f, m[0]);
  toast.error(r.error);
  return false;
}

// ─────────────────────────────── Goal and targets ───────────────────────────────

type GoalValues = { goal: PtGoal | ""; targetWeightKg: string; targetBodyFatPct: string; targetDate: string; note: string };

function goalDefaults(goal: PtGoal | null = null, t: PtTargets | null = null): GoalValues {
  return {
    goal: goal ?? "",
    targetWeightKg: t?.targetWeightKg?.toString() ?? "",
    targetBodyFatPct: t?.targetBodyFatPct?.toString() ?? "",
    targetDate: t?.targetDate ?? "",
    note: t?.note ?? "",
  };
}

function GoalFields<T extends GoalValues>({ register, errors, idPrefix }: { register: UseFormRegister<T>; errors: FieldErrors<T>; idPrefix: string }) {
  const reg = register as unknown as UseFormRegister<GoalValues>;
  const err = errors as FieldErrors<GoalValues>;
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-goal`}>Goal</Label>
        <NativeSelect id={`${idPrefix}-goal`} {...reg("goal")}>
          <option value="">No goal yet</option>
          {PT_GOALS.map((g) => (
            <option key={g} value={g}>
              {PT_GOAL_LABELS[g]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-weight`}>Target weight (kg)</Label>
          <Input id={`${idPrefix}-weight`} inputMode="decimal" {...reg("targetWeightKg")} aria-invalid={!!err.targetWeightKg} />
          <FieldError message={err.targetWeightKg?.message} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-fat`}>Target body fat (%)</Label>
          <Input id={`${idPrefix}-fat`} inputMode="decimal" {...reg("targetBodyFatPct")} aria-invalid={!!err.targetBodyFatPct} />
          <FieldError message={err.targetBodyFatPct?.message} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-date`}>Target date</Label>
          <Input id={`${idPrefix}-date`} type="date" {...reg("targetDate")} aria-invalid={!!err.targetDate} />
          <FieldError message={err.targetDate?.message} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-note`}>Goal note</Label>
        <Textarea id={`${idPrefix}-note`} rows={2} placeholder="e.g. Knee injury in 2024: no deep squats yet" {...reg("note")} aria-invalid={!!err.note} />
        <p className="text-xs text-muted-foreground">Targets and notes are health data and stored encrypted. The trainer and managers can see them.</p>
        <FieldError message={err.note?.message} />
      </div>
    </>
  );
}

// ─────────────────────────────── Assign ───────────────────────────────

/** Assign a trainer to a member. Fix either side (from a member's page or a trainer's) or pick both. */
export function AssignTrainerDialog({
  gymSlug,
  trainers,
  member,
  trainerId,
  trigger,
}: {
  gymSlug: string;
  trainers: Trainer[];
  member?: { id: string; name: string };
  trainerId?: string;
  trigger?: (open: () => void) => ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedMember | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.input<typeof assignTrainerSchema>, unknown, z.output<typeof assignTrainerSchema>>({
    resolver: zodResolver(assignTrainerSchema),
    defaultValues: { memberId: member?.id ?? "", trainerId: trainerId ?? trainers[0]?.id ?? "", ...goalDefaults() },
  });
  const close = (o: boolean) => {
    if (pending) return;
    setOpen(o);
    if (!o) {
      form.reset();
      setPicked(null);
    }
  };
  const errors = form.formState.errors;

  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <Button onClick={() => setOpen(true)} disabled={trainers.length === 0}>
          <UserPlus aria-hidden /> Assign trainer
        </Button>
      )}
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-xl">
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit((values) =>
              startTransition(async () => {
                const r = await assignTrainerAction(gymSlug, form.getValues());
                if (!report(r, (f, m) => form.setError(f as "memberId", { message: m }))) return;
                const name = member?.name ?? picked?.name ?? "The member";
                toast.success(`${name} assigned to ${trainers.find((t) => t.id === values.trainerId)?.name ?? "the trainer"}. Both have been notified.`);
                close(false);
                router.refresh();
              })
            )}
          >
            <DialogHeader>
              <DialogTitle>Assign a personal trainer</DialogTitle>
              <DialogDescription>The member (in the member app) and the trainer are notified straight away.</DialogDescription>
            </DialogHeader>
            {!member && (
              <div className="grid gap-2">
                <Label htmlFor="member-picker">Member</Label>
                <MemberPicker
                  gymSlug={gymSlug}
                  value={picked}
                  invalid={!!errors.memberId}
                  onChange={(m) => {
                    setPicked(m);
                    form.setValue("memberId", m?.id ?? "", { shouldValidate: !!m });
                  }}
                />
                <FieldError message={errors.memberId ? "Choose a member." : undefined} />
              </div>
            )}
            {member && (
              <p className="text-sm">
                Member: <span className="font-medium">{member.name}</span>
              </p>
            )}
            {!trainerId && (
              <div className="grid gap-2">
                <Label htmlFor="assign-trainer">Trainer</Label>
                <NativeSelect id="assign-trainer" {...form.register("trainerId")} aria-invalid={!!errors.trainerId}>
                  {trainers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.clients !== undefined ? ` (${t.clients} client${t.clients === 1 ? "" : "s"})` : ""}
                    </option>
                  ))}
                </NativeSelect>
                <FieldError message={errors.trainerId?.message} />
              </div>
            )}
            <GoalFields register={form.register} errors={errors} idPrefix="assign" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />} Assign and notify
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─────────────────────────────── Edit goal / end ───────────────────────────────

export function EditGoalDialog({ gymSlug, assignmentId, trainerName, goal, targets }: { gymSlug: string; assignmentId: string; trainerName: string; goal: PtGoal | null; targets: PtTargets | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.input<typeof updateGoalSchema>, unknown, z.output<typeof updateGoalSchema>>({
    resolver: zodResolver(updateGoalSchema),
    defaultValues: { assignmentId, ...goalDefaults(goal, targets) },
  });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil aria-hidden /> Edit goal
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-xl">
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit(() =>
              startTransition(async () => {
                const r = await updateGoalAction(gymSlug, form.getValues());
                if (!report(r, (f, m) => form.setError(f as "goal", { message: m }))) return;
                toast.success("Goal saved.");
                setOpen(false);
                router.refresh();
              })
            )}
          >
            <DialogHeader>
              <DialogTitle>Goal with {trainerName}</DialogTitle>
              <DialogDescription>Progress toward the targets is worked out from the member&apos;s measurements.</DialogDescription>
            </DialogHeader>
            <GoalFields register={form.register} errors={form.formState.errors} idPrefix="goal" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />} Save goal
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EndAssignmentButton({ gymSlug, assignmentId, memberName, trainerName }: { gymSlug: string; assignmentId: string; memberName: string; trainerName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <UserMinus aria-hidden /> End
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End personal training?</DialogTitle>
            <DialogDescription>
              {trainerName} will no longer coach {memberName} and loses access to their progress. Future PT sessions between them are cancelled. Both are notified, and the
              assignment stays in the history.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="end-reason">Reason (optional)</Label>
            <Input id="end-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Goal reached, switching trainer" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await endAssignmentAction(gymSlug, { assignmentId, reason });
                  if (!report(r)) return;
                  const n = r.ok ? r.data.cancelledSessions : 0;
                  toast.success(n ? `Ended. ${n} upcoming session${n === 1 ? "" : "s"} cancelled.` : "Personal training ended.");
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />} End assignment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─────────────────────────────── Sessions ───────────────────────────────

/** Book a PT session. Managers pick the trainer; for a trainer it's always themselves. */
export function BookSessionDialog({
  gymSlug,
  today,
  trainers,
  member,
  defaultTrainerId,
  canComplimentary = false,
  canBookOnline = false,
  creditsLeft,
}: {
  gymSlug: string;
  today: string;
  /** Empty for trainers booking their own sessions. */
  trainers: Trainer[];
  member?: { id: string; name: string };
  defaultTrainerId?: string;
  /** Owners and managers may book without a package credit. */
  canComplimentary?: boolean;
  /** The plan includes live sessions: offer an online (video call) session. */
  canBookOnline?: boolean;
  /** Credits the (fixed) client has left, to show while booking. */
  creditsLeft?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedMember | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.input<typeof bookPtSessionSchema>, unknown, z.output<typeof bookPtSessionSchema>>({
    resolver: zodResolver(bookPtSessionSchema),
    defaultValues: {
      trainerId: trainers.length ? (defaultTrainerId ?? trainers[0].id) : undefined,
      memberId: member?.id ?? "",
      date: today,
      startTime: "07:00",
      durationMinutes: PT_SESSION_MINUTES.default,
      focus: "",
      complimentary: false,
      deliveryMode: "IN_PERSON",
    },
  });
  const errors = form.formState.errors;
  const close = (o: boolean) => {
    if (pending) return;
    setOpen(o);
    if (!o) {
      form.reset();
      setPicked(null);
    }
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <CalendarPlus aria-hidden /> Book session
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit(() =>
              startTransition(async () => {
                const r = await bookPtSessionAction(gymSlug, form.getValues());
                if (!report(r, (f, m) => form.setError(f as "date", { message: m }))) return;
                const credit = r.ok ? r.data.credit : null;
                toast.success(
                  credit
                    ? `Session booked using ${credit.packageName} (${credit.remainingAfter} left). The member has been notified.`
                    : r.ok && r.data.complimentary
                      ? "Complimentary session booked. The member has been notified."
                      : "Session booked (not covered by a package). The member has been notified."
                );
                close(false);
                router.refresh();
              })
            )}
          >
            <DialogHeader>
              <DialogTitle>Book a PT session</DialogTitle>
              <DialogDescription>The trainer&apos;s classes and sessions and the client&apos;s other sessions are checked for clashes.</DialogDescription>
            </DialogHeader>
            {member ? (
              <p className="text-sm">
                Client: <span className="font-medium">{member.name}</span>
              </p>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="member-picker">Client</Label>
                <MemberPicker
                  gymSlug={gymSlug}
                  value={picked}
                  invalid={!!errors.memberId}
                  onChange={(m) => {
                    setPicked(m);
                    form.setValue("memberId", m?.id ?? "", { shouldValidate: !!m });
                  }}
                />
                <FieldError message={errors.memberId ? "Choose a client." : undefined} />
              </div>
            )}
            {trainers.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="book-trainer">Trainer</Label>
                <NativeSelect id="book-trainer" {...form.register("trainerId")}>
                  {trainers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
                <FieldError message={errors.trainerId?.message} />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="book-date">Date</Label>
                <Input id="book-date" type="date" min={today} {...form.register("date")} aria-invalid={!!errors.date} />
                <FieldError message={errors.date?.message} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="book-time">Start</Label>
                <Input id="book-time" type="time" {...form.register("startTime")} aria-invalid={!!errors.startTime} />
                <FieldError message={errors.startTime?.message} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="book-length">Minutes</Label>
                <Input id="book-length" type="number" min={PT_SESSION_MINUTES.min} max={PT_SESSION_MINUTES.max} step={15} {...form.register("durationMinutes")} aria-invalid={!!errors.durationMinutes} />
                <FieldError message={errors.durationMinutes?.message} />
              </div>
            </div>
            {canBookOnline && (
              <div className="grid gap-2">
                <Label htmlFor="book-mode">Where</Label>
                <NativeSelect id="book-mode" {...form.register("deliveryMode")}>
                  <option value="IN_PERSON">In person</option>
                  <option value="ONLINE">Online (video call in the app)</option>
                </NativeSelect>
                <FieldError message={errors.deliveryMode?.message} />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="book-focus">Focus (optional)</Label>
              <Input id="book-focus" maxLength={120} placeholder="e.g. Lower body strength" {...form.register("focus")} />
              <FieldError message={errors.focus?.message} />
            </div>
            {creditsLeft !== undefined && (
              <p className={creditsLeft > 0 ? "text-sm text-muted-foreground" : "text-sm text-amber-700 dark:text-amber-400"}>
                {creditsLeft > 0 ? `Uses one of the client's ${creditsLeft} package session${creditsLeft === 1 ? "" : "s"} left.` : "The client has no package sessions left."}
              </p>
            )}
            {canComplimentary && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" {...form.register("complimentary")} /> Complimentary (doesn&apos;t use a package credit)
              </label>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />} Book session
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Close a session: done or no-show once it has started; cancel any time before. */
export function SessionActions({ gymSlug, sessionId, started, label }: { gymSlug: string; sessionId: string; started: boolean; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const set = (status: "COMPLETED" | "NO_SHOW" | "CANCELLED") =>
    new Promise<boolean>((resolve) =>
      startTransition(async () => {
        const r = await ptSessionStatusAction(gymSlug, { sessionId, status });
        if (report(r)) {
          toast.success(status === "COMPLETED" ? "Marked as done." : status === "NO_SHOW" ? "Marked as a no-show." : "Session cancelled. The member has been notified.");
          router.refresh();
          resolve(true);
        } else resolve(false);
      })
    );
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {started && (
        <>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void set("COMPLETED")} aria-label={`Mark ${label} as done`}>
            <Check aria-hidden /> Done
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void set("NO_SHOW")} aria-label={`Mark ${label} as a no-show`}>
            No-show
          </Button>
        </>
      )}
      {!started && (
        <ConfirmDialog
          title="Cancel this session?"
          description={`${label}. The member (and the trainer, if it isn't you) will be notified.`}
          confirmLabel="Cancel session"
          onConfirm={() => set("CANCELLED")}
          trigger={(open) => (
            <Button size="sm" variant="ghost" disabled={pending} onClick={open} aria-label={`Cancel ${label}`}>
              <X aria-hidden /> Cancel
            </Button>
          )}
        />
      )}
    </div>
  );
}

// ─────────────────────────────── Notes and progress ───────────────────────────────

export function PtNoteForm({ gymSlug, memberId }: { gymSlug: string; memberId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        startTransition(async () => {
          const r = await addPtNoteAction(gymSlug, { memberId, body });
          if (!report(r)) return;
          setBody("");
          router.refresh();
        });
      }}
    >
      <Label htmlFor="pt-note">Add a private note</Label>
      <Textarea id="pt-note" rows={2} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Only you and the gym's managers can read this." />
      <Button type="submit" size="sm" className="justify-self-start" disabled={pending || !body.trim()}>
        {pending && <Loader2 className="animate-spin" aria-hidden />} Save note
      </Button>
    </form>
  );
}

/** One measurement over time; choose which. */
export function ProgressChart({ entries }: { entries: ProgressPoint[] }) {
  const available = MEASUREMENTS.filter((m) => seriesFor(entries, m.key).length > 0);
  const [key, setKey] = useState<MeasurementKey | undefined>(available[0]?.key);
  const metric = available.find((m) => m.key === key) ?? available[0];
  if (!metric) return <p className="text-sm text-muted-foreground">No measurements yet. The member logs them in the app.</p>;
  const fmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  const data = seriesFor(entries, metric.key).map((p) => ({ label: fmt.format(new Date(`${p.date}T00:00:00Z`)), value: p.value }));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Measurement">
        {available.map((m) => (
          <Button key={m.key} size="sm" variant={m.key === metric.key ? "default" : "outline"} aria-pressed={m.key === metric.key} onClick={() => setKey(m.key)}>
            {m.label}
          </Button>
        ))}
      </div>
      <LineChart data={data} valueLabel={metric.unit} />
    </div>
  );
}
