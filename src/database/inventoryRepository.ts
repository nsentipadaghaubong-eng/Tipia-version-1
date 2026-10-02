import { loadDatabase, type SqliteDatabase } from "./connection";

export type InventoryStockRow = {
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

export type InventoryStockRowInput = {
    id?: string;
    variantId?: string;
    packagingUnitId: string;
    quantity: number;
    batchNumber?: string;
    expiryDate?: string;
    costPrice: number;
    sellingPrice: number;
};

export type InventoryStockBatchCandidate = {
    id: string;
    quantity: number;
    batchNumber: string | null;
    expiryDate: string | null;
    sellingPrice: number;
};

export type InventoryStockQuantityRow = {
    packagingUnitId: string;
    quantity: number;
};

export type InventoryStockDashboardRow = Pick<
    InventoryStockRow,
    "id" | "productId" | "variantId" | "packagingUnitId" | "quantity" | "batchNumber" | "expiryDate"
>;

export const mapInventoryStockRow = (row: InventoryStockRow) => ({
    id: row.id,
    productId: row.productId,
    variantId: row.variantId,
    packagingUnitId: row.packagingUnitId,
    quantity: row.quantity,
    batchNumber: row.batchNumber ?? undefined,
    expiryDate: row.expiryDate ?? undefined,
    costPrice: row.costPrice,
    sellingPrice: row.sellingPrice,
});

export type InventoryStockReadScope = {
    productId?: string;
    variantId?: string;
};

export const selectRawInventoryStockRows = (
    db: SqliteDatabase,
    scope: InventoryStockReadScope = {}
): Promise<InventoryStockRow[]> => {
    const conditions: string[] = [];
    const bindings: string[] = [];

    if (scope.productId !== undefined) {
        conditions.push("product_id = ?");
        bindings.push(scope.productId);
    }
    if (scope.variantId !== undefined) {
        conditions.push("variant_id = ?");
        bindings.push(scope.variantId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const orderBy = scope.productId !== undefined
        ? "variant_id, packaging_unit_id, expiry_date ASC, id ASC"
        : "product_id, variant_id, packaging_unit_id, expiry_date ASC, id ASC";

    return db.select<InventoryStockRow[]>(`
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
        ${whereClause}
        ORDER BY ${orderBy}
    `, bindings);
};

export const getInventoryStockByProduct = async (productId: string): Promise<InventoryStockRow[]> => {
    const db = await loadDatabase();
    return selectRawInventoryStockRows(db, { productId });
};

export const getInventoryStockForAllProducts = async (): Promise<InventoryStockRow[]> => {
    const db = await loadDatabase();
    return selectRawInventoryStockRows(db);
};

export const getInventoryStockRowsForVariant = async (
    productId: string,
    variantId: string,
    preferredBatchNumber?: string,
    preferredExpiryDate?: string
): Promise<InventoryStockRow[]> => {
    const db = await loadDatabase();
    const rows = await selectRawInventoryStockRows(db, { productId, variantId });

    return rows
        .filter((row) => row.quantity > 0)
        .filter((row) => {
            if (preferredBatchNumber && (row.batchNumber ?? "") !== preferredBatchNumber) {
                return false;
            }
            if (preferredExpiryDate && (row.expiryDate ?? "") !== preferredExpiryDate) {
                return false;
            }
            return true;
        });
};

export const getInventoryStockRowsByVariant = async (
    productId: string,
    variantId: string
): Promise<InventoryStockRow[]> => {
    const db = await loadDatabase();

    return selectInventoryStockRowsByVariant(db, productId, variantId);
};

export const selectInventoryStockRowsByVariant = async (
    db: SqliteDatabase,
    productId: string,
    variantId: string
): Promise<InventoryStockRow[]> => {
    const rows = await selectRawInventoryStockRows(db, { productId, variantId });
    return rows.filter((row) => row.quantity > 0);
};

export const getInventoryStockReferencesByVariant = (
    db: SqliteDatabase,
    variantId: string
) => db.select<Array<{ id: string }>>(`
    SELECT id
    FROM inventory_stock
    WHERE variant_id = ?
    LIMIT 1
`, [variantId]);

export const getInventoryStockReferencesByPackagingUnit = (
    db: SqliteDatabase,
    packagingUnitId: string
) => db.select<Array<{ id: string }>>(`
    SELECT id
    FROM inventory_stock
    WHERE packaging_unit_id = ?
    LIMIT 1
`, [packagingUnitId]);

export const getInventoryStockBatchCandidates = (
    db: SqliteDatabase,
    productId: string,
    variantId: string,
        packagingUnitId: string,
        batchNumber: string | null,
        expiryDate: string | null,
        costPrice: number
) => db.select<InventoryStockBatchCandidate[]>(`
    SELECT id, quantity, batch_number AS batchNumber, expiry_date AS expiryDate, selling_price AS sellingPrice
    FROM inventory_stock
    WHERE product_id = ?
      AND variant_id = ?
      AND packaging_unit_id = ?
    AND COALESCE(batch_number, '') = COALESCE(?, '')
    AND COALESCE(expiry_date, '') = COALESCE(?, '')
    AND cost_price = ?
`, [productId, variantId, packagingUnitId, batchNumber, expiryDate, costPrice]);

export const getInventoryStockQuantitiesByVariant = async (
    db: SqliteDatabase,
    productId: string,
    variantId: string
): Promise<InventoryStockQuantityRow[]> => {
    const rows = await selectRawInventoryStockRows(db, { productId, variantId });
    return rows.map(({ packagingUnitId, quantity }) => ({ packagingUnitId, quantity }));
};

export const getPositiveInventoryStockRowsForDashboard = (
    db: SqliteDatabase
) => db.select<InventoryStockDashboardRow[]>(`
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

export const insertInventoryStock = async (
    db: SqliteDatabase,
    item: InventoryStockRow & { productId: string; variantId: string; packagingUnitId: string }
) => {
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
            item.id,
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

export const updateStockQuantityById = async (
    db: SqliteDatabase,
    rowId: string,
    nextQuantity: number
) => {
    await db.execute(
        `UPDATE inventory_stock SET quantity = ? WHERE id = ?`,
        [nextQuantity, rowId]
    );
};

export const incrementInventoryStockQuantityById = async (
    db: SqliteDatabase,
    rowId: string,
    quantity: number
) => {
    await db.execute(
        `UPDATE inventory_stock SET quantity = quantity + ? WHERE id = ?`,
        [quantity, rowId]
    );
};

export const deleteInventoryStockById = async (
    db: SqliteDatabase,
    rowId: string,
    expectedIdentity?: { productId: string; variantId: string; packagingUnitId: string }
) => {
    if (expectedIdentity) {
        return db.execute(`
            DELETE FROM inventory_stock
            WHERE id = ? AND product_id = ? AND variant_id = ? AND packaging_unit_id = ?
        `, [rowId, expectedIdentity.productId, expectedIdentity.variantId, expectedIdentity.packagingUnitId]);
    }
    return db.execute(`DELETE FROM inventory_stock WHERE id = ?`, [rowId]);
};

export const upsertInventoryStock = async (
    db: SqliteDatabase,
    productId: string,
    _variantId: string,
    stock: InventoryStockRowInput,
    options: { mode?: "upsert" | "existing" } = {}
) => {
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
        if (options.mode === "existing") {
            throw new Error(`Packaging unit ${stock.packagingUnitId} does not exist`);
        }
        return;
    }

    const actualVariantId = variantRows[0].variantId;
    const normalizedQuantity = Number(stock.quantity);
    if (options.mode === "existing") {
        if (!stock.id) {
            throw new Error("An inventory stock row ID is required for an existing-row adjustment");
        }
        if (stock.variantId !== actualVariantId) {
            throw new Error(`Packaging unit ${stock.packagingUnitId} does not belong to variant ${stock.variantId}`);
        }

        const rowsById = await db.select<Array<{ id: string }>>(`
            SELECT id
            FROM inventory_stock
            WHERE id = ? AND product_id = ? AND variant_id = ? AND packaging_unit_id = ?
            LIMIT 1
        `, [stock.id, productId, stock.variantId, stock.packagingUnitId]);
        if (rowsById.length === 0) {
            throw new Error(`Inventory stock row ${stock.id} does not exist or no longer matches the adjustment`);
        }

        if (normalizedQuantity === 0) {
            const result = await deleteInventoryStockById(db, stock.id, {
                productId,
                variantId: stock.variantId,
                packagingUnitId: stock.packagingUnitId,
            });
            if (result.rowsAffected === 0) {
                throw new Error(`Inventory stock row ${stock.id} changed before the adjustment was applied`);
            }
            return;
        }

        const result = await db.execute(`
            UPDATE inventory_stock
            SET quantity = ?, batch_number = ?, expiry_date = ?, cost_price = ?, selling_price = ?
            WHERE id = ? AND product_id = ? AND variant_id = ? AND packaging_unit_id = ?
        `, [
            normalizedQuantity,
            stock.batchNumber ?? null,
            stock.expiryDate ?? null,
            stock.costPrice,
            stock.sellingPrice,
            stock.id,
            productId,
            stock.variantId,
            stock.packagingUnitId,
        ]);
        if (result.rowsAffected === 0) {
            throw new Error(`Inventory stock row ${stock.id} changed before the adjustment was applied`);
        }
        return;
    }

    const identityKey = {
        productId,
        variantId: actualVariantId,
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
            return;
        }

        await insertInventoryStock(db, {
            id: stock.id ?? crypto.randomUUID(),
            productId,
            variantId: actualVariantId,
            packagingUnitId: stock.packagingUnitId,
            quantity: normalizedQuantity,
            batchNumber: stock.batchNumber ?? null,
            expiryDate: stock.expiryDate ?? null,
            costPrice: stock.costPrice,
            sellingPrice: stock.sellingPrice,
        });
        return;
    }

    if (normalizedQuantity === 0) {
        await deleteInventoryStockById(db, existingRows[0].id);
        return;
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
            actualVariantId,
            stock.packagingUnitId,
            normalizedQuantity,
            stock.batchNumber ?? null,
            stock.expiryDate ?? null,
            stock.costPrice,
            stock.sellingPrice,
            existingRows[0].id,
        ]
    );
};

export const reconcileInventoryStock = async (
    db: SqliteDatabase,
    _productId: string,
    _variantId: string,
    row: { id: string; quantity: number; batchNumber: string | null; expiryDate: string | null }
) => {
    const sourceAfterSale = row.quantity;
    if (sourceAfterSale === 0) {
        await deleteInventoryStockById(db, row.id);
        return;
    }

    await updateStockQuantityById(db, row.id, sourceAfterSale);
};
