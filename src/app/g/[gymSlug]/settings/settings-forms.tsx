"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ImageUp, Loader2, MapPinPlus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { brandingSchema, DAY_NAMES, gymProfileSchema, locationSchema, openingHoursSchema } from "@/lib/validation/settings";
import { removeGymLogoAction, saveLocationAction, saveOpeningHoursAction, updateBrandingAction, updateGymProfileAction, uploadGymLogoAction } from "./actions";

type ProfileValues = z.input<typeof gymProfileSchema>;

const Err = ({ message }: { message?: string }) => (message ? <p className="text-sm text-destructive">{message}</p> : null);

export function GymProfileForm({
  gymSlug,
  defaults,
  timeZones,
  currencies,
  currencyLocked,
  readOnly,
}: {
  gymSlug: string;
  defaults: ProfileValues;
  timeZones: string[];
  currencies: { code: string; label: string }[];
  currencyLocked: boolean;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<ProfileValues, unknown, z.output<typeof gymProfileSchema>>({ resolver: zodResolver(gymProfileSchema), defaultValues: defaults });
  const e = form.formState.errors;

  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={form.handleSubmit(() =>
        startTransition(async () => {
          const r = await updateGymProfileAction(gymSlug, form.getValues());
          if (!r.ok) {
            for (const [field, messages] of Object.entries(r.fieldErrors ?? {})) if (messages?.[0]) form.setError(field as keyof ProfileValues, { message: messages[0] });
            return void toast.error(r.error);
          }
          toast.success(r.data.changed ? "Settings saved." : "Nothing changed.");
          router.refresh();
        })
      )}
    >
      <fieldset disabled={readOnly || pending} className="contents">
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="gym-name">Gym name</Label>
          <Input id="gym-name" {...form.register("name")} aria-invalid={!!e.name} />
          <Err message={e.name?.message} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="gym-email">Contact email</Label>
          <Input id="gym-email" type="email" {...form.register("email")} aria-invalid={!!e.email} />
          <Err message={e.email?.message} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="gym-phone">Phone</Label>
          <Input id="gym-phone" type="tel" {...form.register("phone")} aria-invalid={!!e.phone} />
          <Err message={e.phone?.message} />
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="gym-address">Address</Label>
          <Textarea id="gym-address" rows={2} {...form.register("address")} />
          <Err message={e.address?.message} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="gym-timezone">Time zone</Label>
          <NativeSelect id="gym-timezone" {...form.register("timezone")} aria-invalid={!!e.timezone}>
            {timeZones.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replaceAll("_", " ")}
              </option>
            ))}
          </NativeSelect>
          <Err message={e.timezone?.message} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="gym-currency">Currency</Label>
          <NativeSelect id="gym-currency" {...form.register("currency")} aria-invalid={!!e.currency} aria-describedby={currencyLocked ? "gym-currency-hint" : undefined}>
            {currencies
              .filter((c) => !currencyLocked || c.code === defaults.currency)
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.label}
                </option>
              ))}
          </NativeSelect>
          {currencyLocked && (
            <p id="gym-currency-hint" className="text-xs text-muted-foreground">
              Locked because invoices or payments already use this currency.
            </p>
          )}
          <Err message={e.currency?.message} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="gym-tax">Tax rate (%)</Label>
          <Input id="gym-tax" inputMode="decimal" {...form.register("taxRate")} aria-invalid={!!e.taxRate} aria-describedby="gym-tax-hint" />
          <p id="gym-tax-hint" className="text-xs text-muted-foreground">
            Added to new invoices. Existing invoices keep the tax they were issued with.
          </p>
          <Err message={e.taxRate?.message} />
        </div>
        {!readOnly && (
          <div className="flex items-end justify-end sm:col-span-2">
            <Button type="submit">{pending && <Loader2 className="animate-spin" aria-hidden />} Save changes</Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}

type Day = { dayOfWeek: number; isClosed: boolean; open: string; close: string };

export function OpeningHoursForm({ gymSlug, locationId, locationName, days: initial, readOnly }: { gymSlug: string; locationId: string; locationName: string; days: Day[]; readOnly: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState(initial);
  const [errors, setErrors] = useState<Record<number, string>>({});
  // Show Monday first, like the timetable.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const set = (d: number, patch: Partial<Day>) => setDays((all) => all.map((x) => (x.dayOfWeek === d ? { ...x, ...patch } : x)));

  const save = () =>
    startTransition(async () => {
      const parsed = openingHoursSchema.safeParse({ locationId, days });
      if (!parsed.success) {
        const next: Record<number, string> = {};
        for (const issue of parsed.error.issues) if (typeof issue.path[1] === "number") next[days[issue.path[1]].dayOfWeek] = issue.message;
        setErrors(next);
        return void toast.error("Check the highlighted days.");
      }
      setErrors({});
      const r = await saveOpeningHoursAction(gymSlug, { locationId, days });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Opening hours for ${locationName} saved.`);
      router.refresh();
    });

  return (
    <div className="grid gap-3">
      <div className="grid gap-2" role="group" aria-label={`Opening hours for ${locationName}`}>
        {order.map((d) => {
          const day = days.find((x) => x.dayOfWeek === d)!;
          const id = `${locationId}-${d}`;
          return (
            <div key={d} className="grid grid-cols-[6.5rem_auto_1fr] items-center gap-x-3 gap-y-1 sm:grid-cols-[7rem_6rem_9rem_1rem_9rem_1fr]">
              <span className="text-sm font-medium">{DAY_NAMES[d]}</span>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={day.isClosed} disabled={readOnly} onChange={(ev) => set(d, { isClosed: ev.target.checked })} />
                Closed
              </label>
              {day.isClosed ? (
                <span className="text-sm text-muted-foreground sm:col-span-4">Closed all day</span>
              ) : (
                <>
                  <Input type="time" aria-label={`${DAY_NAMES[d]} opens`} id={`${id}-open`} value={day.open} disabled={readOnly} onChange={(ev) => set(d, { open: ev.target.value })} className="col-start-2 sm:col-start-auto" />
                  <span className="hidden text-center text-muted-foreground sm:block" aria-hidden>
                    –
                  </span>
                  <Input type="time" aria-label={`${DAY_NAMES[d]} closes`} id={`${id}-close`} value={day.close === "24:00" ? "23:59" : day.close} disabled={readOnly} onChange={(ev) => set(d, { close: ev.target.value })} aria-invalid={!!errors[d]} />
                  <span className="col-span-3 text-sm text-destructive sm:col-span-1">{errors[d]}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />} Save hours
          </Button>
        </div>
      )}
    </div>
  );
}

type LocationValues = z.input<typeof locationSchema>;

export function LocationDialog({ gymSlug, location, atLimit = false }: { gymSlug: string; location?: { id: string; name: string; address: string }; atLimit?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const blank = { name: "", address: "" };
  const form = useForm<LocationValues, unknown, z.output<typeof locationSchema>>({ resolver: zodResolver(locationSchema), defaultValues: location ? { name: location.name, address: location.address } : blank });
  const e = form.formState.errors;
  const prefix = location?.id ?? "new-location";

  return (
    <>
      {location ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Edit ${location.name}`}>
          <Pencil aria-hidden /> Edit
        </Button>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)} disabled={atLimit} title={atLimit ? "Your plan's location limit is reached. Upgrade to add more." : undefined}>
          <MapPinPlus aria-hidden /> Add location
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit(() =>
              startTransition(async () => {
                const r = await saveLocationAction(gymSlug, { ...form.getValues(), locationId: location?.id });
                if (!r.ok) {
                  for (const [field, messages] of Object.entries(r.fieldErrors ?? {})) if (messages?.[0]) form.setError(field as keyof LocationValues, { message: messages[0] });
                  return void toast.error(r.error);
                }
                toast.success(location ? "Location saved." : "Location added with default hours (6am–10pm).");
                setOpen(false);
                if (!location) form.reset(blank);
                router.refresh();
              })
            )}
          >
            <DialogHeader>
              <DialogTitle>{location ? `Edit ${location.name}` : "Add a location"}</DialogTitle>
              <DialogDescription>Locations have their own opening hours, rooms and check-in desk.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`${prefix}-name`}>Name</Label>
              <Input id={`${prefix}-name`} {...form.register("name")} aria-invalid={!!e.name} />
              <Err message={e.name?.message} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${prefix}-address`}>Address</Label>
              <Textarea id={`${prefix}-address`} rows={2} {...form.register("address")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />} {location ? "Save" : "Add location"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function BrandingForm({ gymSlug, brandColor, readOnly }: { gymSlug: string; brandColor: string; readOnly: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [color, setColor] = useState(brandColor);
  const valid = brandingSchema.safeParse({ brandColor: color }).success;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-2">
        <Label htmlFor="brand-color">Colour</Label>
        <div className="flex items-center gap-2">
          <input type="color" aria-label="Pick a colour" value={valid ? color : "#000000"} disabled={readOnly} onChange={(ev) => setColor(ev.target.value)} className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1" />
          <Input id="brand-color" value={color} disabled={readOnly} onChange={(ev) => setColor(ev.target.value.trim())} className="w-32 font-mono" aria-invalid={!valid} />
        </div>
      </div>
      <span className="flex size-9 items-center justify-center rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: valid ? color : "transparent" }} aria-hidden>
        Aa
      </span>
      {!readOnly && (
        <Button
          disabled={pending || !valid || color.toLowerCase() === brandColor.toLowerCase()}
          onClick={() =>
            startTransition(async () => {
              const r = await updateBrandingAction(gymSlug, { brandColor: color });
              if (!r.ok) return void toast.error(r.error);
              toast.success("Brand colour saved.");
              router.refresh();
            })
          }
        >
          {pending && <Loader2 className="animate-spin" aria-hidden />} Save colour
        </Button>
      )}
      {!valid && <p className="w-full text-sm text-destructive">Use a hex colour like #ea580c.</p>}
    </div>
  );
}

export function LogoControl({ gymSlug, logoUrl, readOnly }: { gymSlug: string; logoUrl: string | null; readOnly: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return void toast.error("Images must be 2 MB or smaller.");
    const data = new FormData();
    data.set("file", file);
    startTransition(async () => {
      const r = await uploadGymLogoAction(gymSlug, data);
      if (r.ok) {
        toast.success("Logo updated.");
        router.refresh();
      } else toast.error(r.error);
      if (input.current) input.current.value = "";
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <span className="flex size-20 items-center justify-center overflow-hidden rounded-xl border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- served by our authenticated file route */}
        {logoUrl ? <img src={logoUrl} alt="Current logo" className="size-full object-contain" /> : <span className="text-xs text-muted-foreground">No logo</span>}
      </span>
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <input ref={input} id="gym-logo-file" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(ev) => onFile(ev.target.files?.[0])} aria-label="Logo image file" />
          <Button variant="outline" onClick={() => input.current?.click()} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <ImageUp aria-hidden />} {logoUrl ? "Replace logo" : "Upload logo"}
          </Button>
          {logoUrl && (
            <ConfirmDialog
              title="Remove the logo?"
              description="Your brand colour will be shown instead."
              confirmLabel="Remove logo"
              trigger={(open) => (
                <Button variant="ghost" className="text-destructive" onClick={open} disabled={pending}>
                  <Trash2 aria-hidden /> Remove
                </Button>
              )}
              onConfirm={async () => {
                const r = await removeGymLogoAction(gymSlug, {});
                if (!r.ok) {
                  toast.error(r.error);
                  return false;
                }
                toast.success("Logo removed.");
                router.refresh();
                return true;
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
