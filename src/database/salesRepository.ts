import { loadDatabase, type SqliteDatabase } from "./connection";
import type { Sale, SaleItem } from "../types/Product";

export type SaleRow = {
    id: string;
    date: string;
    soldBy: string | null;
    totalAmount: number;
    discount: number | null;
    notes: string | null;
    status?: "draft" | "completed";
};

export type SaleItemRow = Omit<SaleItem, "batchNumber" | "expiryDate"> & {
    batchNumber: string | null;
    expiryDate: string | null;
};

export const mapSaleItems = (items: SaleItemRow[]): SaleItem[] => items.map((item) => ({
    ...item,
    batchNumber: item.batchNumber ?? undefined,
    expiryDate: item.expiryDate ?? undefined,
}));

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

    return saleRows.map((saleRow) => ({
        ...saleRow,
        soldBy: saleRow.soldBy ?? undefined,
        discount: saleRow.discount ?? 0,
        notes: saleRow.notes ?? undefined,
        status: (saleRow as SaleRow & { status?: "draft" | "completed" }).status ?? "completed",
        items: mapSaleItems(itemRows.filter((item) => item.saleId === saleRow.id)),
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

    const saleRow = saleRows[0];
    return {
        ...saleRow,
        soldBy: saleRow.soldBy ?? undefined,
        discount: saleRow.discount ?? 0,
        notes: saleRow.notes ?? undefined,
        items: mapSaleItems(itemRows),
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
        batchNumberOverride ?? item.batchNumber ?? null,
        expiryDateOverride ?? item.expiryDate ?? null,
    ]);
};

export const insertSaleItemRowWithAllocation = async (
    db: SqliteDatabase,
    saleId: string,
    item: SaleItem,
    quantity: number,
    batchNumber: string | null,
    expiryDate: string | null
) => {
    await db.execute(`
        INSERT INTO sale_items(
            id, sale_id, product_id, variant_id, packaging_unit_id,
            quantity, unit_price, batch_number, expiry_date
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        crypto.randomUUID(),
        saleId,
        item.productId,
        item.variantId,
        item.packagingUnitId,
        quantity,
        item.unitPrice,
        batchNumber,
        expiryDate,
    ]);
};

