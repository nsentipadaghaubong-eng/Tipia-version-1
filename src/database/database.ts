import Database from "@tauri-apps/plugin-sql";
import {
    product1, product2, product3, product4, product5, product6, product7,
    product8, product9, product10
} from "../components/ProductList";
import { Product, ProductRow, PackagingUnit, PackagingUnitRow, Delivery, DeliveryItems, Variant, Sale, SaleItem } from "../types/Product";
import { getDaysUntilExpiry } from "../utils/expiry";

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

export const INVENTORY_CHANGED_EVENT = "tipia:inventory-changed";
export const PENDING_TASKS_CHANGED_EVENT = "tipia:pending-tasks-changed";

const products = [
    product1, product2, product3, product4, product5,
    product6, product7, product8, product9, product10
];

const mapProductToRow = (product: Product): ProductRow => {
    return {
        ...product,
        nafdacNumber: product.nafdacNumber ?? "",
        trackBatches: product.trackBatches ? 1 : 0,
        trackExpiry: product.trackExpiry ? 1 : 0,
    };
};

const mapRowToProduct = (row: ProductRow): Product => {
    return {
        ...row,
        nafdacNumber: row.nafdacNumber ?? "",
        barcode: row.barcode ?? "",
        sku: row.sku ?? "",
        lowStockLevel: row.lowStockLevel ?? 5,
        trackBatches: Boolean(row.trackBatches),
        trackExpiry: Boolean(row.trackExpiry),
        status: row.status ?? "active",
        createdAt: row.createdAt ?? undefined,
        variants: [],
    };
};

const mapRowToPackagingUnit = (row: PackagingUnitRow): PackagingUnit => {
    return {
        id: row.id,
        name: row.name,
        contains:
            row.containsQuantity !== null && row.containsUnitId !== null
                ? {
                    quantity: row.containsQuantity,
                    unitId: row.containsUnitId
                }
                : undefined,
        costPrice: row.costPrice ?? undefined,
        sellingPrice: row.sellingPrice ?? undefined,
        isDefault: Boolean(row.isDefault),
    };
};

export const initializeDatabase = async () => {
    const db = await Database.load("sqlite:tipia.db");

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
    const db = await Database.load("sqlite:tipia.db");

    const rows = await db.select<Array<{
        id: string;
        variantId: string;
        packagingUnitId: string;
        quantity: number;
        batchNumber: string | null;
        expiryDate: string | null;
        costPrice: number;
        sellingPrice: number;
    }>>(`
        SELECT
            id,
            variant_id AS variantId,
            packaging_unit_id AS packagingUnitId,
            quantity,
            batch_number AS batchNumber,
            expiry_date AS expiryDate,
            cost_price AS costPrice,
            selling_price AS sellingPrice
        FROM inventory_stock
        WHERE product_id = ?
        ORDER BY variant_id, packaging_unit_id, expiry_date ASC, id ASC
    `, [productId]);

    return rows.map((row) => ({
        id: row.id,
        variantId: row.variantId,
        packagingUnitId: row.packagingUnitId,
        quantity: row.quantity,
        batchNumber: row.batchNumber ?? undefined,
        expiryDate: row.expiryDate ?? undefined,
        costPrice: row.costPrice,
        sellingPrice: row.sellingPrice,
    }));
};

export const getCurrentStockForAllProducts = async (): Promise<Record<string, CurrentStockEntry[]>> => {
    const db = await Database.load("sqlite:tipia.db");
    const rows = await db.select<Array<CurrentStockEntry & { productId: string }>>(`
        SELECT
            id,
            product_id AS productId,
            variant_id AS variantId,
            packaging_unit_id AS packagingUnitId,
            quantity,
            batch_number AS batchNumber,
            expiry_date AS expiryDate,
            cost_price AS costPrice,
            selling_price AS sellingPrice
        FROM inventory_stock
        ORDER BY product_id, variant_id, packaging_unit_id, expiry_date ASC, id ASC
    `);

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
    const db = await Database.load("sqlite:tipia.db");

    const rows = await db.select<StockRowForSale[]>(`
        SELECT
            id,
            product_id AS productId,
            variant_id AS variantId,
            packaging_unit_id AS packagingUnitId,
            quantity,
            batch_number AS batchNumber,
            expiry_date AS expiryDate,
            cost_price AS costPrice,
            selling_price AS sellingPrice
        FROM inventory_stock
        WHERE product_id = ?
          AND variant_id = ?
          AND quantity > 0
    `, [productId, variantId]);

    return rows.filter((row) => {
        if (preferredBatchNumber && (row.batchNumber ?? "") !== preferredBatchNumber) {
            return false;
        }
        if (preferredExpiryDate && (row.expiryDate ?? "") !== preferredExpiryDate) {
            return false;
        }
        return true;
    });
};

export const formatStockByPackagingHierarchy = (
    variant: Variant,
    stockEntries: Array<{ packagingUnitId: string; quantity: number }>
): string => {
    if (!variant.packagingUnits.length || stockEntries.length === 0) {
        return "0";
    }

    const smallestUnit = getSmallestPackagingUnit(variant);
    if (!smallestUnit) {
        return "0";
    }

    const totalSmallestUnits = stockEntries.reduce((total, entry) => {
        const unit = variant.packagingUnits.find((item) => item.id === entry.packagingUnitId);
        if (!unit) return total;
        return total + entry.quantity * getConversionFactor(unit.id, smallestUnit.id, variant.packagingUnits);
    }, 0);

    if (totalSmallestUnits === 0) {
        return `0 ${smallestUnit.name || "unit"}s`;
    }

    const orderedUnits = variant.packagingUnits.slice();
    let remainingSmallestUnits = totalSmallestUnits;
    const quantitiesByUnit = new Map<string, number>();

    for (const unit of orderedUnits) {
        const factorToSmallest = getConversionFactor(unit.id, smallestUnit.id, variant.packagingUnits);
        const count = Math.floor(remainingSmallestUnits / factorToSmallest);
        if (count <= 0) {
            continue;
        }

        quantitiesByUnit.set(unit.id, count);
        remainingSmallestUnits -= count * factorToSmallest;
    }

    const parts = orderedUnits
        .map((unit) => {
            const count = quantitiesByUnit.get(unit.id) ?? 0;
            if (count <= 0) return null;
            return `${count} ${unit.name || "unit"}${count === 1 ? "" : "s"}`;
        })
        .filter((value): value is string => Boolean(value));

    if (remainingSmallestUnits > 0) {
        const smallestCount = remainingSmallestUnits;
        parts.push(`${smallestCount} ${smallestUnit.name || "unit"}${smallestCount === 1 ? "" : "s"}`);
    }

    if (parts.length === 0) {
        return `${totalSmallestUnits} ${smallestUnit.name || "unit"}${totalSmallestUnits === 1 ? "" : "s"}`;
    }

    return parts.join(" + ");
};

