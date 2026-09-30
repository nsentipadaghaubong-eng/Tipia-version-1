export type ActivityEventType =
    | "product.created"
    | "product.edited"
    | "product.archived"
    | "inventory.adjusted"
    | "delivery.received"
    | "sale.completed";

export type ActivityEntityType = "product" | "delivery" | "sale";

export type ActivityChangeValue = string | number | boolean | null;

export type ActivityChange = {
    field: string;
    before: ActivityChangeValue;
    after: ActivityChangeValue;
};

export type ProductCreatedActivityDetails = {
    genericName: string;
    manufacturer: string;
    category: string;
    variants: Array<{
        label: string;
        initialQuantities: Array<{ quantity: number; packagingUnitName: string }>;
    }>;
};

export type DeliveryReceivedActivityDetails = {
    supplier: string;
    invoiceNo: string;
    deliveryDate: string;
    receivedBy: string;
    items: Array<{
        productId: string;
        productName: string | null;
        variantId: string;
        variantLabel: string | null;
        packagingUnitId: string;
        packagingUnitName: string | null;
        quantity: number;
        batchNumber: string | null;
        expiryDate: string | null;
        costPrice: number;
        sellingPrice: number;
    }>;
};

export type InventoryAdjustedActivityDetails = {
    rows: Array<{
        stockRowId: string;
        variantId: string;
        packagingUnitId: string;
        before: {
            quantity: number;
            batchNumber: string | null;
            expiryDate: string | null;
            costPrice: number;
            sellingPrice: number;
        };
        after: {
            quantity: number;
            batchNumber: string | null;
            expiryDate: string | null;
            costPrice: number;
            sellingPrice: number;
        };
    }>;
};

export type SaleCompletedActivityItem = {
    productId: string;
    productName: string | null;
    variantId: string;
    variantLabel: string | null;
    packagingUnitId: string;
    packagingUnitName: string | null;
    quantity: number;
    unitPrice: number;
    lineAmount: number;
    allocations: Array<{
        quantity: number;
        batchNumber: string | null;
        expiryDate: string | null;
    }>;
};

export type SaleCompletedActivityDetails = {
    saleDate: string;
    soldBy: string | null;
    notes: string | null;
    totalAmount: number;
    discount: number;
    items: SaleCompletedActivityItem[];
};

export type ActivityDetails =
    | ProductCreatedActivityDetails
    | InventoryAdjustedActivityDetails
    | DeliveryReceivedActivityDetails
    | SaleCompletedActivityDetails;

export type ActivityRecord = {
    id: string;
    eventType: ActivityEventType;
    occurredAt: string;
    entityType: ActivityEntityType;
    entityId: string;
    entityLabel: string;
    summary: string;
    reason: string | null;
    changes: ActivityChange[] | null;
    details: ActivityDetails | null;
};

export type ActivityRecordInput = Omit<ActivityRecord, "reason" | "changes" | "details"> & {
    reason?: string | null;
    changes?: ActivityChange[] | null;
    details?: ActivityDetails | null;
};