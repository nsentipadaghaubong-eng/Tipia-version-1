import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }));

vi.mock("@tauri-apps/plugin-sql", () => ({
    default: { load: loadMock },
}));

import Database from "@tauri-apps/plugin-sql";
import {
    convertQuantityToSmallest,
    adjustInventory,
    createProduct,
    createSale,
    getAvailableQuantityInUnit,
    getConversionFactor,
    getSaleStockAllocationPreview,
    getVariantAvailabilityByPackagingUnit,
    initializeDatabase,
    deleteProduct,
    saveSaleDraft,
    updateProduct,
} from "./database";
import { receiveDelivery, saveDeliveryDraft } from "./deliveryWorkflow";
import { addInventoryStock, setInventoryStockEntry } from "./inventory";
import * as activityRepository from "./activityRepository";
import type { Delivery, DeliveryItems, PackagingUnit, Product, Sale } from "../types/Product";
import type { ActivityRecord } from "../types/Activity";
import type { InventoryAdjustmentInput, InventoryStockValues } from "../types/Inventory";
import {
    calculateStockBreakdown,
    type RawInventoryStockEntry,
} from "../domain/stockBreakdown";

type StockRow = {
    id: string;
    productId: string;
    variantId: string;
    packagingUnitId: string;
    quantity: number;
    batchNumber: string | null;
    expiryDate: string | null;
    costPrice: number;
    sellingPrice: number;
};

type TestState = {
    products: string[];
    productNames: Record<string, string>;
    productStatuses: Record<string, string>;
    productSnapshots: Record<string, Product>;
    variants: string[];
    variantProductIds: Record<string, string>;
    packagingUnits: Array<Record<string, unknown>>;
    inventory: StockRow[];
    activities: ActivityRecord[];
    deliveries: string[];
    deliveryStatuses: Record<string, string>;
    deliveryHeaders: Record<string, Omit<Delivery, "items" | "status">>;
    deliveryItems: unknown[][];
    sales: string[];
    saleStatuses: Record<string, string>;
    saleItems: unknown[][];
};

type TestDatabase = {
    state: TestState;
    select: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
    failures: {
        activityInsert: boolean;
        productUpdate: boolean;
        inventoryUpdate: boolean;
        inventoryUpdateOnCall: number | null;
        inventoryInsert: boolean;
        deliveryItemInsert: boolean;
        deliveryUpdate: boolean;
    };
};

const packagingUnits: PackagingUnit[] = [
    { id: "pack", name: "Pack", contains: { quantity: 12, unitId: "sachet" }, costPrice: 500, sellingPrice: 700, isDefault: true },
    { id: "sachet", name: "Sachet", contains: { quantity: 10, unitId: "card" }, costPrice: 50, sellingPrice: 70, isDefault: false },
    { id: "card", name: "Card", costPrice: 5, sellingPrice: 7, isDefault: false },
];

const packagingRows = [
    { id: "pack", variantId: "variant-1", name: "Pack", level: 1, containsQuantity: 12, containsUnitId: "sachet", costPrice: 500, sellingPrice: 700, isDefault: 1 },
    { id: "sachet", variantId: "variant-1", name: "Sachet", level: 2, containsQuantity: 10, containsUnitId: "card", costPrice: 50, sellingPrice: 70, isDefault: 0 },
    { id: "card", variantId: "variant-1", name: "Card", level: 3, containsQuantity: null, containsUnitId: null, costPrice: 5, sellingPrice: 7, isDefault: 0 },
];

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
        packagingUnits,
    }],
};

const deliveryItem: DeliveryItems = {
    id: "delivery-item-1",
    deliveryId: "delivery-1",
    productId: "product-1",
    variantId: "variant-1",
    packagingUnitId: "pack",
    quantity: 2,
    batchNumber: "batch-1",
    expiryDate: "2030-01-01",
    costPrice: 500,
    sellingPrice: 700,
};

const saleFor = (quantity: number, packagingUnitId = "card"): Sale => ({
    id: "sale-1",
    date: "2026-09-28",
    soldBy: "Tester",
    totalAmount: quantity * 7,
    status: "completed",
    items: [{
        id: "sale-item-1",
        saleId: "sale-1",
        productId: "product-1",
        variantId: "variant-1",
        packagingUnitId,
        quantity,
        unitPrice: 7,
    }],
});

const makeStockRow = (overrides: Partial<StockRow> = {}): StockRow => ({
    id: "stock-sachet-1",
    productId: "product-1",
    variantId: "variant-1",
    packagingUnitId: "sachet",
    quantity: 1,
    batchNumber: "batch-sachet",
    expiryDate: "2027-01-01",
    costPrice: 50,
    sellingPrice: 70,
    ...overrides,
});