export const getVariantAvailabilityByPackagingUnit = async (
    productId: string,
    variantId: string
): Promise<Array<{ unitId: string; unitName: string; quantity: number }>> => {
    const db = await Database.load("sqlite:tipia.db");
    const packagingUnits = await getPackagingUnitsForVariant(db, variantId);

    const stockRows = await db.select<Array<{ packagingUnitId: string; quantity: number }>>(`
        SELECT packaging_unit_id AS packagingUnitId, quantity
        FROM inventory_stock
        WHERE product_id = ? AND variant_id = ? AND quantity > 0
    `, [productId, variantId]);

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

export const getProducts = async () => {
    const db = await Database.load("sqlite:tipia.db");

    const productRows = await db.select<ProductRow[]>(`
        SELECT 
            id, name, generic_name AS genericName, category, manufacturer,
            nafdac_number AS nafdacNumber,
            barcode, sku, low_stock_level AS lowStockLevel,
            track_batches AS trackBatches, track_expiry AS trackExpiry, status,
            created_at AS createdAt
        FROM products
        ORDER BY created_at IS NULL, created_at DESC, id DESC
    `);

    const variantRows = await db.select<Array<{
        id: string;
        productId: string;
        strength: string;
        strengthUnit: string;
        form: string;
    }>>(`
        SELECT 
            id, product_id AS productId, strength, strength_unit AS strengthUnit, form
        FROM variants
    `);

    const packagingRows = await db.select<PackagingUnitRow[]>(`
    SELECT
        id,
        variant_id AS variantId,
        name,
        level,
        contains_quantity AS containsQuantity,
        contains_unit_id AS containsUnitId,
        cost_price AS costPrice,
        selling_price AS sellingPrice,
        is_default AS isDefault
    FROM packaging_units
    ORDER BY variant_id, level ASC
`);
    return productRows.map((pRow) => {
        const product = mapRowToProduct(pRow);

        const variants = variantRows
            .filter((v) => v.productId === product.id)
            .map((v) => {
                const packagingUnits = packagingRows
                    .filter((u) => u.variantId === v.id)
                    .map(mapRowToPackagingUnit);

                return {
                    id: v.id,
                    productId: v.productId,
                    strength: v.strength,
                    strengthUnit: v.strengthUnit,
                    form: v.form,
                    packagingUnits,
                };
            });

        return {
            ...product,
            variants: variants,
        };
    });
};

type SqliteDatabase = Awaited<ReturnType<typeof Database.load>>;

const saveProductHierarchy = async (
    db: SqliteDatabase,
    product: Product
) => {
    for (const variant of product.variants ?? []) {
        await db.execute(`
            INSERT INTO variants(
                id, product_id, strength, strength_unit, form
            )
            VALUES(?, ?, ?, ?, ?)
        `, [
            variant.id,
            product.id,
            variant.strength ?? "",
            variant.strengthUnit ?? "",
            variant.form ?? "",
        ]);

        for (let level = 0; level < (variant.packagingUnits ?? []).length; level++) {
            const unit = variant.packagingUnits[level];

            await db.execute(`
        INSERT INTO packaging_units(
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
    const db = await Database.load("sqlite:tipia.db");

    try {
        await db.execute(`PRAGMA foreign_keys = ON;`);
        await db.execute(`BEGIN`);

        const row = mapProductToRow(product);

        const createdAt = new Date().toISOString();

        await db.execute(`
            INSERT INTO products(
                id,
                name,
                generic_name,
                category,
                manufacturer,
                nafdac_number,
                barcode,
                sku,
                low_stock_level,
                track_batches,
                track_expiry,
                status,
                created_at
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
            createdAt,
        ]);

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

            await addStock(db, {
                id: stock.id,
                deliveryId: "",
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

export const updateProduct = async (product: Product) => {
    const db = await Database.load("sqlite:tipia.db");
    const row = mapProductToRow(product);

    try {
        await db.execute(`PRAGMA foreign_keys = ON;`);
        await db.execute(`BEGIN`);

        // --------------------------------------------------
        // 1. Update basic product information
        // --------------------------------------------------
        await db.execute(`
            UPDATE products
            SET
                name = ?,
                generic_name = ?,
                category = ?,
                manufacturer = ?,
                nafdac_number = ?,
                barcode = ?,
                sku = ?,
                low_stock_level = ?,
                track_batches = ?,
                track_expiry = ?,
                status = ?
            WHERE id = ?
        `, [
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
            row.id,
        ]);

        // --------------------------------------------------
        // 2. Get existing variants
        // --------------------------------------------------
        const existingVariants = await db.select<Array<{
            id: string;
        }>>(
            `
            SELECT id
            FROM variants
            WHERE product_id = ?
            `,
            [product.id]
        );

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

            const stockRows = await db.select<Array<{ id: string }>>(
                `
                SELECT id
                FROM inventory_stock
                WHERE variant_id = ?
                LIMIT 1
                `,
                [existingVariant.id]
            );

            if (stockRows.length > 0) {
                throw new Error(
                    `Cannot remove variant ${existingVariant.id} because inventory stock is using it`
                );
            }

            const deliveryRows = await db.select<Array<{ id: string }>>(
                `
                SELECT id
                FROM delivery_items
                WHERE variant_id = ?
                LIMIT 1
                `,
                [existingVariant.id]
            );

            if (deliveryRows.length > 0) {
                throw new Error(
                    `Cannot remove variant ${existingVariant.id} because delivery history is using it`
                );
            }

            // Delete its packaging units first
            await db.execute(`
                DELETE FROM packaging_units
                WHERE variant_id = ?
            `, [existingVariant.id]);

            // Then delete the variant
            await db.execute(`
                DELETE FROM variants
                WHERE id = ?
            `, [existingVariant.id]);
        }

        // --------------------------------------------------
        // 4. Process every variant from the form
        // --------------------------------------------------
        for (const variant of product.variants ?? []) {

            const existingVariant = await db.select<Array<{ id: string }>>(
                `
                SELECT id
                FROM variants
                WHERE id = ?
                AND product_id = ?
                `,
                [variant.id, product.id]
            );

            if (existingVariant.length > 0) {

                // Existing variant -> UPDATE it
                await db.execute(`
                    UPDATE variants
                    SET
                        strength = ?,
                        strength_unit = ?,
                        form = ?
                    WHERE id = ?
                    AND product_id = ?
                `, [
                    variant.strength ?? "",
                    variant.strengthUnit ?? "",
                    variant.form ?? "",
                    variant.id,
                    product.id,
                ]);

            } else {

                // New variant -> INSERT it
                await db.execute(`
                    INSERT INTO variants(
                        id,
                        product_id,
                        strength,
                        strength_unit,
                        form
                    )
                    VALUES(?, ?, ?, ?, ?)
                `, [
                    variant.id,
                    product.id,
                    variant.strength ?? "",
                    variant.strengthUnit ?? "",
                    variant.form ?? "",
                ]);
            }

            // --------------------------------------------------
            // 5. Get existing packaging units for this variant
            // --------------------------------------------------
            const existingUnits = await db.select<Array<{
                id: string;
            }>>(
                `
                SELECT id
                FROM packaging_units
                WHERE variant_id = ?
                `,
                [variant.id]
            );

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
                const stockRows = await db.select<Array<{ id: string }>>(
                    `
                    SELECT id
                    FROM inventory_stock
                    WHERE packaging_unit_id = ?
                    LIMIT 1
                    `,
                    [existingUnit.id]
                );

                if (stockRows.length > 0) {
                    throw new Error(
                        `Cannot remove packaging unit ${existingUnit.id} because inventory stock is using it`
                    );
                }

                // Check delivery history
                const deliveryRows = await db.select<Array<{ id: string }>>(
                    `
                    SELECT id
                    FROM delivery_items
                    WHERE packaging_unit_id = ?
                    LIMIT 1
                    `,
                    [existingUnit.id]
                );

                if (deliveryRows.length > 0) {
                    throw new Error(
                        `Cannot remove packaging unit ${existingUnit.id} because delivery history is using it`
                    );
                }

                // Check whether another packaging unit contains this unit
                const containsRows = await db.select<Array<{ id: string }>>(
                    `
                    SELECT id
                    FROM packaging_units
                    WHERE contains_unit_id = ?
                    LIMIT 1
                    `,
                    [existingUnit.id]
                );

                if (containsRows.length > 0) {
                    throw new Error(
                        `Cannot remove packaging unit ${existingUnit.id} because another packaging unit contains it`
                    );
                }

                await db.execute(`
                    DELETE FROM packaging_units
                    WHERE id = ?
                `, [existingUnit.id]);
            }

            // --------------------------------------------------
            // 7. Process packaging units
            // --------------------------------------------------
            for (const unit of variant.packagingUnits ?? []) {

                const existingUnit = await db.select<Array<{ id: string }>>(
                    `
                    SELECT id
                    FROM packaging_units
                    WHERE id = ?
                    AND variant_id = ?
                    `,
                    [unit.id, variant.id]
                );

                if (existingUnit.length > 0) {

                    // Existing packaging unit -> UPDATE
                    await db.execute(`
                        UPDATE packaging_units
                        SET
                        name = ?,
                        level = ?,
                        contains_quantity = ?,
                        contains_unit_id = ?,
                        cost_price = ?,
                        selling_price = ?,
                        is_default = ?
                        WHERE id = ?
                        AND variant_id = ?
                    `, [
                        unit.name,
                        variant.packagingUnits.indexOf(unit) + 1,
                        unit.contains?.quantity ?? null,
                        unit.contains?.unitId ?? null,
                        unit.costPrice ?? null,
                        unit.sellingPrice ?? null,
                        unit.isDefault ? 1 : 0,
                        unit.id,
                        variant.id,
                    ]);

                } else {

                    // New packaging unit -> INSERT
                    await db.execute(`
                        INSERT INTO packaging_units(
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
                        variant.packagingUnits.indexOf(unit) + 1,
                        unit.contains?.quantity ?? null,
                        unit.contains?.unitId ?? null,
                        unit.costPrice ?? null,
                        unit.sellingPrice ?? null,
                        unit.isDefault ? 1 : 0,
                    ]);
                }
            }
        }

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

export const deleteProduct = async (id: string) => {
    const db = await Database.load("sqlite:tipia.db");

    return await db.execute(`
        UPDATE products
        SET status = 'archived'
        WHERE id = ?
    `, [id]);
};

export const createDelivery = async (delivery: Delivery) => {
    const db = await Database.load("sqlite:tipia.db");
    return await db.execute(`
        INSERT INTO deliveries(
            id, supplier, invoice_no, date, received_by
        )
        VALUES(?, ?, ?, ?, ?)
    `, [
        delivery.id,
        delivery.supplier,
        delivery.invoiceNo,
        delivery.date,
        delivery.receivedBy
    ]);
};

export const createDeliveryItem = async (item: DeliveryItems) => {
    const db = await Database.load("sqlite:tipia.db");
    return await db.execute(`
        INSERT INTO delivery_items(
            id, delivery_id, product_id, variant_id, packaging_unit_id,
            quantity, batch_number, expiry_date, cost_price, selling_price
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        item.id,
        item.deliveryId,
        item.productId,
        item.variantId,
        item.packagingUnitId,
        item.quantity,
        item.batchNumber,
        item.expiryDate,
        item.costPrice,
        item.sellingPrice
    ]);
};

export const getDeliveries = async (): Promise<Delivery[]> => {
    const db = await Database.load("sqlite:tipia.db");

    const deliveryRows = await db.select<Array<{
        id: string;
        supplier: string;
        invoiceNo: string;
        date: string;
        receivedBy: string;
        status: "draft" | "approved";
    }>>(`
        SELECT 
            id, supplier, invoice_no AS invoiceNo, date, received_by AS receivedBy, status
        FROM deliveries
        ORDER BY date DESC
    `);

    const itemRows = await db.select<Array<{
        id: string;
        deliveryId: string;
        productId: string;
        variantId: string;
        packagingUnitId: string;
        quantity: number;
        batchNumber: string | null;
        expiryDate: string | null;
        costPrice: number;
        sellingPrice: number;
    }>>(`
        SELECT 
            id, 
            delivery_id AS deliveryId, 
            product_id AS productId, 
            variant_id AS variantId, 
            packaging_unit_id AS packagingUnitId, 
            quantity, 
            batch_number AS batchNumber, 
            expiry_date AS expiryDate, 
            cost_price AS costPrice, 
            selling_price AS sellingPrice
        FROM delivery_items
    `);

    return deliveryRows.map((dRow) => ({
        ...dRow,
        items: itemRows
            .filter((item) => item.deliveryId === dRow.id)
            .map((item) => ({
                ...item,
                batchNumber: item.batchNumber ?? undefined,
                expiryDate: item.expiryDate ?? undefined,
            })),
    }));
};

export const getDeliveryById = async (id: string): Promise<Delivery | null> => {
    const db = await Database.load("sqlite:tipia.db");

    const deliveryRows = await db.select<Array<{
        id: string;
        supplier: string;
        invoiceNo: string;
        date: string;
        receivedBy: string;
        status: "draft" | "approved";
    }>>(`
        SELECT 
            id, supplier, invoice_no AS invoiceNo, date, received_by AS receivedBy, status
        FROM deliveries 
        WHERE id = ?
    `, [id]);

    if (deliveryRows.length === 0) return null;

    const dRow = deliveryRows[0];

    const itemRows = await db.select<Array<{
        id: string;
        deliveryId: string;
        productId: string;
        variantId: string;
        packagingUnitId: string;
        quantity: number;
        batchNumber: string | null;
        expiryDate: string | null;
        costPrice: number;
        sellingPrice: number;
    }>>(`
        SELECT 
            id, 
            delivery_id AS deliveryId, 
            product_id AS productId, 
            variant_id AS variantId, 
            packaging_unit_id AS packagingUnitId, 
            quantity, 
            batch_number AS batchNumber, 
            expiry_date AS expiryDate, 
            cost_price AS costPrice, 
            selling_price AS sellingPrice
        FROM delivery_items
        WHERE delivery_id = ?
    `, [id]);

    return {
        ...dRow,
        items: itemRows.map((item) => ({
            ...item,
            batchNumber: item.batchNumber ?? undefined,
            expiryDate: item.expiryDate ?? undefined,
        })),
    };
};

export const updateProductStock = async (
    productId: string,
    stockEntries: InventoryStockEntryInput[] = []
) => {
    const db = await Database.load("sqlite:tipia.db");

    try {
        await db.execute(`PRAGMA foreign_keys = ON;`);
        await db.execute(`BEGIN`);

        for (const stock of stockEntries) {
            if (!stock.packagingUnitId) {
                continue;
            }

            const variantRows = await db.select<Array<{ variantId: string }>>(
                `
                SELECT variant_id AS variantId
                FROM packaging_units
                WHERE id = ?
                LIMIT 1
                `,
                [stock.packagingUnitId]
            );

            if (variantRows.length === 0) {
                continue;
            }

            const variantId = variantRows[0].variantId;
            const normalizedQuantity = Number(stock.quantity);
            if (!Number.isFinite(normalizedQuantity) || normalizedQuantity < 0) {
                throw new Error(`Stock quantity for ${stock.packagingUnitId} cannot be negative`);
            }

            const identityKey = {
                productId,
                variantId,
                packagingUnitId: stock.packagingUnitId,
                batchNumber: stock.batchNumber ?? null,
                expiryDate: stock.expiryDate ?? null,
            };

            const rowsById = stock.id
                ? await db.select<Array<{ id: string }>>(
                    `SELECT id FROM inventory_stock WHERE id = ? LIMIT 1`,
                    [stock.id]
                )
                : [];
            const existingRows = rowsById.length > 0
                ? rowsById
                : await db.select<Array<{ id: string }>>(
                    `
                    SELECT id
                    FROM inventory_stock
                    WHERE product_id = ?
                      AND variant_id = ?
                      AND packaging_unit_id = ?
                      AND COALESCE(batch_number, '') = COALESCE(?, '')
                      AND COALESCE(expiry_date, '') = COALESCE(?, '')
                    `,
                    [
                        identityKey.productId,
                        identityKey.variantId,
                        identityKey.packagingUnitId,
                        identityKey.batchNumber,
                        identityKey.expiryDate,
                    ]
                );

            if (existingRows.length === 0) {
                if (normalizedQuantity === 0) {
                    continue;
                }

                await db.execute(
                    `
                    INSERT INTO inventory_stock(
                        id,
                        product_id,
                        variant_id,
                        packaging_unit_id,
                        quantity,
                        batch_number,
                        expiry_date,
                        cost_price,
                        selling_price
                    )
                    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `,
                    [
                        stock.id ?? crypto.randomUUID(),
                        productId,
                        variantId,
                        stock.packagingUnitId,
                        normalizedQuantity,
                        stock.batchNumber ?? null,
                        stock.expiryDate ?? null,
                        stock.costPrice,
                        stock.sellingPrice,
                    ]
                );

                continue;
            }

            if (normalizedQuantity === 0) {
                await db.execute(`DELETE FROM inventory_stock WHERE id = ?`, [existingRows[0].id]);
                continue;
            }

            await db.execute(
                `
                UPDATE inventory_stock
                SET
                    variant_id = ?,
                    packaging_unit_id = ?,
                    quantity = ?,
                    batch_number = ?,
                    expiry_date = ?,
                    cost_price = ?,
                    selling_price = ?
                WHERE id = ?
                `,
                [
                    variantId,
                    stock.packagingUnitId,
                    normalizedQuantity,
                    stock.batchNumber ?? null,
                    stock.expiryDate ?? null,
                    stock.costPrice,
                    stock.sellingPrice,
                    existingRows[0].id,
                ]
            );
        }

        await db.execute(`COMMIT`);

        return { success: true };
    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    }
};

export const addStock = async (
    db: SqliteDatabase,
    item: DeliveryItems
) => {
    if (!Number.isFinite(item.quantity) || item.quantity < 0 || !Number.isInteger(item.quantity)) {
        throw new Error("Stock quantity must be a non-negative whole number");
    }

    const existingRows = await db.select<Array<{
        id: string;
        quantity: number;
    }>>(
        `
        SELECT id, quantity
        FROM inventory_stock
        WHERE product_id = ?
          AND variant_id = ?
          AND packaging_unit_id = ?
          AND COALESCE(batch_number, '') = COALESCE(?, '')
          AND COALESCE(expiry_date, '') = COALESCE(?, '')
        `,
        [
            item.productId,
            item.variantId,
            item.packagingUnitId,
            item.batchNumber ?? null,
            item.expiryDate ?? null,
        ]
    );

    if (existingRows.length > 0) {
        const nextQuantity = existingRows[0].quantity + item.quantity;
        if (nextQuantity < 0) {
            throw new Error("Cannot add negative stock to an inventory batch");
        }

        await db.execute(
            `
            UPDATE inventory_stock
            SET quantity = quantity + ?
            WHERE id = ?
            `,
            [
                item.quantity,
                existingRows[0].id,
            ]
        );

        return;
    }

    if (item.quantity === 0) {
        return;
    }

    await db.execute(
        `
        INSERT INTO inventory_stock(
            id,
            product_id,
            variant_id,
            packaging_unit_id,
            quantity,
            batch_number,
            expiry_date,
            cost_price,
            selling_price
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
            crypto.randomUUID(),
            item.productId,
            item.variantId,
            item.packagingUnitId,
            item.quantity,
            item.batchNumber ?? null,
            item.expiryDate ?? null,
            item.costPrice,
            item.sellingPrice,
        ]
    );
};

export const saveDeliveryDraft = async (delivery: Delivery) => {
    const db = await Database.load("sqlite:tipia.db");

    try {
        await db.execute(`PRAGMA foreign_keys = ON;`);
        await db.execute(`BEGIN`);

        const existingDelivery = await db.select<Array<{ id: string }>>(
            `SELECT id FROM deliveries WHERE id = ?`,
            [delivery.id]
        );

        if (existingDelivery.length > 0) {
            await db.execute(`
                UPDATE deliveries
                SET supplier = ?, invoice_no = ?, date = ?, received_by = ?, status = 'draft'
                WHERE id = ?
            `, [
                delivery.supplier,
                delivery.invoiceNo,
                delivery.date,
                delivery.receivedBy,
                delivery.id,
            ]);
        } else {
            await db.execute(`
                INSERT INTO deliveries(
                    id,
                    supplier,
                    invoice_no,
                    date,
                    received_by,
                    status
                )
                VALUES(?, ?, ?, ?, ?, 'draft')
            `, [
                delivery.id,
                delivery.supplier,
                delivery.invoiceNo,
                delivery.date,
                delivery.receivedBy,
            ]);
        }

        await db.execute(`DELETE FROM delivery_items WHERE delivery_id = ?`, [delivery.id]);

        for (const item of delivery.items) {
            await db.execute(`
                INSERT INTO delivery_items(
                    id,
                    delivery_id,
                    product_id,
                    variant_id,
                    packaging_unit_id,
                    quantity,
                    batch_number,
                    expiry_date,
                    cost_price,
                    selling_price
                )
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                item.id,
                item.deliveryId,
                item.productId,
                item.variantId,
                item.packagingUnitId,
                item.quantity,
                item.batchNumber ?? null,
                item.expiryDate ?? null,
                item.costPrice,
                item.sellingPrice,
            ]);
        }

        await db.execute(`COMMIT`);
        return { success: true, deliveryId: delivery.id };
    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    }
};

export const receiveDelivery = async (delivery: Delivery) => {
    const db = await Database.load("sqlite:tipia.db");

    try {
        await db.execute(`PRAGMA foreign_keys = ON;`);
        await db.execute(`BEGIN`);

        if (delivery.status === "draft") {
            await db.execute(`ROLLBACK`);
            throw new Error("Draft delivery must be saved using saveDeliveryDraft without creating stock.");
        }

        const existingDelivery = await db.select<Array<{ id: string }>>(
            `SELECT id FROM deliveries WHERE id = ?`,
            [delivery.id]
        );

        if (existingDelivery.length > 0) {
            await db.execute(`
                UPDATE deliveries 
                SET supplier = ?, invoice_no = ?, date = ?, received_by = ?, status = 'approved'
                WHERE id = ?
            `, [
                delivery.supplier,
                delivery.invoiceNo,
                delivery.date,
                delivery.receivedBy,
                delivery.id,
            ]);
            await db.execute(`DELETE FROM delivery_items WHERE delivery_id = ?`, [delivery.id]);
        } else {
            await db.execute(`
                INSERT INTO deliveries(
                    id,
                    supplier,
                    invoice_no,
                    date,
                    received_by,
                    status
                )
                VALUES(?, ?, ?, ?, ?, 'approved')
            `, [
                delivery.id,
                delivery.supplier,
                delivery.invoiceNo,
                delivery.date,
                delivery.receivedBy,
            ]);
        }

        for (const item of delivery.items) {
            await db.execute(`
                INSERT INTO delivery_items(
                    id,
                    delivery_id,
                    product_id,
                    variant_id,
                    packaging_unit_id,
                    quantity,
                    batch_number,
                    expiry_date,
                    cost_price,
                    selling_price
                )
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                item.id,
                item.deliveryId,
                item.productId,
                item.variantId,
                item.packagingUnitId,
                item.quantity,
                item.batchNumber ?? null,
                item.expiryDate ?? null,
                item.costPrice,
                item.sellingPrice,
            ]);

            await addStock(db, item);
        }

        await db.execute(`COMMIT`);

        return {
            success: true,
            deliveryId: delivery.id,
        };
    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    }
};

export const getSmallestPackagingUnit = (variant: Variant): PackagingUnit | null => {
    return variant.packagingUnits[variant.packagingUnits.length - 1] ?? null;
};

export const getConversionFactor = (
    fromUnitId: string,
    toUnitId: string,
    packagingUnits: PackagingUnit[]
): number => {
    if (fromUnitId === toUnitId) return 1;

    const unitsById = new Map(packagingUnits.map((unit) => [unit.id, unit]));
    const queue: Array<{ unitId: string; factor: number }> = [{ unitId: fromUnitId, factor: 1 }];
    const visited = new Set<string>([fromUnitId]);

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) break;

        const currentUnit = unitsById.get(current.unitId);
        if (!currentUnit) {
            continue;
        }

        if (currentUnit.contains) {
            const nextUnitId = currentUnit.contains.unitId;
            const nextUnit = unitsById.get(nextUnitId);
            if (nextUnit) {
                const nextFactor = current.factor * currentUnit.contains.quantity;
                if (nextUnitId === toUnitId) return nextFactor;
                if (!visited.has(nextUnit.id)) {
                    visited.add(nextUnit.id);
                    queue.push({ unitId: nextUnit.id, factor: nextFactor });
                }
            }
        }

        const parents = packagingUnits.filter((unit) => unit.contains?.unitId === current.unitId);
        for (const parent of parents) {
            const parentFactor = current.factor / (parent.contains?.quantity ?? 1);
            if (parent.id === toUnitId) return parentFactor;
            if (!visited.has(parent.id)) {
                visited.add(parent.id);
                queue.push({ unitId: parent.id, factor: parentFactor });
            }
        }
    }

    throw new Error(`Cannot convert packaging unit ${fromUnitId} to ${toUnitId}`);
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

const getPackagingUnitsForVariant = async (
    db: SqliteDatabase,
    variantId: string
): Promise<PackagingUnit[]> => {
    const rows = await db.select<Array<PackagingUnitRow>>(`
        SELECT
            id,
            variant_id AS variantId,
            name,
            level,
            contains_quantity AS containsQuantity,
            contains_unit_id AS containsUnitId,
            cost_price AS costPrice,
            selling_price AS sellingPrice,
            is_default AS isDefault
        FROM packaging_units
        WHERE variant_id = ?
        ORDER BY level ASC
    `, [variantId]);

    return rows.map(mapRowToPackagingUnit);
};

export const getAvailableQuantityInUnit = async (
    productId: string,
    variantId: string,
    packagingUnitId: string
): Promise<number> => {
    const db = await Database.load("sqlite:tipia.db");
    const packagingUnits = await getPackagingUnitsForVariant(db, variantId);
    if (packagingUnits.length === 0) {
        return 0;
    }

    const selectedUnit = packagingUnits.find((unit) => unit.id === packagingUnitId);
    if (!selectedUnit) {
        throw new Error(`Packaging unit ${packagingUnitId} does not belong to variant ${variantId}`);
    }

    const stockRows = await db.select<Array<{
        packagingUnitId: string;
        quantity: number;
    }>>(`
        SELECT packaging_unit_id AS packagingUnitId, quantity
        FROM inventory_stock
        WHERE product_id = ? AND variant_id = ?
    `, [productId, variantId]);

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
    expired: DashboardStockLine[];
    lowStock: DashboardQuantity[];
    outOfStock: DashboardQuantity[];
};

const formatVariantLabel = (variant: Variant) =>
    [variant.strength, variant.strengthUnit, variant.form]
        .filter((value) => value?.trim())
        .join(" ");

export const getDashboardSummary = async (): Promise<DashboardSummary> => {
    const db = await Database.load("sqlite:tipia.db");
    const productsFromDb = await getProducts();
    const activeProducts = productsFromDb.filter((product) => product.status !== "archived");
    const stockRows = await db.select<Array<{
        id: string;
        productId: string;
        variantId: string;
        packagingUnitId: string;
        quantity: number;
        batchNumber: string | null;
        expiryDate: string | null;
    }>>(`
        SELECT
            id,
            product_id AS productId,
            variant_id AS variantId,
            packaging_unit_id AS packagingUnitId,
            quantity,
            batch_number AS batchNumber,
            expiry_date AS expiryDate
        FROM inventory_stock
        WHERE quantity > 0
        ORDER BY expiry_date ASC, id ASC
    `);

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
    const expired: DashboardStockLine[] = [];
    for (const line of stockLines) {
        const days = getDaysUntilExpiry(line.expiryDate as string);
        if (days <= 0) expired.push(line);
        else if (days <= 90) nearExpiry.push(line);
    }

    return {
        nearExpiry,
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

export const getSaleStockAllocationPreview = async (
    productId: string,
    variantId: string,
    packagingUnitId: string,
    quantity: number
): Promise<SaleStockAllocation[]> => {
    const db = await Database.load("sqlite:tipia.db");
    const [packagingUnits, stockRows] = await Promise.all([
        getPackagingUnitsForVariant(db, variantId),
        db.select<StockRowForSale[]>(`
            SELECT
                id,
                product_id AS productId,
                variant_id AS variantId,
                packaging_unit_id AS packagingUnitId,
                quantity,
                batch_number AS batchNumber,
                expiry_date AS expiryDate,
                cost_price AS costPrice,
                selling_price AS sellingPrice
            FROM inventory_stock
            WHERE product_id = ? AND variant_id = ? AND quantity > 0
        `, [productId, variantId]),
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
    const db = await Database.load("sqlite:tipia.db");

    try {
        await db.execute(`PRAGMA foreign_keys = ON;`);
        await db.execute(`BEGIN`);
        await db.execute(`DELETE FROM sale_items WHERE sale_id = ?`, [saleId]);
        await db.execute(`DELETE FROM sales WHERE id = ? AND status = 'draft'`, [saleId]);
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

    const stockRows = await db.select<StockRowForSale[]>(`
        SELECT
            id,
            product_id AS productId,
            variant_id AS variantId,
            packaging_unit_id AS packagingUnitId,
            quantity,
            batch_number AS batchNumber,
            expiry_date AS expiryDate,
            cost_price AS costPrice,
            selling_price AS sellingPrice
        FROM inventory_stock
        WHERE product_id = ? AND variant_id = ? AND quantity > 0
    `, [item.productId, item.variantId]);
    const { allocations } = getSaleStockAllocation(item, stockRows, packagingUnits);

    for (const allocation of allocations) {
        const { row, sourceQuantity } = allocation;
        const sourceAfterSale = row.quantity - sourceQuantity;
        if (sourceAfterSale < 0) {
            throw new Error(`Negative stock detected for batch ${row.batchNumber ?? "unknown"}`);
        }

        if (sourceAfterSale === 0) {
            await db.execute(`DELETE FROM inventory_stock WHERE id = ?`, [row.id]);
        } else {
            await db.execute(
                `UPDATE inventory_stock SET quantity = ? WHERE id = ?`,
                [sourceAfterSale, row.id]
            );
        }
    }

    return allocations.map(({ row, quantity }) => ({
        batchNumber: row.batchNumber,
        expiryDate: row.expiryDate,
        quantity,
    }));
};

export const saveSaleDraft = async (sale: Sale) => {
    const db = await Database.load("sqlite:tipia.db");

    try {
        await db.execute(`PRAGMA foreign_keys = ON;`);
        await db.execute(`BEGIN`);

        if (!sale.items || sale.items.length === 0) {
            throw new Error("Sale draft must contain at least one item");
        }

        const existingSale = await db.select<Array<{ id: string; status: string }>>(
            `SELECT id, status FROM sales WHERE id = ?`,
            [sale.id]
        );

        if (existingSale.length > 0 && existingSale[0].status !== "draft") {
            throw new Error("Completed sales cannot be saved as drafts");
        }

        if (existingSale.length > 0) {
            await db.execute(`
                UPDATE sales
                SET date = ?, sold_by = ?, total_amount = ?, discount = ?, notes = ?, status = 'draft'
                WHERE id = ?
            `, [
                sale.date,
                sale.soldBy ?? null,
                sale.totalAmount,
                sale.discount ?? 0,
                sale.notes ?? null,
                sale.id,
            ]);
        } else {
            await db.execute(`
                INSERT INTO sales(id, date, sold_by, total_amount, discount, notes, status)
                VALUES(?, ?, ?, ?, ?, ?, 'draft')
            `, [
                sale.id,
                sale.date,
                sale.soldBy ?? null,
                sale.totalAmount,
                sale.discount ?? 0,
                sale.notes ?? null,
            ]);
        }

        await db.execute(`DELETE FROM sale_items WHERE sale_id = ?`, [sale.id]);

        for (const item of sale.items) {
            if (!Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isInteger(item.quantity)) {
                throw new Error("Draft sale quantity must be a positive whole number");
            }

            await db.execute(`
                INSERT INTO sale_items(
                    id, sale_id, product_id, variant_id, packaging_unit_id,
                    quantity, unit_price, batch_number, expiry_date
                )
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                item.id,
                sale.id,
                item.productId,
                item.variantId,
                item.packagingUnitId,
                item.quantity,
                item.unitPrice,
                item.batchNumber ?? null,
                item.expiryDate ?? null,
            ]);
        }

        await db.execute(`COMMIT`);
        return { success: true, saleId: sale.id };
    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    }
};

export const createSale = async (sale: Sale) => {
    const db = await Database.load("sqlite:tipia.db");

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

            const productRow = await db.select<Array<{ id: string }>>(
                `SELECT id FROM products WHERE id = ? AND status != 'archived'`,
                [item.productId]
            );
            if (productRow.length === 0) {
                throw new Error(`Product ${item.productId} does not exist or is archived`);
            }

            const variantRow = await db.select<Array<{ id: string }>>(
                `SELECT id FROM variants WHERE id = ? AND product_id = ?`,
                [item.variantId, item.productId]
            );
            if (variantRow.length === 0) {
                throw new Error(`Variant ${item.variantId} does not belong to product ${item.productId}`);
            }

            const packagingUnitRow = await db.select<Array<{ id: string }>>(
                `SELECT id FROM packaging_units WHERE id = ? AND variant_id = ?`,
                [item.packagingUnitId, item.variantId]
            );
            if (packagingUnitRow.length === 0) {
                throw new Error(`Packaging unit ${item.packagingUnitId} does not belong to variant ${item.variantId}`);
            }

            const packagingUnits = await getPackagingUnitsForVariant(db, item.variantId);
            const stockRows = await db.select<StockRowForSale[]>(`
                SELECT
                    id,
                    product_id AS productId,
                    variant_id AS variantId,
                    packaging_unit_id AS packagingUnitId,
                    quantity,
                    batch_number AS batchNumber,
                    expiry_date AS expiryDate,
                    cost_price AS costPrice,
                    selling_price AS sellingPrice
                FROM inventory_stock
                WHERE product_id = ? AND variant_id = ? AND quantity > 0
            `, [item.productId, item.variantId]);
            getSaleStockAllocation(item, stockRows, packagingUnits);
        }

        const existingSale = await db.select<Array<{ id: string }>>(`SELECT id FROM sales WHERE id = ?`, [sale.id]);
        if (existingSale.length > 0) {
            await db.execute(`
                UPDATE sales
                SET date = ?, sold_by = ?, total_amount = ?, discount = ?, notes = ?, status = 'completed'
                WHERE id = ?
            `, [
                sale.date,
                sale.soldBy ?? null,
                sale.totalAmount,
                sale.discount ?? 0,
                sale.notes ?? null,
                sale.id,
            ]);
        } else {
            await db.execute(`
                INSERT INTO sales(id, date, sold_by, total_amount, discount, notes, status)
                VALUES(?, ?, ?, ?, ?, ?, 'completed')
            `, [
                sale.id,
                sale.date,
                sale.soldBy ?? null,
                sale.totalAmount,
                sale.discount ?? 0,
                sale.notes ?? null,
            ]);
        }

        await db.execute(`DELETE FROM sale_items WHERE sale_id = ?`, [sale.id]);

        for (const item of sale.items) {
            const packagingUnits = await getPackagingUnitsForVariant(db, item.variantId);
            const stockRows = await db.select<StockRowForSale[]>(`
                SELECT
                    id,
                    product_id AS productId,
                    variant_id AS variantId,
                    packaging_unit_id AS packagingUnitId,
                    quantity,
                    batch_number AS batchNumber,
                    expiry_date AS expiryDate,
                    cost_price AS costPrice,
                    selling_price AS sellingPrice
                FROM inventory_stock
                WHERE product_id = ? AND variant_id = ? AND quantity > 0
            `, [item.productId, item.variantId]);
            const { allocations } = getSaleStockAllocation(item, stockRows, packagingUnits);

            for (const allocation of allocations) {
                const { row, quantity, sourceQuantity } = allocation;
                const sourceAfterSale = row.quantity - sourceQuantity;
                if (sourceAfterSale < 0) {
                    throw new Error(`Negative stock detected for batch ${row.batchNumber ?? "unknown"}`);
                }

                if (sourceAfterSale === 0) {
                    await db.execute(`DELETE FROM inventory_stock WHERE id = ?`, [row.id]);
                } else {
                    await db.execute(
                        `UPDATE inventory_stock SET quantity = ? WHERE id = ?`,
                        [sourceAfterSale, row.id]
                    );
                }

                await db.execute(`
                INSERT INTO sale_items(
                    id, sale_id, product_id, variant_id, packaging_unit_id,
                    quantity, unit_price, batch_number, expiry_date
                )
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                    crypto.randomUUID(),
                    sale.id,
                    item.productId,
                    item.variantId,
                    item.packagingUnitId,
                    quantity,
                    item.unitPrice,
                    row.batchNumber,
                    row.expiryDate,
                ]);
            }
        }

        await db.execute(`COMMIT`);
        return { success: true, saleId: sale.id };
    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    }
};

type SaleRow = {
    id: string;
    date: string;
    soldBy: string | null;
    totalAmount: number;
    discount: number | null;
    notes: string | null;
    status?: "draft" | "completed";
};

type SaleItemRow = Omit<SaleItem, "batchNumber" | "expiryDate"> & {
    batchNumber: string | null;
    expiryDate: string | null;
};

const mapSaleItems = (items: SaleItemRow[]): SaleItem[] => items.map((item) => ({
    ...item,
    batchNumber: item.batchNumber ?? undefined,
    expiryDate: item.expiryDate ?? undefined,
}));

export const getSales = async (): Promise<Sale[]> => {
    const db = await Database.load("sqlite:tipia.db");
    const saleRows = await db.select<SaleRow[]>(`
        SELECT
            id,
            date,
            sold_by AS soldBy,
            total_amount AS totalAmount,
            discount,
            notes,
            status
        FROM sales
        ORDER BY date DESC
    `);
    const itemRows = await db.select<SaleItemRow[]>(`
        SELECT
            id,
            sale_id AS saleId,
            product_id AS productId,
            variant_id AS variantId,
            packaging_unit_id AS packagingUnitId,
            quantity,
            unit_price AS unitPrice,
            batch_number AS batchNumber,
            expiry_date AS expiryDate
        FROM sale_items
    `);

    return saleRows.map((saleRow) => ({
        ...saleRow,
        soldBy: saleRow.soldBy ?? undefined,
        discount: saleRow.discount ?? 0,
        notes: saleRow.notes ?? undefined,
        status: (saleRow as SaleRow & { status?: "draft" | "completed" }).status ?? "completed",
        items: mapSaleItems(itemRows.filter((item) => item.saleId === saleRow.id)),
    }));
};

export const getSaleById = async (id: string): Promise<Sale | null> => {
    const db = await Database.load("sqlite:tipia.db");
    const saleRows = await db.select<SaleRow[]>(`
        SELECT
            id,
            date,
            sold_by AS soldBy,
            total_amount AS totalAmount,
            discount,
            notes
        FROM sales
        WHERE id = ?
    `, [id]);

    if (saleRows.length === 0) return null;

    const itemRows = await db.select<SaleItemRow[]>(`
        SELECT
            id,
            sale_id AS saleId,
            product_id AS productId,
            variant_id AS variantId,
            packaging_unit_id AS packagingUnitId,
            quantity,
            unit_price AS unitPrice,
            batch_number AS batchNumber,
            expiry_date AS expiryDate
        FROM sale_items
        WHERE sale_id = ?
    `, [id]);

    const saleRow = saleRows[0];
    return {
        ...saleRow,
        soldBy: saleRow.soldBy ?? undefined,
        discount: saleRow.discount ?? 0,
        notes: saleRow.notes ?? undefined,
        items: mapSaleItems(itemRows),
    };
};

