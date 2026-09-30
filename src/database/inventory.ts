import type { SqliteDatabase } from "./connection";
import type { DeliveryItems } from "../types/Product";
import {
    deleteInventoryStockById,
    getInventoryStockBatchCandidates,
    incrementInventoryStockQuantityById,
    insertInventoryStock,
    upsertInventoryStock,
    updateStockQuantityById,
    type InventoryStockRowInput,
} from "./inventoryRepository";

export type InventoryStockAdditionInput = Pick<
    DeliveryItems,
    | "productId"
    | "variantId"
    | "packagingUnitId"
    | "quantity"
    | "batchNumber"
    | "expiryDate"
    | "costPrice"
    | "sellingPrice"
>;

export const addInventoryStock = async (
    db: SqliteDatabase,
    item: InventoryStockAdditionInput
) => {
    if (!Number.isFinite(item.quantity) || item.quantity < 0 || !Number.isInteger(item.quantity)) {
        throw new Error("Stock quantity must be a non-negative whole number");
    }

    const existingRows = await getInventoryStockBatchCandidates(
        db,
        item.productId,
        item.variantId,
        item.packagingUnitId,
        item.batchNumber ?? null,
        item.expiryDate ?? null
    );

    if (existingRows.length > 0) {
        const nextQuantity = existingRows[0].quantity + item.quantity;
        if (nextQuantity < 0) {
            throw new Error("Cannot add negative stock to an inventory batch");
        }

        await incrementInventoryStockQuantityById(db, existingRows[0].id, item.quantity);
        return;
    }

    if (item.quantity === 0) {
        return;
    }

    await insertInventoryStock(db, {
        id: crypto.randomUUID(),
        productId: item.productId,
        variantId: item.variantId,
        packagingUnitId: item.packagingUnitId,
        quantity: item.quantity,
        batchNumber: item.batchNumber ?? null,
        expiryDate: item.expiryDate ?? null,
        costPrice: item.costPrice,
        sellingPrice: item.sellingPrice,
    });
};

export const setInventoryStockEntry = (
    db: SqliteDatabase,
    productId: string,
    stock: InventoryStockRowInput,
    options: { mode?: "upsert" | "existing" } = {}
) => upsertInventoryStock(db, productId, "", stock, options);

export type InventoryStockAllocationInput = {
    stockRowId: string;
    availableQuantity: number;
    quantityToDeduct: number;
    batchNumber: string | null;
};

export const applyInventoryStockAllocation = async (
    db: SqliteDatabase,
    allocations: InventoryStockAllocationInput[]
) => {
    for (const allocation of allocations) {
        const remainingQuantity = allocation.availableQuantity - allocation.quantityToDeduct;
        if (remainingQuantity < 0) {
            throw new Error(`Negative stock detected for batch ${allocation.batchNumber ?? "unknown"}`);
        }

        if (remainingQuantity === 0) {
            await deleteInventoryStockById(db, allocation.stockRowId);
        } else {
            await updateStockQuantityById(db, allocation.stockRowId, remainingQuantity);
        }
    }
};
