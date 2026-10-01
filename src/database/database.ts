import { loadDatabase, type SqliteDatabase } from "./connection";
import {
    getConversionFactor,
    getSmallestPackagingUnit as getSmallestPackagingUnitFromHierarchy,
} from "../domain/stockBreakdown";
import { classifyExpiry, isValidExpiryDate } from "../domain/expirySemantics";
import { getProductActivityChanges } from "../domain/productActivityChanges";
export { getConversionFactor } from "../domain/stockBreakdown";
import { recordActivity } from "./activity";
import { getActivityRecords } from "./activityRepository";
import {
    getProducts as getProductCatalog,
    mapProductToRow,
    saveProductHierarchy,
    insertProductRow,
    updateProductRow,
    archiveProductRow,
    getProductActivitySnapshot,
    selectNonArchivedProductIdsById,
    selectVariantIdsByProductId,
    selectVariantIdByIdAndProductId,
    insertVariantRow,
    updateVariantRow,
    deleteVariantRow,
    deletePackagingUnitsByVariantId,
    selectPackagingUnitIdsByVariantId,
    selectPackagingUnitIdByIdAndVariantId,
    selectPackagingUnitIdsContainingUnit,
    deletePackagingUnitRow,
    insertPackagingUnitRow,
    updatePackagingUnitRow,
    getPackagingUnitsForVariant,
} from "./productRepository";
import {
    addInventoryStock,
    applyInventoryStockAllocation,
    setInventoryStockEntry,
} from "./inventory";
import {
    getInventoryStockRowsForVariant,
    mapInventoryStockRow,
    getInventoryStockReferencesByVariant,
    getInventoryStockReferencesByPackagingUnit,
    getInventoryStockQuantitiesByVariant,
    selectInventoryStockRowsByVariant,
    selectRawInventoryStockRows,
} from "./inventoryRepository";
import {
    createDelivery as createDeliveryRow,
    createDeliveryItem as createDeliveryItemRow,
    getDeliveryRows,
    getDeliveryRowById,
    getDeliveryItemReferencesByVariant,
    getDeliveryItemReferencesByPackagingUnit,
} from "./deliveryRepository";
import {
    getSaleRows,
    getSaleRowById,
    selectSaleIdsById,
    selectSaleIdsByIdAndStatus,
    insertSaleRow,
    updateSaleRow,
    deleteSaleItemsBySaleId,
    deleteSaleDraftById,
    insertSaleItemRow,
    insertSaleItemRowWithAllocation,
} from "./salesRepository";
import {
    product1, product2, product3, product4, product5, product6, product7,
    product8, product9, product10
} from "../components/ProductList";
import { Product, PackagingUnit, Delivery, DeliveryItems, Variant, Sale, SaleItem } from "../types/Product";
import { getCurrentCalendarDate, getDaysUntilExpiry } from "../utils/expiry";
import { calculateSaleLineAmount } from "../domain/saleCalculations";
import type { InventoryAdjustmentInput, InventoryStockValues } from "../types/Inventory";

export type InventoryStockEntryInput = {
    id?: string;
    variantId?: string;
    packagingUnitId: string;
    quantity: number;
    batchNumber?: string;
    expiryDate?: string;
    costPrice: number;
    sellingPrice: number;
};

export type CurrentStockEntry = Omit<InventoryStockEntryInput, "id" | "variantId"> & {
    id: string;
    variantId: string;
};

const getActivityVariantLabel = (variant: Variant | undefined) => {
    if (!variant) return null;
    const strength = [variant.strength, variant.strengthUnit].filter(Boolean).join(" ");
    return [strength, variant.form].filter(Boolean).join(" ") || "Variant";
};

export const INVENTORY_CHANGED_EVENT = "tipia:inventory-changed";
export const PENDING_TASKS_CHANGED_EVENT = "tipia:pending-tasks-changed";

const products = [
    product1, product2, product3, product4, product5,
    product6, product7, product8, product9, product10
];