const makeDatabase = (initialInventory: StockRow[] = []): TestDatabase => {
    const state: TestState = {
        products: [],
        productNames: {},
        productStatuses: {},
        productSnapshots: {},
        variants: [],
        variantProductIds: {},
        packagingUnits: [],
        inventory: initialInventory.map((row) => ({ ...row })),
        activities: [],
        deliveries: [],
        deliveryStatuses: {},
        deliveryHeaders: {},
        deliveryItems: [],
        sales: [],
        saleStatuses: {},
        saleItems: [],
    };
    const failures = {
        activityInsert: false,
        productUpdate: false,
        inventoryUpdate: false,
        inventoryUpdateOnCall: null as number | null,
        inventoryInsert: false,
        deliveryItemInsert: false,
        deliveryUpdate: false,
    };
    let inventoryUpdateCalls = 0;
    let transactionSnapshot: TestState | null = null;

    const select = vi.fn(async (sql: string, bindings: unknown[] = []) => {
        if (sql.includes("FROM packaging_units")) {
            if (sql.includes("WHERE variant_id = ?")) {
                const matchingUnits = state.packagingUnits.filter((unit) => unit.variantId === bindings[0]);
                if (sql.includes("contains_quantity AS containsQuantity")) {
                    return matchingUnits.length > 0 ? matchingUnits : packagingRows;
                }
                return matchingUnits.length > 0 ? matchingUnits.map(({ id }) => ({ id })) : packagingRows;
            }
            if (sql.includes("WHERE id = ?")) {
                const unitId = String(bindings[0]);
                const matchingUnit = state.packagingUnits.find((unit) => unit.id === unitId)
                    ?? packagingRows.find((unit) => unit.id === unitId);
                if (sql.includes("AND variant_id = ?") && matchingUnit?.variantId !== String(bindings[1])) return [];
                return [{ variantId: matchingUnit?.variantId ?? "variant-1", id: unitId }];
            }
            return [];
        }
        if (sql.includes("FROM inventory_stock")) {
            if (sql.includes("WHERE id = ?")) {
                return state.inventory
                    .filter((row) => row.id === bindings[0])
                    .map(({ id }) => ({ id }));
            }
            if (sql.includes("WHERE product_id = ?") && sql.includes("packaging_unit_id = ?")) {
                const [productId, variantId, unitId, batch, expiry] = bindings;
                const matches = state.inventory.filter((row) =>
                    row.productId === productId &&
                    row.variantId === variantId &&
                    row.packagingUnitId === unitId &&
                    (row.batchNumber ?? "") === (batch ?? "") &&
                    (row.expiryDate ?? "") === (expiry ?? "")
                );
                return sql.includes("quantity")
                    ? matches.map(({ id, quantity }) => ({ id, quantity }))
                    : matches.map(({ id }) => ({ id }));
            }
            const rows = state.inventory.filter((row) =>
                row.productId === bindings[0] &&
                (!sql.includes("variant_id = ?") || row.variantId === bindings[1])
            );
            if (sql.includes("SELECT id, quantity")) {
                return rows.map(({ id, quantity }) => ({ id, quantity }));
            }
            return rows.map((row) => ({ ...row }));
        }
        if (sql.includes("FROM products")) {
            const id = String(bindings[0] ?? "");
            if (!state.products.includes(id)) return [];
            const snapshot = state.productSnapshots[id] ?? product;
            const row = {
                id,
                name: state.productNames[id] ?? snapshot.name,
                status: state.productStatuses[id] ?? "active",
                genericName: snapshot.genericName,
                category: snapshot.category,
                manufacturer: snapshot.manufacturer,
                nafdacNumber: snapshot.nafdacNumber ?? "",
                barcode: snapshot.barcode ?? "",
                sku: snapshot.sku ?? "",
                lowStockLevel: snapshot.lowStockLevel ?? 5,
                trackBatches: snapshot.trackBatches ? 1 : 0,
                trackExpiry: snapshot.trackExpiry ? 1 : 0,
                createdAt: snapshot.createdAt ?? null,
            };
            if (sql.includes("status != 'archived'") && row.status === "archived") return [];
            return sql.includes("SELECT id FROM") ? [{ id }] : [row];
        }
        if (sql.includes("FROM variants")) {
            if (sql.includes("strength_unit AS strengthUnit")) {
                return (state.productSnapshots[String(bindings[0])]?.variants ?? []).map((variant) => ({
                    id: variant.id,
                    productId: variant.productId,
                    strength: variant.strength ?? "",
                    strengthUnit: variant.strengthUnit ?? "",
                    form: variant.form ?? "",
                }));
            }
            if (sql.includes("WHERE id = ?")) {
                const id = String(bindings[0]);
                const belongsToProduct = bindings[1] === undefined ||
                    state.variantProductIds[id] === undefined ||
                    state.variantProductIds[id] === String(bindings[1]);
                return state.variants.includes(id) && belongsToProduct ? [{ id }] : [];
            }
            if (sql.includes("WHERE product_id = ?")) {
                return state.variants
                    .filter((id) => state.variantProductIds[id] === String(bindings[0]))
                    .map((id) => ({ id }));
            }
            return [];
        }
        if (sql.includes("FROM deliveries")) {
            const deliveryId = String(bindings[0]);
            return state.deliveries.includes(deliveryId)
                ? [{ id: deliveryId, status: state.deliveryStatuses[deliveryId] ?? "draft" }]
                : [];
        }
        if (sql.includes("FROM sales")) {
            const saleId = String(bindings[0]);
            if (!state.sales.includes(saleId)) return [];
            return sql.includes("status")
                ? [{ id: saleId, status: state.saleStatuses[saleId] ?? "completed" }]
                : [{ id: saleId }];
        }
        return [];
    });

    const execute = vi.fn(async (sql: string, bindings: unknown[] = []) => {
        if (sql === "BEGIN") {
            transactionSnapshot = JSON.parse(JSON.stringify(state)) as TestState;
        } else if (sql === "COMMIT") {
            transactionSnapshot = null;
        } else if (sql === "ROLLBACK") {
            if (transactionSnapshot) {
                Object.assign(state, transactionSnapshot);
                transactionSnapshot = null;
            }
        } else if (sql.includes("INSERT INTO activities")) {
            if (failures.activityInsert) throw new Error("Activity insert failed");
            const [id, eventType, occurredAt, entityType, entityId, entityLabel, summary, reason, changes, details] = bindings;
            state.activities.push({
                id: String(id),
                eventType: eventType as ActivityRecord["eventType"],
                occurredAt: String(occurredAt),
                entityType: entityType as ActivityRecord["entityType"],
                entityId: String(entityId),
                entityLabel: String(entityLabel),
                summary: String(summary),
                reason: reason as string | null,
                changes: changes === null ? null : JSON.parse(String(changes)) as ActivityRecord["changes"],
                details: details === null ? null : JSON.parse(String(details)) as ActivityRecord["details"],
            });
        } else if (sql.includes("INSERT INTO products")) {
            state.products.push(String(bindings[0]));
            state.productNames[String(bindings[0])] = String(bindings[1]);
            state.productStatuses[String(bindings[0])] = String(bindings[11]);
        } else if (sql.includes("UPDATE products") && failures.productUpdate) {
            throw new Error("Product update failed");
        } else if (sql.includes("UPDATE products") && sql.includes("status = 'archived'")) {
            state.productStatuses[String(bindings[0])] = "archived";
        } else if (sql.includes("UPDATE products")) {
            const productId = String(bindings[11]);
            state.productNames[productId] = String(bindings[0]);
            state.productStatuses[productId] = String(bindings[10]);
        } else if (sql.includes("UPDATE variants")) {
            const [strength, strengthUnit, form, variantId] = bindings;
            const snapshot = Object.values(state.productSnapshots).find((candidate) => candidate.variants.some((variant) => variant.id === variantId));
            const variant = snapshot?.variants.find((candidate) => candidate.id === variantId);
            if (variant) Object.assign(variant, { strength, strengthUnit, form });
        } else if (sql.includes("INSERT INTO variants")) {
            state.variants.push(String(bindings[0]));
            state.variantProductIds[String(bindings[0])] = String(bindings[1]);
        } else if (sql.includes("INSERT INTO packaging_units")) {
            const [id, variantId, name, level, containsQuantity, containsUnitId, costPrice, sellingPrice, isDefault] = bindings;
            state.packagingUnits.push({ id, variantId, name, level, containsQuantity, containsUnitId, costPrice, sellingPrice, isDefault });
        } else if (sql.includes("UPDATE packaging_units")) {
            const [name, level, containsQuantity, containsUnitId, costPrice, sellingPrice, isDefault, id] = bindings;
            const unit = state.packagingUnits.find((entry) => entry.id === id);
            if (unit) Object.assign(unit, { name, level, containsQuantity, containsUnitId, costPrice, sellingPrice, isDefault });
        } else if (sql.includes("DELETE FROM packaging_units")) {
            state.packagingUnits = state.packagingUnits.filter((unit) => unit.id !== bindings[0] && unit.variantId !== bindings[0]);
        } else if (sql.includes("DELETE FROM variants")) {
            state.variants = state.variants.filter((id) => id !== String(bindings[0]));
        } else if (sql.includes("UPDATE inventory_stock") && (
            failures.inventoryUpdate || ++inventoryUpdateCalls === failures.inventoryUpdateOnCall
        )) {
            throw new Error("Inventory update failed");
        } else if (sql.includes("INSERT INTO inventory_stock")) {
            if (failures.inventoryInsert) throw new Error("Inventory insert failed");
            const [id, productId, variantId, packagingUnitId, quantity, batchNumber, expiryDate, costPrice, sellingPrice] = bindings;
            state.inventory.push({
                id: String(id),
                productId: String(productId),
                variantId: String(variantId),
                packagingUnitId: String(packagingUnitId),
                quantity: Number(quantity),
                batchNumber: batchNumber as string | null,
                expiryDate: expiryDate as string | null,
                costPrice: Number(costPrice),
                sellingPrice: Number(sellingPrice),
            });
        } else if (sql.includes("UPDATE inventory_stock") && sql.includes("quantity = quantity + ?")) {
            const [quantity, id] = bindings;
            const row = state.inventory.find((entry) => entry.id === id);
            if (row) row.quantity += Number(quantity);
        } else if (sql.includes("UPDATE inventory_stock") && sql.includes("variant_id = ?,")) {
            const [variantId, packagingUnitId, quantity, batchNumber, expiryDate, costPrice, sellingPrice, id] = bindings;
            const row = state.inventory.find((entry) => entry.id === id);
            if (row) Object.assign(row, { variantId, packagingUnitId, quantity, batchNumber, expiryDate, costPrice, sellingPrice });
        } else if (sql.includes("UPDATE inventory_stock") && sql.includes("batch_number = ?")) {
            const [quantity, batchNumber, expiryDate, costPrice, sellingPrice, id] = bindings;
            const row = state.inventory.find((entry) => entry.id === id);
            if (row) Object.assign(row, { quantity, batchNumber, expiryDate, costPrice, sellingPrice });
        } else if (sql.includes("UPDATE inventory_stock") && sql.includes("SET quantity = ?")) {
            const [quantity, id] = bindings;
            const row = state.inventory.find((entry) => entry.id === id);
            if (row) row.quantity = Number(quantity);
        } else if (sql.includes("UPDATE inventory_stock")) {
            const [variantId, packagingUnitId, quantity, batchNumber, expiryDate, costPrice, sellingPrice, id] = bindings;
            const row = state.inventory.find((entry) => entry.id === id);
            if (row) Object.assign(row, { variantId, packagingUnitId, quantity, batchNumber, expiryDate, costPrice, sellingPrice });
        } else if (sql.includes("DELETE FROM inventory_stock")) {
            state.inventory = state.inventory.filter((row) => row.id !== bindings[0]);
        } else if (sql.includes("UPDATE deliveries")) {
            if (failures.deliveryUpdate) throw new Error("Delivery update failed");
            const [supplier, invoiceNo, date, receivedBy, status, id] = bindings;
            const deliveryId = String(id);
            state.deliveryStatuses[deliveryId] = String(status);
            state.deliveryHeaders[deliveryId] = {
                id: deliveryId,
                supplier: String(supplier),
                invoiceNo: String(invoiceNo),
                date: String(date),
                receivedBy: String(receivedBy),
            };
        } else if (sql.includes("INSERT INTO deliveries")) {
            const [id, supplier, invoiceNo, date, receivedBy, status] = bindings;
            const deliveryId = String(id);
            state.deliveries.push(deliveryId);
            state.deliveryStatuses[deliveryId] = String(status ?? "draft");
            state.deliveryHeaders[deliveryId] = {
                id: deliveryId,
                supplier: String(supplier),
                invoiceNo: String(invoiceNo),
                date: String(date),
                receivedBy: String(receivedBy),
            };
        } else if (sql.includes("INSERT INTO delivery_items")) {
            if (failures.deliveryItemInsert) throw new Error("Delivery item insert failed");
            state.deliveryItems.push(bindings);
        } else if (sql.includes("DELETE FROM delivery_items")) {
            state.deliveryItems = [];
        } else if (sql.includes("INSERT INTO sales")) {
            const saleId = String(bindings[0]);
            state.sales.push(saleId);
            state.saleStatuses[saleId] = String(bindings[6]);
        } else if (sql.includes("UPDATE sales")) {
            const saleId = String(bindings[6]);
            state.saleStatuses[saleId] = String(bindings[5]);
        } else if (sql.includes("INSERT INTO sale_items")) {
            state.saleItems.push(bindings);
        } else if (sql.includes("DELETE FROM sale_items")) {
            state.saleItems = [];
        }
        return { rowsAffected: 1 };
    });

    return { state, select, execute, failures };
};

const installDatabase = (db: TestDatabase) => {
    vi.mocked(Database.load).mockResolvedValue(db as never);
};

const installExistingProduct = (db: TestDatabase, status: Product["status"] = "active") => {
    db.state.products.push(product.id);
    db.state.productNames[product.id] = product.name;
    db.state.productStatuses[product.id] = status;
    db.state.productSnapshots[product.id] = structuredClone({ ...product, status });
    for (const variant of product.variants) {
        db.state.variants.push(variant.id);
        db.state.variantProductIds[variant.id] = product.id;
        for (let index = 0; index < variant.packagingUnits.length; index++) {
            const unit = variant.packagingUnits[index];
            db.state.packagingUnits.push({
                id: unit.id,
                variantId: variant.id,
                name: unit.name,
                level: index + 1,
                containsQuantity: unit.contains?.quantity ?? null,
                containsUnitId: unit.contains?.unitId ?? null,
                costPrice: unit.costPrice ?? packagingRows.find((row) => row.id === unit.id)?.costPrice ?? null,
                sellingPrice: unit.sellingPrice ?? packagingRows.find((row) => row.id === unit.id)?.sellingPrice ?? null,
                isDefault: unit.isDefault ? 1 : 0,
            });
        }
    }
};

const stockValues = (row: StockRow): InventoryStockValues => ({
    quantity: row.quantity,
    batchNumber: row.batchNumber,
    expiryDate: row.expiryDate,
    costPrice: row.costPrice,
    sellingPrice: row.sellingPrice,
});

const makeInventoryAdjustment = (
    row: StockRow,
    after: Partial<InventoryStockValues>,
    reason = "Stock count correction"
): InventoryAdjustmentInput => ({
    productId: row.productId,
    reason,
    changes: [{
        stockRowId: row.id,
        variantId: row.variantId,
        packagingUnitId: row.packagingUnitId,
        expectedBefore: stockValues(row),
        after: { ...stockValues(row), ...after },
    }],
});

