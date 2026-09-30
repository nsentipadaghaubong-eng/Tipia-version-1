import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadMock, getProductsMock, getCurrentCalendarDateMock } = vi.hoisted(() => ({
    loadMock: vi.fn(),
    getProductsMock: vi.fn(),
    getCurrentCalendarDateMock: vi.fn(() => "2026-09-29"),
}));

vi.mock("@tauri-apps/plugin-sql", () => ({
    default: { load: loadMock },
}));

vi.mock("./productRepository", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./productRepository")>();
    return { ...actual, getProducts: getProductsMock };
});

vi.mock("../utils/expiry", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../utils/expiry")>();
    return { ...actual, getCurrentCalendarDate: getCurrentCalendarDateMock };
});

import Database from "@tauri-apps/plugin-sql";
import type { Product } from "../types/Product";
import type { InventoryStockRow } from "./inventoryRepository";
import { getDashboardSummary } from "./database";

const dashboardProduct: Product = {
    id: "product-1",
    name: "Dashboard test product",
    genericName: "Test ingredient",
    category: "Test",
    manufacturer: "Test manufacturer",
    lowStockLevel: 8,
    trackBatches: true,
    trackExpiry: true,
    status: "active",
    variants: [{
        id: "variant-1",
        productId: "product-1",
        form: "Tablet",
        packagingUnits: [{ id: "unit-1", name: "Unit", isDefault: true }],
    }],
};

const makeStockRow = (
    id: string,
    quantity: number,
    expiryDate: string | null
): InventoryStockRow => ({
    id,
    productId: "product-1",
    variantId: "variant-1",
    packagingUnitId: "unit-1",
    quantity,
    batchNumber: null,
    expiryDate,
    costPrice: 1,
    sellingPrice: 2,
});

describe("Dashboard canonical inventory read", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("preserves positive filtering, row order, expiry buckets, and quantities", async () => {
        const stockRows = [
            makeStockRow("near-91", 1, "2026-12-29"),
            makeStockRow("expired-late", 1, "2026-09-28"),
            makeStockRow("zero-expired", 0, "2026-09-01"),
            makeStockRow("today", 1, "2026-09-29"),
            makeStockRow("invalid", 1, "2026-02-30"),
            makeStockRow("near-90", 1, "2026-12-28"),
            makeStockRow("missing", 1, null),
            makeStockRow("expired-early", 1, "2026-09-20"),
        ];
        const select = vi.fn(async (sql: string) =>
            sql.includes("FROM inventory_stock") ? stockRows : []
        );
        vi.mocked(Database.load).mockResolvedValue({ select } as never);
        vi.mocked(getProductsMock).mockResolvedValue([dashboardProduct]);

        const summary = await getDashboardSummary();

        expect(summary.expired.map((line) => line.id)).toEqual(["expired-early", "expired-late"]);
        expect(summary.expiresToday.map((line) => line.id)).toEqual(["today"]);
        expect(summary.nearExpiry.map((line) => line.id)).toEqual(["near-90"]);
        expect(summary.lowStock.map((entry) => entry.quantity)).toEqual([7]);
        expect(summary.outOfStock).toEqual([]);

        expect(select).toHaveBeenCalledTimes(1);
        const [sql] = select.mock.calls[0];
        expect(sql).toContain("FROM inventory_stock");
        expect(sql).not.toContain("WHERE quantity > 0");
        expect(getCurrentCalendarDateMock).toHaveBeenCalledTimes(1);
    });
});