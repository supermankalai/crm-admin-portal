/**
 * Normalise a phone number to E.164-like digits ("+919876543210") so the same number
 * always produces the same blind index regardless of spacing or formatting.
 * Numbers without a country code are assumed to be in `defaultCountryCode`.
 */
export function normalisePhone(raw: string, defaultCountryCode = "91"): string | null {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (!hasPlus) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (digits.startsWith("0")) digits = defaultCountryCode + digits.slice(1);
    else if (digits.length <= 10) digits = defaultCountryCode + digits;
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}
