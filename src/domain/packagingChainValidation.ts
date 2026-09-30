import type { PackagingUnit } from "../types/Product";

export type PackagingChainValidationErrorCode =
    | "missing-unit-name"
    | "smallest-unit-contains-another"
    | "invalid-contains-quantity"
    | "missing-contains-unit"
    | "unit-contains-itself"
    | "contains-unit-is-not-next";

export type PackagingChainValidationError = {
    code: PackagingChainValidationErrorCode;
    packagingUnitId: string;
    packagingUnitName: string;
    nextPackagingUnitName?: string;
};

export type PackagingChainValidationResult =
    | { valid: true; error: null }
    | { valid: false; error: PackagingChainValidationError };

export const validatePackagingChain = (
    packagingUnits: readonly PackagingUnit[]
): PackagingChainValidationResult => {
    for (let index = 0; index < packagingUnits.length; index++) {
        const unit = packagingUnits[index];

        if (!unit.name.trim()) {
            return {
                valid: false,
                error: {
                    code: "missing-unit-name",
                    packagingUnitId: unit.id,
                    packagingUnitName: unit.name,
                },
            };
        }

        const isSmallestUnit = index === packagingUnits.length - 1;
        if (isSmallestUnit) {
            if (unit.contains) {
                return {
                    valid: false,
                    error: {
                        code: "smallest-unit-contains-another",
                        packagingUnitId: unit.id,
                        packagingUnitName: unit.name,
                    },
                };
            }
            continue;
        }

        const contains = unit.contains;
        const containsQuantity = contains?.quantity;
        if (
            !contains ||
            typeof containsQuantity !== "number" ||
            !Number.isFinite(containsQuantity) ||
            containsQuantity <= 0 ||
            !Number.isInteger(containsQuantity)
        ) {
            return {
                valid: false,
                error: {
                    code: "invalid-contains-quantity",
                    packagingUnitId: unit.id,
                    packagingUnitName: unit.name,
                },
            };
        }

        if (!contains.unitId) {
            return {
                valid: false,
                error: {
                    code: "missing-contains-unit",
                    packagingUnitId: unit.id,
                    packagingUnitName: unit.name,
                },
            };
        }

        if (contains.unitId === unit.id) {
            return {
                valid: false,
                error: {
                    code: "unit-contains-itself",
                    packagingUnitId: unit.id,
                    packagingUnitName: unit.name,
                },
            };
        }

        const nextSmallerUnit = packagingUnits[index + 1];
        if (contains.unitId !== nextSmallerUnit.id) {
            return {
                valid: false,
                error: {
                    code: "contains-unit-is-not-next",
                    packagingUnitId: unit.id,
                    packagingUnitName: unit.name,
                    nextPackagingUnitName: nextSmallerUnit.name,
                },
            };
        }
    }

    return { valid: true, error: null };
};