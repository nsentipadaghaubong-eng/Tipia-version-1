import { loadDatabase, type SqliteDatabase } from "./connection";
import type { Delivery, DeliveryItems } from "../types/Product";

export type DeliveryRow = {
    id: string;
    supplier: string;
    invoiceNo: string;
    date: string;
    receivedBy: string;
    status: "draft" | "approved";
};

export type DeliveryItemRow = {
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
};

export const mapDeliveryItemRow = (item: DeliveryItemRow): DeliveryItems => ({
    ...item,
    batchNumber: item.batchNumber ?? undefined,
    expiryDate: item.expiryDate ?? undefined,
});

export const getDeliveryRows = async (): Promise<Delivery[]> => {
    const db = await loadDatabase();

    const deliveryRows = await db.select<DeliveryRow[]>(`
        SELECT 
            id, supplier, invoice_no AS invoiceNo, date, received_by AS receivedBy, status
        FROM deliveries
        ORDER BY date DESC
    `);

    const itemRows = await db.select<DeliveryItemRow[]>(`
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
            .map(mapDeliveryItemRow),
    }));
};

export const getDeliveryRowById = async (id: string): Promise<Delivery | null> => {
    const db = await loadDatabase();

    const deliveryRows = await db.select<DeliveryRow[]>(`
        SELECT 
            id, supplier, invoice_no AS invoiceNo, date, received_by AS receivedBy, status
        FROM deliveries 
        WHERE id = ?
    `, [id]);

    if (deliveryRows.length === 0) return null;

    const dRow = deliveryRows[0];

    const itemRows = await db.select<DeliveryItemRow[]>(`
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
        items: itemRows.map(mapDeliveryItemRow),
    };
};

export const selectDeliveryIdsById = async (
    db: SqliteDatabase,
    id: string
): Promise<Array<{ id: string }>> => db.select<Array<{ id: string }>>(
    `SELECT id FROM deliveries WHERE id = ?`,
    [id]
);

export const getDeliveryItemReferencesByVariant = (
    db: SqliteDatabase,
    variantId: string
) => db.select<Array<{ id: string }>>(`
    SELECT id
    FROM delivery_items
    WHERE variant_id = ?
    LIMIT 1
`, [variantId]);

export const getDeliveryItemReferencesByPackagingUnit = (
    db: SqliteDatabase,
    packagingUnitId: string
) => db.select<Array<{ id: string }>>(`
    SELECT id
    FROM delivery_items
    WHERE packaging_unit_id = ?
    LIMIT 1
`, [packagingUnitId]);

export const insertDeliveryRow = async (
    db: SqliteDatabase,
    delivery: Delivery
) => {
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
        delivery.receivedBy,
    ]);
};

export const insertDeliveryRowWithStatus = async (
    db: SqliteDatabase,
    delivery: Delivery,
    status: "draft" | "approved"
) => {
    await db.execute(`
        INSERT INTO deliveries(
            id,
            supplier,
            invoice_no,
            date,
            received_by,
            status
        )
        VALUES(?, ?, ?, ?, ?, ?)
    `, [
        delivery.id,
        delivery.supplier,
        delivery.invoiceNo,
        delivery.date,
        delivery.receivedBy,
        status,
    ]);
};

export const updateDeliveryRow = async (
    db: SqliteDatabase,
    delivery: Delivery,
    status: "draft" | "approved"
) => {
    await db.execute(`
        UPDATE deliveries
        SET supplier = ?, invoice_no = ?, date = ?, received_by = ?, status = ?
        WHERE id = ?
    `, [
        delivery.supplier,
        delivery.invoiceNo,
        delivery.date,
        delivery.receivedBy,
        status,
        delivery.id,
    ]);
};

export const insertDeliveryItemRow = async (
    db: SqliteDatabase,
    item: DeliveryItems
) => {
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
        item.batchNumber ?? null,
        item.expiryDate ?? null,
        item.costPrice,
        item.sellingPrice,
    ]);
};

export const deleteDeliveryItemsByDeliveryId = async (
    db: SqliteDatabase,
    deliveryId: string
) => {
    await db.execute(`DELETE FROM delivery_items WHERE delivery_id = ?`, [deliveryId]);
};

export const createDelivery = async (delivery: Delivery) => {
    const db = await loadDatabase();
    return await insertDeliveryRow(db, delivery);
};

export const createDeliveryItem = async (item: DeliveryItems) => {
    const db = await loadDatabase();
    return await insertDeliveryItemRow(db, item);
};
