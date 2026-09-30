import type { PackagingUnit } from "../types/Product";

export type RawInventoryStockEntry = {
    packagingUnitId: string;
    quantity: number;
};

export type StockBreakdownEntry = {
    packagingUnitId: string;
    packagingUnitName: string;
    quantity: number;
};

export const getConversionFactor = (
    fromUnitId: string,
    toUnitId: string,
    packagingUnits: readonly PackagingUnit[]
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

export const getSmallestPackagingUnit = (
    packagingUnits: readonly PackagingUnit[]
): PackagingUnit | null => packagingUnits[packagingUnits.length - 1] ?? null;

export const calculateStockBreakdown = (
    rawStockRows: readonly RawInventoryStockEntry[],
    packagingUnits: readonly PackagingUnit[]
): StockBreakdownEntry[] => {
    if (packagingUnits.length === 0) {
        return [];
    }

    const smallestUnit = getSmallestPackagingUnit(packagingUnits);
    if (!smallestUnit) {
        return [];
    }

    if (rawStockRows.length === 0) {
        return [{
            packagingUnitId: smallestUnit.id,
            packagingUnitName: smallestUnit.name,
            quantity: 0,
        }];
    }

    const totalSmallestUnits = rawStockRows.reduce((total, entry) => {
        const unit = packagingUnits.find((item) => item.id === entry.packagingUnitId);
        if (!unit) return total;
        return total + entry.quantity * getConversionFactor(unit.id, smallestUnit.id, packagingUnits);
    }, 0);

    if (totalSmallestUnits === 0) {
        return [{
            packagingUnitId: smallestUnit.id,
            packagingUnitName: smallestUnit.name,
            quantity: 0,
        }];
    }

    let remainingSmallestUnits = totalSmallestUnits;
    const breakdown: StockBreakdownEntry[] = [];

    for (const unit of packagingUnits) {
        const factorToSmallest = getConversionFactor(unit.id, smallestUnit.id, packagingUnits);
        const count = Math.floor(remainingSmallestUnits / factorToSmallest);
        if (count <= 0) {
            continue;
        }

        breakdown.push({
            packagingUnitId: unit.id,
            packagingUnitName: unit.name,
            quantity: count,
        });
        remainingSmallestUnits -= count * factorToSmallest;
    }

    if (remainingSmallestUnits > 0) {
        breakdown.push({
            packagingUnitId: smallestUnit.id,
            packagingUnitName: smallestUnit.name,
            quantity: remainingSmallestUnits,
        });
    }

    if (breakdown.length === 0) {
        return [{
            packagingUnitId: smallestUnit.id,
            packagingUnitName: smallestUnit.name,
            quantity: totalSmallestUnits,
        }];
    }

    return breakdown;
};