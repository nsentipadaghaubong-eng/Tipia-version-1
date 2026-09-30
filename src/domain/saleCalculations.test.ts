import { describe, expect, it } from "vitest";
import { calculateSaleAmounts, calculateSaleLineAmount } from "./saleCalculations";

describe("calculateSaleLineAmount", () => {
    it("multiplies one quantity by one unit price", () => {
        expect(calculateSaleLineAmount(1, 12)).toBe(12);
    });

    it("multiplies a quantity by a unit price", () => {
        expect(calculateSaleLineAmount(5, 12)).toBe(60);
    });

    it("returns zero for a zero unit price", () => {
        expect(calculateSaleLineAmount(5, 0)).toBe(0);
    });

    it("preserves fractional price arithmetic without rounding", () => {
        expect(calculateSaleLineAmount(3, 1.2345)).toBe(3.7035);
    });

    it("preserves JavaScript NaN propagation", () => {
        expect(Number.isNaN(calculateSaleLineAmount(0, Number.POSITIVE_INFINITY))).toBe(true);
    });
});

describe("calculateSaleAmounts", () => {
    it("returns zero amounts for an empty sale with no discount", () => {
        expect(calculateSaleAmounts([], 0)).toEqual({ subtotal: 0, grandTotal: 0 });
    });

    it("calculates one line", () => {
        expect(calculateSaleAmounts([{ quantity: 2, unitPrice: 15 }], 0))
            .toEqual({ subtotal: 30, grandTotal: 30 });
    });

    it("sums multiple lines with different quantities and prices", () => {
        expect(calculateSaleAmounts([
            { quantity: 2, unitPrice: 15 },
            { quantity: 3, unitPrice: 7 },
        ], 0)).toEqual({ subtotal: 51, grandTotal: 51 });
    });

    it("includes a zero-priced item in the sum without changing it", () => {
        expect(calculateSaleAmounts([
            { quantity: 2, unitPrice: 15 },
            { quantity: 5, unitPrice: 0 },
        ], 0)).toEqual({ subtotal: 30, grandTotal: 30 });
    });

    it("does not round subtotal or total values", () => {
        expect(calculateSaleAmounts([
            { quantity: 1, unitPrice: 0.1 },
            { quantity: 1, unitPrice: 0.2 },
        ], 0)).toEqual({ subtotal: 0.30000000000000004, grandTotal: 0.30000000000000004 });
    });

    it("applies zero discount unchanged", () => {
        expect(calculateSaleAmounts([{ quantity: 2, unitPrice: 15 }], 0))
            .toEqual({ subtotal: 30, grandTotal: 30 });
    });

    it("subtracts a discount smaller than the subtotal", () => {
        expect(calculateSaleAmounts([{ quantity: 2, unitPrice: 15 }], 5))
            .toEqual({ subtotal: 30, grandTotal: 25 });
    });

    it("returns zero when discount equals the subtotal", () => {
        expect(calculateSaleAmounts([{ quantity: 2, unitPrice: 15 }], 30))
            .toEqual({ subtotal: 30, grandTotal: 0 });
    });

    it("clamps the total to zero when discount exceeds the subtotal", () => {
        expect(calculateSaleAmounts([{ quantity: 2, unitPrice: 15 }], 40))
            .toEqual({ subtotal: 30, grandTotal: 0 });
    });

    it("treats a negative discount as zero in the total", () => {
        expect(calculateSaleAmounts([{ quantity: 2, unitPrice: 15 }], -5))
            .toEqual({ subtotal: 30, grandTotal: 30 });
    });

    it("preserves JavaScript NaN propagation for a NaN discount", () => {
        const amounts = calculateSaleAmounts([{ quantity: 2, unitPrice: 15 }], Number.NaN);

        expect(amounts.subtotal).toBe(30);
        expect(Number.isNaN(amounts.grandTotal)).toBe(true);
    });

    it("preserves JavaScript number behavior for infinite discounts", () => {
        expect(calculateSaleAmounts([{ quantity: 2, unitPrice: 15 }], Number.POSITIVE_INFINITY))
            .toEqual({ subtotal: 30, grandTotal: 0 });
        expect(calculateSaleAmounts([{ quantity: 2, unitPrice: 15 }], Number.NEGATIVE_INFINITY))
            .toEqual({ subtotal: 30, grandTotal: 30 });
    });
});