describe("Inventory adjustment workflow", () => {
    beforeEach(() => vi.clearAllMocks());

    it.each([
        ["quantity increase", { quantity: 4 }],
        ["quantity decrease", { quantity: 1 }],
        ["batch correction", { batchNumber: " corrected-batch " }],
        ["blank metadata normalization", { batchNumber: "  ", expiryDate: "" }],
        ["expiry correction", { expiryDate: "2028-02-29" }],
        ["cost price correction", { costPrice: 55 }],
        ["selling price correction", { sellingPrice: 75 }],
        ["multiple field correction", { quantity: 4, batchNumber: "batch-new", costPrice: 60, sellingPrice: 80 }],
    ] as Array<[string, Partial<InventoryStockValues>]>) (
        "applies %s to the existing row and records before/after",
        async (_label, after) => {
            const row = makeStockRow({ quantity: after.quantity === 1 ? 5 : 1 });
            const db = makeDatabase([row]);
            installExistingProduct(db);
            installDatabase(db);

            await adjustInventory(makeInventoryAdjustment(row, after));

            const finalRow = db.state.inventory[0];
            const expectedAfter = {
                ...stockValues(row),
                ...after,
                batchNumber: after.batchNumber === undefined ? row.batchNumber : after.batchNumber?.trim() ? after.batchNumber : null,
                expiryDate: after.expiryDate === undefined ? row.expiryDate : after.expiryDate?.trim() || null,
            };
            expect(stockValues(finalRow)).toEqual(expectedAfter);
            expect(db.state.activities).toHaveLength(1);
            expect(db.state.activities[0]).toMatchObject({
                eventType: "inventory.adjusted",
                entityType: "product",
                entityId: product.id,
                entityLabel: product.name,
                summary: `Inventory adjusted: ${product.name}`,
                reason: "Stock count correction",
                changes: null,
                details: {
                    rows: [{
                        stockRowId: row.id,
                        variantId: row.variantId,
                        packagingUnitId: row.packagingUnitId,
                        before: stockValues(row),
                        after: expectedAfter,
                    }],
                },
            });
            expect(db.execute).toHaveBeenCalledWith("COMMIT");
        }
    );

    it("deletes a row at zero while recording the logical zero after-state", async () => {
        const row = makeStockRow();
        const db = makeDatabase([row]);
        installExistingProduct(db);
        installDatabase(db);

        await adjustInventory(makeInventoryAdjustment(row, { quantity: 0 }));

        expect(db.state.inventory).toEqual([]);
        expect(db.state.activities[0].details).toMatchObject({
            rows: [{ before: stockValues(row), after: { ...stockValues(row), quantity: 0 } }],
        });
    });

    it("adjusts multiple rows in one transaction and writes exactly one Activity event", async () => {
        const first = makeStockRow({ id: "stock-first" });
        const second = makeStockRow({ id: "stock-second", batchNumber: "batch-second", quantity: 5 });
        const db = makeDatabase([first, second]);
        installExistingProduct(db);
        installDatabase(db);
        const input = makeInventoryAdjustment(first, { quantity: 2 });
        input.changes.push({
            stockRowId: second.id,
            variantId: second.variantId,
            packagingUnitId: second.packagingUnitId,
            expectedBefore: stockValues(second),
            after: { ...stockValues(second), quantity: 3 },
        });

        await adjustInventory(input);

        expect(db.state.inventory.map(({ quantity }) => quantity)).toEqual([2, 3]);
        expect(db.state.activities).toHaveLength(1);
        expect(db.state.activities[0].details).toMatchObject({
            rows: [
                { stockRowId: first.id, before: stockValues(first), after: { ...stockValues(first), quantity: 2 } },
                { stockRowId: second.id, before: stockValues(second), after: { ...stockValues(second), quantity: 3 } },
            ],
        });
        expect(db.execute.mock.calls.filter(([sql]) => sql === "BEGIN")).toHaveLength(1);
        expect(db.execute.mock.calls.filter(([sql]) => sql === "COMMIT")).toHaveLength(1);
    });

    it.each([
        ["negative quantity", { quantity: -1 }],
        ["fractional quantity", { quantity: 1.5 }],
        ["infinite quantity", { quantity: Number.POSITIVE_INFINITY }],
        ["negative cost price", { costPrice: -1 }],
        ["non-finite selling price", { sellingPrice: Number.NaN }],
        ["invalid expiry", { expiryDate: "2027-02-29" }],
    ] as Array<[string, Partial<InventoryStockValues>]>) (
        "rejects %s without changing stock",
        async (_label, after) => {
            const row = makeStockRow();
            const db = makeDatabase([row]);
            installExistingProduct(db);
            installDatabase(db);

            await expect(adjustInventory(makeInventoryAdjustment(row, after))).rejects.toThrow();

            expect(db.state.inventory).toEqual([row]);
            expect(db.state.activities).toEqual([]);
            expect(db.execute).toHaveBeenCalledWith("ROLLBACK");
        }
    );

    it.each([
        ["missing row", (row: StockRow) => ({ ...makeInventoryAdjustment(row, { quantity: 2 }), changes: [{ ...makeInventoryAdjustment(row, { quantity: 2 }).changes[0], stockRowId: "missing-row" }] })],
        ["variant mismatch", (row: StockRow) => ({ ...makeInventoryAdjustment(row, { quantity: 2 }), changes: [{ ...makeInventoryAdjustment(row, { quantity: 2 }).changes[0], variantId: "wrong-variant" }] })],
        ["packaging mismatch", (row: StockRow) => ({ ...makeInventoryAdjustment(row, { quantity: 2 }), changes: [{ ...makeInventoryAdjustment(row, { quantity: 2 }).changes[0], packagingUnitId: "wrong-unit" }] })],
        ["no-op change", (row: StockRow) => makeInventoryAdjustment(row, {})],
        ["stale expected values", (row: StockRow) => ({ ...makeInventoryAdjustment(row, { quantity: 2 }), changes: [{ ...makeInventoryAdjustment(row, { quantity: 2 }).changes[0], expectedBefore: { ...stockValues(row), quantity: 99 } }] })],
    ] as Array<[string, (row: StockRow) => InventoryAdjustmentInput]>) (
        "rejects %s",
        async (_label, makeInput) => {
            const row = makeStockRow();
            const db = makeDatabase([row]);
            installExistingProduct(db);
            installDatabase(db);

            await expect(adjustInventory(makeInput(row))).rejects.toThrow();

            expect(db.state.inventory).toEqual([row]);
            expect(db.state.activities).toEqual([]);
        }
    );

    it("rejects invalid product/variant/packaging relationships", async () => {
        const row = makeStockRow({ variantId: "orphan-variant" });
        const db = makeDatabase([row]);
        installExistingProduct(db);
        installDatabase(db);

        await expect(adjustInventory(makeInventoryAdjustment(row, { quantity: 2 })))
            .rejects.toThrow("invalid product, variant, or packaging unit relationship");
        expect(db.state.inventory).toEqual([row]);
    });

    it("strict Inventory mutation rejects a missing row without creating a replacement", async () => {
        const db = makeDatabase();
        installDatabase(db);

        await expect(setInventoryStockEntry(db as never, product.id, {
            id: "missing-stock-row",
            variantId: "variant-1",
            packagingUnitId: "pack",
            quantity: 2,
            costPrice: 50,
            sellingPrice: 70,
        }, { mode: "existing" })).rejects.toThrow("does not exist");

        expect(db.state.inventory).toEqual([]);
        expect(db.execute.mock.calls.some(([sql]) => sql.includes("INSERT INTO inventory_stock"))).toBe(false);
    });

    it("rejects duplicate row IDs and packaging-unit changes", async () => {
        const row = makeStockRow();
        const db = makeDatabase([row]);
        installExistingProduct(db);
        installDatabase(db);
        const duplicate = makeInventoryAdjustment(row, { quantity: 2 });
        duplicate.changes.push({ ...duplicate.changes[0], after: { ...duplicate.changes[0].after, quantity: 3 } });

        await expect(adjustInventory(duplicate)).rejects.toThrow("appears more than once");

        const attempt = makeInventoryAdjustment(row, { quantity: 2 });
        attempt.changes[0].after = {
            ...attempt.changes[0].after,
            packagingUnitId: "card",
        } as unknown as InventoryAdjustmentInput["changes"][number]["after"];
        await expect(adjustInventory(attempt)).rejects.toThrow("cannot change a stock row packaging unit");
        expect(db.state.inventory).toEqual([row]);
        expect(db.execute.mock.calls.filter(([sql]) => sql === "ROLLBACK")).toHaveLength(2);
    });

    it.each(["", "  \n  "]) ("requires a non-whitespace reason (%j)", async (reason) => {
        const row = makeStockRow();
        const db = makeDatabase([row]);
        installExistingProduct(db);
        installDatabase(db);

        await expect(adjustInventory(makeInventoryAdjustment(row, { quantity: 2 }, reason)))
            .rejects.toThrow("reason is required");
        expect(db.state.inventory).toEqual([row]);
        expect(db.state.activities).toEqual([]);
    });

    it("trims the required reason", async () => {
        const row = makeStockRow();
        const db = makeDatabase([row]);
        installExistingProduct(db);
        installDatabase(db);

        await adjustInventory(makeInventoryAdjustment(row, { quantity: 2 }, "  Damaged stock  "));

        expect(db.state.activities[0].reason).toBe("Damaged stock");
    });

    it("rolls back earlier row mutations when a later Inventory mutation fails", async () => {
        const first = makeStockRow({ id: "stock-first" });
        const second = makeStockRow({ id: "stock-second", batchNumber: "batch-second", quantity: 5 });
        const db = makeDatabase([first, second]);
        db.failures.inventoryUpdateOnCall = 2;
        installExistingProduct(db);
        installDatabase(db);
        const input = makeInventoryAdjustment(first, { quantity: 2 });
        input.changes.push({
            stockRowId: second.id,
            variantId: second.variantId,
            packagingUnitId: second.packagingUnitId,
            expectedBefore: stockValues(second),
            after: { ...stockValues(second), quantity: 3 },
        });

        await expect(adjustInventory(input)).rejects.toThrow("Inventory update failed");

        expect(db.state.inventory).toEqual([first, second]);
        expect(db.state.activities).toEqual([]);
        expect(db.execute).toHaveBeenCalledWith("ROLLBACK");
    });

    it("rolls back stock mutations when Activity insertion fails", async () => {
        const row = makeStockRow();
        const db = makeDatabase([row]);
        db.failures.activityInsert = true;
        installExistingProduct(db);
        installDatabase(db);

        await expect(adjustInventory(makeInventoryAdjustment(row, { quantity: 2 })))
            .rejects.toThrow("Activity insert failed");

        expect(db.state.inventory).toEqual([row]);
        expect(db.state.activities).toEqual([]);
        expect(db.execute).toHaveBeenCalledWith("ROLLBACK");
    });
});

