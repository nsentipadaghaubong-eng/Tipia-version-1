import type { SqliteDatabase } from "./connection";
import type { DeliveryItems, PackagingUnit, SaleItem } from "../types/Product";
import { getConversionFactor } from "../domain/stockBreakdown";
import {
    getPackagingUnitsForVariant,
    selectPackagingUnitIdByIdAndVariantId,
    selectVariantIdByIdAndProductId,
} from "./productRepository";
import {
    deleteInventoryStockById,
    getInventoryStockBatchCandidates,
    incrementInventoryStockQuantityById,
    insertInventoryStock,
    selectInventoryStockRowsByVariant,
    upsertInventoryStock,
    updateStockQuantityById,
    type InventoryStockRow,
    type InventoryStockRowInput,
} from "./inventoryRepository";

export type InventorySaleStockOption = {
    stockRowId?: string;
    batchNumber: string | null;
    expiryDate: string | null;
    quantity: number;
    plannedQuantity?: number;
    sellingPrice: number;
    stockQuantity?: number;
    stockPackagingUnitId?: string;
    quantityStep?: number;
    recommended?: boolean;
};

export type SelectedInventoryStockAllocation = {
    items: Array<{
        saleItemId?: string;
        productId: string;
        variantId: string;
        packagingUnitId: string;
        quantity: number;
        allocations: Array<{
            stockRowId: string;
            quantity: number;
            batchNumber?: string;
            expiryDate?: string;
            stockPackagingUnitId?: string;
            sellingPrice?: number;
        }>;
    }>;
};

export type InventoryStockFulfillmentMode =
    | { type: "fefo" }
    | { type: "selected"; selectedAllocation: SelectedInventoryStockAllocation };

type InventoryStockPlanAllocation = {
    row: InventoryStockRow;
    conversionFactor: number;
    quantity: number;
    sourceQuantity: number;
    sourcePackagingUnitName: string;
};

export type InventoryStockFulfillmentLinePlan = {
    item: Pick<SaleItem, "productId" | "variantId" | "packagingUnitId" | "quantity"> & Partial<Pick<SaleItem, "id">>;
    requestedUnit: PackagingUnit;
    candidates: Array<{ row: InventoryStockRow; conversionFactor: number }>;
    totalAvailable: number;
    allocations: InventoryStockPlanAllocation[];
};

const getInventoryStockOptionsForSale = (
    item: Pick<SaleItem, "productId" | "variantId" | "packagingUnitId" | "quantity">,
    stockRows: InventoryStockRow[],
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
        .filter((candidate) => candidate.conversionFactor > 0)
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

    const totalAvailable = candidates.reduce(
        (total, candidate) => total + candidate.row.quantity * candidate.conversionFactor,
        0
    );

    return { requestedUnit, candidates, totalAvailable };
};

