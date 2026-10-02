"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2, Pencil, UserPlus, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MemberPicker, type PickedMember } from "@/components/members/member-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cancelSessionSchema, sessionUpdateSchema } from "@/lib/validation/classes";
import { bookMemberAction, cancelBookingAction, cancelSessionAction, markAttendanceAction, updateSessionAction } from "../actions";

export function BookMember({ gymSlug, sessionId, full }: { gymSlug: string; sessionId: string; full: boolean }) {
  const router = useRouter();
  const [member, setMember] = useState<PickedMember | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid gap-2">
      <Label htmlFor="member-picker">{full ? "Add to the waitlist" : "Book a member"}</Label>
      <MemberPicker gymSlug={gymSlug} value={member} onChange={setMember} />
      {member && (
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await bookMemberAction(gymSlug, { sessionId, memberId: member.id });
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.data.status === "BOOKED" ? `${r.data.name} is booked.` : `Class is full — ${r.data.name} is #${r.data.waitlistPosition} on the waitlist.`);
              setMember(null);
              router.refresh();
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />} {full ? "Add to waitlist" : "Book"}
        </Button>
      )}
    </div>
  );
}

export function BookingRowActions({ gymSlug, sessionId, bookingId, name, status, canCancel, canMark }: { gymSlug: string; sessionId: string; bookingId: string; name: string; status: string; canCancel: boolean; canMark: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const mark = (attended: boolean) =>
    startTransition(async () => {
      const r = await markAttendanceAction(gymSlug, { bookingId, attended, sessionId });
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {canMark && ["BOOKED", "ATTENDED", "NO_SHOW"].includes(status) && (
        <>
          <Button size="sm" variant={status === "ATTENDED" ? "default" : "outline"} disabled={pending} onClick={() => mark(true)} aria-pressed={status === "ATTENDED"} aria-label={`Mark ${name} attended`}>
            <Check aria-hidden /> Attended
          </Button>
          <Button size="sm" variant={status === "NO_SHOW" ? "destructive" : "outline"} disabled={pending} onClick={() => mark(false)} aria-pressed={status === "NO_SHOW"} aria-label={`Mark ${name} no-show`}>
            <X aria-hidden /> No-show
          </Button>
        </>
      )}
      {canCancel && (status === "BOOKED" || status === "WAITLISTED") && (
        <ConfirmDialog
          title={`Cancel ${name}'s ${status === "WAITLISTED" ? "waitlist spot" : "booking"}?`}
          description={status === "BOOKED" ? "The spot goes to the first person on the waitlist. A class-pack credit is returned if the class hasn't started." : "They are removed from the waitlist."}
          confirmLabel="Cancel booking"
          trigger={(open) => (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={open} aria-label={`Cancel booking for ${name}`}>
              <XCircle aria-hidden />
            </Button>
          )}
          onConfirm={async () => {
            const r = await cancelBookingAction(gymSlug, { bookingId, sessionId });
            if (!r.ok) {
              toast.error(r.error);
              return false;
            }
            toast.success(r.data.promoted ? "Booking cancelled — the next person on the waitlist got the spot." : "Booking cancelled.");
            router.refresh();
            return true;
          }}
        />
      )}
    </div>
  );
}

export function EditSession({
  gymSlug,
  session,
  rooms,
  trainers,
  canChangeStaffing,
}: {
  gymSlug: string;
  session: { id: string; trainerId: string; roomId: string; capacity: number };
  rooms: { id: string; name: string; capacity: number }[];
  trainers: { id: string; name: string }[];
  canChangeStaffing: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.input<typeof sessionUpdateSchema>, unknown, z.output<typeof sessionUpdateSchema>>({ resolver: zodResolver(sessionUpdateSchema), defaultValues: { sessionId: session.id, trainerId: session.trainerId, roomId: session.roomId, capacity: session.capacity } });
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil aria-hidden /> Edit
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit(() =>
              startTransition(async () => {
                const r = await updateSessionAction(gymSlug, form.getValues());
                if (!r.ok) {
                  for (const [f, m] of Object.entries(r.fieldErrors ?? {})) if (m?.[0]) form.setError(f as "capacity", { message: m[0] });
                  return void toast.error(r.error);
                }
                toast.success(r.data.promoted ? `Saved — ${r.data.promoted} moved off the waitlist.` : "Saved.");
                setOpen(false);
                router.refresh();
              })
            )}
          >
            <DialogHeader>
              <DialogTitle>Edit class</DialogTitle>
              <DialogDescription>Raising capacity moves people off the waitlist in order.</DialogDescription>
            </DialogHeader>
            {canChangeStaffing && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="edit-trainer">Trainer</Label>
                  <NativeSelect id="edit-trainer" {...form.register("trainerId")}>
                    {trainers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-room">Room</Label>
                  <NativeSelect id="edit-room" {...form.register("roomId")}>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} (max {r.capacity})
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </>
            )}
            <div className="grid gap-2">
              <Label htmlFor="edit-capacity">Capacity</Label>
              <Input id="edit-capacity" type="number" min={1} {...form.register("capacity")} aria-invalid={!!form.formState.errors.capacity} />
              {form.formState.errors.capacity && <p className="text-sm text-destructive">{form.formState.errors.capacity.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />} Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CancelSession({ gymSlug, sessionId, booked }: { gymSlug: string; sessionId: string; booked: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.input<typeof cancelSessionSchema>>({ resolver: zodResolver(cancelSessionSchema), defaultValues: { sessionId, reason: "" } });
  return (
    <>
      <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
        <XCircle aria-hidden /> Cancel class
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit(() =>
              startTransition(async () => {
                const r = await cancelSessionAction(gymSlug, form.getValues());
                if (!r.ok) return void toast.error(r.error);
                toast.success(`Class cancelled. ${r.data.bookingsCancelled} booking(s) cancelled.`);
                setOpen(false);
                router.refresh();
              })
            )}
          >
            <DialogHeader>
              <DialogTitle>Cancel this class?</DialogTitle>
              <DialogDescription>{booked} booked member(s) and the waitlist are cancelled; class-pack credits are returned.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="cancel-session-reason">Reason</Label>
              <Textarea id="cancel-session-reason" rows={2} {...form.register("reason")} aria-invalid={!!form.formState.errors.reason} />
              {form.formState.errors.reason && <p className="text-sm text-destructive">{form.formState.errors.reason.message}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Keep class
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />} Cancel class
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
