"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Search, XCircle } from "lucide-react";
import { MemberAvatar } from "@/components/members/member-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { checkInAction, lookupCheckInAction } from "./actions";
import { QrScanner } from "./qr-scanner";

type Candidate = {
  id: string;
  name: string;
  memberNumber: string;
  photoFileId: string | null;
  decision: { result: string; message: string };
  overdueInvoices: number;
};

type Outcome = { name: string; memberId: string; result: string; message: string; duplicate: boolean; overdueInvoices: number; at: Date };

const LOCATION_KEY = "fitcrm.checkin.location";

export function CheckInConsole({ gymSlug, locations, canSell, writable }: { gymSlug: string; locations: { id: string; name: string }[]; canSell: boolean; writable: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [method, setMethod] = useState<"NAME_SEARCH" | "MEMBER_ID" | "QR">("NAME_SEARCH");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCATION_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a per-device preference after mount
      if (saved && locations.some((l) => l.id === saved)) setLocationId(saved);
    } catch {
      // storage unavailable
    }
    input.current?.focus();
  }, [locations]);

  const checkIn = useCallback(
    (candidate: Pick<Candidate, "id" | "name">, how: "NAME_SEARCH" | "MEMBER_ID" | "QR") =>
      startTransition(async () => {
        setError(null);
        const r = await checkInAction(gymSlug, { memberId: candidate.id, locationId, method: how });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setOutcome({ name: r.data.name, memberId: candidate.id, result: r.data.result, message: r.data.message, duplicate: r.data.duplicate, overdueInvoices: r.data.overdueInvoices, at: new Date(r.data.checkedInAt) });
        setCandidates(null);
        setQuery("");
        router.refresh();
        input.current?.focus();
      }),
    [gymSlug, locationId, router]
  );

  const lookup = useCallback(
    (raw: string) =>
      startTransition(async () => {
        setError(null);
        setOutcome(null);
        const r = await lookupCheckInAction(gymSlug, { query: raw });
        if (!r.ok) return setError(r.error);
        setMethod(r.data.method);
        // A scanned code or member number identifies exactly one member: check in straight away.
        if (r.data.method !== "NAME_SEARCH" && r.data.candidates.length === 1 && writable) {
          checkIn(r.data.candidates[0], r.data.method);
          return;
        }
        setCandidates(r.data.candidates);
      }),
    [gymSlug, checkIn, writable]
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        {locations.length > 1 && (
          <div className="grid gap-1.5">
            <Label htmlFor="checkin-location">Location</Label>
            <NativeSelect
              id="checkin-location"
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value);
                try {
                  localStorage.setItem(LOCATION_KEY, e.target.value);
                } catch {
                  // storage unavailable
                }
              }}
              className="w-48"
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <form
          className="flex min-w-0 flex-1 gap-2"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) lookup(query);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Label htmlFor="checkin-query" className="sr-only">
              Member name, member ID or QR code
            </Label>
            <Search className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="checkin-query"
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Scan QR, or type a name or M-000123…"
              className="h-12 pl-10 text-base"
              autoComplete="off"
            />
          </div>
          <Button type="submit" className="h-12" disabled={pending || !query.trim()}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : "Find"}
          </Button>
        </form>
      </div>
      <QrScanner onCode={(code) => lookup(code)} />

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {outcome && (
        <div
          role="status"
          aria-live="assertive"
          className={cn(
            "flex flex-wrap items-center gap-4 rounded-xl border-2 p-5",
            outcome.result === "ALLOWED" ? "border-emerald-500 bg-emerald-500/10" : "border-red-500 bg-red-500/10"
          )}
        >
          {outcome.result === "ALLOWED" ? <CheckCircle2 className="size-10 text-emerald-600" aria-hidden /> : <XCircle className="size-10 text-red-600" aria-hidden />}
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">
              {outcome.result === "ALLOWED" ? (outcome.duplicate ? "Already checked in" : "Welcome") : "Entry denied"} — {outcome.name}
            </p>
            <p className="text-sm">{outcome.duplicate ? `Checked in at ${outcome.at.toLocaleTimeString()}. This scan was not counted again.` : outcome.message}</p>
            {outcome.overdueInvoices > 0 && (
              <p className="mt-1 flex items-center gap-1 text-sm font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-4" aria-hidden /> {outcome.overdueInvoices} overdue invoice{outcome.overdueInvoices > 1 ? "s" : ""} — please remind the member.
              </p>
            )}
          </div>
          {outcome.result !== "ALLOWED" && canSell && (
            <Button asChild>
              <Link href={`/g/${gymSlug}/payments/sell?memberId=${outcome.memberId}`}>Renew membership</Link>
            </Button>
          )}
        </div>
      )}

      {candidates && (
        <div className="grid gap-2">
          {candidates.length === 0 && <p className="text-sm text-muted-foreground">No member found. Check the spelling, or try the member ID.</p>}
          {candidates.map((c) => {
            const allowed = c.decision.result === "ALLOWED";
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                <MemberAvatar name={c.name} gymSlug={gymSlug} photoFileId={c.photoFileId} />
                <div className="min-w-0 flex-1">
                  <Link href={`/g/${gymSlug}/members/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{c.memberNumber}</span> · <span className={allowed ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>{c.decision.message}</span>
                    {c.overdueInvoices > 0 && <span className="text-amber-700 dark:text-amber-400"> · {c.overdueInvoices} overdue</span>}
                  </p>
                </div>
                <Button onClick={() => checkIn(c, method)} disabled={pending || !writable} variant={allowed ? "default" : "outline"}>
                  {allowed ? "Check in" : "Record attempt"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
