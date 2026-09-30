import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }));

vi.mock("@tauri-apps/plugin-sql", () => ({
    default: { load: loadMock },
}));

import Database from "@tauri-apps/plugin-sql";
import {
    getCurrentStockForAllProducts,
    getCurrentStockForProduct,
} from "./database";
import {
    getInventoryStockByProduct,
    getInventoryStockForAllProducts,
    selectInventoryStockRowsByVariant,
    selectRawInventoryStockRows,
    type InventoryStockRow,
} from "./inventoryRepository";

const stockRows: InventoryStockRow[] = [
    {
        id: "stock-card-zero",
        productId: "product-1",
        variantId: "variant-1",
        packagingUnitId: "card",
        quantity: 0,
        batchNumber: null,
        expiryDate: null,
        costPrice: 5,
        sellingPrice: 7,
    },
    {
        id: "stock-pack-null-expiry",
        productId: "product-1",
        variantId: "variant-1",
        packagingUnitId: "pack",
        quantity: 3,
        batchNumber: null,
        expiryDate: null,
        costPrice: 50,
        sellingPrice: 70,
    },
    {
        id: "stock-other-variant",
        productId: "product-1",
        variantId: "variant-2",
        packagingUnitId: "bottle",
        quantity: 4,
        batchNumber: "batch-2",
        expiryDate: "2030-01-01",
        costPrice: 100,
        sellingPrice: 120,
    },
    {
        id: "stock-other-product",
        productId: "product-2",
        variantId: "variant-1",
        packagingUnitId: "sachet",
        quantity: 2,
        batchNumber: "batch-3",
        expiryDate: "2029-01-01",
        costPrice: 10,
        sellingPrice: 15,
    },
];

const select = vi.fn(async (sql: string, bindings: unknown[] = []) => {
    let selectedRows = stockRows;
    if (sql.includes("WHERE product_id = ?")) {
        selectedRows = selectedRows.filter((row) => row.productId === bindings[0]);
    }
    if (sql.includes("variant_id = ?")) {
        const bindingIndex = sql.includes("product_id = ?") ? 1 : 0;
        selectedRows = selectedRows.filter((row) => row.variantId === bindings[bindingIndex]);
    }
    return selectedRows;
});

const db = { select };

describe("canonical raw inventory stock reads", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(Database.load).mockResolvedValue(db as never);
    });

    it("returns all physical rows unchanged, including zero quantities and null batch/expiry", async () => {
        await expect(getInventoryStockForAllProducts()).resolves.toEqual(stockRows);

        const [sql, bindings] = select.mock.calls[0];
        expect(sql).toContain("batch_number AS batchNumber");
        expect(sql).toContain("expiry_date AS expiryDate");
        expect(sql).toContain("cost_price AS costPrice");
        expect(sql).toContain("selling_price AS sellingPrice");
        expect(sql).toContain("ORDER BY product_id, variant_id, packaging_unit_id, expiry_date ASC, id ASC");
        expect(sql).not.toContain("quantity > 0");
        expect(bindings).toEqual([]);
    });

    it("returns product-scoped physical rows with the existing product ordering", async () => {
        await expect(getInventoryStockByProduct("product-1")).resolves.toEqual(stockRows.slice(0, 3));

        const [sql, bindings] = select.mock.calls[0];
        expect(sql).toContain("WHERE product_id = ?");
        expect(sql).toContain("ORDER BY variant_id, packaging_unit_id, expiry_date ASC, id ASC");
        expect(sql).not.toContain("quantity > 0");
        expect(bindings).toEqual(["product-1"]);
    });

    it("supports combined product and variant scope without changing row shape", async () => {
        await expect(selectRawInventoryStockRows(db as never, {
            productId: "product-1",
            variantId: "variant-2",
        })).resolves.toEqual([stockRows[2]]);

        const [sql, bindings] = select.mock.calls[0];
        expect(sql).toContain("WHERE product_id = ? AND variant_id = ?");
        expect(bindings).toEqual(["product-1", "variant-2"]);
    });

    it("routes variant availability reads through the canonical raw inventory selector", async () => {
        await expect(selectInventoryStockRowsByVariant(db as never, "product-1", "variant-1")).resolves.toEqual([
            { ...stockRows[1], batchNumber: null, expiryDate: null },
        ]);

        const [sql, bindings] = select.mock.calls[0];
        expect(sql).toContain("WHERE product_id = ? AND variant_id = ?");
        expect(bindings).toEqual(["product-1", "variant-1"]);
    });

    it("keeps the product current-stock response mapping unchanged through the canonical read", async () => {
        await expect(getCurrentStockForProduct("product-1")).resolves.toEqual([
            {
                ...stockRows[0],
                batchNumber: undefined,
                expiryDate: undefined,
            },
            {
                ...stockRows[1],
                batchNumber: undefined,
                expiryDate: undefined,
            },
            stockRows[2],
        ]);

        expect(select).toHaveBeenCalledTimes(1);
        expect(select.mock.calls[0][0]).toContain("WHERE product_id = ?");
        expect(select.mock.calls[0][1]).toEqual(["product-1"]);
    });

    it("keeps the all-products current-stock grouping and null mapping unchanged", async () => {
        await expect(getCurrentStockForAllProducts()).resolves.toEqual({
            "product-1": [
                {
                    id: stockRows[0].id,
                    variantId: stockRows[0].variantId,
                    packagingUnitId: stockRows[0].packagingUnitId,
                    quantity: stockRows[0].quantity,
                    batchNumber: undefined,
                    expiryDate: undefined,
                    costPrice: stockRows[0].costPrice,
                    sellingPrice: stockRows[0].sellingPrice,
                },
                {
                    id: stockRows[1].id,
                    variantId: stockRows[1].variantId,
                    packagingUnitId: stockRows[1].packagingUnitId,
                    quantity: stockRows[1].quantity,
                    batchNumber: undefined,
                    expiryDate: undefined,
                    costPrice: stockRows[1].costPrice,
                    sellingPrice: stockRows[1].sellingPrice,
                },
                {
                    id: stockRows[2].id,
                    variantId: stockRows[2].variantId,
                    packagingUnitId: stockRows[2].packagingUnitId,
                    quantity: stockRows[2].quantity,
                    batchNumber: stockRows[2].batchNumber,
                    expiryDate: stockRows[2].expiryDate,
                    costPrice: stockRows[2].costPrice,
                    sellingPrice: stockRows[2].sellingPrice,
                },
            ],
            "product-2": [{
                id: stockRows[3].id,
                variantId: stockRows[3].variantId,
                packagingUnitId: stockRows[3].packagingUnitId,
                quantity: stockRows[3].quantity,
                batchNumber: stockRows[3].batchNumber,
                expiryDate: stockRows[3].expiryDate,
                costPrice: stockRows[3].costPrice,
                sellingPrice: stockRows[3].sellingPrice,
            }],
        });

        expect(select).toHaveBeenCalledTimes(1);
        expect(select.mock.calls[0][0]).not.toContain("WHERE");
        expect(select.mock.calls[0][1]).toEqual([]);
    });
});