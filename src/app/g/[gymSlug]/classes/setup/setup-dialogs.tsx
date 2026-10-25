"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { classTypeSchema, roomSchema } from "@/lib/validation/classes";
import { saveClassTypeAction, saveRoomAction } from "../actions";

type ClassTypeValues = z.input<typeof classTypeSchema>;
type RoomValues = z.input<typeof roomSchema>;

function Trigger({ edit, label, onClick }: { edit: boolean; label: string; onClick: () => void }) {
  return edit ? (
    <Button size="sm" variant="ghost" onClick={onClick} aria-label={`Edit ${label}`}>
      <Pencil aria-hidden />
    </Button>
  ) : (
    <Button size="sm" onClick={onClick}>
      <Plus aria-hidden /> {label}
    </Button>
  );
}

export function ClassTypeDialog({ gymSlug, value }: { gymSlug: string; value?: ClassTypeValues & { classTypeId: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<ClassTypeValues, unknown, z.output<typeof classTypeSchema>>({
    resolver: zodResolver(classTypeSchema),
    defaultValues: value ?? { name: "", description: "", color: "#3b82f6", durationMinutes: 60, defaultCapacity: 15 },
  });
  const e = form.formState.errors;
  const id = value?.classTypeId ?? "new-type";
  return (
    <>
      <Trigger edit={!!value} label={value ? value.name : "Class type"} onClick={() => setOpen(true)} />
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit(() =>
              startTransition(async () => {
                const r = await saveClassTypeAction(gymSlug, { ...form.getValues(), classTypeId: value?.classTypeId });
                if (!r.ok) {
                  for (const [f, m] of Object.entries(r.fieldErrors ?? {})) if (m?.[0]) form.setError(f as keyof ClassTypeValues, { message: m[0] });
                  return void toast.error(r.error);
                }
                toast.success("Class type saved.");
                setOpen(false);
                if (!value) form.reset();
                router.refresh();
              })
            )}
          >
            <DialogHeader>
              <DialogTitle>{value ? `Edit ${value.name}` : "New class type"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-2">
                <Label htmlFor={`${id}-name`}>Name</Label>
                <Input id={`${id}-name`} {...form.register("name")} aria-invalid={!!e.name} />
                {e.name && <p className="text-sm text-destructive">{e.name.message}</p>}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-color`}>Colour</Label>
                <Input id={`${id}-color`} type="color" className="h-9 w-16 p-1" {...form.register("color")} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor={`${id}-duration`}>Length (minutes)</Label>
                <Input id={`${id}-duration`} type="number" min={10} step={5} {...form.register("durationMinutes")} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-capacity`}>Default capacity</Label>
                <Input id={`${id}-capacity`} type="number" min={1} {...form.register("defaultCapacity")} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-description`}>Description</Label>
              <Textarea id={`${id}-description`} rows={2} {...form.register("description")} />
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

export function RoomDialog({ gymSlug, locations, value }: { gymSlug: string; locations: { id: string; name: string }[]; value?: RoomValues & { roomId: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<RoomValues, unknown, z.output<typeof roomSchema>>({ resolver: zodResolver(roomSchema), defaultValues: value ?? { locationId: locations[0]?.id ?? "", name: "", capacity: 20 } });
  const e = form.formState.errors;
  const id = value?.roomId ?? "new-room";
  return (
    <>
      <Trigger edit={!!value} label={value ? value.name : "Room"} onClick={() => setOpen(true)} />
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit(() =>
              startTransition(async () => {
                const r = await saveRoomAction(gymSlug, { ...form.getValues(), roomId: value?.roomId });
                if (!r.ok) {
                  for (const [f, m] of Object.entries(r.fieldErrors ?? {})) if (m?.[0]) form.setError(f as keyof RoomValues, { message: m[0] });
                  return void toast.error(r.error);
                }
                toast.success("Room saved.");
                setOpen(false);
                if (!value) form.reset();
                router.refresh();
              })
            )}
          >
            <DialogHeader>
              <DialogTitle>{value ? `Edit ${value.name}` : "New room"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-location`}>Location</Label>
              <NativeSelect id={`${id}-location`} {...form.register("locationId")}>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor={`${id}-name`}>Name</Label>
                <Input id={`${id}-name`} {...form.register("name")} aria-invalid={!!e.name} />
                {e.name && <p className="text-sm text-destructive">{e.name.message}</p>}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-capacity`}>Capacity</Label>
                <Input id={`${id}-capacity`} type="number" min={1} {...form.register("capacity")} />
              </div>
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
