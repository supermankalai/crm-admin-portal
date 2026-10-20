"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, Loader2, PackagePlus, Pencil, ShoppingBag } from "lucide-react";
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
import { addDays } from "@/domain/dates";
import { formatInvoiceNumber } from "@/domain/billing";
import { formatMoney, invoiceTotals, minorToMajorInput } from "@/domain/money";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from "@/lib/validation/payments";
import { ptPackageSchema, sellPtPackageSchema } from "@/lib/validation/pt";
import { archivePtPackageAction, savePtPackageAction, sellPtPackageAction, setPtCreditsRequiredAction } from "./actions";

export type CatalogPackage = { id: string; name: string; description: string | null; sessionCount: number; priceMinor: number; validityDays: number; isActive: boolean };

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-sm text-destructive">{message}</p> : null;
}

// ─────────────────────────────── Catalog ───────────────────────────────

export function PackageDialog({ gymSlug, currency, pkg }: { gymSlug: string; currency: string; pkg?: CatalogPackage }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const defaults = {
    packageId: pkg?.id,
    name: pkg?.name ?? "",
    description: pkg?.description ?? "",
    sessionCount: pkg?.sessionCount ?? 10,
    price: pkg ? minorToMajorInput(pkg.priceMinor) : "",
    validityDays: pkg?.validityDays ?? 90,
    isActive: pkg?.isActive ?? true,
  };
  const form = useForm<z.input<typeof ptPackageSchema>, unknown, z.output<typeof ptPackageSchema>>({ resolver: zodResolver(ptPackageSchema), defaultValues: defaults });
  const e = form.formState.errors;
  return (
    <>
      {pkg ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Edit ${pkg.name}`}>
          <Pencil aria-hidden /> Edit
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <PackagePlus aria-hidden /> New package
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (pending) return;
          setOpen(o);
          if (!o) form.reset(defaults);
        }}
      >
        <DialogContent>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit(() =>
              startTransition(async () => {
                const r = await savePtPackageAction(gymSlug, form.getValues());
                if (!r.ok) {
                  for (const [f, m] of Object.entries(r.fieldErrors ?? {})) if (m?.[0]) form.setError(f as "name", { message: m[0] });
                  return void toast.error(r.error);
                }
                toast.success(pkg ? "Package saved." : "Package added.");
                setOpen(false);
                router.refresh();
              })
            )}
          >
            <DialogHeader>
              <DialogTitle>{pkg ? `Edit ${pkg.name}` : "New PT package"}</DialogTitle>
              <DialogDescription>{pkg ? "Packages already sold keep the sessions and price they were sold with." : "A number of personal training sessions to use within a set time."}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="pkg-name">Name</Label>
              <Input id="pkg-name" placeholder="e.g. 10 sessions" {...form.register("name")} aria-invalid={!!e.name} />
              <FieldError message={e.name?.message} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="pkg-sessions">Sessions</Label>
                <Input id="pkg-sessions" type="number" min={1} max={200} {...form.register("sessionCount")} aria-invalid={!!e.sessionCount} />
                <FieldError message={e.sessionCount?.message} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pkg-price">Price ({currency}, before tax)</Label>
                <Input id="pkg-price" inputMode="decimal" {...form.register("price")} aria-invalid={!!e.price} />
                <FieldError message={e.price?.message} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pkg-days">Valid for (days)</Label>
                <Input id="pkg-days" type="number" min={1} max={730} {...form.register("validityDays")} aria-invalid={!!e.validityDays} />
                <FieldError message={e.validityDays?.message} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pkg-desc">Description (optional)</Label>
              <Textarea id="pkg-desc" rows={2} maxLength={300} {...form.register("description")} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" {...form.register("isActive")} /> On sale
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />} {pkg ? "Save package" : "Add package"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ArchivePackageButton({ gymSlug, pkg }: { gymSlug: string; pkg: { id: string; name: string } }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      title={`Remove ${pkg.name}?`}
      description="It comes off the list of packages you sell. Packages members already bought keep working until they're used up or expire."
      confirmLabel="Remove package"
      onConfirm={async () => {
        const r = await archivePtPackageAction(gymSlug, { packageId: pkg.id });
        if (!r.ok) {
          toast.error(r.error);
          return false;
        }
        toast.success("Package removed.");
        router.refresh();
        return true;
      }}
      trigger={(open) => (
        <Button size="sm" variant="ghost" onClick={open} aria-label={`Remove ${pkg.name}`}>
          <Archive aria-hidden /> Remove
        </Button>
      )}
    />
  );
}

/** Owner switch: PT sessions need a package credit. */
export function CreditsRequiredSwitch({ gymSlug, required }: { gymSlug: string; required: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4"
        checked={required}
        disabled={pending}
        onChange={(ev) => {
          const next = ev.target.checked;
          startTransition(async () => {
            const r = await setPtCreditsRequiredAction(gymSlug, { required: next });
            if (!r.ok) return void toast.error(r.error);
            toast.success(next ? "PT sessions now need a package credit." : "PT sessions can be booked without a package.");
            router.refresh();
          });
        }}
      />
      <span>
        <span className="font-medium">PT sessions need a package credit</span>
        <span className="block text-muted-foreground">
          When on, a session can only be booked if the client has a package with sessions left (owners and managers can still book a complimentary one). When off, sessions use a
          credit if there is one, and are booked anyway if not.
        </span>
      </span>
    </label>
  );
}

// ─────────────────────────────── Selling ───────────────────────────────

/** Sell a package: invoice now, and take payment now (in full or part) or later. */
export function SellPackageDialog({
  gymSlug,
  today,
  currency,
  taxRateBps,
  packages,
  trainers,
  member,
  defaultTrainerId,
}: {
  gymSlug: string;
  today: string;
  currency: string;
  taxRateBps: number;
  packages: CatalogPackage[];
  trainers: { id: string; name: string }[];
  member?: { id: string; name: string };
  defaultTrainerId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedMember | null>(null);
  const [pending, startTransition] = useTransition();
  const onSale = packages.filter((p) => p.isActive);
  const defaults = {
    memberId: member?.id ?? "",
    packageId: onSale[0]?.id ?? "",
    trainerId: defaultTrainerId ?? "",
    startsOn: today,
    payNow: "full" as const,
    amount: "",
    method: "CASH" as const,
    reference: "",
  };
  const form = useForm<z.input<typeof sellPtPackageSchema>, unknown, z.output<typeof sellPtPackageSchema>>({ resolver: zodResolver(sellPtPackageSchema), defaultValues: defaults });
  const [packageId, startsOn, payNow, method] = useWatch({ control: form.control, name: ["packageId", "startsOn", "payNow", "method"] });
  const pkg = onSale.find((p) => p.id === packageId);
  const totals = pkg ? invoiceTotals(pkg.priceMinor, taxRateBps) : null;
  const e = form.formState.errors;
  const close = (o: boolean) => {
    if (pending) return;
    setOpen(o);
    if (!o) {
      form.reset(defaults);
      setPicked(null);
    }
  };
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={onSale.length === 0} title={onSale.length === 0 ? "Add a PT package first (Personal training → Packages)" : undefined}>
        <ShoppingBag aria-hidden /> Sell PT package
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-xl">
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit(() =>
              startTransition(async () => {
                const r = await sellPtPackageAction(gymSlug, form.getValues());
                if (!r.ok) {
                  for (const [f, m] of Object.entries(r.fieldErrors ?? {})) if (m?.[0]) form.setError(f as "packageId", { message: m[0] });
                  return void toast.error(r.error);
                }
                toast.success(
                  `${formatInvoiceNumber(r.data.invoiceNumber)} issued for ${formatMoney(r.data.totalMinor, currency)}${r.data.paidMinor ? `, ${formatMoney(r.data.paidMinor, currency)} received` : ""}.`
                );
                close(false);
                router.refresh();
              })
            )}
          >
            <DialogHeader>
              <DialogTitle>Sell a PT package</DialogTitle>
              <DialogDescription>Creates an invoice like a membership sale. Sessions booked from now on use its credits.</DialogDescription>
            </DialogHeader>
            {member ? (
              <p className="text-sm">
                Member: <span className="font-medium">{member.name}</span>
              </p>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="member-picker">Member</Label>
                <MemberPicker
                  gymSlug={gymSlug}
                  value={picked}
                  invalid={!!e.memberId}
                  onChange={(m) => {
                    setPicked(m);
                    form.setValue("memberId", m?.id ?? "", { shouldValidate: !!m });
                  }}
                />
                <FieldError message={e.memberId ? "Choose a member." : undefined} />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="sell-package">Package</Label>
                <NativeSelect id="sell-package" {...form.register("packageId")} aria-invalid={!!e.packageId}>
                  {onSale.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {formatMoney(p.priceMinor, currency)}
                    </option>
                  ))}
                </NativeSelect>
                <FieldError message={e.packageId?.message} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sell-trainer">Sessions with</Label>
                <NativeSelect id="sell-trainer" {...form.register("trainerId")} aria-invalid={!!e.trainerId}>
                  <option value="">Any trainer</option>
                  {trainers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
                <FieldError message={e.trainerId?.message} />
              </div>
            </div>
            <div className="grid gap-2 sm:w-1/2">
              <Label htmlFor="sell-start">Starts on</Label>
              <Input id="sell-start" type="date" {...form.register("startsOn")} aria-invalid={!!e.startsOn} />
              <FieldError message={e.startsOn?.message} />
            </div>
            {pkg && totals && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p>
                  {pkg.sessionCount} session{pkg.sessionCount === 1 ? "" : "s"}, usable until <span className="font-medium">{addDays(startsOn || today, pkg.validityDays - 1)}</span>
                </p>
                <p className="text-muted-foreground">
                  {formatMoney(totals.subtotalMinor, currency)} + tax {formatMoney(totals.taxMinor, currency)} = <span className="font-medium text-foreground">{formatMoney(totals.totalMinor, currency)}</span>
                </p>
              </div>
            )}
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="sr-only">Payment now</legend>
              {(
                [
                  ["full", "Paid in full now"],
                  ["partial", "Part payment now"],
                  ["none", "Invoice only (pay later)"],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="flex items-center gap-2">
                  <input type="radio" value={v} {...form.register("payNow")} /> {label}
                </label>
              ))}
            </fieldset>
            {payNow !== "none" && (
              <div className="grid gap-4 sm:grid-cols-3">
                {payNow === "partial" && (
                  <div className="grid gap-2">
                    <Label htmlFor="sell-amount">Amount received ({currency})</Label>
                    <Input id="sell-amount" inputMode="decimal" {...form.register("amount")} aria-invalid={!!e.amount} />
                    <FieldError message={e.amount?.message} />
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="sell-method">Method</Label>
                  <NativeSelect id="sell-method" {...form.register("method")}>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="sell-reference">Reference {method === "TRANSFER" ? "" : "(optional)"}</Label>
                  <Input id="sell-reference" placeholder={method === "TRANSFER" ? "UTR / UPI ref" : method === "CARD" ? "POS slip no." : ""} {...form.register("reference")} aria-invalid={!!e.reference} />
                  <FieldError message={e.reference?.message} />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />} Sell package
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
