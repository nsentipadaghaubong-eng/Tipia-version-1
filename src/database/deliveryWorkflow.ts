import type { Delivery, Product, Variant } from "../types/Product";
import { recordActivity } from "./activity";
import { loadDatabase } from "./connection";
import {
    deleteDeliveryItemsByDeliveryId,
    insertDeliveryItemRow,
    insertDeliveryRowWithStatus,
    selectDeliveryStatusById,
    updateDeliveryRow,
} from "./deliveryRepository";
import { addInventoryStock } from "./inventory";
import { getProductActivitySnapshot } from "./productRepository";

const getActivityVariantLabel = (variant: Variant | undefined) => {
    if (!variant) return null;
    const strength = [variant.strength, variant.strengthUnit].filter(Boolean).join(" ");
    return [strength, variant.form].filter(Boolean).join(" ") || "Variant";
};

export const saveDeliveryDraft = async (delivery: Delivery) => {
    const db = await loadDatabase();

    try {
        await db.execute(`PRAGMA foreign_keys = ON;`);
        await db.execute(`BEGIN`);

        const existingDelivery = await selectDeliveryStatusById(db, delivery.id);
        if (existingDelivery.some((entry) => entry.status === "approved")) {
            throw new Error(`Approved delivery ${delivery.id} cannot be edited as a draft.`);
        }

        if (existingDelivery.length > 0) {
            await updateDeliveryRow(db, delivery, "draft");
        } else {
            await insertDeliveryRowWithStatus(db, delivery, "draft");
        }

        await deleteDeliveryItemsByDeliveryId(db, delivery.id);

        for (const item of delivery.items) {
            await insertDeliveryItemRow(db, item);
        }

        await db.execute(`COMMIT`);
        return { success: true, deliveryId: delivery.id };
    } catch (error) {
        await db.execute(`ROLLBACK`);
        throw error;
    }
};

export const receiveDelivery = async (delivery: Delivery) => {
    if (delivery.status !== "approved") {
        throw new Error(delivery.status === "draft"
            ? "Draft delivery must be saved using saveDeliveryDraft without creating stock."
            : "Delivery must have an explicit approved status before receiving.");
    }

    if (typeof delivery.supplier !== "string" || !delivery.supplier.trim() || delivery.supplier === "select") {
        throw new Error("Supplier is required");
    }
    if (typeof delivery.invoiceNo !== "string" || !delivery.invoiceNo.trim()) {
        throw new Error("Invoice No. is required");
    }
    if (typeof delivery.date !== "string" || !delivery.date.trim()) {
        throw new Error("Date is required");
    }
    if (typeof delivery.receivedBy !== "string" || !delivery.receivedBy.trim()) {
        throw new Error("Received by is required");
    }
    if (!Array.isArray(delivery.items) || delivery.items.length === 0) {
        throw new Error("Add at least one product to the delivery");
    }
    for (const item of delivery.items) {
        if (!item || !Number.isFinite(item.quantity) || item.quantity <= 0) {
            throw new Error("Quantity must be greater than zero");
        }
        if (!Number.isInteger(item.quantity)) {
            throw new Error("Stock quantity must be a non-negative whole number");
        }
        if (item.costPrice < 0 || item.sellingPrice < 0) {
            throw new Error("Prices cannot be negative");
        }
    }

    const db = await loadDatabase();

    try {
        await db.execute(`PRAGMA foreign_keys = ON;`);
        await db.execute(`BEGIN`);

        const existingDelivery = await selectDeliveryStatusById(db, delivery.id);
        if (existingDelivery.some((entry) => entry.status === "approved")) {
            throw new Error(`Delivery ${delivery.id} has already been approved.`);
        }

        if (existingDelivery.length > 0) {
            await updateDeliveryRow(db, delivery, "approved");
            await deleteDeliveryItemsByDeliveryId(db, delivery.id);
        } else {
            await insertDeliveryRowWithStatus(db, delivery, "approved");
        }

        for (const item of delivery.items) {
            await insertDeliveryItemRow(db, item);
            await addInventoryStock(db, item);
        }

        const deliveryProducts = new Map<string, Product | null>();
        for (const item of delivery.items) {
            if (!deliveryProducts.has(item.productId)) {
                deliveryProducts.set(item.productId, await getProductActivitySnapshot(db, item.productId));
            }
        }

        await recordActivity(db, {
            eventType: "delivery.received",
            entityType: "delivery",
            entityId: delivery.id,
            entityLabel: `Invoice ${delivery.invoiceNo}`,
            summary: `Delivery from ${delivery.supplier} received on ${delivery.date} by ${delivery.receivedBy} (${delivery.items.length} item${delivery.items.length === 1 ? "" : "s"})`,
            reason: null,
            details: {
                supplier: delivery.supplier,
                invoiceNo: delivery.invoiceNo,
                deliveryDate: delivery.date,
                receivedBy: delivery.receivedBy,
                items: delivery.items.map((item) => {
                    const productSnapshot = deliveryProducts.get(item.productId) ?? null;
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
                        batchNumber: item.batchNumber ?? null,
                        expiryDate: item.expiryDate ?? null,
                        costPrice: item.costPrice,
                        sellingPrice: item.sellingPrice,
                    };
                }),
            },
        });

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