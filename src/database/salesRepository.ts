import { loadDatabase, type SqliteDatabase } from "./connection";
import type { Sale, SaleItem, SaleItemAllocation } from "../types/Product";

export type SaleRow = {
    id: string;
    date: string;
    soldBy: string | null;
    totalAmount: number;
    discount: number | null;
    notes: string | null;
    status?: "draft" | "completed";
};

export type SaleItemRow = Omit<SaleItem, "batchNumber" | "expiryDate" | "allocations"> & {
    batchNumber: string | null;
    expiryDate: string | null;
};

export type SaleItemAllocationRow = SaleItemAllocation & {
    batchNumber: string | null;
    expiryDate: string | null;
};

export const mapSaleItems = (
    items: SaleItemRow[],
    allocations: SaleItemAllocationRow[] = []
): SaleItem[] => {
    const allocationsBySaleItemId = new Map<string, SaleItemAllocationRow[]>();
    for (const allocation of allocations) {
        const itemAllocations = allocationsBySaleItemId.get(allocation.saleItemId) ?? [];
        itemAllocations.push(allocation);
        allocationsBySaleItemId.set(allocation.saleItemId, itemAllocations);
    }

    return items.map((item) => {
        const itemAllocations = allocationsBySaleItemId.get(item.id);
        return {
            ...item,
            batchNumber: item.batchNumber ?? undefined,
            expiryDate: item.expiryDate ?? undefined,
            ...(itemAllocations?.length ? {
                allocations: itemAllocations.map((allocation) => ({
                    ...allocation,
                    batchNumber: allocation.batchNumber ?? undefined,
                    expiryDate: allocation.expiryDate ?? undefined,
                })),
            } : {}),
        };
    });
};

const selectSaleItemAllocationRows = (db: SqliteDatabase, saleId?: string) => db.select<SaleItemAllocationRow[]>(`
    SELECT
        allocations.id,
        allocations.sale_item_id AS saleItemId,
        allocations.source_inventory_stock_id AS sourceInventoryStockId,
        allocations.quantity,
        allocations.source_packaging_unit_id AS sourcePackagingUnitId,
        allocations.source_packaging_unit_name AS sourcePackagingUnitName,
        allocations.source_quantity AS sourceQuantity,
        allocations.batch_number AS batchNumber,
        allocations.expiry_date AS expiryDate,
        allocations.selling_price AS sellingPrice
    FROM sale_item_allocations AS allocations
    ${saleId === undefined ? "" : "WHERE allocations.sale_item_id IN (SELECT id FROM sale_items WHERE sale_id = ?)"}
    ORDER BY allocations.sale_item_id, allocations.id
`, saleId === undefined ? [] : [saleId]);

export const getSaleRows = async (): Promise<Sale[]> => {
    const db = await loadDatabase();
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
    const allocationRows = await selectSaleItemAllocationRows(db);

    return saleRows.map((saleRow) => ({
        ...saleRow,
        soldBy: saleRow.soldBy ?? undefined,
        discount: saleRow.discount ?? 0,
        notes: saleRow.notes ?? undefined,
        status: (saleRow as SaleRow & { status?: "draft" | "completed" }).status ?? "completed",
        items: mapSaleItems(
            itemRows.filter((item) => item.saleId === saleRow.id),
            allocationRows.filter((allocation) => itemRows.some((item) => item.saleId === saleRow.id && item.id === allocation.saleItemId))
        ),
    }));
};

export const getSaleRowById = async (id: string): Promise<Sale | null> => {
    const db = await loadDatabase();
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
    const allocationRows = await selectSaleItemAllocationRows(db, id);

    const saleRow = saleRows[0];
    return {
        ...saleRow,
        soldBy: saleRow.soldBy ?? undefined,
        discount: saleRow.discount ?? 0,
        notes: saleRow.notes ?? undefined,
        items: mapSaleItems(itemRows, allocationRows),
    };
};

export const selectSaleIdsById = async (
    db: SqliteDatabase,
    id: string
): Promise<Array<{ id: string }>> => db.select<Array<{ id: string }>>(
    `SELECT id FROM sales WHERE id = ?`,
    [id]
);

export const selectSaleIdsByIdAndStatus = async (
    db: SqliteDatabase,
    id: string
): Promise<Array<{ id: string; status: string }>> => db.select<Array<{ id: string; status: string }>>(
    `SELECT id, status FROM sales WHERE id = ?`,
    [id]
);

export const insertSaleRow = async (
    db: SqliteDatabase,
    sale: Sale,
    status: "draft" | "completed"
) => {
    await db.execute(`
        INSERT INTO sales(id, date, sold_by, total_amount, discount, notes, status)
        VALUES(?, ?, ?, ?, ?, ?, ?)
    `, [
        sale.id,
        sale.date,
        sale.soldBy ?? null,
        sale.totalAmount,
        sale.discount ?? 0,
        sale.notes ?? null,
        status,
    ]);
};

export const updateSaleRow = async (
    db: SqliteDatabase,
    sale: Sale,
    status: "draft" | "completed"
) => {
    await db.execute(`
        UPDATE sales
        SET date = ?, sold_by = ?, total_amount = ?, discount = ?, notes = ?, status = ?
        WHERE id = ?
    `, [
        sale.date,
        sale.soldBy ?? null,
        sale.totalAmount,
        sale.discount ?? 0,
        sale.notes ?? null,
        status,
        sale.id,
    ]);
};

export const deleteSaleItemsBySaleId = async (
    db: SqliteDatabase,
    saleId: string
) => {
    await db.execute(`DELETE FROM sale_items WHERE sale_id = ?`, [saleId]);
};

export const deleteSaleDraftById = async (
    db: SqliteDatabase,
    saleId: string
) => {
    await db.execute(`DELETE FROM sales WHERE id = ? AND status = 'draft'`, [saleId]);
};

export const insertSaleItemRow = async (
    db: SqliteDatabase,
    saleId: string,
    item: SaleItem,
    quantityOverride?: number,
    batchNumberOverride?: string | null,
    expiryDateOverride?: string | null
) => {
    await db.execute(`
        INSERT INTO sale_items(
            id, sale_id, product_id, variant_id, packaging_unit_id,
            quantity, unit_price, batch_number, expiry_date
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        item.id,
        saleId,
        item.productId,
        item.variantId,
        item.packagingUnitId,
        quantityOverride ?? item.quantity,
        item.unitPrice,
        batchNumberOverride === undefined ? item.batchNumber ?? null : batchNumberOverride,
        expiryDateOverride === undefined ? item.expiryDate ?? null : expiryDateOverride,
    ]);
};

export const insertSaleItemAllocationRow = async (
    db: SqliteDatabase,
    allocation: Omit<SaleItemAllocation, "id">
) => {
    await db.execute(`
        INSERT INTO sale_item_allocations(
            id, sale_item_id, source_inventory_stock_id, quantity,
            source_packaging_unit_id, source_packaging_unit_name, source_quantity,
            batch_number, expiry_date, selling_price
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        crypto.randomUUID(),
        allocation.saleItemId,
        allocation.sourceInventoryStockId,
        allocation.quantity,
        allocation.sourcePackagingUnitId,
        allocation.sourcePackagingUnitName,
        allocation.sourceQuantity,
        allocation.batchNumber ?? null,
        allocation.expiryDate ?? null,
        allocation.sellingPrice,
    ]);
};

