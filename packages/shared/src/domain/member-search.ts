import { normalisePhone } from "./phone";

/**
 * Interpret the member search box:
 *  - "M-000123", "m123", "#123" or a short number → member number
 *  - 8+ digits (with optional +, spaces, dashes)   → exact phone match via the blind index
 *  - contains "@"                                  → email (partial)
 *  - anything else                                 → name tokens (each must match first or last name)
 */
export type MemberSearch =
  | { kind: "none" }
  | { kind: "memberNumber"; value: number }
  | { kind: "phone"; normalised: string }
  | { kind: "email"; value: string }
  | { kind: "name"; tokens: string[] };

export function parseMemberSearch(raw: string | undefined | null, defaultCountryCode = "91"): MemberSearch {
  const q = (raw ?? "").trim().slice(0, 100);
  if (!q) return { kind: "none" };

  const numbered = /^(?:m-?|#)?0*(\d{1,7})$/i.exec(q);
  const digits = q.replace(/[\s()+-]/g, "");
  if (numbered && !(digits.length >= 8 && /^\d+$/.test(digits))) return { kind: "memberNumber", value: Number(numbered[1]) };

  if (/^\+?[\d\s()-]{8,}$/.test(q)) {
    const normalised = normalisePhone(q, defaultCountryCode);
    if (normalised) return { kind: "phone", normalised };
  }
  if (q.includes("@")) return { kind: "email", value: q.toLowerCase() };

  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  return tokens.length ? { kind: "name", tokens } : { kind: "none" };
}

export function formatMemberNumber(n: number): string {
  return `M-${String(n).padStart(6, "0")}`;
}
