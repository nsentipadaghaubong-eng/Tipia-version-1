import type { Product } from "../types/Product";
import { formatStockByPackagingHierarchy, type CurrentStockEntry } from "../database/database";
import { getDaysUntilExpiry } from "../utils/expiry";

interface ProductRowProps {
    product: Product;
    stockEntries?: CurrentStockEntry[];
    onView: (product: Product) => void;
    onUpdate: (product: Product) => void;
    onDelete: (product: Product) => void;
}

const formatStockSummary = (product: Product, stockEntries: CurrentStockEntry[] = []) => {
    if (stockEntries.length === 0) {
        return "No stock";
    }

    const summaries: string[] = [];
    for (const variant of product.variants) {
        const variantEntries = stockEntries.filter((entry) => entry.variantId === variant.id);
        if (variantEntries.length === 0) continue;

        const variantSummary = formatStockByPackagingHierarchy(variant, variantEntries.map((entry) => ({
            packagingUnitId: entry.packagingUnitId,
            quantity: entry.quantity,
        })));
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
    const days = getDaysUntilExpiry(earliest);

    if (days < 0) return `Expired ${Math.abs(days)} days ago`;
    if (days === 0) return "Expires today";
    if (days === 1) return "1 day left";
    return `${days} days left`;
};

const ProductRow = (props: ProductRowProps) => {
    const stockSummary = formatStockSummary(props.product, props.stockEntries ?? []);
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