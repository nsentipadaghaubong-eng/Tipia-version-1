export type InventoryStockValues = {
    quantity: number;
    batchNumber: string | null;
    expiryDate: string | null;
    costPrice: number;
    sellingPrice: number;
};

export type InventoryAdjustmentChange = {
    stockRowId: string;
    variantId: string;
    packagingUnitId: string;
    expectedBefore: InventoryStockValues;
    after: InventoryStockValues & { packagingUnitId?: never };
};

export type InventoryAdjustmentInput = {
    productId: string;
    reason: string;
    changes: InventoryAdjustmentChange[];
};