export const initializeDatabase = async () => {
    const db = await loadDatabase();

    await db.execute(`PRAGMA foreign_keys = ON;`);

    // Force table drop in development to apply updated schema
    /*await db.execute(`DROP TABLE IF EXISTS delivery_items;`);
    await db.execute(`DROP TABLE IF EXISTS inventory_stock;`);
    await db.execute(`DROP TABLE IF EXISTS deliveries;`);
    await db.execute(`DROP TABLE IF EXISTS packaging_units;`);
    await db.execute(`DROP TABLE IF EXISTS variants;`);
    await db.execute(`DROP TABLE IF EXISTS products;`);*/

    await db.execute(`
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            generic_name TEXT NOT NULL,
            category TEXT NOT NULL,
            manufacturer TEXT NOT NULL,
            nafdac_number TEXT,
            barcode TEXT,
            sku TEXT,
            low_stock_level INTEGER,
            track_batches INTEGER,
            track_expiry INTEGER,
            status TEXT,
            created_at TEXT
        )
    `);

    const productColumns = await db.select<Array<{ name: string }>>(
        `PRAGMA table_info(products)`
    );
    const existingProductColumns = new Set(productColumns.map((column) => column.name));
    if (!existingProductColumns.has("created_at")) {
        await db.execute(`ALTER TABLE products ADD COLUMN created_at TEXT`);
        await db.execute(`UPDATE products SET created_at = COALESCE(created_at, datetime('2000-01-01T00:00:00Z')) WHERE created_at IS NULL`);
    }

    await db.execute(`
        CREATE TABLE IF NOT EXISTS variants (
            id TEXT PRIMARY KEY,
            product_id TEXT NOT NULL,
            strength TEXT ,
            strength_unit TEXT ,
            form TEXT ,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
    `);

    await db.execute(`
    CREATE TABLE IF NOT EXISTS packaging_units (
        id TEXT PRIMARY KEY,
        variant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        level INTEGER NOT NULL,
        contains_quantity INTEGER,
        contains_unit_id TEXT,
        cost_price REAL,
        selling_price REAL,
        is_default INTEGER NOT NULL,
        FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE
    )
`);

    const packagingColumns = await db.select<Array<{ name: string }>>(
        `PRAGMA table_info(packaging_units)`
    );
    const existingPackagingColumns = new Set(packagingColumns.map((column) => column.name));
    const missingPackagingColumns = [
        ["level", "INTEGER NOT NULL DEFAULT 1"],
        ["contains_quantity", "INTEGER"],
        ["contains_unit_id", "TEXT"],
        ["cost_price", "REAL"],
        ["selling_price", "REAL"],
        ["is_default", "INTEGER NOT NULL DEFAULT 0"],
    ] as const;

    for (const [column, definition] of missingPackagingColumns) {
        if (!existingPackagingColumns.has(column)) {
            await db.execute(`ALTER TABLE packaging_units ADD COLUMN ${column} ${definition}`);
        }
    }

    await db.execute(`
        CREATE TABLE IF NOT EXISTS deliveries (
            id TEXT PRIMARY KEY,
            supplier TEXT NOT NULL,
            invoice_no TEXT NOT NULL,
            date TEXT NOT NULL,
            received_by TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft'
        )
    `);

    const deliveryColumns = await db.select<Array<{ name: string }>>(
        `PRAGMA table_info(deliveries)`
    );
    const existingDeliveryColumns = new Set(deliveryColumns.map((column) => column.name));
    if (!existingDeliveryColumns.has("status")) {
        await db.execute(`ALTER TABLE deliveries ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'`);
    }

    await db.execute(`
        CREATE TABLE IF NOT EXISTS delivery_items (
            id TEXT PRIMARY KEY,
            delivery_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            variant_id TEXT NOT NULL,
            packaging_unit_id TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            batch_number TEXT,
            expiry_date TEXT,
            cost_price REAL NOT NULL,
            selling_price REAL NOT NULL,
            FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            FOREIGN KEY (variant_id) REFERENCES variants(id) ON DELETE CASCADE,
            FOREIGN KEY (packaging_unit_id) REFERENCES packaging_units(id) ON DELETE CASCADE
        )
    `);

    await db.execute(`
    CREATE TABLE IF NOT EXISTS inventory_stock (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        variant_id TEXT NOT NULL,
        packaging_unit_id TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        batch_number TEXT,
        expiry_date TEXT,
        cost_price REAL NOT NULL,
        selling_price REAL NOT NULL,

        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (variant_id) REFERENCES variants(id),
        FOREIGN KEY (packaging_unit_id) REFERENCES packaging_units(id)
    )
`);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS sales (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            sold_by TEXT,
            total_amount REAL NOT NULL,
            discount REAL DEFAULT 0,
            notes TEXT,
            status TEXT NOT NULL DEFAULT 'completed'
        )
    `);

    const saleColumns = await db.select<Array<{ name: string }>>(
        `PRAGMA table_info(sales)`
    );
    const existingSaleColumns = new Set(saleColumns.map((column) => column.name));
    if (!existingSaleColumns.has("status")) {
        await db.execute(`ALTER TABLE sales ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'`);
    }

    await db.execute(`
        CREATE TABLE IF NOT EXISTS sale_items (
            id TEXT PRIMARY KEY,
            sale_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            variant_id TEXT NOT NULL,
            packaging_unit_id TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            unit_price REAL NOT NULL,
            batch_number TEXT,
            expiry_date TEXT,
            FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (variant_id) REFERENCES variants(id),
            FOREIGN KEY (packaging_unit_id) REFERENCES packaging_units(id)
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS activities (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            entity_label TEXT NOT NULL,
            summary TEXT NOT NULL,
            reason TEXT,
            changes TEXT,
            details TEXT
        )
    `);

    const activityColumns = await db.select<Array<{ name: string }>>(
        `PRAGMA table_info(activities)`
    );
    if (!activityColumns.some((column) => column.name === "changes")) {
        await db.execute(`ALTER TABLE activities ADD COLUMN changes TEXT`);
    }
    if (!activityColumns.some((column) => column.name === "details")) {
        await db.execute(`ALTER TABLE activities ADD COLUMN details TEXT`);
    }

    // Seed data: Product -> Variant -> PackagingUnit
    for (const product of products) {
        const row = mapProductToRow(product);

        await db.execute(`
            INSERT OR IGNORE INTO products(
                id, name, generic_name, category, manufacturer, nafdac_number,
                barcode, sku, low_stock_level,
                track_batches, track_expiry, status, created_at
            )
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            row.id,
            row.name,
            row.genericName,
            row.category,
            row.manufacturer,
            row.nafdacNumber,
            row.barcode,
            row.sku,
            row.lowStockLevel,
            row.trackBatches,
            row.trackExpiry,
            row.status,
            row.createdAt ?? new Date().toISOString(),
        ]);

        const variants = product.variants ?? [];
        for (const variant of variants) {
            await db.execute(`
                INSERT OR IGNORE INTO variants(
                    id, product_id, strength, strength_unit, form
                )
                VALUES(?, ?, ?, ?, ?)
            `, [
                variant.id,
                product.id,
                variant.strength,
                variant.strengthUnit,
                variant.form,
            ]);

            for (let level = 0; level < (variant.packagingUnits ?? []).length; level++) {
                const unit = variant.packagingUnits[level];

                await db.execute(`
        INSERT OR IGNORE INTO packaging_units(
            id,
            variant_id,
            name,
            level,
            contains_quantity,
            contains_unit_id,
            cost_price,
            selling_price,
            is_default
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
                    unit.id,
                    variant.id,
                    unit.name,
                    level + 1,
                    unit.contains?.quantity ?? null,
                    unit.contains?.unitId ?? null,
                    unit.costPrice ?? null,
                    unit.sellingPrice ?? null,
                    unit.isDefault ? 1 : 0,
                ]);
            }
        }
    }
};

