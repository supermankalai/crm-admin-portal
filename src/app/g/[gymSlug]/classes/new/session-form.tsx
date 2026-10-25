"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { sessionSchema } from "@/lib/validation/classes";
import { createSessionsAction } from "../actions";

type Setup = {
  classTypes: { id: string; name: string; durationMinutes: number; defaultCapacity: number }[];
  rooms: { id: string; name: string; capacity: number; location: { name: string } }[];
  trainers: { id: string; name: string }[];
};

export function SessionForm({ gymSlug, setup, today }: { gymSlug: string; setup: Setup; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const first = setup.classTypes[0];
  const form = useForm<z.input<typeof sessionSchema>, unknown, z.output<typeof sessionSchema>>({
    resolver: zodResolver(sessionSchema),
    defaultValues: { classTypeId: first?.id ?? "", trainerId: setup.trainers[0]?.id ?? "", roomId: setup.rooms[0]?.id ?? "", date: today, startTime: "18:00", durationMinutes: first?.durationMinutes ?? 60, capacity: first?.defaultCapacity ?? 15, repeatWeeks: 1 },
  });
  const e = form.formState.errors;
  const msg = (m?: string) => (m ? <p className="text-sm text-destructive">{m}</p> : null);

  return (
    <Card>
      <CardContent>
        <form
          noValidate
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={form.handleSubmit(() =>
            startTransition(async () => {
              const r = await createSessionsAction(gymSlug, form.getValues());
              if (!r.ok) {
                for (const [f, m] of Object.entries(r.fieldErrors ?? {})) if (m?.[0]) form.setError(f as keyof z.input<typeof sessionSchema>, { message: m[0] });
                return void toast.error(r.error);
              }
              toast.success(r.data.created === 1 ? "Class scheduled." : `${r.data.created} classes scheduled.`);
              router.push(`/g/${gymSlug}/classes?week=${form.getValues("date")}`);
            })
          )}
        >
          <div className="grid gap-2">
            <Label htmlFor="classTypeId">Class</Label>
            <NativeSelect
              id="classTypeId"
              {...form.register("classTypeId", {
                onChange: (ev) => {
                  const t = setup.classTypes.find((c) => c.id === ev.target.value);
                  if (t) {
                    form.setValue("durationMinutes", t.durationMinutes);
                    form.setValue("capacity", t.defaultCapacity);
                  }
                },
              })}
            >
              {setup.classTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="trainerId">Trainer</Label>
            <NativeSelect id="trainerId" {...form.register("trainerId")}>
              {setup.trainers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="roomId">Room</Label>
            <NativeSelect id="roomId" {...form.register("roomId")}>
              {setup.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.location.name} · {r.name} (max {r.capacity})
                </option>
              ))}
            </NativeSelect>
            {msg(e.roomId?.message)}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="capacity">Capacity</Label>
            <Input id="capacity" type="number" min={1} {...form.register("capacity")} aria-invalid={!!e.capacity} />
            {msg(e.capacity?.message)}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" min={today} {...form.register("date")} aria-invalid={!!e.date} />
            {msg(e.date?.message)}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="startTime">Starts</Label>
              <Input id="startTime" type="time" {...form.register("startTime")} aria-invalid={!!e.startTime} />
              {msg(e.startTime?.message)}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="durationMinutes">Minutes</Label>
              <Input id="durationMinutes" type="number" min={10} step={5} {...form.register("durationMinutes")} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="repeatWeeks">Repeat weekly for</Label>
            <NativeSelect id="repeatWeeks" {...form.register("repeatWeeks")}>
              {[1, 2, 4, 8, 12].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "Just this once" : `${n} weeks`}
                </option>
              ))}
            </NativeSelect>
            {msg(e.repeatWeeks?.message)}
          </div>
          <div className="flex items-end justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />} Schedule
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
