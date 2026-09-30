import { describe, expect, it } from "vitest";
import type { PackagingUnit } from "../types/Product";
import { validatePackagingChain } from "./packagingChainValidation";

const unit = (
    id: string,
    name: string,
    contains?: PackagingUnit["contains"]
): PackagingUnit => ({ id, name, contains, isDefault: false });

describe("validatePackagingChain", () => {
    it("accepts a single packaging unit", () => {
        expect(validatePackagingChain([unit("tablet", "Tablet")])).toEqual({ valid: true, error: null });
    });

    it("accepts a two-level chain", () => {
        expect(validatePackagingChain([
            unit("pack", "Pack", { quantity: 12, unitId: "sachet" }),
            unit("sachet", "Sachet"),
        ])).toEqual({ valid: true, error: null });
    });

    it("accepts a three-level chain", () => {
        expect(validatePackagingChain([
            unit("pack", "Pack", { quantity: 12, unitId: "sachet" }),
            unit("sachet", "Sachet", { quantity: 10, unitId: "card" }),
            unit("card", "Card"),
        ])).toEqual({ valid: true, error: null });
    });

    it("accepts a four-level chain", () => {
        expect(validatePackagingChain([
            unit("case", "Case", { quantity: 6, unitId: "pack" }),
            unit("pack", "Pack", { quantity: 12, unitId: "sachet" }),
            unit("sachet", "Sachet", { quantity: 10, unitId: "card" }),
            unit("card", "Card"),
        ])).toEqual({ valid: true, error: null });
    });

    it.each([1, 12, 1000000])("accepts positive integer contains quantity %s", (quantity) => {
        expect(validatePackagingChain([
            unit("outer", "Outer", { quantity, unitId: "inner" }),
            unit("inner", "Inner"),
        ])).toEqual({ valid: true, error: null });
    });

    it("rejects a missing packaging unit name", () => {
        expect(validatePackagingChain([unit("unit", " ")])).toMatchObject({
            valid: false,
            error: { code: "missing-unit-name", packagingUnitId: "unit" },
        });
    });

    it("rejects a smallest unit that contains another unit", () => {
        expect(validatePackagingChain([
            unit("unit", "Unit", { quantity: 1, unitId: "other" }),
        ])).toMatchObject({
            valid: false,
            error: { code: "smallest-unit-contains-another", packagingUnitId: "unit" },
        });
    });

    it("rejects a non-smallest unit without a contains relationship", () => {
        expect(validatePackagingChain([
            unit("outer", "Outer"),
            unit("inner", "Inner"),
        ])).toMatchObject({
            valid: false,
            error: { code: "invalid-contains-quantity", packagingUnitId: "outer" },
        });
    });

    it.each([
        0,
        -1,
        2.5,
        0.5,
        -0.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
    ])("rejects invalid contains quantity %s", (quantity) => {
        expect(validatePackagingChain([
            unit("outer", "Outer", { quantity, unitId: "inner" }),
            unit("inner", "Inner"),
        ])).toMatchObject({
            valid: false,
            error: { code: "invalid-contains-quantity", packagingUnitId: "outer" },
        });
    });

    it("rejects a missing contains unit reference", () => {
        expect(validatePackagingChain([
            unit("outer", "Outer", { quantity: 2, unitId: "" }),
            unit("inner", "Inner"),
        ])).toMatchObject({
            valid: false,
            error: { code: "missing-contains-unit", packagingUnitId: "outer" },
        });
    });

    it("rejects an unknown contains unit reference", () => {
        expect(validatePackagingChain([
            unit("outer", "Outer", { quantity: 2, unitId: "missing" }),
            unit("inner", "Inner"),
        ])).toMatchObject({
            valid: false,
            error: { code: "contains-unit-is-not-next", packagingUnitId: "outer" },
        });
    });

    it("rejects a chain left pointing at a packaging unit removed from the hierarchy", () => {
        expect(validatePackagingChain([
            unit("pack", "Pack", { quantity: 12, unitId: "removed-sachet" }),
            unit("card", "Card"),
        ])).toMatchObject({
            valid: false,
            error: { code: "contains-unit-is-not-next", packagingUnitId: "pack" },
        });
    });

    it("rejects a reference to a packaging unit at the wrong level", () => {
        expect(validatePackagingChain([
            unit("outer", "Outer", { quantity: 2, unitId: "smallest" }),
            unit("middle", "Middle", { quantity: 3, unitId: "smallest" }),
            unit("smallest", "Smallest"),
        ])).toMatchObject({
            valid: false,
            error: { code: "contains-unit-is-not-next", packagingUnitId: "outer" },
        });
    });

    it("rejects a unit that contains itself", () => {
        expect(validatePackagingChain([
            unit("outer", "Outer", { quantity: 2, unitId: "outer" }),
            unit("inner", "Inner"),
        ])).toMatchObject({
            valid: false,
            error: { code: "unit-contains-itself", packagingUnitId: "outer" },
        });
    });

    it("does not mutate the supplied packaging units", () => {
        const packagingUnits = [
            unit("outer", "Outer", { quantity: 2, unitId: "inner" }),
            unit("inner", "Inner"),
        ];
        const original = structuredClone(packagingUnits);

        validatePackagingChain(packagingUnits);

        expect(packagingUnits).toEqual(original);
    });
});