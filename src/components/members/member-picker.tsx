"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";
import { MemberStatusBadge } from "@/components/members/member-badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMemberNumber } from "@/domain/member-search";
import type { MemberStatus } from "@/domain/membership";
import { searchMembersAction } from "@/app/g/[gymSlug]/payments/actions";

export type PickedMember = { id: string; name: string; memberNumber: number; status: MemberStatus; planName: string | null; endDate: string | null };

/** Accessible search-as-you-type member picker (server-side search, debounced). */
export function MemberPicker({ gymSlug, value, onChange, invalid }: { gymSlug: string; value: PickedMember | null; onChange: (m: PickedMember | null) => void; invalid?: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedMember[]>([]);
  const [pending, startTransition] = useTransition();
  const listId = useId();

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(
      () =>
        startTransition(async () => {
          const r = await searchMembersAction(gymSlug, { q });
          setResults(r.ok ? r.data : []);
        }),
      250
    );
    return () => clearTimeout(t);
  }, [q, gymSlug]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div>
          <p className="font-medium">{value.name}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{formatMemberNumber(value.memberNumber)}</span>
            {value.planName && ` · ${value.planName}${value.endDate ? ` until ${value.endDate}` : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MemberStatusBadge status={value.status} />
          <Button type="button" variant="ghost" size="icon" onClick={() => onChange(null)} aria-label="Change member">
            <X />
          </Button>
        </div>
      </div>
    );
  }

  const show = q.trim().length >= 2;
  return (
    <div className="relative">
      <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden />
      <Input
        id="member-picker"
        role="combobox"
        aria-expanded={show && results.length > 0}
        aria-controls={listId}
        aria-invalid={invalid}
        placeholder="Search member by name, M-number or phone…"
        className="pl-9"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoComplete="off"
      />
      {pending && <Loader2 className="absolute top-2.5 right-3 size-4 animate-spin text-muted-foreground" aria-hidden />}
      {show && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {results.length === 0 && !pending && <li className="px-3 py-2 text-sm text-muted-foreground">No members found.</li>}
          {results.map((m) => (
            <li key={m.id} role="option" aria-selected={false}>
              <button type="button" className="flex w-full items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none" onClick={() => onChange(m)}>
                <span>
                  <span className="font-medium">{m.name}</span> <span className="font-mono text-xs text-muted-foreground">{formatMemberNumber(m.memberNumber)}</span>
                </span>
                <MemberStatusBadge status={m.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
