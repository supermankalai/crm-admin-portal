import { describe, expect, it } from "vitest";
import { calculateTax, divideRoundHalfEven, formatMoney, invoiceTotals } from "@/domain/money";

describe("money", () => {
  it("rounds half to even", () => {
    expect(divideRoundHalfEven(5, 2)).toBe(2); // 2.5 → 2
    expect(divideRoundHalfEven(7, 2)).toBe(4); // 3.5 → 4
    expect(divideRoundHalfEven(10, 4)).toBe(2); // 2.5 → 2
    expect(divideRoundHalfEven(11, 4)).toBe(3); // 2.75 → 3
    expect(divideRoundHalfEven(9, 4)).toBe(2); // 2.25 → 2
  });

  it("calculates tax in basis points on integer minor units", () => {
    expect(calculateTax(250_000, 1800)).toBe(45_000); // ₹2,500 × 18%
    expect(calculateTax(999, 1800)).toBe(180); // 179.82 → 180
    expect(calculateTax(1_25, 1000)).toBe(12); // 12.5 → 12 (even)
    expect(calculateTax(1_35, 1000)).toBe(14); // 13.5 → 14 (even)
    expect(calculateTax(100, 0)).toBe(0);
  });

  it("builds invoice totals where total = subtotal + tax", () => {
    expect(invoiceTotals(675_000, 1800)).toEqual({ subtotalMinor: 675_000, taxMinor: 121_500, totalMinor: 796_500 });
  });

  it("rejects floats and invalid rates", () => {
    expect(() => calculateTax(10.5, 1800)).toThrow(RangeError);
    expect(() => calculateTax(100, 10_001)).toThrow(RangeError);
    expect(() => calculateTax(100, 18.5)).toThrow(RangeError);
  });

  it("formats minor units for display", () => {
    expect(formatMoney(250_000, "INR")).toBe("₹2,500.00");
  });
});