export const getCurrentStockForProduct = async (productId: string): Promise<CurrentStockEntry[]> => {
    const db = await loadDatabase();
    const rows = await selectRawInventoryStockRows(db, { productId });

    return rows.map((row) => mapInventoryStockRow(row));
};

export const getCurrentStockForAllProducts = async (): Promise<Record<string, CurrentStockEntry[]>> => {
    const db = await loadDatabase();
    const rows = await selectRawInventoryStockRows(db);

    return rows.reduce<Record<string, CurrentStockEntry[]>>((stockByProduct, row) => {
        const { productId, ...stockEntry } = row;
        (stockByProduct[productId] ??= []).push({
            ...stockEntry,
            batchNumber: stockEntry.batchNumber ?? undefined,
            expiryDate: stockEntry.expiryDate ?? undefined,
        });
        return stockByProduct;
    }, {});
};

export const getAvailableStockRowsForVariant = async (
    productId: string,
    variantId: string,
    preferredBatchNumber?: string,
    preferredExpiryDate?: string
): Promise<StockRowForSale[]> => {
    const rows = await getInventoryStockRowsForVariant(productId, variantId, preferredBatchNumber, preferredExpiryDate);

    return rows as StockRowForSale[];
};

export const getVariantAvailabilityByPackagingUnit = async (
    productId: string,
    variantId: string
): Promise<Array<{ unitId: string; unitName: string; quantity: number }>> => {
    const db = await loadDatabase();
    const packagingUnits = await getPackagingUnitsForVariant(db, variantId);

    const stockRows = await selectInventoryStockRowsByVariant(db, productId, variantId);

    return packagingUnits.map((unit) => ({
        unitId: unit.id,
        unitName: unit.name || "Unit",
        quantity: stockRows.reduce((total, row) => {
            const factor = getConversionFactor(row.packagingUnitId, unit.id, packagingUnits);
            return total + row.quantity * factor;
        }, 0),
    }));
};

export const getExpirySummary = (stockEntries: Array<{ expiryDate?: string }>) => {
    const expiryValues = stockEntries
        .map((entry) => entry.expiryDate?.trim())
        .filter((date): date is string => Boolean(date));

    if (expiryValues.length === 0) {
        return { summary: "No expiry tracked", multipleBatches: false, earliestExpiry: undefined };
    }

    const uniqueDates = [...new Set(expiryValues)].sort();
    if (uniqueDates.length === 1) {
        return { summary: uniqueDates[0], multipleBatches: false, earliestExpiry: uniqueDates[0] };
    }

    const earliestExpiry = uniqueDates[0];
    const days = getDaysUntilExpiry(earliestExpiry);
    return {
        summary: days <= 0 ? `Expired: ${earliestExpiry}` : `Earliest expiry: ${days} days`,
        multipleBatches: true,
        earliestExpiry,
    };
};

export const getProducts = async () => getProductCatalog();

export const getActivities = async () => {
    const db = await loadDatabase();
    return getActivityRecords(db);
};

export const createProduct = async (
    product: Product,
    stockEntries: Array<{
        id: string;
        packagingUnitId: string;
        quantity: number;
        batchNumber?: string;
        expiryDate?: string;
        costPrice: number;
        sellingPrice: number;
    }> = []
) => {
    const db = await loadDatabase();

    try {
        await db.execute(`PRAGMA foreign_keys = ON;`);
        await db.execute(`BEGIN`);

        const createdAt = new Date().toISOString();
        await insertProductRow(db, product, createdAt);

        // Create variants and packaging units first
        await saveProductHierarchy(db, product);

        // Then create initial stock
        for (const stock of stockEntries) {

            const variant = product.variants.find((v) =>
                v.packagingUnits.some(
                    (unit) => unit.id === stock.packagingUnitId
                )
            );

            if (!variant) {
                throw new Error(
                    `Packaging unit ${stock.packagingUnitId} does not belong to this product`
                );
            }

            await addInventoryStock(db, {
                productId: product.id,
                variantId: variant.id,
                packagingUnitId: stock.packagingUnitId,
                quantity: stock.quantity,
                batchNumber: stock.batchNumber,
                expiryDate: stock.expiryDate,
                costPrice: stock.costPrice,
                sellingPrice: stock.sellingPrice,
            });
        }

        await recordActivity(db, {
            eventType: "product.created",
            entityType: "product",
            entityId: product.id,
            entityLabel: product.name,
            summary: `Product created: ${product.name}`,
            reason: null,
            details: {
                genericName: product.genericName,
                manufacturer: product.manufacturer,
                category: product.category,
                variants: product.variants.map((variant) => ({
                    label: getActivityVariantLabel(variant) ?? "Variant",
                    initialQuantities: stockEntries
                        .filter((stock) => variant.packagingUnits.some((unit) => unit.id === stock.packagingUnitId))
                        .map((stock) => ({
                            quantity: stock.quantity,
                            packagingUnitName: variant.packagingUnits.find((unit) => unit.id === stock.packagingUnitId)?.name ?? "Unit",
                        })),
                })),
            },
        });

        await db.execute(`COMMIT`);

        return {
            success: true,
            productId: product.id,
        };

    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    }
};

