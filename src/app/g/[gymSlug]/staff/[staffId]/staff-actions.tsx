"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2, UserMinus } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MemberPicker, type PickedMember } from "@/components/members/member-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ROLE_LABELS, type GymRole } from "@/domain/permissions";
import { shiftSchema, staffProfileSchema } from "@/lib/validation/staff";
import { addShiftAction, assignClientAction, changeRoleAction, deleteShiftAction, removeStaffAction, updateStaffProfileAction } from "../actions";

export function RoleControl({ gymSlug, staffId, role, roles, name }: { gymSlug: string; staffId: string; role: GymRole; roles: GymRole[]; name: string }) {
  const router = useRouter();
  const [value, setValue] = useState(role);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="grid gap-1.5">
        <Label htmlFor="role">Role</Label>
        <NativeSelect id="role" value={value} onChange={(e) => setValue(e.target.value as GymRole)} className="w-44">
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </NativeSelect>
      </div>
      {value !== role && (
        <ConfirmDialog
          destructive={false}
          title={`Make ${name} ${ROLE_LABELS[value]}?`}
          description="Their access changes on their next page load."
          confirmLabel="Change role"
          trigger={(open) => <Button onClick={open}>Save role</Button>}
          onConfirm={async () => {
            const r = await changeRoleAction(gymSlug, { staffId, role: value });
            if (!r.ok) {
              toast.error(r.error);
              setValue(role);
              return false;
            }
            toast.success("Role changed.");
            router.refresh();
            return true;
          }}
        />
      )}
    </div>
  );
}

export function RemoveStaffButton({ gymSlug, staffId, name }: { gymSlug: string; staffId: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      title={`Remove ${name} from this gym?`}
      description="They lose access to this gym immediately (their account stays, for any other gyms). Their history is kept. Reassign any classes they were teaching."
      confirmLabel="Remove"
      trigger={(open) => (
        <Button variant="outline" className="text-destructive" onClick={open}>
          <UserMinus aria-hidden /> Remove from gym
        </Button>
      )}
      onConfirm={async () => {
        const r = await removeStaffAction(gymSlug, { staffId });
        if (!r.ok) {
          toast.error(r.error);
          return false;
        }
        toast.success(r.data.futureClasses ? `${name} removed. ${r.data.futureClasses} upcoming class(es) need a new trainer.` : `${name} removed.`);
        router.push(`/g/${gymSlug}/staff`);
        return true;
      }}
    />
  );
}

export function ProfileForm({ gymSlug, staffId, defaults, canEditNotes }: { gymSlug: string; staffId: string; defaults: z.input<typeof staffProfileSchema>; canEditNotes: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<z.input<typeof staffProfileSchema>, unknown, z.output<typeof staffProfileSchema>>({ resolver: zodResolver(staffProfileSchema), defaultValues: defaults });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={form.handleSubmit(() =>
        startTransition(async () => {
          const r = await updateStaffProfileAction(gymSlug, { ...form.getValues(), staffId });
          if (!r.ok) return void toast.error(r.error);
          toast.success("Profile saved.");
          router.refresh();
        })
      )}
    >
      <div className="grid gap-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" {...form.register("title")} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" type="tel" {...form.register("phone")} aria-invalid={!!e.phone} />
        {e.phone && <p className="text-sm text-destructive">{e.phone.message}</p>}
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="specialties">Specialties (comma separated)</Label>
        <Input id="specialties" placeholder="Strength, Yoga, Mobility" {...form.register("specialties")} />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="bio">Bio</Label>
        <Textarea id="bio" rows={3} {...form.register("bio")} />
      </div>
      {canEditNotes && (
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="notes">Staff notes (managers only, stored encrypted)</Label>
          <Textarea id="notes" rows={3} {...form.register("notes")} />
        </div>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />} Save profile
        </Button>
      </div>
    </form>
  );
}

export function ClientControls({ gymSlug, staffId }: { gymSlug: string; staffId: string }) {
  const router = useRouter();
  const [member, setMember] = useState<PickedMember | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="grid gap-2">
      <Label htmlFor="member-picker">Assign a client</Label>
      <MemberPicker gymSlug={gymSlug} value={member} onChange={setMember} />
      {member && (
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await assignClientAction(gymSlug, { staffId, memberId: member.id, assign: true });
              if (!r.ok) return void toast.error(r.error);
              toast.success(`${member.name} assigned.`);
              setMember(null);
              router.refresh();
            })
          }
        >
          <Plus aria-hidden /> Assign
        </Button>
      )}
    </div>
  );
}

export function UnassignClient({ gymSlug, staffId, memberId, name }: { gymSlug: string; staffId: string; memberId: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={`Unassign ${name}`}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await assignClientAction(gymSlug, { staffId, memberId, assign: false });
          if (!r.ok) return void toast.error(r.error);
          router.refresh();
        })
      }
    >
      <Trash2 aria-hidden />
    </Button>
  );
}

export function ShiftForm({ gymSlug, staffId, locations, today }: { gymSlug: string; staffId: string; locations: { id: string; name: string }[]; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<z.input<typeof shiftSchema>, unknown, z.output<typeof shiftSchema>>({ resolver: zodResolver(shiftSchema), defaultValues: { staffId, locationId: locations[0]?.id ?? "", date: today, start: "06:00", end: "14:00" } });
  const e = form.formState.errors;
  return (
    <form
      noValidate
      className="flex flex-wrap items-end gap-2"
      onSubmit={form.handleSubmit(() =>
        startTransition(async () => {
          const r = await addShiftAction(gymSlug, form.getValues());
          if (!r.ok) return void toast.error(r.error);
          toast.success("Shift added.");
          router.refresh();
        })
      )}
    >
      {locations.length > 1 && (
        <div className="grid gap-1.5">
          <Label htmlFor="shift-location">Location</Label>
          <NativeSelect id="shift-location" {...form.register("locationId")} className="w-40">
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="shift-date">Date</Label>
        <Input id="shift-date" type="date" min={today} {...form.register("date")} className="w-40" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="shift-start">From</Label>
        <Input id="shift-start" type="time" {...form.register("start")} className="w-28" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="shift-end">To</Label>
        <Input id="shift-end" type="time" {...form.register("end")} className="w-28" aria-invalid={!!e.end} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />} Add shift
      </Button>
      {e.end && <p className="w-full text-sm text-destructive">{e.end.message}</p>}
    </form>
  );
}

export function DeleteShift({ gymSlug, staffId, shiftId }: { gymSlug: string; staffId: string; shiftId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label="Delete shift"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await deleteShiftAction(gymSlug, { shiftId, staffId });
          if (!r.ok) return void toast.error(r.error);
          router.refresh();
        })
      }
    >
      <Trash2 aria-hidden />
    </Button>
  );
}
