import type { Product, Variant, PackagingUnit } from "../types/Product";
import type { ActivityChange, ActivityChangeValue } from "../types/Activity";

const asValue = (value: ActivityChangeValue | undefined): ActivityChangeValue => value ?? null;

const productFieldChanges = (before: Product, after: Product, changes: ActivityChange[]) => {
    const add = (field: string, oldValue: ActivityChangeValue | undefined, newValue: ActivityChangeValue | undefined) => {
        const beforeValue = asValue(oldValue);
        const afterValue = asValue(newValue);
        if (!Object.is(beforeValue, afterValue)) changes.push({ field, before: beforeValue, after: afterValue });
    };

    add("Product name", before.name, after.name);
    add("Generic name", before.genericName, after.genericName);
    add("Category", before.category, after.category);
    add("Manufacturer", before.manufacturer, after.manufacturer);
    add("NAFDAC number", before.nafdacNumber, after.nafdacNumber);
    add("Barcode", before.barcode, after.barcode);
    add("SKU", before.sku, after.sku);
    add("Low-stock level", before.lowStockLevel, after.lowStockLevel);
    add("Track batches", before.trackBatches, after.trackBatches);
    add("Track expiry", before.trackExpiry, after.trackExpiry);
    add("Product status", before.status, after.status);
};

const variantLabel = (variant: Variant, index: number) => {
    const descriptor = [
        [variant.strength, variant.strengthUnit].filter(Boolean).join(" "),
        variant.form,
    ].filter(Boolean).join(" ");
    return descriptor || `Variant ${index + 1}`;
};

const packagingDescription = (unit: PackagingUnit, variant: Variant) => {
    const containedUnit = variant.packagingUnits.find((candidate) => candidate.id === unit.contains?.unitId);
    const contains = unit.contains
        ? `contains ${unit.contains.quantity} ${containedUnit?.name || "unit"}`
        : "smallest unit";
    const details = [
        contains,
        unit.costPrice === undefined ? null : `cost ${unit.costPrice}`,
        unit.sellingPrice === undefined ? null : `selling ${unit.sellingPrice}`,
        unit.isDefault ? "default" : null,
    ].filter((part): part is string => part !== null);
    return `${unit.name || "Unnamed unit"} (${details.join(", ")})`;
};

const variantAndPackagingChanges = (before: Product, after: Product, changes: ActivityChange[]) => {
    const beforeVariants = new Map(before.variants.map((variant, index) => [variant.id, { variant, index }]));
    const afterVariants = new Map(after.variants.map((variant, index) => [variant.id, { variant, index }]));
    const variantIds = new Set([...beforeVariants.keys(), ...afterVariants.keys()]);

    for (const variantId of variantIds) {
        const previous = beforeVariants.get(variantId);
        const next = afterVariants.get(variantId);
        if (!previous || !next) {
            const variant = previous?.variant ?? next!.variant;
            const index = previous?.index ?? next!.index;
            changes.push({
                field: "Variant",
                before: previous ? variantLabel(variant, index) : null,
                after: next ? variantLabel(variant, index) : null,
            });
        } else {
            const label = variantLabel(previous.variant, previous.index);
            const addVariantField = (field: string, oldValue: string | undefined, newValue: string | undefined) => {
                const beforeValue = oldValue ?? null;
                const afterValue = newValue ?? null;
                if (!Object.is(beforeValue, afterValue)) {
                    changes.push({ field: `Variant ${label} / ${field}`, before: beforeValue, after: afterValue });
                }
            };
            addVariantField("Form", previous.variant.form, next.variant.form);
            addVariantField("Strength", previous.variant.strength, next.variant.strength);
            addVariantField("Strength unit", previous.variant.strengthUnit, next.variant.strengthUnit);
        }

        const beforeVariant = previous?.variant;
        const afterVariant = next?.variant;
        const beforeUnits = new Map((beforeVariant?.packagingUnits ?? []).map((unit) => [unit.id, unit]));
        const afterUnits = new Map((afterVariant?.packagingUnits ?? []).map((unit) => [unit.id, unit]));
        const unitIds = new Set([...beforeUnits.keys(), ...afterUnits.keys()]);
        const displayVariant = beforeVariant ?? afterVariant!;
        const displayIndex = previous?.index ?? next!.index;
        const parentLabel = variantLabel(displayVariant, displayIndex);

        for (const unitId of unitIds) {
            const oldUnit = beforeUnits.get(unitId);
            const newUnit = afterUnits.get(unitId);
            if (!oldUnit || !newUnit) {
                changes.push({
                    field: `Packaging unit (${parentLabel})`,
                    before: oldUnit ? packagingDescription(oldUnit, beforeVariant!) : null,
                    after: newUnit ? packagingDescription(newUnit, afterVariant!) : null,
                });
                continue;
            }

            const unitLabel = oldUnit.name || newUnit.name || "Unnamed unit";
            const addUnitField = (field: string, oldValue: ActivityChangeValue | undefined, newValue: ActivityChangeValue | undefined) => {
                const beforeValue = asValue(oldValue);
                const afterValue = asValue(newValue);
                if (!Object.is(beforeValue, afterValue)) {
                    changes.push({
                        field: `Packaging ${unitLabel} / ${field}`,
                        before: beforeValue,
                        after: afterValue,
                    });
                }
            };

            const oldContainedName = oldUnit.contains
                ? beforeVariant?.packagingUnits.find((candidate) => candidate.id === oldUnit.contains?.unitId)?.name ?? null
                : null;
            const newContainedName = newUnit.contains
                ? afterVariant?.packagingUnits.find((candidate) => candidate.id === newUnit.contains?.unitId)?.name ?? null
                : null;
            addUnitField("Name", oldUnit.name, newUnit.name);
            addUnitField("Contains quantity", oldUnit.contains?.quantity, newUnit.contains?.quantity);
            addUnitField("Contains unit", oldContainedName, newContainedName);
            addUnitField("Cost price", oldUnit.costPrice, newUnit.costPrice);
            addUnitField("Selling price", oldUnit.sellingPrice, newUnit.sellingPrice);
            addUnitField("Default unit", oldUnit.isDefault, newUnit.isDefault);
        }
    }
};

export const getProductActivityChanges = (
    before: Product,
    after: Product
): ActivityChange[] => {
    const changes: ActivityChange[] = [];
    productFieldChanges(before, after, changes);
    variantAndPackagingChanges(before, after, changes);
    return changes;
};