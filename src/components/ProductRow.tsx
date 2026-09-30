import type { Product } from "../types/Product";
import type { CurrentStockEntry } from "../database/database";
import type { StockBreakdownEntry } from "../domain/stockBreakdown";
import { classifyExpiry } from "../domain/expirySemantics";
import { getCurrentCalendarDate } from "../utils/expiry";

interface ProductRowProps {
    product: Product;
    stockEntries?: CurrentStockEntry[];
    stockBreakdowns: Array<{ variantId: string; entries: StockBreakdownEntry[] }>;
    onView: (product: Product) => void;
    onUpdate: (product: Product) => void;
    onDelete: (product: Product) => void;
}

const formatStockSummary = (
    product: Product,
    stockEntries: CurrentStockEntry[] = [],
    stockBreakdowns: Array<{ variantId: string; entries: StockBreakdownEntry[] }>
) => {
    if (stockEntries.length === 0) {
        return "No stock";
    }

    const summaries: string[] = [];
    for (const variant of product.variants) {
        const variantEntries = stockEntries.filter((entry) => entry.variantId === variant.id);
        if (variantEntries.length === 0) continue;

        const breakdown = stockBreakdowns.find((entry) => entry.variantId === variant.id)?.entries ?? [];
        const variantSummary = breakdown
            .map(({ quantity, packagingUnitName }) =>
                `${quantity} ${packagingUnitName || "unit"}${quantity === 1 ? "" : "s"}`
            )
            .join(" + ") || "0";
        summaries.push(variantSummary);
    }

    return summaries.join(" / ") || "No stock";
};

const formatExpirySummary = (stockEntries: CurrentStockEntry[] = []) => {
    const validDates = stockEntries
        .map((entry) => entry.expiryDate?.trim())
        .filter((value): value is string => Boolean(value));

    if (validDates.length === 0) {
        return "No expiry tracked";
    }

    const earliest = [...new Set(validDates)].sort()[0];
    const classification = classifyExpiry(earliest, getCurrentCalendarDate());

    if (classification.state === "invalid") return "Invalid expiry date";
    if (classification.state === "expired") {
        return `Expired ${Math.abs(classification.daysUntilExpiry)} days ago`;
    }
    if (classification.state === "expiresToday") return "Expires today";
    if (classification.state === "expiringSoon" || classification.state === "valid") {
        if (classification.daysUntilExpiry === 1) return "1 day left";
        return `${classification.daysUntilExpiry} days left`;
    }

    return "No expiry tracked";
};

const ProductRow = (props: ProductRowProps) => {
    const stockSummary = formatStockSummary(
        props.product,
        props.stockEntries ?? [],
        props.stockBreakdowns
    );
    const expirySummary = formatExpirySummary(props.stockEntries ?? []);

    return (
        <div>
            <div><h3>{props.product.name}</h3></div>
            <div><p>{props.product.genericName}</p></div>
            <div><p>{props.product.category}</p></div>
            <div><p>{props.product.barcode}</p></div>
            <div><p><strong>Current Stock:</strong> {stockSummary}</p></div>
            <div><p><strong>Expiry:</strong> {expirySummary}</p></div>
            <div><p>{props.product.status}</p></div>

            <button onClick={() => props.onView(props.product)}>View</button>
            <button onClick={() => props.onUpdate(props.product)}>Edit</button>
            <button onClick={() => props.onDelete(props.product)}>Delete</button>
        </div>
    );
};

export default ProductRow;