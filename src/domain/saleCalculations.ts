import type { SaleItem } from "../types/Product";

export type SaleCalculationItem = Pick<SaleItem, "quantity" | "unitPrice">;

export type SaleAmounts = {
    subtotal: number;
    grandTotal: number;
};

export const calculateSaleLineAmount = (quantity: number, unitPrice: number): number =>
    quantity * unitPrice;

export const calculateSaleAmounts = (
    items: readonly SaleCalculationItem[],
    discount: number
): SaleAmounts => {
    const subtotal = items.reduce(
        (total, item) => total + calculateSaleLineAmount(item.quantity, item.unitPrice),
        0
    );

    return {
        subtotal,
        grandTotal: Math.max(0, subtotal - Math.max(0, discount)),
    };
};