const planInventoryStockAllocation = (
    item: Pick<SaleItem, "productId" | "variantId" | "packagingUnitId" | "quantity">,
    stockRows: InventoryStockRow[],
    packagingUnits: PackagingUnit[],
    stockOptions = getInventoryStockOptionsForSale(item, stockRows, packagingUnits)
) => {
    const { requestedUnit, candidates, totalAvailable } = stockOptions;
    if (totalAvailable < item.quantity) {
        throw new Error(
            `Insufficient stock: requested ${item.quantity} ${requestedUnit.name || "unit"}, only ${totalAvailable} available`
        );
    }

    let remainingQuantity = item.quantity;
    const allocations: Array<{ row: InventoryStockRow; conversionFactor: number; quantity: number; sourceQuantity: number }> = [];

    for (const candidate of candidates) {
        if (remainingQuantity <= 0) break;

        const availableInRequestedUnit = candidate.row.quantity * candidate.conversionFactor;
        const quantityToAllocate = Math.min(remainingQuantity, availableInRequestedUnit);
        const sourceQuantityToUse = Math.floor(quantityToAllocate / candidate.conversionFactor);
        if (sourceQuantityToUse <= 0) continue;

        const actualRequestedQuantity = sourceQuantityToUse * candidate.conversionFactor;
        if (actualRequestedQuantity <= 0) continue;

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

    return { requestedUnit, candidates, totalAvailable, allocations };
};

const normalizeStockIdentity = (value: string | null | undefined) => value === "" ? null : value ?? null;

const findSelectedAllocationItem = (
    item: Pick<SaleItem, "productId" | "variantId" | "packagingUnitId" | "quantity"> & Partial<Pick<SaleItem, "id">>,
    selectedAllocation: SelectedInventoryStockAllocation
) => selectedAllocation.items.find((entry) =>
    (entry.saleItemId ? entry.saleItemId === item.id : true) &&
    entry.productId === item.productId &&
    entry.variantId === item.variantId &&
    entry.packagingUnitId === item.packagingUnitId
);

const validateSelectedInventoryAllocation = (
    item: Pick<SaleItem, "productId" | "variantId" | "packagingUnitId" | "quantity"> & Partial<Pick<SaleItem, "id">>,
    requestedItem: SelectedInventoryStockAllocation["items"][number] | undefined,
    stockRows: InventoryStockRow[],
    packagingUnits: PackagingUnit[]
) => {
    if (!requestedItem || requestedItem.quantity !== item.quantity) {
        throw new Error("Selected stock allocation is invalid");
    }

    const requestedUnit = packagingUnits.find((unit) => unit.id === item.packagingUnitId);
    if (!requestedUnit) throw new Error("Selected stock allocation is invalid");

    const rowById = new Map(stockRows.map((row) => [row.id, row]));
    const selectedByRow = new Map<string, { row: InventoryStockRow; quantity: number; sourceQuantity: number }>();
    let totalSelected = 0;

    for (const allocation of requestedItem.allocations ?? []) {
        if (!allocation || !allocation.stockRowId || !Number.isFinite(allocation.quantity) || allocation.quantity <= 0 || !Number.isInteger(allocation.quantity)) {
            throw new Error("Selected stock allocation is invalid");
        }

        const row = rowById.get(allocation.stockRowId);
        if (!row || row.productId !== item.productId || row.variantId !== item.variantId) {
            throw new Error("Selected stock allocation is invalid");
        }
        if (allocation.batchNumber !== undefined && normalizeStockIdentity(allocation.batchNumber) !== normalizeStockIdentity(row.batchNumber)) {
            throw new Error("Selected stock allocation is invalid");
        }
        if (allocation.expiryDate !== undefined && normalizeStockIdentity(allocation.expiryDate) !== normalizeStockIdentity(row.expiryDate)) {
            throw new Error("Selected stock allocation is invalid");
        }
        if (allocation.stockPackagingUnitId !== undefined && allocation.stockPackagingUnitId !== row.packagingUnitId) {
            throw new Error("Selected stock allocation is invalid");
        }

        const conversionFactor = getConversionFactor(row.packagingUnitId, requestedUnit.id, packagingUnits);
        if (conversionFactor <= 0 || allocation.quantity % conversionFactor !== 0) {
            throw new Error("Selected stock allocation is invalid");
        }

        const sourceQuantity = allocation.quantity / conversionFactor;
        if (!Number.isInteger(sourceQuantity) || sourceQuantity <= 0 || sourceQuantity > row.quantity) {
            throw new Error("Selected stock allocation is invalid");
        }

        const existing = selectedByRow.get(row.id) ?? { row, quantity: 0, sourceQuantity: 0 };
        existing.quantity += allocation.quantity;
        existing.sourceQuantity += sourceQuantity;
        if (existing.sourceQuantity > row.quantity) {
            throw new Error("Selected stock allocation is invalid");
        }
        selectedByRow.set(row.id, existing);
        totalSelected += allocation.quantity;
    }

    if (totalSelected !== item.quantity || selectedByRow.size === 0) {
        throw new Error("Selected stock allocation is invalid");
    }

    return Array.from(selectedByRow.values()).map(({ row, sourceQuantity, quantity }) => ({
        row,
        quantity,
        sourceQuantity,
        conversionFactor: getConversionFactor(row.packagingUnitId, requestedUnit.id, packagingUnits),
    }));
};

export const planInventoryStockFulfillment = async (
    db: SqliteDatabase,
    items: Array<Pick<SaleItem, "productId" | "variantId" | "packagingUnitId" | "quantity"> & Partial<Pick<SaleItem, "id">>>,
    mode: InventoryStockFulfillmentMode
): Promise<InventoryStockFulfillmentLinePlan[]> => {
    if (mode.type === "selected" && (!mode.selectedAllocation || !Array.isArray(mode.selectedAllocation.items))) {
        throw new Error("Selected stock allocation is invalid");
    }
    if (mode.type !== "selected" && mode.type !== "fefo") {
        throw new Error("Inventory stock fulfillment mode is invalid");
    }

    const stockRowsByVariant = new Map<string, InventoryStockRow[]>();
    const packagingUnitsByVariant = new Map<string, PackagingUnit[]>();
    const remainingByStockRow = new Map<string, number>();
    const plans: InventoryStockFulfillmentLinePlan[] = [];

    for (const item of items) {
        const variantKey = `${item.productId}:${item.variantId}`;
        let stockRows = stockRowsByVariant.get(variantKey);
        if (!stockRows) {
            stockRows = await selectInventoryStockRowsByVariant(db, item.productId, item.variantId);
            stockRowsByVariant.set(variantKey, stockRows);
        }
        let packagingUnits = packagingUnitsByVariant.get(variantKey);
        if (!packagingUnits) {
            packagingUnits = await getPackagingUnitsForVariant(db, item.variantId);
            packagingUnitsByVariant.set(variantKey, packagingUnits);
        }

        const availableRows = stockRows
            .map((row) => ({
                ...row,
                quantity: remainingByStockRow.get(row.id) ?? row.quantity,
            }))
            .filter((row) => row.quantity > 0);
        const stockOptions = getInventoryStockOptionsForSale(item, availableRows, packagingUnits);

        const allocations = mode.type === "fefo"
            ? planInventoryStockAllocation(item, availableRows, packagingUnits, stockOptions).allocations
            : validateSelectedInventoryAllocation(
                item,
                findSelectedAllocationItem(item, mode.selectedAllocation),
                availableRows,
                packagingUnits
            );

        for (const allocation of allocations) {
            const remainingQuantity = (remainingByStockRow.get(allocation.row.id) ?? allocation.row.quantity) - allocation.sourceQuantity;
            if (remainingQuantity < 0) {
                throw new Error("Selected stock allocation is invalid");
            }
            remainingByStockRow.set(allocation.row.id, remainingQuantity);
        }

        plans.push({
            item,
            requestedUnit: stockOptions.requestedUnit,
            candidates: stockOptions.candidates,
            totalAvailable: stockOptions.totalAvailable,
            allocations: allocations.map((allocation) => ({
                ...allocation,
                sourcePackagingUnitName: packagingUnits.find((unit) => unit.id === allocation.row.packagingUnitId)?.name
                    ?? allocation.row.packagingUnitId,
            })),
        });
    }

    return plans;
};

export const getEligibleInventoryStockOptionsForSale = async (
    db: SqliteDatabase,
    productId: string,
    variantId: string,
    packagingUnitId: string,
    quantity: number
): Promise<InventorySaleStockOption[]> => {
    const [plan] = await planInventoryStockFulfillment(db, [{
        productId,
        variantId,
        packagingUnitId,
        quantity,
    }], { type: "fefo" });

    if (!plan) return [];

    const recommended = plan.allocations[0]?.row.id ?? null;
    const plannedQuantities = new Map(plan.allocations.map(({ row, quantity }) => [row.id, quantity]));

    return plan.candidates.map(({ row, conversionFactor }) => ({
        stockRowId: row.id,
        batchNumber: row.batchNumber,
        expiryDate: row.expiryDate,
        quantity: row.quantity * conversionFactor,
        plannedQuantity: plannedQuantities.get(row.id) ?? 0,
        sellingPrice: row.sellingPrice,
        stockQuantity: row.quantity,
        stockPackagingUnitId: row.packagingUnitId,
        quantityStep: conversionFactor,
        recommended: row.id === recommended,
    }));
};

export const getSelectedInventoryAllocation = async (
    db: SqliteDatabase,
    item: Pick<SaleItem, "productId" | "variantId" | "packagingUnitId" | "quantity">,
    selectedAllocation?: SelectedInventoryStockAllocation
) => {
    if (!selectedAllocation || !Array.isArray(selectedAllocation.items)) {
        throw new Error("Selected stock allocation is invalid");
    }

    const packagingUnits = await getPackagingUnitsForVariant(db, item.variantId);
    const stockRows = await selectInventoryStockRowsByVariant(db, item.productId, item.variantId);
    return validateSelectedInventoryAllocation(
        item,
        findSelectedAllocationItem(item, selectedAllocation),
        stockRows,
        packagingUnits
    );
};

export const applySelectedInventoryStockAllocation = async (
    db: SqliteDatabase,
    item: Pick<SaleItem, "productId" | "variantId" | "packagingUnitId" | "quantity">,
    selectedAllocation?: SelectedInventoryStockAllocation
) => {
    const allocations = await getSelectedInventoryAllocation(db, item, selectedAllocation);
    await applyInventoryStockAllocation(db, allocations.map(({ row, sourceQuantity }) => ({
        stockRowId: row.id,
        availableQuantity: row.quantity,
        quantityToDeduct: sourceQuantity,
        batchNumber: row.batchNumber,
    })));
    return allocations;
};

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

    const matchingVariants = await selectVariantIdByIdAndProductId(db, item.variantId, item.productId);
    if (matchingVariants.length === 0) {
        throw new Error("Delivery item Variant must belong to its Product.");
    }
    const matchingPackagingUnits = await selectPackagingUnitIdByIdAndVariantId(db, item.packagingUnitId, item.variantId);
    if (matchingPackagingUnits.length === 0) {
        throw new Error("Delivery item Packaging Unit must belong to its Variant and Product.");
    }

    const existingRows = await getInventoryStockBatchCandidates(
        db,
        item.productId,
        item.variantId,
        item.packagingUnitId,
        item.batchNumber ?? null,
        item.expiryDate ?? null,
        item.costPrice
    );

    if (existingRows.length > 0) {
        if (existingRows.some((row) => row.sellingPrice !== item.sellingPrice)) {
            throw new Error("Conflicting selling price for existing inventory batch. Resolve the price before receiving stock.");
        }

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
