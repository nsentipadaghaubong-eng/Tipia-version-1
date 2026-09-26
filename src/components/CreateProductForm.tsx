import React, { useEffect, useState } from "react";
import type { Product, FormData, Variant, PackagingUnit } from "../types/Product";
import { getCurrentStockForProduct } from "../database/database";
import { formatExpiryStatus } from "../utils/expiry";

interface InitialStockEntry {
    id: string;
    packagingUnitId: string;
    quantity: number;
    batchNumber?: string;
    expiryDate?: string;
    costPrice: number;
    sellingPrice: number;
}

export interface CreateProductFormProps {
    existingProducts: Product[];
    initialProduct?: Product | null;
    onSave: (product: Product, initialStock: InitialStockEntry[]) => Promise<void> | void;
    onCancel: () => void;
    onUseExistingProduct?: (product: Product) => void;
    onModifyExistingProduct?: (product: Product) => void;
    allowDuplicateWarning?: boolean;
}

type DuplicateMatchType = "name" | "barcode" | "both" | "conflict";

interface DuplicateMatchResult {
    type: DuplicateMatchType;
    primaryProduct: Product | null;
    matchingProducts: Product[];
    nameMatches: Product[];
    barcodeMatches: Product[];
}

const normalizeProductName = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
const normalizeBarcodeValue = (value: string) => value.replace(/\s+/g, "").trim().toLowerCase();

const formatProductSummary = (product: Product) => {
    const details = [
        product.name,
        product.genericName,
        product.manufacturer,
        product.barcode,
    ].filter((value): value is string => Boolean(value && value.trim()));

    return details.join(" • ") || "Unnamed product";
};

const getDuplicateMatchKey = (match: DuplicateMatchResult | null) => {
    if (!match) return null;

    const uniqueIds = [...new Set(match.matchingProducts.map((product) => product.id))].sort().join("|");
    return `${match.type}:${uniqueIds}:${match.primaryProduct?.id ?? ""}`;
};

const findDuplicateMatch = (
    candidate: Pick<Product, "id" | "name" | "barcode">,
    existingProducts: Product[],
    ignoredProductId?: string
): DuplicateMatchResult | null => {
    const normalizedName = normalizeProductName(candidate.name ?? "");
    const normalizedBarcode = normalizeBarcodeValue(candidate.barcode ?? "");

    if (!normalizedName && !normalizedBarcode) {
        return null;
    }

    const nameMatches = normalizedName
        ? existingProducts.filter((product) => {
            if (product.id === ignoredProductId) return false;
            return normalizeProductName(product.name ?? "") === normalizedName;
        })
        : [];

    const barcodeMatches = normalizedBarcode
        ? existingProducts.filter((product) => {
            if (product.id === ignoredProductId) return false;
            return normalizeBarcodeValue(product.barcode ?? "") === normalizedBarcode;
        })
        : [];

    const uniqueNameMatches = Array.from(new Map(nameMatches.map((product) => [product.id, product])).values());
    const uniqueBarcodeMatches = Array.from(new Map(barcodeMatches.map((product) => [product.id, product])).values());

    if (normalizedName && normalizedBarcode) {
        const sameProduct = uniqueNameMatches.find((product) =>
            uniqueBarcodeMatches.some((barcodeProduct) => barcodeProduct.id === product.id)
        );

        if (sameProduct) {
            return {
                type: "both",
                primaryProduct: sameProduct,
                matchingProducts: [sameProduct],
                nameMatches: [sameProduct],
                barcodeMatches: [sameProduct],
            };
        }

        if (uniqueNameMatches.length > 0 && uniqueBarcodeMatches.length > 0) {
            return {
                type: "conflict",
                primaryProduct: uniqueNameMatches[0] ?? uniqueBarcodeMatches[0],
                matchingProducts: [...uniqueNameMatches, ...uniqueBarcodeMatches],
                nameMatches: uniqueNameMatches,
                barcodeMatches: uniqueBarcodeMatches,
            };
        }
    }

    if (uniqueNameMatches.length > 0) {
        return {
            type: "name",
            primaryProduct: uniqueNameMatches[0],
            matchingProducts: uniqueNameMatches,
            nameMatches: uniqueNameMatches,
            barcodeMatches: [],
        };
    }

    if (uniqueBarcodeMatches.length > 0) {
        return {
            type: "barcode",
            primaryProduct: uniqueBarcodeMatches[0],
            matchingProducts: uniqueBarcodeMatches,
            nameMatches: [],
            barcodeMatches: uniqueBarcodeMatches,
        };
    }

    return null;
};