export const updateProduct = async (
    product: Product,
    editReason: string
) => {
    const normalizedReason = editReason.trim();
    if (!normalizedReason) {
        throw new Error("An edit reason is required when updating a product");
    }

    const db = await loadDatabase();

    try {
        await db.execute(`PRAGMA foreign_keys = ON;`);
        await db.execute(`BEGIN`);

        const existingProduct = await getProductActivitySnapshot(db, product.id);
        if (!existingProduct) {
            throw new Error(`Product ${product.id} does not exist`);
        }

        // --------------------------------------------------
        // 1. Update basic product information
        // --------------------------------------------------
        await updateProductRow(db, product);

        // --------------------------------------------------
        // 2. Get existing variants
        // --------------------------------------------------
        const existingVariants = await selectVariantIdsByProductId(db, product.id);

        const newVariantIds = new Set(
            (product.variants ?? []).map((variant) => variant.id)
        );

        // --------------------------------------------------
        // 3. Delete variants that were removed
        //    ONLY if they are not being used by stock/history
        // --------------------------------------------------
        for (const existingVariant of existingVariants) {
            if (newVariantIds.has(existingVariant.id)) {
                continue;
            }

            const stockRows = await getInventoryStockReferencesByVariant(db, existingVariant.id);

            if (stockRows.length > 0) {
                throw new Error(
                    `Cannot remove variant ${existingVariant.id} because inventory stock is using it`
                );
            }

            const deliveryRows = await getDeliveryItemReferencesByVariant(db, existingVariant.id);

            if (deliveryRows.length > 0) {
                throw new Error(
                    `Cannot remove variant ${existingVariant.id} because delivery history is using it`
                );
            }

            // Delete its packaging units first
            await deletePackagingUnitsByVariantId(db, existingVariant.id);

            // Then delete the variant
            await deleteVariantRow(db, existingVariant.id);
        }

        // --------------------------------------------------
        // 4. Process every variant from the form
        // --------------------------------------------------
        for (const variant of product.variants ?? []) {

            const existingVariant = await selectVariantIdByIdAndProductId(db, variant.id, product.id);

            if (existingVariant.length > 0) {

                // Existing variant -> UPDATE it
                await updateVariantRow(db, variant, product.id);

            } else {

                // New variant -> INSERT it
                await insertVariantRow(db, variant, product.id);
            }

            // --------------------------------------------------
            // 5. Get existing packaging units for this variant
            // --------------------------------------------------
            const existingUnits = await selectPackagingUnitIdsByVariantId(db, variant.id);

            const newUnitIds = new Set(
                (variant.packagingUnits ?? []).map((unit) => unit.id)
            );

            // --------------------------------------------------
            // 6. Remove packaging units that were deleted
            // --------------------------------------------------
            for (const existingUnit of existingUnits) {

                if (newUnitIds.has(existingUnit.id)) {
                    continue;
                }

                // Check inventory
                const stockRows = await getInventoryStockReferencesByPackagingUnit(db, existingUnit.id);

                if (stockRows.length > 0) {
                    throw new Error(
                        `Cannot remove packaging unit ${existingUnit.id} because inventory stock is using it`
                    );
                }

                // Check delivery history
                const deliveryRows = await getDeliveryItemReferencesByPackagingUnit(db, existingUnit.id);

                if (deliveryRows.length > 0) {
                    throw new Error(
                        `Cannot remove packaging unit ${existingUnit.id} because delivery history is using it`
                    );
                }

                // Check whether another packaging unit contains this unit
                const containsRows = await selectPackagingUnitIdsContainingUnit(db, existingUnit.id);

                if (containsRows.length > 0) {
                    throw new Error(
                        `Cannot remove packaging unit ${existingUnit.id} because another packaging unit contains it`
                    );
                }

                await deletePackagingUnitRow(db, existingUnit.id);
            }

            // --------------------------------------------------
            // 7. Process packaging units
            // --------------------------------------------------
            for (const unit of variant.packagingUnits ?? []) {

                const existingUnit = await selectPackagingUnitIdByIdAndVariantId(db, unit.id, variant.id);

                if (existingUnit.length > 0) {

                    // Existing packaging unit -> UPDATE
                    await updatePackagingUnitRow(
                        db,
                        unit,
                        variant.id,
                        variant.packagingUnits.indexOf(unit) + 1
                    );

                } else {

                    // New packaging unit -> INSERT
                    await insertPackagingUnitRow(
                        db,
                        unit,
                        variant.id,
                        variant.packagingUnits.indexOf(unit) + 1
                    );
                }
            }
        }

        const changes = getProductActivityChanges(existingProduct, product);
        const isArchiveTransition = existingProduct.status !== "archived" && product.status === "archived";
        await recordActivity(db, {
            eventType: isArchiveTransition ? "product.archived" : "product.edited",
            entityType: "product",
            entityId: product.id,
            entityLabel: product.name,
            summary: isArchiveTransition
                ? `Product archived: ${product.name}`
                : `Product edited: ${product.name}`,
            reason: normalizedReason,
            changes,
        });

        await db.execute(`COMMIT`);

        return {
            success: true,
            productId: product.id,
        };

    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    }
};

const normalizeAdjustmentText = (value: string | null, field: string): string | null => {
    if (value === null) return null;
    if (typeof value !== "string") throw new Error(`${field} must be a string or null`);
    return value.trim() ? value : null;
};

const normalizeAdjustmentValues = (values: InventoryStockValues, label: string): InventoryStockValues => {
    if (!values || typeof values !== "object") {
        throw new Error(`${label} values are required`);
    }
    return {
        quantity: values.quantity,
        batchNumber: normalizeAdjustmentText(values.batchNumber, `${label} batch number`),
        expiryDate: normalizeAdjustmentText(values.expiryDate, `${label} expiry date`),
        costPrice: values.costPrice,
        sellingPrice: values.sellingPrice,
    };
};

const validateAdjustmentValues = (values: InventoryStockValues) => {
    if (!Number.isFinite(values.quantity) || values.quantity < 0 || !Number.isInteger(values.quantity)) {
        throw new Error("Adjusted quantity must be a non-negative whole number");
    }
    if (!Number.isFinite(values.costPrice) || values.costPrice < 0) {
        throw new Error("Adjusted cost price must be a non-negative number");
    }
    if (!Number.isFinite(values.sellingPrice) || values.sellingPrice < 0) {
        throw new Error("Adjusted selling price must be a non-negative number");
    }
    if (values.expiryDate !== null && !isValidExpiryDate(values.expiryDate)) {
        throw new Error("Adjusted expiry date is invalid");
    }
};

