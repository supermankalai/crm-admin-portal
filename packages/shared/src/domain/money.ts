/**
 * Money rules. All amounts are integers in the currency's minor unit (paise, cents).
 * Never use floating point for stored amounts.
 */

export function assertMinorUnits(amount: number, label = "amount"): void {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`${label} must be an integer number of minor units`);
}

/** Integer division rounding half to even (banker's rounding), for non-negative numerators. */
export function divideRoundHalfEven(numerator: number, denominator: number): number {
  assertMinorUnits(numerator, "numerator");
  if (numerator < 0 || denominator <= 0) throw new RangeError("expected numerator >= 0 and denominator > 0");
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  const twice = remainder * 2;
  if (twice > denominator) return quotient + 1;
  if (twice < denominator) return quotient;
  return quotient % 2 === 0 ? quotient : quotient + 1;
}

/** Tax on a subtotal, with the rate in basis points (1800 = 18.00%). */
export function calculateTax(subtotalMinor: number, taxRateBps: number): number {
  assertMinorUnits(subtotalMinor, "subtotal");
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10_000) {
    throw new RangeError("taxRateBps must be an integer between 0 and 10000");
  }
  return divideRoundHalfEven(subtotalMinor * taxRateBps, 10_000);
}

export function invoiceTotals(subtotalMinor: number, taxRateBps: number) {
  const taxMinor = calculateTax(subtotalMinor, taxRateBps);
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
}

/** Format minor units for display, e.g. 250000 INR → "₹2,500.00". */
export function formatMoney(amountMinor: number, currency: string, locale = "en-IN"): string {
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amountMinor / 10 ** digits);
}

/**
 * Parse a user-entered major-unit amount ("2,500", "2500.5", "₹ 1,999.00") into minor units
 * exactly, without floating point. Returns null for invalid input or more than 2 decimals.
 */
export function parseMajorToMinor(input: string, fractionDigits = 2): number | null {
  const cleaned = input.replace(/[\s,₹$€£]/g, "").replace(/^(INR|USD|EUR|GBP|AED|SGD|AUD)/i, "");
  const match = /^(\d{1,9})(?:\.(\d+))?$/.exec(cleaned);
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  if (fraction.length > fractionDigits) return null;
  return Number(whole) * 10 ** fractionDigits + Number(fraction.padEnd(fractionDigits, "0") || "0");
}

/** Minor units → plain major-unit string for form fields ("250000" → "2500", "250050" → "2500.50"). */
export function minorToMajorInput(amountMinor: number, fractionDigits = 2): string {
  const whole = Math.floor(amountMinor / 10 ** fractionDigits);
  const fraction = amountMinor % 10 ** fractionDigits;
  return fraction ? `${whole}.${String(fraction).padStart(fractionDigits, "0")}` : String(whole);
}
