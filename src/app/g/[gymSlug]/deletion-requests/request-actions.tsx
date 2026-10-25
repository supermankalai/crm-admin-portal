"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { completeDeletionAction, rejectDeletionAction } from "./actions";

/** Complete (erase) or reject one request. Both ask first; erasing can't be undone. */
export function RequestActions({ gymSlug, requestId, memberName }: { gymSlug: string; requestId: string; memberName: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const noteId = useId();

  const run = async (action: (slug: string, input: unknown) => Promise<{ ok: true } | { ok: false; error: string }>, done: string) => {
    const r = await action(gymSlug, { requestId, note });
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success(done);
    router.refresh();
    return true;
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={noteId}>Note (optional — shown to the member if you reject)</Label>
        <Textarea id={noteId} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <ConfirmDialog
          title={`Erase ${memberName}'s data?`}
          description={
            <>
              Their name, contact details, date of birth, health notes, emergency contact and photo are removed, their app account is turned off, and their measurements, progress photos,
              workouts, trainer notes and app notifications are deleted. Invoices, payments and visit history are kept for your accounts without their name. <strong>This can&apos;t be undone.</strong>
            </>
          }
          confirmLabel="Erase personal data"
          onConfirm={() => run(completeDeletionAction, `${memberName}'s personal data was erased.`)}
          trigger={(open) => (
            <Button variant="destructive" size="sm" onClick={open}>
              Erase personal data
            </Button>
          )}
        />
        <ConfirmDialog
          title="Reject this request?"
          description="The member sees that it was rejected, with your note. Tell them why — for example, an unpaid balance to settle first."
          confirmLabel="Reject request"
          destructive={false}
          onConfirm={() => run(rejectDeletionAction, "Request rejected.")}
          trigger={(open) => (
            <Button variant="outline" size="sm" onClick={open}>
              Reject
            </Button>
          )}
        />
      </div>
    </div>
  );
}