describe("Activity schema", () => {
    beforeEach(() => vi.clearAllMocks());

    it("creates the Activity table with required fields and nullable reason", async () => {
        const db = makeDatabase();
        installDatabase(db);

        await initializeDatabase();

        const activitySchema = db.execute.mock.calls
            .map(([sql]) => sql)
            .find((sql) => sql.includes("CREATE TABLE IF NOT EXISTS activities"));
        expect(activitySchema).toBeDefined();
        expect(activitySchema).toContain("id TEXT PRIMARY KEY");
        expect(activitySchema).toContain("event_type TEXT NOT NULL");
        expect(activitySchema).toContain("occurred_at TEXT NOT NULL");
        expect(activitySchema).toContain("entity_type TEXT NOT NULL");
        expect(activitySchema).toContain("entity_id TEXT NOT NULL");
        expect(activitySchema).toContain("entity_label TEXT NOT NULL");
        expect(activitySchema).toContain("summary TEXT NOT NULL");
        expect(activitySchema).toContain("reason TEXT");
        expect(activitySchema).not.toContain("reason TEXT NOT NULL");
        expect(activitySchema).toContain("changes TEXT");
        expect(activitySchema).not.toContain("changes TEXT NOT NULL");
        expect(activitySchema).toContain("details TEXT");
        expect(activitySchema).not.toContain("details TEXT NOT NULL");
        expect(db.execute.mock.calls.some(([sql]) => sql === "ALTER TABLE activities ADD COLUMN changes TEXT")).toBe(true);
        expect(db.execute.mock.calls.some(([sql]) => sql === "ALTER TABLE activities ADD COLUMN details TEXT")).toBe(true);
    });
});

describe("Product Activity workflow", () => {
    beforeEach(() => vi.clearAllMocks());

    it("rejects Product edits without a reason", async () => {
        await expect(updateProduct(product, "")).rejects.toThrow("An edit reason is required");
        expect(loadMock).not.toHaveBeenCalled();
    });

    it("rejects whitespace-only Product edit reasons", async () => {
        await expect(updateProduct(product, "  \n  ")).rejects.toThrow("An edit reason is required");
        expect(loadMock).not.toHaveBeenCalled();
    });

    it("updates Product metadata without mutating stock and records Product-only Activity", async () => {
        const stock = makeStockRow({
            id: "stock-pack-1",
            packagingUnitId: "pack",
            quantity: 2,
            costPrice: 500,
            sellingPrice: 700,
        });
        const db = makeDatabase([stock]);
        installExistingProduct(db);
        installDatabase(db);
        const changedProduct = { ...product, name: "Corrected medicine" };

        await updateProduct(changedProduct, "  Incorrect price  ");

        expect(db.state.productNames[product.id]).toBe("Corrected medicine");
        expect(db.state.inventory).toEqual([stock]);
        expect(db.execute.mock.calls.some(([sql]) => sql.includes("UPDATE inventory_stock"))).toBe(false);
        expect(db.state.activities).toHaveLength(1);
        expect(db.state.activities[0]).toMatchObject({
            eventType: "product.edited",
            entityType: "product",
            entityId: product.id,
            entityLabel: "Corrected medicine",
            summary: "Product edited: Corrected medicine",
            reason: "Incorrect price",
        });
        expect(db.state.activities[0].changes).toEqual([
            { field: "Product name", before: "Test medicine", after: "Corrected medicine" },
        ]);
        expect(db.execute).toHaveBeenCalledWith("COMMIT");
    });

    it("captures Product, variant, packaging, and Product-level price changes", async () => {
        const stock = makeStockRow({
            id: "stock-pack-1",
            packagingUnitId: "pack",
            quantity: 2,
            expiryDate: "2026-10-15",
            costPrice: 500,
            sellingPrice: 700,
        });
        const db = makeDatabase([stock]);
        installExistingProduct(db);
        installDatabase(db);
        const changedProduct: Product = {
            ...product,
            name: "Test medicine extra strength",
            variants: product.variants.map((variant) => ({
                ...variant,
                packagingUnits: variant.packagingUnits.map((unit) =>
                    unit.id === "pack"
                        ? { ...unit, contains: { quantity: 6, unitId: "sachet" }, sellingPrice: 600 }
                        : unit
                ),
                strength: "20",
            })),
        };

        await updateProduct(changedProduct, "Supplier provided corrected product information");

        expect(db.state.activities).toHaveLength(1);
        expect(db.state.activities[0]).toMatchObject({
            eventType: "product.edited",
            reason: "Supplier provided corrected product information",
        });
        expect(db.state.activities[0].changes).toEqual([
            { field: "Product name", before: "Test medicine", after: "Test medicine extra strength" },
            { field: "Variant 10 mg Tablet / Strength", before: "10", after: "20" },
            { field: "Packaging Pack / Contains quantity", before: 12, after: 6 },
            { field: "Packaging Pack / Selling price", before: 700, after: 600 },
        ]);
        expect(db.state.inventory).toEqual([stock]);
        expect(db.state.productSnapshots[product.id].variants[0].strength).toBe("20");
        expect(db.state.packagingUnits.find((unit) => unit.id === "pack")).toMatchObject({
            containsQuantity: 6,
            sellingPrice: 600,
        });
        expect(db.state.activities[0].changes).not.toContainEqual(expect.objectContaining({ field: "Generic name" }));
        expect(db.state.activities[0].changes).not.toContainEqual(expect.objectContaining({ field: expect.stringMatching(/Stock quantity|Stock packaging|Batch number|Expiry date|Stock cost price|Stock selling price/) }));
    });

    it("preserves the existing edit event semantics with an empty change list when nothing changed", async () => {
        const stock = makeStockRow({
            id: "stock-pack-1",
            packagingUnitId: "pack",
            quantity: 2,
            batchNumber: null,
            expiryDate: null,
            costPrice: 500,
            sellingPrice: 700,
        });
        const db = makeDatabase([stock]);
        installExistingProduct(db);
        installDatabase(db);

        await updateProduct(product, "Reviewed and confirmed");

        expect(db.state.activities).toHaveLength(1);
        expect(db.state.activities[0].eventType).toBe("product.edited");
        expect(db.state.activities[0].changes).toEqual([]);
        expect(db.state.inventory).toEqual([stock]);
    });

    it("rolls back Product changes when Activity insertion fails", async () => {
        const db = makeDatabase();
        installExistingProduct(db);
        db.failures.activityInsert = true;
        installDatabase(db);

        await expect(updateProduct({ ...product, name: "Changed name" }, "Correction"))
            .rejects.toThrow("Activity insert failed");

        expect(db.state.productNames[product.id]).toBe(product.name);
        expect(db.state.activities).toEqual([]);
        expect(db.execute).toHaveBeenCalledWith("ROLLBACK");
    });

    it("does not call the Inventory writer during Product editing", async () => {
        const stock = makeStockRow({ id: "stock-pack-1", packagingUnitId: "pack", quantity: 2 });
        const db = makeDatabase([stock]);
        installExistingProduct(db);
        db.failures.inventoryUpdate = true;
        installDatabase(db);

        await updateProduct({ ...product, name: "Changed name" }, "Correction");

        expect(db.state.productNames[product.id]).toBe("Changed name");
        expect(db.state.inventory).toEqual([stock]);
        expect(db.execute.mock.calls.some(([sql]) => sql.includes("UPDATE inventory_stock"))).toBe(false);
        expect(db.state.activities[0].changes).toEqual([
            { field: "Product name", before: product.name, after: "Changed name" },
        ]);
    });

    it("exposes only Product and reason parameters for Product edits", () => {
        expectTypeOf(updateProduct).parameters.toEqualTypeOf<[Product, string]>();
    });

    it("rolls back a Product edit when Product persistence fails", async () => {
        const db = makeDatabase();
        installExistingProduct(db);
        db.failures.productUpdate = true;
        installDatabase(db);

        await expect(updateProduct({ ...product, name: "Changed name" }, "Correction"))
            .rejects.toThrow("Product update failed");

        expect(db.state.productNames[product.id]).toBe(product.name);
        expect(db.state.activities).toEqual([]);
        expect(db.execute).toHaveBeenCalledWith("ROLLBACK");
    });

    it("records a Product archive through the edit form as one archive event", async () => {
        const stock = makeStockRow({ id: "stock-pack-1", packagingUnitId: "pack", quantity: 2 });
        const db = makeDatabase([stock]);
        installExistingProduct(db);
        installDatabase(db);

        await updateProduct({ ...product, status: "archived" }, "No longer stocked");

        expect(db.state.productStatuses[product.id]).toBe("archived");
        expect(db.state.inventory).toEqual([stock]);
        expect(db.execute.mock.calls.some(([sql]) => sql.includes("inventory_stock"))).toBe(false);
        expect(db.state.activities).toHaveLength(1);
        expect(db.state.activities[0].eventType).toBe("product.archived");
        expect(db.state.activities[0].changes).toContainEqual({
            field: "Product status",
            before: "active",
            after: "archived",
        });
    });

    it("records a successful standalone soft archive", async () => {
        const stock = makeStockRow({ id: "stock-pack-1", packagingUnitId: "pack", quantity: 2 });
        const db = makeDatabase([stock]);
        installExistingProduct(db);
        installDatabase(db);

        await deleteProduct(product.id);

        expect(db.state.productStatuses[product.id]).toBe("archived");
        expect(db.state.inventory).toEqual([stock]);
        expect(db.execute.mock.calls.some(([sql]) => sql.includes("inventory_stock"))).toBe(false);
        expect(db.state.activities).toHaveLength(1);
        expect(db.state.activities[0]).toMatchObject({
            eventType: "product.archived",
            entityId: product.id,
            entityLabel: product.name,
            reason: null,
        });
        expect(db.execute).toHaveBeenCalledWith("COMMIT");
    });

    it("rolls back a soft archive when its Activity insertion fails", async () => {
        const db = makeDatabase();
        installExistingProduct(db);
        db.failures.activityInsert = true;
        installDatabase(db);

        await expect(deleteProduct(product.id)).rejects.toThrow("Activity insert failed");

        expect(db.state.productStatuses[product.id]).toBe("active");
        expect(db.state.activities).toEqual([]);
        expect(db.execute).toHaveBeenCalledWith("ROLLBACK");
    });

    it("records successful Product creation and leaves no event on failed creation", async () => {
        const db = makeDatabase();
        installDatabase(db);

        await createProduct(product, [{
            id: "opening-stock",
            packagingUnitId: "pack",
            quantity: 2,
            costPrice: 500,
            sellingPrice: 700,
        }]);

        expect(db.state.activities).toHaveLength(1);
        expect(db.state.activities[0]).toMatchObject({
            eventType: "product.created",
            entityType: "product",
            entityId: product.id,
            entityLabel: product.name,
            summary: `Product created: ${product.name}`,
            reason: null,
            changes: null,
            details: {
                genericName: product.genericName,
                manufacturer: product.manufacturer,
                category: product.category,
                variants: [{
                    label: "10 mg Tablet",
                    initialQuantities: [{ quantity: 2, packagingUnitName: "Pack" }],
                }],
            },
        });

        const failedDb = makeDatabase();
        installDatabase(failedDb);
        await expect(createProduct(product, [{
            id: "bad-stock",
            packagingUnitId: "pack",
            quantity: 0.5,
            costPrice: 500,
            sellingPrice: 700,
        }])).rejects.toThrow("Stock quantity must be a non-negative whole number");
        expect(failedDb.state.activities).toEqual([]);
    });

    it("exposes only insert/read operations for immutable Activity records", () => {
        expect(Object.keys(activityRepository).sort()).toEqual([
            "getActivityRecords",
            "insertActivityRecord",
        ]);
    });
});

