import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Product } from "../types/Product";
import CreateProductForm from "./CreateProductForm";

const product: Product = {
    id: "product-1",
    name: "Test medicine",
    genericName: "Test ingredient",
    category: "Test",
    manufacturer: "Test manufacturer",
    nafdacNumber: "",
    barcode: "",
    sku: "",
    lowStockLevel: 5,
    trackBatches: true,
    trackExpiry: true,
    status: "active",
    variants: [{
        id: "variant-1",
        productId: "product-1",
        strength: "10",
        strengthUnit: "mg",
        form: "Tablet",
        packagingUnits: [{
            id: "pack",
            name: "Pack",
            costPrice: 50,
            sellingPrice: 70,
            isDefault: true,
        }],
    }],
};

describe("CreateProductForm Product-only edit mode", () => {
    it("hides physical stock controls but keeps Product-level packaging prices", () => {
        const markup = renderToStaticMarkup(
            <CreateProductForm
                existingProducts={[product]}
                initialProduct={product}
                onSave={vi.fn()}
                onEdit={vi.fn()}
                onCancel={vi.fn()}
            />
        );

        expect(markup).not.toContain("Current Stock");
        expect(markup).not.toContain("Batch Number");
        expect(markup).not.toContain("Expiry Date");
        expect(markup).not.toContain("So you are starting with:");
        expect(markup).toContain("Cost Price:");
        expect(markup).toContain("Selling Price:");
        expect(markup).toContain("Edit reason *:");
    });
});