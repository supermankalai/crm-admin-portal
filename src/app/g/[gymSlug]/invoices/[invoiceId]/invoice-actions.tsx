"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, Loader2, Printer, Undo2, Wallet } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, minorToMajorInput } from "@/domain/money";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, recordPaymentSchema, refundSchema, voidInvoiceSchema } from "@/lib/validation/payments";
import { recordPaymentAction, refundPaymentAction, voidInvoiceAction } from "../../payments/actions";

function FieldMessage({ message }: { message?: string }) {
  return message ? <p className="text-sm text-destructive">{message}</p> : null;
}

export function PrintButton() {
  return (
    <Button variant="outline" onClick={() => window.print()} className="print:hidden">
      <Printer aria-hidden /> Print
    </Button>
  );
}

export function RecordPaymentButton({ gymSlug, invoiceId, outstandingMinor, currency }: { gymSlug: string; invoiceId: string; outstandingMinor: number; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.input<typeof recordPaymentSchema>, unknown, z.output<typeof recordPaymentSchema>>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues: { invoiceId, amount: minorToMajorInput(outstandingMinor), method: "CASH", reference: "" },
  });
  const method = useWatch({ control: form.control, name: "method" });
  const e = form.formState.errors;
  return (
    <>
      <Button onClick={() => setOpen(true)} className="print:hidden">
        <Wallet aria-hidden /> Record payment
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit(() =>
              startTransition(async () => {
                const r = await recordPaymentAction(gymSlug, form.getValues());
                if (!r.ok) return void toast.error(r.error);
                toast.success(r.data.fullyPaid ? "Payment recorded — invoice paid in full." : `Payment recorded. ${formatMoney(r.data.remainingMinor, currency)} still due.`);
                setOpen(false);
                router.refresh();
              })
            )}
          >
            <DialogHeader>
              <DialogTitle>Record payment</DialogTitle>
              <DialogDescription>{formatMoney(outstandingMinor, currency)} outstanding. Part payments are allowed.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="pay-amount">Amount ({currency})</Label>
                <Input id="pay-amount" inputMode="decimal" {...form.register("amount")} aria-invalid={!!e.amount} />
                <FieldMessage message={e.amount?.message} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pay-method">Method</Label>
                <NativeSelect id="pay-method" {...form.register("method")}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="pay-reference">Reference {method === "TRANSFER" ? "" : "(optional)"}</Label>
                <Input id="pay-reference" {...form.register("reference")} aria-invalid={!!e.reference} />
                <FieldMessage message={e.reference?.message} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />} Record payment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RefundButton({
  gymSlug,
  invoiceId,
  paymentId,
  refundableMinor,
  currency,
  hasMembership,
}: {
  gymSlug: string;
  invoiceId: string;
  paymentId: string;
  refundableMinor: number;
  currency: string;
  hasMembership: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.input<typeof refundSchema>, unknown, z.output<typeof refundSchema>>({
    resolver: zodResolver(refundSchema),
    defaultValues: { paymentId, amount: minorToMajorInput(refundableMinor), reason: "", cancelMembership: false },
  });
  const e = form.formState.errors;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} className="print:hidden">
        <Undo2 aria-hidden /> Refund
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit(() =>
              startTransition(async () => {
                const r = await refundPaymentAction(gymSlug, { ...form.getValues(), invoiceId });
                if (!r.ok) return void toast.error(r.error);
                toast.success(r.data.cancelledMembershipId ? "Refund recorded and membership cancelled." : "Refund recorded.");
                setOpen(false);
                router.refresh();
              })
            )}
          >
            <DialogHeader>
              <DialogTitle>Refund payment</DialogTitle>
              <DialogDescription>Up to {formatMoney(refundableMinor, currency)} can be refunded. Pay the member back outside FitCRM, then record it here.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`refund-amount-${paymentId}`}>Amount ({currency})</Label>
              <Input id={`refund-amount-${paymentId}`} inputMode="decimal" {...form.register("amount")} aria-invalid={!!e.amount} />
              <FieldMessage message={e.amount?.message} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`refund-reason-${paymentId}`}>Reason</Label>
              <Textarea id={`refund-reason-${paymentId}`} rows={2} {...form.register("reason")} aria-invalid={!!e.reason} />
              <FieldMessage message={e.reason?.message} />
            </div>
            {hasMembership && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4" {...form.register("cancelMembership")} />
                <span>Also cancel the membership this payment was for (access ends today)</span>
              </label>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />} Record refund
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function VoidInvoiceButton({ gymSlug, invoiceId, isMembershipSale }: { gymSlug: string; invoiceId: string; isMembershipSale: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<z.input<typeof voidInvoiceSchema>, unknown, z.output<typeof voidInvoiceSchema>>({ resolver: zodResolver(voidInvoiceSchema), defaultValues: { invoiceId, reason: "" } });
  return (
    <>
      <Button variant="outline" className="text-destructive print:hidden" onClick={() => setOpen(true)}>
        <Ban aria-hidden /> Void
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit(() =>
              startTransition(async () => {
                const r = await voidInvoiceAction(gymSlug, form.getValues());
                if (!r.ok) return void toast.error(r.error);
                toast.success("Invoice voided.");
                setOpen(false);
                router.refresh();
              })
            )}
          >
            <DialogHeader>
              <DialogTitle>Void this invoice?</DialogTitle>
              <DialogDescription>
                Use this for invoices raised by mistake. {isMembershipSale ? "The unpaid membership it created is cancelled too. " : ""}The invoice is kept for your records, marked void.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="void-reason">Reason</Label>
              <Textarea id="void-reason" rows={2} {...form.register("reason")} aria-invalid={!!form.formState.errors.reason} />
              <FieldMessage message={form.formState.errors.reason?.message} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Keep invoice
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending && <Loader2 className="animate-spin" aria-hidden />} Void invoice
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