describe("Stage 1 behavior characterization", () => {
    beforeEach(() => vi.clearAllMocks());

    describe("persistence-contract: stock writers", () => {
        it("Inventory rejects fractional stock additions and leaves stock unchanged", async () => {
            const db = makeDatabase();

            await expect(addInventoryStock(db as never, { ...deliveryItem, quantity: 0.5 }))
                .rejects.toThrow("Stock quantity must be a non-negative whole number");

            expect(db.state.inventory).toEqual([]);
        });

        it("Inventory increments a matching physical-unit batch", async () => {
            const db = makeDatabase([makeStockRow({ quantity: 4 })]);
            installExistingProduct(db);

            await addInventoryStock(db as never, { ...deliveryItem, packagingUnitId: "sachet", quantity: 3, batchNumber: "batch-sachet", expiryDate: "2027-01-01" });

            expect(db.state.inventory).toHaveLength(1);
            expect(db.state.inventory[0]).toMatchObject({ packagingUnitId: "sachet", quantity: 7 });
        });

        it("Inventory stores a fractional quantity unchanged in the submitted unit", async () => {
            const db = makeDatabase();

            await setInventoryStockEntry(db as never, "product-1", {
                id: "stock-pack-1",
                packagingUnitId: "pack",
                quantity: 8.875,
                costPrice: 500,
                sellingPrice: 700,
            });

            expect(db.state.inventory).toEqual([expect.objectContaining({
                id: "stock-pack-1",
                productId: "product-1",
                variantId: "variant-1",
                packagingUnitId: "pack",
                quantity: 8.875,
            })]);
        });

        it("product creation writes initial stock as a whole count in its submitted packaging unit", async () => {
            const db = makeDatabase();
            installDatabase(db);

            await createProduct(product, [{
                id: "opening-stock-1",
                packagingUnitId: "pack",
                quantity: 2,
                costPrice: 500,
                sellingPrice: 700,
            }]);

            expect(db.state.products).toContain("product-1");
            expect(db.state.inventory).toEqual([expect.objectContaining({
                productId: "product-1",
                variantId: "variant-1",
                packagingUnitId: "pack",
                quantity: 2,
            })]);
        });

        it("product creation rolls back catalog and stock writes when initial stock is fractional", async () => {
            const db = makeDatabase();
            installDatabase(db);

            await expect(createProduct(product, [{
                id: "opening-stock-1",
                packagingUnitId: "pack",
                quantity: 2.5,
                costPrice: 500,
                sellingPrice: 700,
            }])).rejects.toThrow("Stock quantity must be a non-negative whole number");

            expect(db.state.products).toEqual([]);
            expect(db.state.inventory).toEqual([]);
        });
    });

    describe("persistence-contract: deliveries", () => {
        const makeExistingDraftDatabase = () => {
            const db = makeDatabase([makeStockRow({ quantity: 4 })]);
            installExistingProduct(db);
            db.state.deliveries.push("delivery-1");
            db.state.deliveryStatuses["delivery-1"] = "draft";
            db.state.deliveryHeaders["delivery-1"] = {
                id: "delivery-1",
                supplier: "Original Supplier",
                invoiceNo: "INV-OLD",
                date: "2026-09-27",
                receivedBy: "Original Recipient",
            };
            db.state.deliveryItems.push(["prior-delivery-item"]);
            installDatabase(db);
            return { db, before: structuredClone(db.state) };
        };

        it("saving a delivery draft leaves physical inventory unchanged", async () => {
            const existingStock = makeStockRow({ quantity: 4 });
            const db = makeDatabase([existingStock]);
            installDatabase(db);

            const draft: Delivery = {
                id: "delivery-draft-1",
                supplier: "Supplier",
                invoiceNo: "INV-1",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "draft",
                items: [deliveryItem],
            };
            await saveDeliveryDraft(draft);

            expect(db.state.inventory).toEqual([existingStock]);
            expect(db.state.deliveryItems).toHaveLength(1);
            expect(db.state.activities).toEqual([]);
        });

        it("editing and saving a Delivery draft creates no Activity", async () => {
            const db = makeDatabase();
            db.state.deliveries.push("delivery-draft-1");
            installDatabase(db);

            await saveDeliveryDraft({
                id: "delivery-draft-1",
                supplier: "Updated Supplier",
                invoiceNo: "INV-DRAFT-1",
                date: "2026-09-29",
                receivedBy: "Tester",
                status: "draft",
                items: [deliveryItem],
            });

            expect(db.state.deliveryItems).toHaveLength(1);
            expect(db.state.activities).toEqual([]);
        });

        it("approved delivery adds its quantity and commits", async () => {
            const db = makeDatabase();
            installExistingProduct(db);
            installDatabase(db);

            await receiveDelivery({
                id: "delivery-1",
                supplier: "Supplier",
                invoiceNo: "INV-1",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "approved",
                items: [deliveryItem],
            });

            expect(db.state.inventory).toEqual([expect.objectContaining({
                productId: "product-1",
                variantId: "variant-1",
                packagingUnitId: "pack",
                quantity: 2,
                batchNumber: "batch-1",
                costPrice: deliveryItem.costPrice,
                sellingPrice: deliveryItem.sellingPrice,
            })]);
            expect(db.state.deliveries).toEqual(["delivery-1"]);
            expect(db.state.deliveryItems).toHaveLength(1);
            expect(db.state.activities).toHaveLength(1);
            expect(db.state.activities[0]).toMatchObject({
                eventType: "delivery.received",
                entityType: "delivery",
                entityId: "delivery-1",
                entityLabel: "Invoice INV-1",
                summary: "Delivery from Supplier received on 2026-09-28 by Tester (1 item)",
                reason: null,
                changes: null,
                details: {
                    supplier: "Supplier",
                    invoiceNo: "INV-1",
                    deliveryDate: "2026-09-28",
                    receivedBy: "Tester",
                    items: [{
                        productId: "product-1",
                        productName: "Test medicine",
                        variantId: "variant-1",
                        variantLabel: "10 mg Tablet",
                        packagingUnitId: "pack",
                        packagingUnitName: "Pack",
                        quantity: 2,
                        batchNumber: "batch-1",
                        expiryDate: "2030-01-01",
                        costPrice: 500,
                        sellingPrice: 700,
                    }],
                },
            });
            expect(db.execute).toHaveBeenCalledWith("COMMIT");
        });

        it("rejects repeated approval without changing the Delivery, stock, or Activity", async () => {
            const db = makeDatabase();
            installExistingProduct(db);
            installDatabase(db);
            const approvedDelivery: Delivery = {
                id: "delivery-1",
                supplier: "Supplier",
                invoiceNo: "INV-1",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "approved",
                items: [deliveryItem],
            };

            await receiveDelivery(approvedDelivery);
            await expect(receiveDelivery(approvedDelivery)).rejects.toThrow("has already been approved");

            expect(db.state.deliveryStatuses[approvedDelivery.id]).toBe("approved");
            expect(db.state.inventory).toEqual([expect.objectContaining({
                productId: "product-1",
                variantId: "variant-1",
                packagingUnitId: "pack",
                quantity: 2,
            })]);
            expect(db.state.deliveryItems).toHaveLength(1);
            expect(db.state.activities).toHaveLength(1);
            expect(db.state.activities[0].eventType).toBe("delivery.received");
        });

        it("rejects saving an approved Delivery as a draft without changing its state", async () => {
            const db = makeDatabase();
            installExistingProduct(db);
            installDatabase(db);
            const approvedDelivery: Delivery = {
                id: "delivery-1",
                supplier: "Supplier",
                invoiceNo: "INV-1",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "approved",
                items: [deliveryItem],
            };

            await receiveDelivery(approvedDelivery);
            await expect(saveDeliveryDraft({
                ...approvedDelivery,
                supplier: "Updated Supplier",
                status: "draft",
                items: [{ ...deliveryItem, quantity: 5 }],
            })).rejects.toThrow("cannot be edited as a draft");

            expect(db.state.deliveryStatuses[approvedDelivery.id]).toBe("approved");
            expect(db.state.deliveryHeaders[approvedDelivery.id].supplier).toBe("Supplier");
            expect(db.state.deliveryItems[0][5]).toBe(2);
            expect(db.state.inventory).toEqual([expect.objectContaining({ quantity: 2 })]);
            expect(db.state.activities).toHaveLength(1);
        });

        it("records all items from a multi-item Delivery in one Activity", async () => {
            const db = makeDatabase();
            installExistingProduct(db);
            installDatabase(db);
            const secondItem = {
                ...deliveryItem,
                id: "delivery-item-2",
                packagingUnitId: "sachet",
                quantity: 3,
                batchNumber: "batch-sachet",
                expiryDate: "2027-01-01",
                costPrice: 50,
                sellingPrice: 70,
            };

            await receiveDelivery({
                id: "delivery-1",
                supplier: "Supplier",
                invoiceNo: "INV-1",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "approved",
                items: [deliveryItem, secondItem],
            });

            expect(db.state.activities).toHaveLength(1);
            expect(db.state.activities[0].eventType).toBe("delivery.received");
            const details = db.state.activities[0].details;
            expect(details).not.toBeNull();
            if (details && "items" in details && "supplier" in details) {
                expect(details.items).toHaveLength(2);
                expect(details.items[1]).toMatchObject({
                    productName: "Test medicine",
                    packagingUnitName: "Sachet",
                    quantity: 3,
                    batchNumber: "batch-sachet",
                    expiryDate: "2027-01-01",
                    costPrice: 50,
                    sellingPrice: 70,
                });
            }
        });

        it.each([
            {
                description: "a Variant belonging to another Product",
                variantId: "variant-2",
                packagingUnitId: "other-pack",
            },
            {
                description: "a Packaging Unit belonging to another Variant",
                variantId: "variant-1",
                packagingUnitId: "other-pack",
            },
        ])("rejects a Delivery item with $description", async ({ variantId, packagingUnitId }) => {
            const db = makeDatabase();
            installExistingProduct(db);
            db.state.products.push("product-2");
            db.state.productNames["product-2"] = "Other medicine";
            db.state.productStatuses["product-2"] = "active";
            db.state.variants.push("variant-2");
            db.state.variantProductIds["variant-2"] = "product-2";
            db.state.packagingUnits.push({
                id: "other-pack",
                variantId: "variant-2",
                name: "Other Pack",
                level: 1,
                containsQuantity: null,
                containsUnitId: null,
                costPrice: 900,
                sellingPrice: 1200,
                isDefault: 1,
            });
            installDatabase(db);

            await expect(receiveDelivery({
                id: "delivery-1",
                supplier: "Supplier",
                invoiceNo: "INV-1",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "approved",
                items: [{ ...deliveryItem, variantId, packagingUnitId }],
            })).rejects.toThrow(/must belong/);

            expect(db.state.deliveries).toEqual([]);
            expect(db.state.deliveryItems).toEqual([]);
            expect(db.state.inventory).toEqual([]);
            expect(db.state.activities).toEqual([]);
        });

        it("does not create Activity when receipt validation rejects a draft", async () => {
            const db = makeDatabase();
            installDatabase(db);

            await expect(receiveDelivery({
                id: "delivery-draft-1",
                supplier: "Supplier",
                invoiceNo: "INV-1",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "draft",
                items: [deliveryItem],
            })).rejects.toThrow("Draft delivery must be saved using saveDeliveryDraft");

            expect(db.state.deliveries).toEqual([]);
            expect(db.state.deliveryItems).toEqual([]);
            expect(db.state.activities).toEqual([]);
        });

        it("rejects a Delivery without an explicit status before changing Delivery, Inventory, or Activity", async () => {
            const existingStock = makeStockRow({ quantity: 4 });
            const db = makeDatabase([existingStock]);
            installExistingProduct(db);
            db.state.deliveries.push("delivery-1");
            db.state.deliveryStatuses["delivery-1"] = "draft";
            db.state.deliveryHeaders["delivery-1"] = {
                id: "delivery-1",
                supplier: "Original Supplier",
                invoiceNo: "INV-OLD",
                date: "2026-09-27",
                receivedBy: "Original Recipient",
            };
            db.state.deliveryItems.push(["prior-delivery-item"]);
            installDatabase(db);

            await expect(receiveDelivery({
                id: "delivery-1",
                supplier: "Updated Supplier",
                invoiceNo: "INV-NEW",
                date: "2026-09-28",
                receivedBy: "Tester",
                items: [deliveryItem],
            })).rejects.toThrow("explicit approved status");

            expect(db.state.deliveryStatuses["delivery-1"]).toBe("draft");
            expect(db.state.deliveryHeaders["delivery-1"]).toMatchObject({
                supplier: "Original Supplier",
                invoiceNo: "INV-OLD",
                date: "2026-09-27",
                receivedBy: "Original Recipient",
            });
            expect(db.state.deliveryItems).toEqual([["prior-delivery-item"]]);
            expect(db.state.inventory).toEqual([existingStock]);
            expect(db.state.activities).toEqual([]);
        });

        it("rejects an approved Delivery with no items before changing persisted state", async () => {
            const { db, before } = makeExistingDraftDatabase();

            await expect(receiveDelivery({
                id: "delivery-1",
                supplier: "Updated Supplier",
                invoiceNo: "INV-NEW",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "approved",
                items: [],
            })).rejects.toThrow("Add at least one product to the delivery");

            expect(db.state).toEqual(before);
            expect(db.execute).not.toHaveBeenCalled();
        });

        it.each([
            { label: "zero", quantity: 0, message: "Quantity must be greater than zero" },
            { label: "negative", quantity: -1, message: "Quantity must be greater than zero" },
            { label: "fractional", quantity: 1.5, message: "Stock quantity must be a non-negative whole number" },
        ])("rejects an approved Delivery with $label item quantity before changing persisted state", async ({ quantity, message }) => {
            const { db, before } = makeExistingDraftDatabase();

            await expect(receiveDelivery({
                id: "delivery-1",
                supplier: "Updated Supplier",
                invoiceNo: "INV-NEW",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "approved",
                items: [{ ...deliveryItem, quantity }],
            })).rejects.toThrow(message);

            expect(db.state).toEqual(before);
            expect(db.execute).not.toHaveBeenCalled();
        });

        it.each([
            { label: "cost price", field: "costPrice", value: -1 },
            { label: "selling price", field: "sellingPrice", value: -1 },
        ])("rejects an approved Delivery with negative $label before changing persisted state", async ({ field, value }) => {
            const { db, before } = makeExistingDraftDatabase();
            const approvedDelivery: Delivery = {
                id: "delivery-1",
                supplier: "Supplier",
                invoiceNo: "INV-1",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "approved",
                items: [{ ...deliveryItem, [field]: value }],
            };

            await expect(receiveDelivery(approvedDelivery)).rejects.toThrow("Prices cannot be negative");

            expect(db.state).toEqual(before);
            expect(db.execute).not.toHaveBeenCalled();
        });

        it.each([
            { label: "blank supplier", field: "supplier", value: " ", message: "Supplier is required" },
            { label: "supplier placeholder", field: "supplier", value: "select", message: "Supplier is required" },
            { label: "blank invoice number", field: "invoiceNo", value: "  ", message: "Invoice No. is required" },
            { label: "blank date", field: "date", value: "", message: "Date is required" },
            { label: "blank recipient", field: "receivedBy", value: "\n", message: "Received by is required" },
        ])("rejects an approved Delivery with $label before changing persisted state", async ({ field, value, message }) => {
            const { db, before } = makeExistingDraftDatabase();
            const approvedDelivery: Delivery = {
                id: "delivery-1",
                supplier: "Supplier",
                invoiceNo: "INV-1",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "approved",
                items: [deliveryItem],
            };

            const invalidDelivery = { ...approvedDelivery, [field]: value };
            await expect(receiveDelivery(invalidDelivery)).rejects.toThrow(message);

            expect(db.state).toEqual(before);
            expect(db.execute).not.toHaveBeenCalled();
        });

        it("rolls back Delivery header and items if Delivery item persistence fails", async () => {
            const db = makeDatabase();
            db.failures.deliveryItemInsert = true;
            installDatabase(db);

            await expect(receiveDelivery({
                id: "delivery-1",
                supplier: "Supplier",
                invoiceNo: "INV-1",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "approved",
                items: [deliveryItem],
            })).rejects.toThrow("Delivery item insert failed");

            expect(db.state.deliveries).toEqual([]);
            expect(db.state.deliveryItems).toEqual([]);
            expect(db.state.inventory).toEqual([]);
            expect(db.state.activities).toEqual([]);
        });

        it("rolls back the Delivery update, items, Inventory, and Activity if matching-row increment fails", async () => {
            const existingStock = makeStockRow({
                id: "stock-existing",
                packagingUnitId: deliveryItem.packagingUnitId,
                quantity: 4,
                batchNumber: deliveryItem.batchNumber,
                expiryDate: deliveryItem.expiryDate,
            });
            const db = makeDatabase([existingStock]);
            installExistingProduct(db);
            db.state.deliveries.push("delivery-1");
            db.state.deliveryStatuses["delivery-1"] = "draft";
            db.state.deliveryHeaders["delivery-1"] = {
                id: "delivery-1",
                supplier: "Original Supplier",
                invoiceNo: "INV-OLD",
                date: "2026-09-27",
                receivedBy: "Original Recipient",
            };
            db.state.deliveryItems.push(["prior-delivery-item"]);
            db.failures.inventoryUpdate = true;
            installDatabase(db);

            await expect(receiveDelivery({
                id: "delivery-1",
                supplier: "Updated Supplier",
                invoiceNo: "INV-NEW",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "approved",
                items: [deliveryItem],
            })).rejects.toThrow("Inventory update failed");

            expect(db.state.deliveryStatuses["delivery-1"]).toBe("draft");
            expect(db.state.deliveryHeaders["delivery-1"]).toMatchObject({
                supplier: "Original Supplier",
                invoiceNo: "INV-OLD",
                date: "2026-09-27",
                receivedBy: "Original Recipient",
            });
            expect(db.state.deliveryItems).toEqual([["prior-delivery-item"]]);
            expect(db.state.inventory).toEqual([existingStock]);
            expect(db.state.activities).toEqual([]);
            expect(db.execute).toHaveBeenCalledWith("ROLLBACK");
        });

        it("rolls back approval when Delivery status/header persistence fails", async () => {
            const existingStock = makeStockRow({ quantity: 4 });
            const db = makeDatabase([existingStock]);
            db.state.deliveries.push("delivery-1");
            db.state.deliveryStatuses["delivery-1"] = "draft";
            db.state.deliveryHeaders["delivery-1"] = {
                id: "delivery-1",
                supplier: "Original Supplier",
                invoiceNo: "INV-OLD",
                date: "2026-09-27",
                receivedBy: "Original Recipient",
            };
            db.state.deliveryItems.push(["prior-delivery-item"]);
            db.failures.deliveryUpdate = true;
            installDatabase(db);

            await expect(receiveDelivery({
                id: "delivery-1",
                supplier: "Updated Supplier",
                invoiceNo: "INV-NEW",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "approved",
                items: [deliveryItem],
            })).rejects.toThrow("Delivery update failed");

            expect(db.state.deliveryStatuses["delivery-1"]).toBe("draft");
            expect(db.state.deliveryHeaders["delivery-1"]).toMatchObject({
                supplier: "Original Supplier",
                invoiceNo: "INV-OLD",
                date: "2026-09-27",
                receivedBy: "Original Recipient",
            });
            expect(db.state.deliveryItems).toEqual([["prior-delivery-item"]]);
            expect(db.state.inventory).toEqual([existingStock]);
            expect(db.state.activities).toEqual([]);
            expect(db.execute).toHaveBeenCalledWith("ROLLBACK");
        });

        it("rolls back Delivery and Activity when Inventory stock-in fails", async () => {
            const db = makeDatabase();
            installExistingProduct(db);
            db.failures.inventoryInsert = true;
            installDatabase(db);

            await expect(receiveDelivery({
                id: "delivery-1",
                supplier: "Supplier",
                invoiceNo: "INV-1",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "approved",
                items: [deliveryItem],
            })).rejects.toThrow("Inventory insert failed");

            expect(db.state.deliveries).toEqual([]);
            expect(db.state.deliveryItems).toEqual([]);
            expect(db.state.inventory).toEqual([]);
            expect(db.state.activities).toEqual([]);
        });

        it("rolls back Delivery, items, and stock if Activity insertion fails", async () => {
            const db = makeDatabase();
            installExistingProduct(db);
            db.failures.activityInsert = true;
            installDatabase(db);

            await expect(receiveDelivery({
                id: "delivery-1",
                supplier: "Supplier",
                invoiceNo: "INV-1",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "approved",
                items: [deliveryItem],
            })).rejects.toThrow("Activity insert failed");

            expect(db.state.deliveries).toEqual([]);
            expect(db.state.deliveryItems).toEqual([]);
            expect(db.state.inventory).toEqual([]);
            expect(db.state.activities).toEqual([]);
            expect(db.execute).toHaveBeenCalledWith("ROLLBACK");
        });

        it("approved delivery increments only the matching batch and expiry row", async () => {
            const existingStock = makeStockRow({
                id: "stock-existing",
                packagingUnitId: deliveryItem.packagingUnitId,
                quantity: 4,
                batchNumber: deliveryItem.batchNumber,
                expiryDate: deliveryItem.expiryDate,
                costPrice: 321,
                sellingPrice: 654,
            });
            const db = makeDatabase([existingStock]);
            installExistingProduct(db);
            installDatabase(db);

            await receiveDelivery({
                id: "delivery-1",
                supplier: "Supplier",
                invoiceNo: "INV-1",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "approved",
                items: [deliveryItem],
            });

            expect(db.state.inventory).toEqual([expect.objectContaining({
                id: "stock-existing",
                productId: deliveryItem.productId,
                variantId: deliveryItem.variantId,
                packagingUnitId: deliveryItem.packagingUnitId,
                quantity: 6,
                batchNumber: deliveryItem.batchNumber,
                expiryDate: deliveryItem.expiryDate,
                costPrice: 321,
                sellingPrice: 654,
            })]);
        });

        it("failed delivery approval rolls back delivery and inventory state", async () => {
            const db = makeDatabase();
            installDatabase(db);

            await expect(receiveDelivery({
                id: "delivery-1",
                supplier: "Supplier",
                invoiceNo: "INV-1",
                date: "2026-09-28",
                receivedBy: "Tester",
                status: "approved",
                items: [{ ...deliveryItem, quantity: 1.5 }],
            })).rejects.toThrow("Stock quantity must be a non-negative whole number");

            expect(db.state.deliveries).toEqual([]);
            expect(db.state.deliveryItems).toEqual([]);
            expect(db.state.inventory).toEqual([]);
        });
    });

    describe("persistence-contract: sales", () => {
        it("saving a sale draft leaves physical inventory unchanged", async () => {
            const existingStock = makeStockRow({ quantity: 2 });
            const db = makeDatabase([existingStock]);
            installDatabase(db);

            await saveSaleDraft({ ...saleFor(1), status: "draft" });

            expect(db.state.inventory).toEqual([existingStock]);
            expect(db.state.saleItems).toHaveLength(1);
            expect(db.state.activities).toEqual([]);
        });

        it("editing and saving a Sale draft creates no Activity", async () => {
            const db = makeDatabase();
            installDatabase(db);
            const draft = { ...saleFor(1), status: "draft" as const };

            await saveSaleDraft(draft);
            await saveSaleDraft({ ...draft, notes: "Updated draft" });

            expect(db.state.saleStatuses["sale-1"]).toBe("draft");
            expect(db.state.activities).toEqual([]);
        });

        it("reports mathematically available smaller units even when a partial source package cannot be allocated", async () => {
            const db = makeDatabase([makeStockRow()]);
            installDatabase(db);

            await expect(getAvailableQuantityInUnit("product-1", "variant-1", "card")).resolves.toBe(10);
            await expect(getSaleStockAllocationPreview("product-1", "variant-1", "card", 3))
                .rejects.toThrow("without splitting stock incorrectly");
        });

        it("returns the earliest-expiring eligible batch first", async () => {
            const db = makeDatabase([
                makeStockRow({ id: "later", packagingUnitId: "card", quantity: 1, batchNumber: "later", expiryDate: "2028-01-01" }),
                makeStockRow({ id: "sooner", packagingUnitId: "card", quantity: 1, batchNumber: "sooner", expiryDate: "2027-01-01" }),
            ]);
            installDatabase(db);

            await expect(getSaleStockAllocationPreview("product-1", "variant-1", "card", 1))
                .resolves.toEqual([{ batchNumber: "sooner", expiryDate: "2027-01-01", quantity: 1 }]);
        });

        it("completes a sale by consuming a whole source Sachet and records requested units", async () => {
            const db = makeDatabase([makeStockRow()]);
            installExistingProduct(db);
            installDatabase(db);
            const sale = saleFor(10);
            sale.notes = "Customer requested a receipt";

            await createSale(sale);

            expect(db.state.inventory).toEqual([]);
            expect(db.state.saleItems).toHaveLength(1);
            expect(db.state.saleItems[0]).toEqual([
                expect.any(String), "sale-1", "product-1", "variant-1", "card", 10, 7, "batch-sachet", "2027-01-01",
            ]);
            expect(db.state.activities).toHaveLength(1);
            expect(db.state.activities[0]).toMatchObject({
                eventType: "sale.completed",
                entityType: "sale",
                entityId: "sale-1",
                entityLabel: "Sale 2026-09-28",
                summary: "Completed sale: 1 item, total ₦70.00, sold by Tester",
                reason: null,
                changes: null,
                details: {
                    saleDate: "2026-09-28",
                    soldBy: "Tester",
                    notes: "Customer requested a receipt",
                    totalAmount: 70,
                    discount: 0,
                    items: [{
                        productId: "product-1",
                        productName: "Test medicine",
                        variantId: "variant-1",
                        variantLabel: "10 mg Tablet",
                        packagingUnitId: "card",
                        packagingUnitName: "Card",
                        quantity: 10,
                        unitPrice: 7,
                        lineAmount: 70,
                        allocations: [{ quantity: 10, batchNumber: "batch-sachet", expiryDate: "2027-01-01" }],
                    }],
                },
            });
            const executedSql = db.execute.mock.calls.map(([sql]) => sql);
            const stockMutationIndex = executedSql.findIndex((sql) => sql.includes("DELETE FROM inventory_stock"));
            const saleItemIndex = executedSql.findIndex((sql) => sql.includes("INSERT INTO sale_items"));
            const activityIndex = executedSql.findIndex((sql) => sql.includes("INSERT INTO activities"));
            const commitIndex = executedSql.indexOf("COMMIT");
            expect(stockMutationIndex).toBeLessThan(activityIndex);
            expect(saleItemIndex).toBeLessThan(activityIndex);
            expect(activityIndex).toBeLessThan(commitIndex);
            expect(db.execute).toHaveBeenCalledWith("COMMIT");
        });

        it("records one pluralized Activity for a completed multi-item Sale", async () => {
            const stock = makeStockRow({ packagingUnitId: "card", quantity: 10 });
            const db = makeDatabase([stock]);
            installExistingProduct(db);
            installDatabase(db);
            const sale = saleFor(1);
            sale.items.push({ ...sale.items[0], id: "sale-item-2" });
            sale.totalAmount = 12;
            sale.discount = 2;
            sale.notes = "Manual discount approved";

            await createSale(sale);

            expect(db.state.saleItems).toHaveLength(2);
            expect(db.state.activities).toHaveLength(1);
            expect(db.state.activities[0]).toMatchObject({
                eventType: "sale.completed",
                entityId: sale.id,
                summary: "Completed sale: 2 items, total ₦12.00, sold by Tester",
            });
            expect(db.state.activities[0].details).toMatchObject({
                notes: "Manual discount approved",
                totalAmount: 12,
                discount: 2,
                items: [
                    { productName: "Test medicine", quantity: 1, unitPrice: 7, lineAmount: 7 },
                    { productName: "Test medicine", quantity: 1, unitPrice: 7, lineAmount: 7 },
                ],
            });
        });

        it("rolls back the Sale and Inventory if Activity insertion fails", async () => {
            const stock = makeStockRow({ packagingUnitId: "card", quantity: 10 });
            const db = makeDatabase([stock]);
            db.state.products.push("product-1");
            db.state.variants.push("variant-1");
            db.failures.activityInsert = true;
            installDatabase(db);

            await expect(createSale(saleFor(5))).rejects.toThrow("Activity insert failed");

            expect(db.state.sales).toEqual([]);
            expect(db.state.saleItems).toEqual([]);
            expect(db.state.inventory).toEqual([stock]);
            expect(db.state.activities).toEqual([]);
            expect(db.execute).toHaveBeenCalledWith("ROLLBACK");
        });

        it("rolls back Sale persistence when Inventory stock mutation fails", async () => {
            const stock = makeStockRow({ packagingUnitId: "card", quantity: 10 });
            const db = makeDatabase([stock]);
            db.state.products.push("product-1");
            db.state.variants.push("variant-1");
            db.failures.inventoryUpdate = true;
            installDatabase(db);

            await expect(createSale(saleFor(5))).rejects.toThrow("Inventory update failed");

            expect(db.state.sales).toEqual([]);
            expect(db.state.saleItems).toEqual([]);
            expect(db.state.inventory).toEqual([stock]);
            expect(db.state.activities).toEqual([]);
        });

        it("applies a multi-row sale allocation in FEFO order", async () => {
            const earlierStock = makeStockRow({
                id: "stock-earlier",
                packagingUnitId: "card",
                quantity: 2,
                batchNumber: "batch-earlier",
                expiryDate: "2027-01-01",
            });
            const laterStock = makeStockRow({
                id: "stock-later",
                packagingUnitId: "card",
                quantity: 2,
                batchNumber: "batch-later",
                expiryDate: "2028-01-01",
            });
            const db = makeDatabase([laterStock, earlierStock]);
            db.state.products.push("product-1");
            db.state.variants.push("variant-1");
            installDatabase(db);

            await createSale(saleFor(3));

            expect(db.state.inventory).toEqual([expect.objectContaining({
                id: "stock-later",
                quantity: 1,
                batchNumber: "batch-later",
                expiryDate: "2028-01-01",
            })]);
            expect(db.state.saleItems).toEqual([
                [expect.any(String), "sale-1", "product-1", "variant-1", "card", 2, 7, "batch-earlier", "2027-01-01"],
                [expect.any(String), "sale-1", "product-1", "variant-1", "card", 1, 7, "batch-later", "2028-01-01"],
            ]);
            expect(db.state.activities).toHaveLength(1);
            expect(db.state.activities[0].details).toMatchObject({
                items: [{
                    quantity: 3,
                    allocations: [
                        { quantity: 2, batchNumber: "batch-earlier", expiryDate: "2027-01-01" },
                        { quantity: 1, batchNumber: "batch-later", expiryDate: "2028-01-01" },
                    ],
                }],
            });
        });

        it("rolls back inventory changes when a later sale item is insufficient", async () => {
            const stock = makeStockRow({ packagingUnitId: "card", quantity: 2 });
            const db = makeDatabase([stock]);
            db.state.products.push("product-1");
            db.state.variants.push("variant-1");
            installDatabase(db);
            const sale = saleFor(2);
            sale.items.push({ ...sale.items[0], id: "sale-item-2" });

            await expect(createSale(sale)).rejects.toThrow("Insufficient stock");

            expect(db.state.inventory).toEqual([stock]);
            expect(db.state.sales).toEqual([]);
            expect(db.state.saleItems).toEqual([]);
            expect(db.state.activities).toEqual([]);
        });

        it("rolls back a sale that would require splitting a larger package", async () => {
            const stock = makeStockRow();
            const db = makeDatabase([stock]);
            db.state.products.push("product-1");
            db.state.variants.push("variant-1");
            installDatabase(db);

            await expect(createSale(saleFor(3))).rejects.toThrow("without splitting stock incorrectly");

            expect(db.state.inventory).toEqual([stock]);
            expect(db.state.sales).toEqual([]);
            expect(db.state.saleItems).toEqual([]);
            expect(db.state.activities).toEqual([]);
        });
    });

    describe("behavior: packaging conversion and display", () => {
        it("converts Pack to Card and Card to Pack using the configured hierarchy", () => {
            expect(getConversionFactor("pack", "card", packagingUnits)).toBe(120);
            expect(getConversionFactor("card", "pack", packagingUnits)).toBeCloseTo(1 / 120);
            expect(convertQuantityToSmallest(2, "pack", packagingUnits)).toBe(240);
        });

        it("returns structured breakdown for stock stored in the largest unit", () => {
            expect(calculateStockBreakdown([
                { packagingUnitId: "pack", quantity: 2 },
            ], packagingUnits)).toEqual([
                { packagingUnitId: "pack", packagingUnitName: "Pack", quantity: 2 },
            ]);
        });

        it("combines stock stored in multiple packaging units", () => {
            expect(calculateStockBreakdown([
                { packagingUnitId: "pack", quantity: 1 },
                { packagingUnitId: "sachet", quantity: 3 },
                { packagingUnitId: "card", quantity: 4 },
            ], packagingUnits)).toEqual([
                { packagingUnitId: "pack", packagingUnitName: "Pack", quantity: 1 },
                { packagingUnitId: "sachet", packagingUnitName: "Sachet", quantity: 3 },
                { packagingUnitId: "card", packagingUnitName: "Card", quantity: 4 },
            ]);
        });

        it("breaks down stock across hierarchies with more than three levels", () => {
            const hierarchy: PackagingUnit[] = [
                { id: "case", name: "Case", contains: { quantity: 6, unitId: "pack" }, isDefault: true },
                { id: "pack", name: "Pack", contains: { quantity: 12, unitId: "sachet" }, isDefault: false },
                { id: "sachet", name: "Sachet", contains: { quantity: 10, unitId: "card" }, isDefault: false },
                { id: "card", name: "Card", isDefault: false },
            ];

            expect(calculateStockBreakdown([
                { packagingUnitId: "case", quantity: 1 },
                { packagingUnitId: "pack", quantity: 5 },
                { packagingUnitId: "sachet", quantity: 7 },
                { packagingUnitId: "card", quantity: 9 },
            ], hierarchy)).toEqual([
                { packagingUnitId: "case", packagingUnitName: "Case", quantity: 1 },
                { packagingUnitId: "pack", packagingUnitName: "Pack", quantity: 5 },
                { packagingUnitId: "sachet", packagingUnitName: "Sachet", quantity: 7 },
                { packagingUnitId: "card", packagingUnitName: "Card", quantity: 9 },
            ]);
        });

        it("represents non-empty zero-quantity rows at the smallest unit", () => {
            expect(calculateStockBreakdown([
                { packagingUnitId: "pack", quantity: 0 },
            ], packagingUnits)).toEqual([
                { packagingUnitId: "card", packagingUnitName: "Card", quantity: 0 },
            ]);
        });

        it("represents empty raw stock as zero in the smallest Pack, Sachet, Card unit", () => {
            expect(calculateStockBreakdown([], packagingUnits)).toEqual([
                { packagingUnitId: "card", packagingUnitName: "Card", quantity: 0 },
            ]);
        });

        it("uses the smallest unit in an empty four-level hierarchy", () => {
            const hierarchy: PackagingUnit[] = [
                { id: "case", name: "Case", contains: { quantity: 6, unitId: "pack" }, isDefault: true },
                { id: "pack", name: "Pack", contains: { quantity: 12, unitId: "sachet" }, isDefault: false },
                { id: "sachet", name: "Sachet", contains: { quantity: 10, unitId: "card" }, isDefault: false },
                { id: "card", name: "Card", isDefault: false },
            ];

            expect(calculateStockBreakdown([], hierarchy)).toEqual([
                { packagingUnitId: "card", packagingUnitName: "Card", quantity: 0 },
            ]);
        });

        it("preserves an empty breakdown when no packaging hierarchy exists", () => {
            expect(calculateStockBreakdown([], [])).toEqual([]);
        });

        it("combines multiple stock rows for the same packaging unit", () => {
            expect(calculateStockBreakdown([
                { packagingUnitId: "pack", quantity: 1 },
                { packagingUnitId: "pack", quantity: 2 },
            ], packagingUnits)).toEqual([
                { packagingUnitId: "pack", packagingUnitName: "Pack", quantity: 3 },
            ]);
        });

        it("uses contains quantities to derive the structured breakdown", () => {
            expect(calculateStockBreakdown([
                { packagingUnitId: "pack", quantity: 1 },
                { packagingUnitId: "card", quantity: 13 },
            ], packagingUnits)).toEqual([
                { packagingUnitId: "pack", packagingUnitName: "Pack", quantity: 1 },
                { packagingUnitId: "sachet", packagingUnitName: "Sachet", quantity: 1 },
                { packagingUnitId: "card", packagingUnitName: "Card", quantity: 3 },
            ]);
        });

        it("preserves the Pack, Sachet, and Card breakdown from raw stock", () => {
            expect(calculateStockBreakdown([
                { packagingUnitId: "pack", quantity: 31 },
                { packagingUnitId: "sachet", quantity: 8 },
                { packagingUnitId: "card", quantity: 4 },
            ], packagingUnits)).toEqual([
                { packagingUnitId: "pack", packagingUnitName: "Pack", quantity: 31 },
                { packagingUnitId: "sachet", packagingUnitName: "Sachet", quantity: 8 },
                { packagingUnitId: "card", packagingUnitName: "Card", quantity: 4 },
            ]);
        });

        it("keeps converted availability distinct from raw stock breakdown input", async () => {
            const db = makeDatabase([makeStockRow({ packagingUnitId: "pack", quantity: 1, batchNumber: null })]);
            installDatabase(db);

            const availability = await getVariantAvailabilityByPackagingUnit("product-1", "variant-1");
            expect(availability.map(({ quantity }) => quantity)).toEqual([1, 12, 120]);
            expectTypeOf<typeof availability>().not.toMatchTypeOf<RawInventoryStockEntry[]>();
            expect(calculateStockBreakdown([
                { packagingUnitId: "pack", quantity: 1 },
            ], packagingUnits)).toEqual([
                { packagingUnitId: "pack", packagingUnitName: "Pack", quantity: 1 },
            ]);
        });
    });
});