const createEmptyForm = (): FormData => ({
    name: "",
    genericName: "",
    category: "",
    manufacturer: "",
    nafdacNumber: "",
    barcode: "",
    sku: "",
    lowStockLevel: 5,
    trackBatches: false,
    trackExpiry: false,
    status: "active",
});

const createInitialVariant = (): Variant => ({
    id: crypto.randomUUID(),
    productId: "",
    strength: "",
    strengthUnit: "",
    form: "",
    packagingUnits: [{
        id: crypto.randomUUID(),
        name: "",
        costPrice: 0,
        sellingPrice: 0,
        isDefault: true,
    }],
});

const CreateProductForm = ({
    existingProducts,
    initialProduct,
    onSave,
    onCancel,
    onUseExistingProduct,
    onModifyExistingProduct,
    allowDuplicateWarning = true,
}: CreateProductFormProps) => {
    const [form, setForm] = useState<FormData>(createEmptyForm());
    const [variants, setVariants] = useState<Variant[]>([createInitialVariant()]);
    const [isMultiVariant, setIsMultiVariant] = useState<boolean>(false);
    const [initialStock, setInitialStock] = useState<InitialStockEntry[]>([]);
    const [error, setError] = useState("");
    const [duplicateMatch, setDuplicateMatch] = useState<DuplicateMatchResult | null>(null);
    const [dismissedDuplicateKey, setDismissedDuplicateKey] = useState<string | null>(null);

    const isEditing = Boolean(initialProduct);

    useEffect(() => {
        if (!initialProduct) {
            setForm(createEmptyForm());
            setVariants([createInitialVariant()]);
            setIsMultiVariant(false);
            setInitialStock([]);
            setError("");
            setDuplicateMatch(null);
            setDismissedDuplicateKey(null);
            return;
        }

        setForm({
            name: initialProduct.name,
            genericName: initialProduct.genericName,
            category: initialProduct.category,
            manufacturer: initialProduct.manufacturer,
            nafdacNumber: initialProduct.nafdacNumber ?? "",
            barcode: initialProduct.barcode ?? "",
            sku: initialProduct.sku ?? "",
            lowStockLevel: initialProduct.lowStockLevel ?? 5,
            trackBatches: initialProduct.trackBatches,
            trackExpiry: initialProduct.trackExpiry,
            status: initialProduct.status,
        });

        const nextVariants = initialProduct.variants.length > 0 ? initialProduct.variants : [createInitialVariant()];
        setVariants(nextVariants);
        setIsMultiVariant(initialProduct.variants.length > 1);
        let cancelled = false;

        const loadCurrentStock = async () => {
            try {
                const currentStock = await getCurrentStockForProduct(initialProduct.id);
                if (!cancelled) {
                    setInitialStock(currentStock.map((stock) => ({
                        ...stock,
                        id: stock.id ?? crypto.randomUUID(),
                        batchNumber: stock.batchNumber ?? "",
                        expiryDate: stock.expiryDate ?? "",
                    })));
                }
            } catch (stockError) {
                console.error("Failed to load current stock:", stockError);
                if (!cancelled) setInitialStock([]);
            }
        };

        void loadCurrentStock();
        setError("");
        setDuplicateMatch(null);
        setDismissedDuplicateKey(null);

        return () => {
            cancelled = true;
        };
    }, [initialProduct]);

    const refreshDuplicateWarning = (nextForm: FormData) => {
        if (isEditing || !allowDuplicateWarning) {
            setDuplicateMatch(null);
            setDismissedDuplicateKey(null);
            return;
        }

        const candidate: Product = {
            id: initialProduct?.id ?? crypto.randomUUID(),
            name: nextForm.name,
            genericName: nextForm.genericName,
            category: nextForm.category,
            manufacturer: nextForm.manufacturer,
            nafdacNumber: nextForm.nafdacNumber,
            barcode: nextForm.barcode,
            sku: nextForm.sku,
            lowStockLevel: nextForm.lowStockLevel,
            trackBatches: nextForm.trackBatches,
            trackExpiry: nextForm.trackExpiry,
            status: nextForm.status,
            variants,
        };

        const nextMatch = findDuplicateMatch(candidate, existingProducts, initialProduct?.id);
        const nextKey = getDuplicateMatchKey(nextMatch);

        if (nextKey && dismissedDuplicateKey === nextKey) {
            setDuplicateMatch(null);
            return;
        }

        setDuplicateMatch(nextMatch);
    };

    const handleEnableMultiVariant = () => {
        setIsMultiVariant(true);
        if (variants.length === 1) {
            setVariants([variants[0], createInitialVariant()]);
        }
    };

    const addVariantField = () => {
        setVariants((prev) => [...prev, createInitialVariant()]);
    };

    const removeVariantField = (variantId: string) => {
        if (variants.length === 1) return;

        const variantToRemove = variants.find((v) => v.id === variantId);
        if (!variantToRemove) return;

        const packagingUnitIds = new Set(variantToRemove.packagingUnits.map((unit) => unit.id));

        setVariants((prev) => prev.filter((v) => v.id !== variantId));
        setInitialStock((prev) => prev.filter((stock) => !packagingUnitIds.has(stock.packagingUnitId)));
    };

    const handleVariantChange = (
        variantId: string,
        field: keyof Omit<Variant, "id" | "productId" | "packagingUnits">,
        value: string
    ) => {
        setVariants((prev) =>
            prev.map((variant) => (variant.id === variantId ? { ...variant, [field]: value } : variant))
        );
    };

    const addPackagingUnitField = (variantId: string) => {
        setVariants((prev) =>
            prev.map((variant) => {
                if (variant.id !== variantId) return variant;

                const newUnit: PackagingUnit = {
                    id: crypto.randomUUID(),
                    name: "",
                    costPrice: 0,
                    sellingPrice: 0,
                    isDefault: variant.packagingUnits.length === 0,
                };

                const previousUnit = variant.packagingUnits[variant.packagingUnits.length - 1];
                const updatedUnits = previousUnit
                    ? variant.packagingUnits.map((unit) =>
                        unit.id === previousUnit.id
                            ? { ...unit, contains: { quantity: unit.contains?.quantity ?? 1, unitId: newUnit.id } }
                            : unit
                    )
                    : variant.packagingUnits;

                return { ...variant, packagingUnits: [...updatedUnits, newUnit] };
            })
        );
    };

    const removePackagingUnitField = (variantId: string, unitId: string) => {
        setVariants((prev) =>
            prev.map((variant) => {
                if (variant.id !== variantId || variant.packagingUnits.length === 1) return variant;

                const filteredUnits = variant.packagingUnits.filter((unit) => unit.id !== unitId);
                const cleanedUnits = filteredUnits.map((unit, index) => {
                    if (index === filteredUnits.length - 1) {
                        return { ...unit, contains: undefined };
                    }

                    if (unit.contains?.unitId === unitId) {
                        return {
                            ...unit,
                            contains: {
                                quantity: unit.contains.quantity,
                                unitId: filteredUnits[index + 1].id,
                            },
                        };
                    }

                    return unit;
                });

                const remainingDefault = cleanedUnits.some((unit) => unit.isDefault);
                const nextUnits = remainingDefault
                    ? cleanedUnits
                    : cleanedUnits.map((unit, index) => ({
                        ...unit,
                        isDefault: index === 0,
                    }));

                return { ...variant, packagingUnits: nextUnits };
            })
        );

        setInitialStock((prev) => prev.filter((stock) => stock.packagingUnitId !== unitId));
    };

    const handlePackagingChange = (
        variantId: string,
        unitId: string,
        field: keyof PackagingUnit,
        value: PackagingUnit[keyof PackagingUnit]
    ) => {
        setVariants((prev) =>
            prev.map((variant) => {
                if (variant.id !== variantId) return variant;
                return {
                    ...variant,
                    packagingUnits: variant.packagingUnits.map((unit) =>
                        unit.id !== unitId ? unit : { ...unit, [field]: value }
                    ),
                };
            })
        );
    };

    const setDefaultPackaging = (variantId: string, unitId: string) => {
        setVariants((prev) =>
            prev.map((variant) => {
                if (variant.id !== variantId) return variant;

                const nextUnits = variant.packagingUnits.map((unit) => ({
                    ...unit,
                    isDefault: unit.id === unitId,
                }));

                const hasDefault = nextUnits.some((unit) => unit.isDefault);
                if (!hasDefault && nextUnits.length > 0) {
                    nextUnits[0].isDefault = true;
                }

                return { ...variant, packagingUnits: nextUnits };
            })
        );
    };

    const handleContainsChange = (
        variantId: string,
        unitId: string,
        containsField: "quantity" | "unitId",
        value: string | number
    ) => {
        setVariants((prev) =>
            prev.map((variant) => {
                if (variant.id !== variantId) return variant;
                return {
                    ...variant,
                    packagingUnits: variant.packagingUnits.map((unit) => {
                        if (unit.id !== unitId) return unit;
                        const currentContains = unit.contains || { quantity: 1, unitId: "" };
                        return {
                            ...unit,
                            contains: {
                                ...currentContains,
                                [containsField]: containsField === "quantity" ? Number(value) : value,
                            },
                        };
                    }),
                };
            })
        );
    };

    const handleStockChange = (
        id: string,
        field: keyof InitialStockEntry,
        value: InitialStockEntry[keyof InitialStockEntry]
    ) => {
        setInitialStock((prev) => prev.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)));
    };

    const ensureInitialStockEntry = (unit: PackagingUnit, quantity = 1) => {
        setInitialStock((prev) => {
            const existingEntry = prev.find((stock) => stock.packagingUnitId === unit.id);
            if (existingEntry) {
                return prev.map((stock) =>
                    stock.packagingUnitId === unit.id
                        ? { ...stock, quantity: Number.isFinite(quantity) ? quantity : stock.quantity }
                        : stock
                );
            }

            return [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    packagingUnitId: unit.id,
                    quantity: Number.isFinite(quantity) ? quantity : 1,
                    batchNumber: "",
                    expiryDate: "",
                    costPrice: unit.costPrice || 0,
                    sellingPrice: unit.sellingPrice || 0,
                },
            ];
        });
    };

    const updateOrCreateStockField = (
        unit: PackagingUnit,
        field: "batchNumber" | "expiryDate",
        value: string,
        quantity = 1
    ) => {
        const existingEntry = initialStock.find((stock) => stock.packagingUnitId === unit.id);
        if (existingEntry) {
            handleStockChange(existingEntry.id, field, value);
            return;
        }

        setInitialStock((prev) => [...prev, {
            id: crypto.randomUUID(),
            packagingUnitId: unit.id,
            quantity,
            batchNumber: field === "batchNumber" ? value : "",
            expiryDate: field === "expiryDate" ? value : "",
            costPrice: unit.costPrice || 0,
            sellingPrice: unit.sellingPrice || 0,
        }]);
    };

    const getVariantStockEntries = (variantId: string) =>
        initialStock.filter((stock) =>
            variants
                .find((variant) => variant.id === variantId)
                ?.packagingUnits.some((unit) => unit.id === stock.packagingUnitId)
        );

    const getPackagingUnitLabel = (variantId: string, packagingUnitId: string) => {
        const variant = variants.find((item) => item.id === variantId);
        return variant?.packagingUnits.find((unit) => unit.id === packagingUnitId)?.name ?? "unit";
    };

    const handleDismissDuplicate = () => {
        const nextKey = getDuplicateMatchKey(duplicateMatch);
        if (nextKey) {
            setDismissedDuplicateKey(nextKey);
        }
        setDuplicateMatch(null);
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const trimmedName = form.name.trim();
        if (!trimmedName) {
            setError("Product Name is required");
            return;
        }

        if (!form.category.trim()) {
            setError("Category is required");
            return;
        }

        const trimmedBarcode = (form.barcode ?? "").trim();
        const candidate: Product = {
            id: initialProduct?.id ?? crypto.randomUUID(),
            name: trimmedName,
            genericName: form.genericName.trim(),
            category: form.category.trim(),
            manufacturer: form.manufacturer.trim(),
            nafdacNumber: form.nafdacNumber.trim(),
            barcode: trimmedBarcode || undefined,
            sku: form.sku ?? "",
            lowStockLevel: form.lowStockLevel,
            trackBatches: form.trackBatches,
            trackExpiry: form.trackExpiry,
            status: form.status,
            variants,
        };

        if (!isEditing) {
            const currentDuplicateMatch = findDuplicateMatch(candidate, existingProducts, initialProduct?.id);
            const currentDuplicateKey = getDuplicateMatchKey(currentDuplicateMatch);

            if (currentDuplicateMatch && currentDuplicateKey !== dismissedDuplicateKey) {
                setDuplicateMatch(currentDuplicateMatch);
                setError("A possible duplicate product was detected. Review the warning and choose an action before continuing.");
                return;
            }

            const barcodeResult =
                trimmedBarcode !== "" &&
                existingProducts.some((product) =>
                    normalizeBarcodeValue(product.barcode ?? "") === normalizeBarcodeValue(trimmedBarcode) &&
                    product.id !== initialProduct?.id
                );
            if (barcodeResult && currentDuplicateKey !== dismissedDuplicateKey) {
                setError("Product with this barcode already exists");
                return;
            }
        }

        for (const variant of variants) {
            const packagingUnits = variant.packagingUnits;

            for (let index = 0; index < packagingUnits.length; index++) {
                const unit = packagingUnits[index];

                if (!unit.name.trim()) {
                    setError("Every packaging unit must have a name");
                    return;
                }

                const isSmallestUnit = index === packagingUnits.length - 1;
                if (isSmallestUnit) {
                    if (unit.contains) {
                        setError(`The smallest packaging unit (${unit.name}) cannot contain another unit.`);
                        return;
                    }
                    continue;
                }

                if (!unit.contains?.quantity || unit.contains.quantity <= 0) {
                    setError(`Enter a valid contains quantity for ${unit.name || "packaging unit"}`);
                    return;
                }

                if (!unit.contains.unitId) {
                    setError(`Select what ${unit.name || "packaging unit"} contains`);
                    return;
                }

                if (unit.contains.unitId === unit.id) {
                    setError(`${unit.name || "This packaging unit"} cannot contain itself.`);
                    return;
                }

                const nextSmallerUnit = packagingUnits[index + 1];
                if (unit.contains.unitId !== nextSmallerUnit.id) {
                    setError(`${unit.name || "This packaging unit"} must contain ${nextSmallerUnit.name || "the next packaging unit"}.`);
                    return;
                }
            }
        }

        const targetProductId = initialProduct?.id ?? crypto.randomUUID();
        const preparedVariants: Variant[] = variants.map((variant) => ({
            ...variant,
            productId: targetProductId,
        }));

        const savedProduct: Product = {
            id: targetProductId,
            name: trimmedName,
            genericName: form.genericName.trim(),
            category: form.category.trim(),
            manufacturer: form.manufacturer.trim(),
            nafdacNumber: form.nafdacNumber.trim(),
            barcode: trimmedBarcode,
            sku: form.sku,
            lowStockLevel: form.lowStockLevel,
            trackBatches: form.trackBatches,
            trackExpiry: form.trackExpiry,
            status: form.status,
            variants: preparedVariants,
        };

        try {
            setError("");
            await onSave(savedProduct, initialStock);
        } catch (submitError) {
            console.error(submitError);
            setError(submitError instanceof Error ? submitError.message : "Something went wrong while saving the product");
        }
    };

    const duplicateWarningTitle =
        duplicateMatch?.type === "both"
            ? "This product already exists."
            : duplicateMatch?.type === "conflict"
                ? "Potential product conflict detected."
                : "This product may already exist.";

    const primarySuggestion = duplicateMatch?.primaryProduct ?? null;
    const canUseExistingAction = primarySuggestion && duplicateMatch?.type !== "conflict";
    const canModifyExistingAction = primarySuggestion && duplicateMatch?.type !== "conflict";

    return (
        <form onSubmit={handleSubmit}>
            <h3>{isEditing ? "Edit Product" : "Create Product"}</h3>

            {!isEditing && allowDuplicateWarning && duplicateMatch && (
                <div style={{ marginBottom: 12, border: "1px solid #d7b55e", background: "#fff9eb", padding: 12, borderRadius: 6 }}>
                    <p style={{ marginTop: 0, marginBottom: 8 }}><strong>{duplicateWarningTitle}</strong></p>

                    {duplicateMatch.type === "both" && primarySuggestion && (
                        <p style={{ margin: "0 0 8px" }}>
                            Both the product name and barcode match <strong>{primarySuggestion.name}</strong>.
                        </p>
                    )}

                    {duplicateMatch.type === "name" && duplicateMatch.matchingProducts.length > 0 && (
                        <p style={{ margin: "0 0 8px" }}>
                            Product name matches: {duplicateMatch.matchingProducts.map((product) => product.name).join(", ")}
                        </p>
                    )}

                    {duplicateMatch.type === "barcode" && primarySuggestion && (
                        <p style={{ margin: "0 0 8px" }}>
                            Barcode belongs to: <strong>{primarySuggestion.name}</strong>
                        </p>
                    )}

                    {duplicateMatch.type === "conflict" && (
                        <>
                            <p style={{ margin: "0 0 4px" }}>
                                Product name matches: {duplicateMatch.nameMatches.map((product) => product.name).join(", ")}
                            </p>
                            <p style={{ margin: "0 0 8px" }}>
                                Barcode belongs to: {duplicateMatch.barcodeMatches.map((product) => product.name).join(", ")}
                            </p>
                        </>
                    )}

                    {duplicateMatch.matchingProducts.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                            {duplicateMatch.matchingProducts.map((product) => (
                                <div key={product.id} style={{ marginBottom: 6, padding: 6, border: "1px solid #f0d68d", background: "#fffdf5" }}>
                                    <strong>{product.name}</strong>
                                    <div>{formatProductSummary(product)}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {canUseExistingAction && onUseExistingProduct && primarySuggestion && (
                            <button type="button" onClick={() => onUseExistingProduct(primarySuggestion)}>
                                Use Existing Product
                            </button>
                        )}
                        {canModifyExistingAction && onModifyExistingProduct && primarySuggestion && (
                            <button type="button" onClick={() => onModifyExistingProduct(primarySuggestion)}>
                                Modify Existing Product
                            </button>
                        )}
                        <button type="button" onClick={handleDismissDuplicate}>
                            Create New Product Anyway
                        </button>
                    </div>
                </div>
            )}

            <h4>1. Product Information</h4>

            <label>Product Name *:</label>
            <input
                type="text"
                value={form.name}
                onChange={(event) => {
                    const nextForm = { ...form, name: event.target.value };
                    setForm(nextForm);
                    refreshDuplicateWarning(nextForm);
                }}
            />

            <label>Category *:</label>
            <input
                type="text"
                value={form.category}
                onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
            />

            <label>Generic Name:</label>
            <input
                type="text"
                value={form.genericName}
                onChange={(event) => setForm((prev) => ({ ...prev, genericName: event.target.value }))}
            />

            <label>Manufacturer:</label>
            <input
                type="text"
                value={form.manufacturer}
                onChange={(event) => setForm((prev) => ({ ...prev, manufacturer: event.target.value }))}
            />

            <label>NAFDAC Number:</label>
            <input
                type="text"
                value={form.nafdacNumber}
                onChange={(event) => setForm((prev) => ({ ...prev, nafdacNumber: event.target.value }))}
            />

            <label>Barcode:</label>
            <input
                type="text"
                value={form.barcode ?? ""}
                onChange={(event) => {
                    const nextForm = { ...form, barcode: event.target.value };
                    setForm(nextForm);
                    refreshDuplicateWarning(nextForm);
                }}
            />

            <label>SKU:</label>
            <input
                type="text"
                value={form.sku ?? ""}
                onChange={(event) => setForm((prev) => ({ ...prev, sku: event.target.value }))}
            />

            <label>Low Stock Level:</label>
            <input
                type="number"
                min="0"
                value={form.lowStockLevel ?? 0}
                onChange={(event) => setForm((prev) => ({ ...prev, lowStockLevel: Number(event.target.value) }))}
            />

            <label>
                <input
                    type="checkbox"
                    checked={Boolean(form.trackBatches)}
                    onChange={(event) => setForm((prev) => ({ ...prev, trackBatches: event.target.checked }))}
                />
                Track Batches
            </label>

            <label>
                <input
                    type="checkbox"
                    checked={Boolean(form.trackExpiry)}
                    onChange={(event) => setForm((prev) => ({ ...prev, trackExpiry: event.target.checked }))}
                />
                Track Expiry
            </label>

            <label>Status:</label>
            <select
                value={form.status ?? "active"}
                onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as "active" | "archived" }))}
            >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
            </select>

            <h4>2. {isEditing ? "Current Stock" : "Initial Stock"}</h4>
            {variants.map((variant, index) => {
                const stockEntry = getVariantStockEntries(variant.id)[0];
                const selectedUnit = stockEntry
                    ? variant.packagingUnits.find((unit) => unit.id === stockEntry.packagingUnitId)
                    : variant.packagingUnits[0];

                return (
                    <div key={variant.id} style={{ marginBottom: 16 }}>
                        {variants.length > 1 && <h5>Variant #{index + 1}</h5>}

                        <label>Packaging:</label>
                        <select
                            value={stockEntry?.packagingUnitId ?? selectedUnit?.id ?? ""}
                            onChange={(event) => {
                                const nextUnitId = event.target.value;
                                if (!nextUnitId) return;

                                if (stockEntry) {
                                    handleStockChange(stockEntry.id, "packagingUnitId", nextUnitId);
                                    return;
                                }

                                const packageUnit = variant.packagingUnits.find((unit) => unit.id === nextUnitId);
                                if (!packageUnit) return;
                                ensureInitialStockEntry(packageUnit);
                            }}
                        >
                            <option value="">Select packaging unit...</option>
                            {variant.packagingUnits.map((unit) => (
                                <option key={unit.id} value={unit.id}>
                                    {unit.name || "Unnamed Unit"}
                                </option>
                            ))}
                        </select>

                        <label>Quantity:</label>
                        <input
                            type="number"
                            min="1"
                            value={stockEntry ? stockEntry.quantity : ""}
                            onChange={(event) => {
                                const nextQuantity = Number(event.target.value);
                                const selectedPackagingUnit = stockEntry
                                    ? variant.packagingUnits.find((unit) => unit.id === stockEntry.packagingUnitId)
                                    : selectedUnit;

                                if (!selectedPackagingUnit) return;

                                if (!stockEntry) {
                                    ensureInitialStockEntry(selectedPackagingUnit, nextQuantity);
                                    return;
                                }

                                handleStockChange(stockEntry.id, "quantity", nextQuantity);
                            }}
                        />

                        <label>Batch Number:</label>
                        <input
                            type="text"
                            value={stockEntry?.batchNumber ?? ""}
                            onChange={(event) => {
                                const unit = stockEntry
                                    ? variant.packagingUnits.find((item) => item.id === stockEntry.packagingUnitId)
                                    : selectedUnit;
                                if (unit) updateOrCreateStockField(unit, "batchNumber", event.target.value, stockEntry?.quantity ?? 1);
                            }}
                        />

                        <label>Expiry Date:</label>
                        <input
                            type="date"
                            value={stockEntry?.expiryDate ?? ""}
                            onChange={(event) => {
                                const unit = stockEntry
                                    ? variant.packagingUnits.find((item) => item.id === stockEntry.packagingUnitId)
                                    : selectedUnit;
                                if (unit) updateOrCreateStockField(unit, "expiryDate", event.target.value, stockEntry?.quantity ?? 1);
                            }}
                        />
                        {stockEntry?.expiryDate && <span>{formatExpiryStatus(stockEntry.expiryDate)}</span>}

                        <p>
                            So you are starting with: {stockEntry ? `${stockEntry.quantity} ${getPackagingUnitLabel(variant.id, stockEntry.packagingUnitId)}` : "Select a packaging unit"}
                        </p>
                    </div>
                );
            })}

            <h4>3. Variants & Packaging</h4>

            {!isMultiVariant ? (
                <div>
                    <label>Form:</label>
                    <input
                        type="text"
                        placeholder="e.g. Tablet, Syrup"
                        value={variants[0].form || ""}
                        onChange={(event) => handleVariantChange(variants[0].id, "form", event.target.value)}
                    />

                    <label>Strength:</label>
                    <input
                        type="text"
                        placeholder="e.g. 500"
                        value={variants[0].strength || ""}
                        onChange={(event) => handleVariantChange(variants[0].id, "strength", event.target.value)}
                    />

                    <label>Strength Unit:</label>
                    <input
                        type="text"
                        placeholder="e.g. mg, ml"
                        value={variants[0].strengthUnit || ""}
                        onChange={(event) => handleVariantChange(variants[0].id, "strengthUnit", event.target.value)}
                    />

                    <h5>Packaging</h5>
                    {variants[0].packagingUnits.map((unit, packageIndex) => {
                        const isSmallest = packageIndex === variants[0].packagingUnits.length - 1;
                        const nextSmallerUnit = variants[0].packagingUnits[packageIndex + 1];
                        return (
                            <div key={unit.id}>
                                <label>Unit Name:</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Box, Packet"
                                    value={unit.name}
                                    onChange={(event) => handlePackagingChange(variants[0].id, unit.id, "name", event.target.value)}
                                />

                                {!isSmallest && nextSmallerUnit && (
                                    <div>
                                        <label>Contains ({nextSmallerUnit.name || "next smaller unit"}):</label>
                                        <input
                                            type="number"
                                            min="1"
                                            value={unit.contains?.quantity || ""}
                                            onChange={(event) => handleContainsChange(variants[0].id, unit.id, "quantity", event.target.value)}
                                        />
                                        <p>
                                            1 {unit.name || "unit"} contains {unit.contains?.quantity || "?"} {nextSmallerUnit.name || "unit"}
                                        </p>
                                    </div>
                                )}

                                {isSmallest && <p>This is the smallest packaging unit.</p>}

                                <label>Cost Price:</label>
                                <input
                                    type="number"
                                    value={unit.costPrice ?? 0}
                                    onChange={(event) => handlePackagingChange(variants[0].id, unit.id, "costPrice", Number(event.target.value))}
                                />

                                <label>Selling Price:</label>
                                <input
                                    type="number"
                                    value={unit.sellingPrice ?? 0}
                                    onChange={(event) => handlePackagingChange(variants[0].id, unit.id, "sellingPrice", Number(event.target.value))}
                                />

                                <button
                                    type="button"
                                    onClick={() => removePackagingUnitField(variants[0].id, unit.id)}
                                    disabled={variants[0].packagingUnits.length === 1}
                                >
                                    Remove Packaging Level
                                </button>
                            </div>
                        );
                    })}

                    <button type="button" onClick={() => addPackagingUnitField(variants[0].id)}>
                        + Add Nested Packaging Level
                    </button>
                    <br /><br />
                    <button type="button" onClick={handleEnableMultiVariant}>
                        + Add Multiple Variants
                    </button>
                </div>
            ) : (
                <div>
                    {variants.map((variant, index) => (
                        <div key={variant.id}>
                            <h5>Variant #{index + 1}</h5>
                            <label>Strength:</label>
                            <input
                                type="text"
                                placeholder="e.g. 500"
                                value={variant.strength || ""}
                                onChange={(event) => handleVariantChange(variant.id, "strength", event.target.value)}
                            />

                            <label>Strength Unit:</label>
                            <input
                                type="text"
                                placeholder="e.g. mg, ml"
                                value={variant.strengthUnit || ""}
                                onChange={(event) => handleVariantChange(variant.id, "strengthUnit", event.target.value)}
                            />

                            <label>Form:</label>
                            <input
                                type="text"
                                placeholder="e.g. Tablet, Syrup"
                                value={variant.form || ""}
                                onChange={(event) => handleVariantChange(variant.id, "form", event.target.value)}
                            />

                            <button
                                type="button"
                                onClick={() => removeVariantField(variant.id)}
                                disabled={variants.length === 1}
                            >
                                Remove Variant
                            </button>

                            <div>
                                <h6>Packaging Levels</h6>
                                {variant.packagingUnits.map((unit, packageIndex) => {
                                    const isSmallest = packageIndex === variant.packagingUnits.length - 1;
                                    const nextSmallerUnit = variant.packagingUnits[packageIndex + 1];
                                    return (
                                        <div key={unit.id}>
                                            <label>Unit Name:</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. Box, Packet"
                                                value={unit.name}
                                                onChange={(event) => handlePackagingChange(variant.id, unit.id, "name", event.target.value)}
                                            />

                                            {!isSmallest && nextSmallerUnit && (
                                                <div>
                                                    <label>Contains ({nextSmallerUnit.name || "next smaller unit"}):</label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        value={unit.contains?.quantity || ""}
                                                        onChange={(event) => handleContainsChange(variant.id, unit.id, "quantity", event.target.value)}
                                                    />
                                                    <p>
                                                        1 {unit.name || "unit"} contains {unit.contains?.quantity || "?"} {nextSmallerUnit.name || "unit"}
                                                    </p>
                                                </div>
                                            )}

                                            {isSmallest && <p>This is the smallest packaging unit.</p>}

                                            <label>Cost Price:</label>
                                            <input
                                                type="number"
                                                value={unit.costPrice ?? 0}
                                                onChange={(event) => handlePackagingChange(variant.id, unit.id, "costPrice", Number(event.target.value))}
                                            />

                                            <label>Selling Price:</label>
                                            <input
                                                type="number"
                                                value={unit.sellingPrice ?? 0}
                                                onChange={(event) => handlePackagingChange(variant.id, unit.id, "sellingPrice", Number(event.target.value))}
                                            />

                                            <label>
                                                <input
                                                    type="radio"
                                                    name={`default-unit-${variant.id}`}
                                                    checked={unit.isDefault}
                                                    onChange={() => setDefaultPackaging(variant.id, unit.id)}
                                                />
                                                Default Unit
                                            </label>

                                            <button
                                                type="button"
                                                onClick={() => removePackagingUnitField(variant.id, unit.id)}
                                                disabled={variant.packagingUnits.length === 1}
                                            >
                                                Remove Packaging Level
                                            </button>
                                        </div>
                                    );
                                })}

                                <button type="button" onClick={() => addPackagingUnitField(variant.id)}>
                                    + Add Packaging Level
                                </button>
                            </div>
                        </div>
                    ))}

                    <button type="button" onClick={addVariantField}>
                        + Add Variant
                    </button>
                </div>
            )}

            {error && <p>{error}</p>}

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button type="submit">{isEditing ? "Save" : "Create Product"}</button>
                <button type="button" onClick={onCancel}>Cancel</button>
            </div>
        </form>
    );
};

export default CreateProductForm;