const adjustmentValuesMatch = (left: InventoryStockValues, right: InventoryStockValues) =>
    left.quantity === right.quantity &&
    left.batchNumber === right.batchNumber &&
    left.expiryDate === right.expiryDate &&
    left.costPrice === right.costPrice &&
    left.sellingPrice === right.sellingPrice;

export const adjustInventory = async (input: InventoryAdjustmentInput) => {
    const db = await loadDatabase();

    try {
        await db.execute(`PRAGMA foreign_keys = ON;`);
        await db.execute(`BEGIN`);

        if (typeof input.reason !== "string" || !input.reason.trim()) {
            throw new Error("An inventory adjustment reason is required");
        }
        const reason = input.reason.trim();
        if (typeof input.productId !== "string" || !input.productId.trim()) {
            throw new Error("A product ID is required for an inventory adjustment");
        }
        if (!Array.isArray(input.changes) || input.changes.length === 0) {
            throw new Error("At least one inventory stock row change is required");
        }

        const productSnapshot = await getProductActivitySnapshot(db, input.productId);
        if (!productSnapshot) {
            throw new Error(`Product ${input.productId} does not exist`);
        }
        const stockRows = await selectRawInventoryStockRows(db, { productId: input.productId });
        const rowsById = new Map(stockRows.map((row) => [row.id, row]));
        const seenRowIds = new Set<string>();
        const plannedChanges: Array<{
            stockRowId: string;
            variantId: string;
            packagingUnitId: string;
            before: InventoryStockValues;
            after: InventoryStockValues;
        }> = [];

        for (const change of input.changes) {
            if (!change || typeof change.stockRowId !== "string" || !change.stockRowId) {
                throw new Error("An inventory stock row ID is required for every change");
            }
            if (seenRowIds.has(change.stockRowId)) {
                throw new Error(`Inventory stock row ${change.stockRowId} appears more than once`);
            }
            seenRowIds.add(change.stockRowId);
            if (typeof change.variantId !== "string" || !change.variantId ||
                typeof change.packagingUnitId !== "string" || !change.packagingUnitId) {
                throw new Error(`Inventory stock row ${change.stockRowId} requires a variant and packaging unit`);
            }
            if (!change.after || Object.prototype.hasOwnProperty.call(change.after, "packagingUnitId")) {
                throw new Error("Inventory adjustments cannot change a stock row packaging unit");
            }

            const row = rowsById.get(change.stockRowId);
            if (!row) {
                throw new Error(`Inventory stock row ${change.stockRowId} does not exist for product ${input.productId}`);
            }
            if (row.variantId !== change.variantId || row.packagingUnitId !== change.packagingUnitId) {
                throw new Error(`Inventory stock row ${change.stockRowId} does not match the supplied variant and packaging unit`);
            }
            const variant = productSnapshot.variants.find((candidate) => candidate.id === row.variantId);
            if (!variant || variant.productId !== input.productId ||
                !variant.packagingUnits.some((unit) => unit.id === row.packagingUnitId)) {
                throw new Error(`Inventory stock row ${change.stockRowId} has an invalid product, variant, or packaging unit relationship`);
            }

            const before = normalizeAdjustmentValues({
                quantity: row.quantity,
                batchNumber: row.batchNumber,
                expiryDate: row.expiryDate,
                costPrice: row.costPrice,
                sellingPrice: row.sellingPrice,
            }, "Current");
            const expectedBefore = normalizeAdjustmentValues(change.expectedBefore, "Expected before");
            if (!adjustmentValuesMatch(before, expectedBefore)) {
                throw new Error(`Inventory stock row ${change.stockRowId} has changed; refresh before adjusting it`);
            }

            const after = normalizeAdjustmentValues(change.after, "After");
            validateAdjustmentValues(after);
            if (adjustmentValuesMatch(before, after)) {
                throw new Error(`Inventory stock row ${change.stockRowId} has no changes to apply`);
            }

            plannedChanges.push({
                stockRowId: row.id,
                variantId: row.variantId,
                packagingUnitId: row.packagingUnitId,
                before,
                after,
            });
        }

        for (const change of plannedChanges) {
            await setInventoryStockEntry(db, input.productId, {
                id: change.stockRowId,
                variantId: change.variantId,
                packagingUnitId: change.packagingUnitId,
                quantity: change.after.quantity,
                batchNumber: change.after.batchNumber ?? undefined,
                expiryDate: change.after.expiryDate ?? undefined,
                costPrice: change.after.costPrice,
                sellingPrice: change.after.sellingPrice,
            }, { mode: "existing" });
        }

        await recordActivity(db, {
            eventType: "inventory.adjusted",
            entityType: "product",
            entityId: input.productId,
            entityLabel: productSnapshot.name,
            summary: `Inventory adjusted: ${productSnapshot.name}`,
            reason,
            changes: null,
            details: { rows: plannedChanges },
        });

        await db.execute(`COMMIT`);
        return { success: true, productId: input.productId };
    } catch (error) {
        try {
            await db.execute(`ROLLBACK`);
        } catch {
            // Preserve the failure that caused the transaction to roll back.
        }
        throw error;
    }
};

export const deleteProduct = async (id: string) => {
    const db = await loadDatabase();

    try {
        await db.execute(`PRAGMA foreign_keys = ON;`);
        await db.execute(`BEGIN`);

        const existingProduct = await getProductActivitySnapshot(db, id);
        const result = await archiveProductRow(db, id);

        if (existingProduct && existingProduct.status !== "archived") {
            const archivedProduct = { ...existingProduct, status: "archived" as const };
            await recordActivity(db, {
                eventType: "product.archived",
                entityType: "product",
                entityId: id,
                entityLabel: existingProduct.name,
                summary: `Product archived: ${existingProduct.name}`,
                reason: null,
                changes: getProductActivityChanges(existingProduct, archivedProduct),
            });
        }

        await db.execute(`COMMIT`);
        return result;
    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    }
};

export const createDelivery = async (delivery: Delivery) => {
    return await createDeliveryRow(delivery);
};

export const createDeliveryItem = async (item: DeliveryItems) => {
    return await createDeliveryItemRow(item);
};

export const getDeliveries = async (): Promise<Delivery[]> => {
    return await getDeliveryRows();
};

export const getDeliveryById = async (id: string): Promise<Delivery | null> => {
    return await getDeliveryRowById(id);
};

export const getSmallestPackagingUnit = (variant: Variant): PackagingUnit | null => {
    return getSmallestPackagingUnitFromHierarchy(variant.packagingUnits);
};

export const convertQuantityToSmallest = (
    quantity: number,
    packagingUnitId: string,
    packagingUnits: PackagingUnit[]
): number => {
    const smallestUnit = getSmallestPackagingUnit({
        id: "",
        productId: "",
        packagingUnits,
    });

    if (!smallestUnit) {
        return 0;
    }

    return getConversionFactor(packagingUnitId, smallestUnit.id, packagingUnits) * quantity;
};

export const getAvailableQuantityInUnit = async (
    productId: string,
    variantId: string,
    packagingUnitId: string
): Promise<number> => {
    const db = await loadDatabase();
    const packagingUnits = await getPackagingUnitsForVariant(db, variantId);
    if (packagingUnits.length === 0) {
        return 0;
    }

    const selectedUnit = packagingUnits.find((unit) => unit.id === packagingUnitId);
    if (!selectedUnit) {
        throw new Error(`Packaging unit ${packagingUnitId} does not belong to variant ${variantId}`);
    }

    const stockRows = await getInventoryStockQuantitiesByVariant(db, productId, variantId);

    return stockRows.reduce((total, row) => {
        const factor = getConversionFactor(
            row.packagingUnitId,
            selectedUnit.id,
            packagingUnits
        );
        return total + row.quantity * factor;
    }, 0);
};

export type DashboardStockLine = {
    id: string;
    productId: string;
    productName: string;
    variantId: string;
    variantLabel: string;
    packagingUnitId: string;
    packagingUnitName: string;
    quantity: number;
    batchNumber?: string;
    expiryDate?: string;
};

export type DashboardQuantity = {
    productId: string;
    productName: string;
    variantId: string;
    variantLabel: string;
    quantity: number;
    smallestUnitName: string;
    threshold: number;
};

export type DashboardSummary = {
    nearExpiry: DashboardStockLine[];
    expiresToday: DashboardStockLine[];
    expired: DashboardStockLine[];
    lowStock: DashboardQuantity[];
    outOfStock: DashboardQuantity[];
};

const formatVariantLabel = (variant: Variant) =>
    [variant.strength, variant.strengthUnit, variant.form]
        .filter((value) => value?.trim())
        .join(" ");

export const getDashboardSummary = async (): Promise<DashboardSummary> => {
    const db = await loadDatabase();
    const referenceDate = getCurrentCalendarDate();
    const productsFromDb = await getProducts();
    const activeProducts = productsFromDb.filter((product) => product.status !== "archived");
    const stockRows = (await selectRawInventoryStockRows(db))
        .filter((row) => row.quantity > 0)
        .sort((left, right) => {
            if (left.expiryDate === null && right.expiryDate !== null) return -1;
            if (left.expiryDate !== null && right.expiryDate === null) return 1;
            if (left.expiryDate !== null && right.expiryDate !== null) {
                if (left.expiryDate < right.expiryDate) return -1;
                if (left.expiryDate > right.expiryDate) return 1;
            }
            if (left.id < right.id) return -1;
            if (left.id > right.id) return 1;
            return 0;
        });

    const stockLines: DashboardStockLine[] = [];
    const quantities: DashboardQuantity[] = [];

    for (const product of activeProducts) {
        for (const variant of product.variants) {
            if (variant.packagingUnits.length === 0) continue;

            const smallestUnit = getSmallestPackagingUnit(variant);
            if (!smallestUnit) continue;

            const variantRows = stockRows.filter((row) =>
                row.productId === product.id && row.variantId === variant.id
            );

            let totalSmallestQuantity = 0;
            for (const row of variantRows) {
                const unit = variant.packagingUnits.find((entry) => entry.id === row.packagingUnitId);
                if (!unit) continue;

                totalSmallestQuantity += row.quantity * getConversionFactor(
                    row.packagingUnitId,
                    smallestUnit.id,
                    variant.packagingUnits
                );

                if (product.trackExpiry && row.expiryDate) {
                    const line: DashboardStockLine = {
                        id: row.id,
                        productId: product.id,
                        productName: product.name,
                        variantId: variant.id,
                        variantLabel: formatVariantLabel(variant),
                        packagingUnitId: row.packagingUnitId,
                        packagingUnitName: unit.name || "Unit",
                        quantity: row.quantity,
                        batchNumber: row.batchNumber ?? undefined,
                        expiryDate: row.expiryDate ?? undefined,
                    };
                    stockLines.push(line);
                }
            }

            quantities.push({
                productId: product.id,
                productName: product.name,
                variantId: variant.id,
                variantLabel: formatVariantLabel(variant),
                quantity: totalSmallestQuantity,
                smallestUnitName: smallestUnit.name,
                threshold: product.lowStockLevel ?? 5,
            });
        }
    }

    const nearExpiry: DashboardStockLine[] = [];
    const expiresToday: DashboardStockLine[] = [];
    const expired: DashboardStockLine[] = [];
    for (const line of stockLines) {
        const classification = classifyExpiry(line.expiryDate, referenceDate);
        if (classification.state === "expired") expired.push(line);
        else if (classification.state === "expiresToday") expiresToday.push(line);
        else if (classification.state === "expiringSoon") nearExpiry.push(line);
    }

    return {
        nearExpiry,
        expiresToday,
        expired,
        lowStock: quantities.filter((entry) => entry.quantity > 0 && entry.quantity <= entry.threshold),
        outOfStock: quantities.filter((entry) => entry.quantity === 0),
    };
};

type StockRowForSale = {
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

export type SaleStockAllocation = {
    batchNumber: string | null;
    expiryDate: string | null;
    quantity: number;
};

const getSaleStockAllocation = (
    item: Pick<SaleItem, "productId" | "variantId" | "packagingUnitId" | "quantity">,
    stockRows: StockRowForSale[],
    packagingUnits: PackagingUnit[]
) => {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isInteger(item.quantity)) {
        throw new Error("Sale quantity must be a positive whole number");
    }

    if (packagingUnits.length === 0) {
        throw new Error("This product has no packaging units configured for sale");
    }

    const requestedUnit = packagingUnits.find((unit) => unit.id === item.packagingUnitId);
    if (!requestedUnit) {
        throw new Error(`Packaging unit ${item.packagingUnitId} does not belong to variant ${item.variantId}`);
    }

    const candidates = stockRows
        .filter((row) => row.quantity > 0)
        .map((row) => ({
            row,
            conversionFactor: getConversionFactor(row.packagingUnitId, requestedUnit.id, packagingUnits),
        }))
        .sort((left, right) => {
            const leftExpiry = left.row.expiryDate?.trim() || "9999-12-31";
            const rightExpiry = right.row.expiryDate?.trim() || "9999-12-31";
            const expiryComparison = leftExpiry.localeCompare(rightExpiry);
            if (expiryComparison !== 0) return expiryComparison;

            const leftExact = left.row.packagingUnitId === requestedUnit.id ? 0 : 1;
            const rightExact = right.row.packagingUnitId === requestedUnit.id ? 0 : 1;
            if (leftExact !== rightExact) return leftExact - rightExact;

            return left.row.id.localeCompare(right.row.id);
        });

    const availableQuantity = candidates.reduce(
        (total, candidate) => total + candidate.row.quantity * candidate.conversionFactor,
        0
    );
    if (availableQuantity < item.quantity) {
        throw new Error(
            `Insufficient stock: requested ${item.quantity} ${requestedUnit.name || "unit"}, only ${availableQuantity} available`
        );
    }

    let remainingQuantity = item.quantity;
    const allocations: Array<{ row: StockRowForSale; conversionFactor: number; quantity: number; sourceQuantity: number }> = [];

    for (const candidate of candidates) {
        if (remainingQuantity <= 0) break;

        const availableInRequestedUnit = candidate.row.quantity * candidate.conversionFactor;
        const quantityToAllocate = Math.min(remainingQuantity, availableInRequestedUnit);
        const sourceQuantityToUse = Math.floor(quantityToAllocate / candidate.conversionFactor);
        if (sourceQuantityToUse <= 0) {
            continue;
        }

        const actualRequestedQuantity = sourceQuantityToUse * candidate.conversionFactor;
        if (actualRequestedQuantity <= 0) {
            continue;
        }

        allocations.push({
            row: candidate.row,
            conversionFactor: candidate.conversionFactor,
            quantity: actualRequestedQuantity,
            sourceQuantity: sourceQuantityToUse,
        });
        remainingQuantity -= actualRequestedQuantity;
    }

    if (remainingQuantity > 0) {
        throw new Error(
            `Unable to allocate ${item.quantity} ${requestedUnit.name || "unit"} safely from the available inventory without splitting stock incorrectly.`
        );
    }

    return { requestedUnit, allocations };
};

const applySaleStockAllocation = (
    db: SqliteDatabase,
    allocations: Array<{ row: StockRowForSale; sourceQuantity: number }>
) => applyInventoryStockAllocation(db, allocations.map(({ row, sourceQuantity }) => ({
    stockRowId: row.id,
    availableQuantity: row.quantity,
    quantityToDeduct: sourceQuantity,
    batchNumber: row.batchNumber,
})));

export const getSaleStockAllocationPreview = async (
    productId: string,
    variantId: string,
    packagingUnitId: string,
    quantity: number
): Promise<SaleStockAllocation[]> => {
    const db = await loadDatabase();
    const [packagingUnits, stockRows] = await Promise.all([
        getPackagingUnitsForVariant(db, variantId),
        selectInventoryStockRowsByVariant(db, productId, variantId),
    ]);

    if (packagingUnits.length === 0) {
        return [];
    }

    const { allocations } = getSaleStockAllocation(
        { productId, variantId, packagingUnitId, quantity },
        stockRows,
        packagingUnits
    );
    return allocations.map(({ row, quantity: allocatedQuantity }) => ({
        batchNumber: row.batchNumber,
        expiryDate: row.expiryDate,
        quantity: allocatedQuantity,

    }));
};

export const deleteSaleDraft = async (saleId: string) => {
    const db = await loadDatabase();

    try {
        await db.execute(`PRAGMA foreign_keys = ON;`);
        await db.execute(`BEGIN`);
        await deleteSaleItemsBySaleId(db, saleId);
        await deleteSaleDraftById(db, saleId);
        await db.execute(`COMMIT`);
        return { success: true };
    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    }
};

export const deductStockForSaleItem = async (
    db: SqliteDatabase,
    item: SaleItem
) : Promise<SaleStockAllocation[]> => {
    const packagingUnits = await getPackagingUnitsForVariant(db, item.variantId);
    if (packagingUnits.length === 0) {
        throw new Error("This product has no packaging units configured for sale");
    }

    const stockRows = await selectInventoryStockRowsByVariant(db, item.productId, item.variantId);
    const { allocations } = getSaleStockAllocation(item, stockRows, packagingUnits);
    await applySaleStockAllocation(db, allocations);

    return allocations.map(({ row, quantity }) => ({
        batchNumber: row.batchNumber,
        expiryDate: row.expiryDate,
        quantity,
    }));
};

export const saveSaleDraft = async (sale: Sale) => {
    const db = await loadDatabase();

    try {
        await db.execute(`PRAGMA foreign_keys = ON;`);
        await db.execute(`BEGIN`);

        if (!sale.items || sale.items.length === 0) {
            throw new Error("Sale draft must contain at least one item");
        }

        const existingSale = await selectSaleIdsByIdAndStatus(db, sale.id);

        if (existingSale.length > 0 && existingSale[0].status !== "draft") {
            throw new Error("Completed sales cannot be saved as drafts");
        }

        if (existingSale.length > 0) {
            await updateSaleRow(db, sale, "draft");
        } else {
            await insertSaleRow(db, sale, "draft");
        }

        await deleteSaleItemsBySaleId(db, sale.id);

        for (const item of sale.items) {
            if (!Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isInteger(item.quantity)) {
                throw new Error("Draft sale quantity must be a positive whole number");
            }

            await insertSaleItemRow(db, sale.id, item);
        }

        await db.execute(`COMMIT`);
        return { success: true, saleId: sale.id };
    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    }
};

export const createSale = async (sale: Sale) => {
    const db = await loadDatabase();

    try {
        await db.execute(`PRAGMA foreign_keys = ON;`);
        await db.execute(`BEGIN`);

        if (!sale.items || sale.items.length === 0) {
            throw new Error("Sale must contain at least one item");
        }

        for (const item of sale.items) {
            if (!Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isInteger(item.quantity)) {
                throw new Error("Sale quantity must be a positive whole number");
            }

            const productRow = await selectNonArchivedProductIdsById(db, item.productId);
            if (productRow.length === 0) {
                throw new Error(`Product ${item.productId} does not exist or is archived`);
            }

            const variantRow = await selectVariantIdByIdAndProductId(db, item.variantId, item.productId);
            if (variantRow.length === 0) {
                throw new Error(`Variant ${item.variantId} does not belong to product ${item.productId}`);
            }

            const packagingUnitRow = await selectPackagingUnitIdByIdAndVariantId(
                db,
                item.packagingUnitId,
                item.variantId
            );
            if (packagingUnitRow.length === 0) {
                throw new Error(`Packaging unit ${item.packagingUnitId} does not belong to variant ${item.variantId}`);
            }

            const packagingUnits = await getPackagingUnitsForVariant(db, item.variantId);
            const stockRows = await selectInventoryStockRowsByVariant(db, item.productId, item.variantId);
            getSaleStockAllocation(item, stockRows, packagingUnits);
        }

        const existingSale = await selectSaleIdsById(db, sale.id);
        if (existingSale.length > 0) {
            await updateSaleRow(db, sale, "completed");
        } else {
            await insertSaleRow(db, sale, "completed");
        }

        await deleteSaleItemsBySaleId(db, sale.id);

        const allocatedSaleItems: Array<{
            item: SaleItem;
            allocations: Array<{ quantity: number; batchNumber: string | null; expiryDate: string | null }>;
        }> = [];

        for (const item of sale.items) {
            const packagingUnits = await getPackagingUnitsForVariant(db, item.variantId);
            const stockRows = await selectInventoryStockRowsByVariant(db, item.productId, item.variantId);
            const { allocations } = getSaleStockAllocation(item, stockRows, packagingUnits);
            const activityAllocations: Array<{ quantity: number; batchNumber: string | null; expiryDate: string | null }> = [];

            await applySaleStockAllocation(db, allocations);
            for (const { row, quantity } of allocations) {
                await insertSaleItemRowWithAllocation(db, sale.id, item, quantity, row.batchNumber ?? null, row.expiryDate ?? null);
                activityAllocations.push({
                    quantity,
                    batchNumber: row.batchNumber ?? null,
                    expiryDate: row.expiryDate ?? null,
                });
            }
            allocatedSaleItems.push({ item, allocations: activityAllocations });
        }

        const itemCount = sale.items.length;
        const sellerSummary = sale.soldBy?.trim() ? `, sold by ${sale.soldBy.trim()}` : "";
        const saleProducts = new Map<string, Product | null>();
        for (const item of sale.items) {
            if (!saleProducts.has(item.productId)) {
                saleProducts.set(item.productId, await getProductActivitySnapshot(db, item.productId));
            }
        }
        await recordActivity(db, {
            eventType: "sale.completed",
            entityType: "sale",
            entityId: sale.id,
            entityLabel: `Sale ${sale.date}`,
            summary: `Completed sale: ${itemCount} item${itemCount === 1 ? "" : "s"}, total ₦${sale.totalAmount.toFixed(2)}${sellerSummary}`,
            reason: null,
            details: {
                saleDate: sale.date,
                soldBy: sale.soldBy ?? null,
                notes: sale.notes ?? null,
                totalAmount: sale.totalAmount,
                discount: sale.discount ?? 0,
                items: allocatedSaleItems.map(({ item, allocations }) => {
                    const productSnapshot = saleProducts.get(item.productId) ?? null;
                    const variant = productSnapshot?.variants.find((entry) => entry.id === item.variantId);
                    const packagingUnit = variant?.packagingUnits.find((unit) => unit.id === item.packagingUnitId);
                    return {
                        productId: item.productId,
                        productName: productSnapshot?.name ?? null,
                        variantId: item.variantId,
                        variantLabel: getActivityVariantLabel(variant),
                        packagingUnitId: item.packagingUnitId,
                        packagingUnitName: packagingUnit?.name ?? null,
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        lineAmount: calculateSaleLineAmount(item.quantity, item.unitPrice),
                        allocations,
                    };
                }),
            },
        });

        await db.execute(`COMMIT`);
        return { success: true, saleId: sale.id };
    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    }
};

export const getSales = async (): Promise<Sale[]> => {
    return await getSaleRows();
};

export const getSaleById = async (id: string): Promise<Sale | null> => {
    return await getSaleRowById(id);
};

