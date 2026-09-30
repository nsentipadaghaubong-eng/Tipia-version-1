import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type { Product, Sale, SaleItem } from "../types/Product";
import {
    createSale,
    deleteSaleDraft,
    getAvailableQuantityInUnit,
    getCurrentStockForAllProducts,
    getProducts,
    getSales,
    getSaleStockAllocationPreview,
    initializeDatabase,
    INVENTORY_CHANGED_EVENT,
    PENDING_TASKS_CHANGED_EVENT,
    saveSaleDraft,
    type CurrentStockEntry,
    type SaleStockAllocation,
} from "../database/database";
import { calculateStockBreakdown } from "../domain/stockBreakdown";
import { calculateSaleAmounts, calculateSaleLineAmount } from "../domain/saleCalculations";
import { isValidExpiryDate } from "../domain/expirySemantics";
import { formatExpiryStatus } from "../utils/expiry";

type SaleDraftItem = SaleItem & {
    productName: string;
    variantLabel: string;
    packagingUnitName: string;
};

type SaleHeader = { date: string; soldBy: string; notes: string; discount: number };

const today = () => new Date().toISOString().split("T")[0];

const formatVariantInfo = (variant: Product["variants"][number] | undefined) =>
    [variant?.strength, variant?.strengthUnit, variant?.form]
        .filter((value) => value?.trim())
        .join(" ");

const orderVariantsByExpiry = (
    product: Product,
    stockByProduct: Record<string, CurrentStockEntry[]>
) => product.variants
    .map((variant, index) => {
        const expiryDate = (stockByProduct[product.id] ?? [])
            .filter((stock) => stock.variantId === variant.id && stock.quantity > 0)
            .map((stock) => stock.expiryDate?.trim() ?? "")
            .filter(isValidExpiryDate)
            .sort()[0];
        return { variant, index, expiryDate };
    })
    .sort((left, right) => {
        if (left.expiryDate && right.expiryDate) {
            return left.expiryDate.localeCompare(right.expiryDate) || left.index - right.index;
        }
        if (left.expiryDate) return -1;
        if (right.expiryDate) return 1;
        return left.index - right.index;
    })
    .map(({ variant }) => variant);

const SalesPage = () => {
    const location = useLocation();
    const routeState = location.state as { draftType?: string; draftId?: string } | null;
    const requestedDraftId = routeState?.draftType === "sale" ? routeState.draftId : undefined;
    const [products, setProducts] = useState<Product[]>([]);
    const [stockByProduct, setStockByProduct] = useState<Record<string, CurrentStockEntry[]>>({});
    const [sales, setSales] = useState<Sale[]>([]);
    const [productSearch, setProductSearch] = useState("");
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [selectedVariantId, setSelectedVariantId] = useState("");
    const [selectedPackagingUnitId, setSelectedPackagingUnitId] = useState("");
    const [quantity, setQuantity] = useState(1);
    const [unitPrice, setUnitPrice] = useState(0);
    const [saleDate, setSaleDate] = useState(today());
    const [soldBy, setSoldBy] = useState("");
    const [notes, setNotes] = useState("");
    const [discount, setDiscount] = useState(0);
    const [cart, setCart] = useState<SaleDraftItem[]>([]);
    const [editingSaleItemId, setEditingSaleItemId] = useState<string | null>(null);
    const [historyExpanded, setHistoryExpanded] = useState(false);
    const [historySearch, setHistorySearch] = useState("");
    const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [allocationPreview, setAllocationPreview] = useState<SaleStockAllocation[] | null>(null);
    const [allocationError, setAllocationError] = useState("");
    const [isDraftSaving, setIsDraftSaving] = useState(false);
    const draftSaleIdRef = useRef<string | null>(null);
    const draftWriteQueue = useRef<Promise<void>>(Promise.resolve());
    const addInProgress = useRef(false);

    const refreshSales = async () => {
        setSales((await getSales()).filter((sale) => sale.status !== "draft"));
    };

    const enqueueDraftWrite = <T,>(write: () => Promise<T>) => {
        const operation = draftWriteQueue.current.then(write);
        draftWriteQueue.current = operation.then(() => undefined, () => undefined);
        return operation;
    };

    const persistDraftSnapshot = async (
        items: SaleDraftItem[],
        header: SaleHeader,
        requestedId?: string
    ) => {
        if (items.length === 0) return;

        const id = requestedId ?? draftSaleIdRef.current ?? crypto.randomUUID();
        draftSaleIdRef.current = id;
        const amounts = calculateSaleAmounts(items, header.discount);
        const sale: Sale = {
            id,
            date: header.date,
            soldBy: header.soldBy.trim() || undefined,
            notes: header.notes.trim() || undefined,
            discount: header.discount,
            totalAmount: amounts.grandTotal,
            status: "draft",
            items: items.map(({ productName, variantLabel, packagingUnitName, ...item }) => ({
                ...item,
                saleId: id,
            })),
        };

        await enqueueDraftWrite(() => saveSaleDraft(sale));
        window.dispatchEvent(new Event(PENDING_TASKS_CHANGED_EVENT));
    };

    const persistCurrentDraft = (items: SaleDraftItem[], header: SaleHeader) => {
        if (!draftSaleIdRef.current || items.length === 0) return;
        void persistDraftSnapshot(items, header).catch((saveError) => {
            setError(saveError instanceof Error ? saveError.message : "Failed to save the sale draft.");
        });
    };

    useEffect(() => {
        const loadData = async () => {
            try {
                await initializeDatabase();
                const [productsFromDb, salesFromDb, stockFromDb] = await Promise.all([
                    getProducts(),
                    getSales(),
                    getCurrentStockForAllProducts(),
                ]);
                setProducts(productsFromDb);
                setStockByProduct(stockFromDb);
                setSales(salesFromDb.filter((sale) => sale.status !== "draft"));

                const draft = requestedDraftId
                    ? salesFromDb.find((sale) => sale.id === requestedDraftId && sale.status === "draft")
                    : salesFromDb.find((sale) => sale.status === "draft");

                if (requestedDraftId && !draft) {
                    setError("The selected sale draft is no longer available.");
                    return;
                }

                if (draft) {
                    draftSaleIdRef.current = draft.id;
                    setSaleDate(draft.date);
                    setSoldBy(draft.soldBy ?? "");
                    setNotes(draft.notes ?? "");
                    setDiscount(draft.discount ?? 0);
                    setCart(draft.items.map((item) => {
                        const product = productsFromDb.find((entry) => entry.id === item.productId);
                        const variant = product?.variants.find((entry) => entry.id === item.variantId);
                        const unit = variant?.packagingUnits.find((entry) => entry.id === item.packagingUnitId);
                        return {
                            ...item,
                            productName: product?.name ?? "Unknown product",
                            variantLabel: formatVariantInfo(variant),
                            packagingUnitName: unit?.name ?? "Unnamed Unit",
                        };
                    }));
                }
            } catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : "Failed to load sales data");
            }
        };

        void loadData();
        const refreshStock = () => {
            void getCurrentStockForAllProducts().then(setStockByProduct).catch((loadError) => {
                console.error("Failed to refresh stock for Sales variant ordering:", loadError);
            });
        };
        window.addEventListener(INVENTORY_CHANGED_EVENT, refreshStock);
        return () => window.removeEventListener(INVENTORY_CHANGED_EVENT, refreshStock);
    }, []);

    const filteredProducts = useMemo(() => {
        const search = productSearch.trim().toLowerCase();
        if (!search) return [];

        return products.filter((product) => [
            product.name,
            product.genericName,
            product.barcode ?? "",
            product.manufacturer,
        ].some((value) => value.toLowerCase().includes(search)));
    }, [productSearch, products]);

    const orderedVariants = selectedProduct ? orderVariantsByExpiry(selectedProduct, stockByProduct) : [];
    const activeVariant = orderedVariants.find((variant) => variant.id === selectedVariantId)
        ?? orderedVariants[0];
    const packagingUnits = activeVariant?.packagingUnits ?? [];
    const selectedPackagingUnit = packagingUnits.find((unit) => unit.id === selectedPackagingUnitId)
        ?? packagingUnits[0];
    const stockBreakdown = selectedProduct && activeVariant
        ? calculateStockBreakdown(
            (stockByProduct[selectedProduct.id] ?? [])
                .filter((stock) => stock.variantId === activeVariant.id)
                .map((stock) => ({
                    packagingUnitId: stock.packagingUnitId,
                    quantity: stock.quantity,
                })),
            activeVariant.packagingUnits
        )
        : [];
    const stockBreakdownText = stockBreakdown.length > 0
        ? stockBreakdown.map(({ quantity: count, packagingUnitName }) =>
            `${count} ${packagingUnitName || "unit"}${count === 1 ? "" : "s"}`
        ).join(" + ")
        : "0";
    const hasMeaningfulVariantInfo = selectedProduct?.variants.some((variant) =>
        [variant.strength, variant.strengthUnit, variant.form].some((value) => value?.trim())
    ) ?? false;

    useEffect(() => {
        if (!selectedProduct || !activeVariant || !selectedPackagingUnit) {
            setAllocationPreview(null);
            setAllocationError("");
            return;
        }

        let isCurrent = true;
        const loadAllocationPreview = async () => {
            try {
                const allocation = await getSaleStockAllocationPreview(
                    selectedProduct.id,
                    activeVariant.id,
                    selectedPackagingUnit.id,
                    quantity
                );
                if (isCurrent) {
                    setAllocationPreview(allocation);
                    setAllocationError("");
                }
            } catch (previewError) {
                if (isCurrent) {
                    setAllocationPreview(null);
                    setAllocationError(previewError instanceof Error ? previewError.message : "Unable to preview FEFO allocation.");
                }
            }
        };

        void loadAllocationPreview();
        return () => {
            isCurrent = false;
        };
    }, [selectedProduct?.id, activeVariant?.id, selectedPackagingUnit?.id, quantity]);

    const { subtotal, grandTotal } = calculateSaleAmounts(cart, discount);

    const selectProduct = (product: Product) => {
        const variant = orderVariantsByExpiry(product, stockByProduct)[0];
        const packagingUnit = variant?.packagingUnits.find((unit) => unit.isDefault)
            ?? variant?.packagingUnits[0];

        setSelectedProduct(product);
        setSelectedVariantId(variant?.id ?? "");
        setSelectedPackagingUnitId(packagingUnit?.id ?? "");
        setUnitPrice(packagingUnit?.sellingPrice ?? 0);
        setQuantity(1);
        setEditingSaleItemId(null);
        setProductSearch("");
        setError(product.variants.length === 0 || !variant || variant.packagingUnits.length === 0
            ? "This product has no packaging units configured for sale."
            : "");
        setMessage("");
    };

    const selectVariant = (variantId: string) => {
        const variant = selectedProduct?.variants.find((entry) => entry.id === variantId);
        const packagingUnit = variant?.packagingUnits.find((unit) => unit.isDefault)
            ?? variant?.packagingUnits[0];

        setSelectedVariantId(variantId);
        setSelectedPackagingUnitId(packagingUnit?.id ?? "");
        setUnitPrice(packagingUnit?.sellingPrice ?? 0);
    };

    const editSaleItem = (item: SaleDraftItem) => {
        const product = products.find((entry) => entry.id === item.productId);
        const variant = product?.variants.find((entry) => entry.id === item.variantId);
        const packagingUnit = variant?.packagingUnits.find((entry) => entry.id === item.packagingUnitId);
        if (!product || !variant || !packagingUnit) {
            setError("This sale item can no longer be edited because its product setup is unavailable.");
            return;
        }

        setSelectedProduct(product);
        setSelectedVariantId(variant.id);
        setSelectedPackagingUnitId(packagingUnit.id);
        setQuantity(item.quantity);
        setUnitPrice(item.unitPrice);
        setEditingSaleItemId(item.id);
        setProductSearch("");
        setError("");
        setMessage("");
    };

    const selectPackagingUnit = (unitId: string) => {
        const unit = packagingUnits.find((entry) => entry.id === unitId);
        setSelectedPackagingUnitId(unitId);
        setUnitPrice(unit?.sellingPrice ?? 0);
    };

    const addToSale = async () => {
        if (addInProgress.current) return;
        if (!selectedProduct || !activeVariant || !selectedPackagingUnit) {
            setError(activeVariant && packagingUnits.length === 0
                ? "This product has no packaging units configured — add one before selling it."
                : "Select a product and packaging unit first");
            return;
        }
        if (!Number.isInteger(quantity) || quantity <= 0) {
            setError("Quantity must be greater than zero");
            return;
        }
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
            setError("Unit price cannot be negative");
            return;
        }

        addInProgress.current = true;
        try {
            const available = await getAvailableQuantityInUnit(
                selectedProduct.id,
                activeVariant.id,
                selectedPackagingUnitId
            );
            if (quantity > available) {
                setError(`Insufficient stock. Only ${available} ${selectedPackagingUnit.name || "unit"}(s) are available.`);
                addInProgress.current = false;
                return;
            }
        } catch (availabilityError) {
            setError(
                availabilityError instanceof Error
                    ? availabilityError.message
                    : "Unable to verify stock availability."
            );
            addInProgress.current = false;
            return;
        }

        const saleId = draftSaleIdRef.current ?? crypto.randomUUID();
        const nextItem = {
            id: editingSaleItemId ?? crypto.randomUUID(),
            saleId,
            productId: selectedProduct.id,
            variantId: activeVariant.id,
            packagingUnitId: selectedPackagingUnit.id,
            quantity,
            unitPrice,
            productName: selectedProduct.name,
            variantLabel: formatVariantInfo(activeVariant),
            packagingUnitName: selectedPackagingUnit.name || "Unnamed Unit",
        };
        const nextCart = editingSaleItemId
            ? cart.map((item) => item.id === editingSaleItemId ? nextItem : item)
            : [...cart, nextItem];

        setIsDraftSaving(true);
        try {
            await persistDraftSnapshot(nextCart, { date: saleDate, soldBy, notes, discount }, saleId);
            setCart(nextCart);
            setEditingSaleItemId(null);
            setError("");
            setMessage(editingSaleItemId ? "Sale item updated." : "Item added to sale.");
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Failed to save the sale draft.");
        } finally {
            addInProgress.current = false;
            setIsDraftSaving(false);
        }
    };

    const clearSale = async () => {
        const saleId = draftSaleIdRef.current;
        try {
            if (saleId) {
                await enqueueDraftWrite(() => deleteSaleDraft(saleId));
            }
            draftSaleIdRef.current = null;
            setCart([]);
            setEditingSaleItemId(null);
            setDiscount(0);
            setSaleDate(today());
            setSoldBy("");
            setNotes("");
            setSelectedProduct(null);
            setSelectedVariantId("");
            setSelectedPackagingUnitId("");
            setProductSearch("");
            setMessage("");
            setError("");
            if (saleId) window.dispatchEvent(new Event(PENDING_TASKS_CHANGED_EVENT));
        } catch (clearError) {
            setError(clearError instanceof Error ? clearError.message : "Failed to clear the sale draft.");
        }
    };

    const removeSaleItem = async (itemId: string) => {
        if (editingSaleItemId === itemId) setEditingSaleItemId(null);
        const nextCart = cart.filter((item) => item.id !== itemId);
        if (nextCart.length === 0) {
            await clearSale();
            return;
        }

        setCart(nextCart);
        persistCurrentDraft(nextCart, { date: saleDate, soldBy, notes, discount });
    };

    const completeSale = async () => {
        if (cart.length === 0) {
            setError("Add at least one item to the sale");
            return;
        }
        if (!saleDate.trim()) {
            setError("Date is required");
            return;
        }
        if (discount > subtotal) {
            setError("Discount cannot exceed the subtotal");
            return;
        }

        const saleId = draftSaleIdRef.current ?? crypto.randomUUID();
        const sale: Sale = {
            id: saleId,
            date: saleDate,
            soldBy: soldBy.trim() || undefined,
            totalAmount: grandTotal,
            discount,
            notes: notes.trim() || undefined,
            items: cart.map(({ productName, variantLabel, packagingUnitName, ...item }) => ({
                ...item,
                saleId,
            })),
        };

        setIsSaving(true);
        setError("");
        try {
            await draftWriteQueue.current;
            await createSale(sale);
            draftSaleIdRef.current = null;
            window.dispatchEvent(new Event(INVENTORY_CHANGED_EVENT));
            window.dispatchEvent(new Event(PENDING_TASKS_CHANGED_EVENT));
            await refreshSales();
            setCart([]);
            setDiscount(0);
            setSaleDate(today());
            setSoldBy("");
            setNotes("");
            setSelectedProduct(null);
            setSelectedVariantId("");
            setSelectedPackagingUnitId("");
            setProductSearch("");
            setMessage("Sale completed successfully.");
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Failed to complete sale");
        } finally {
            setIsSaving(false);
        }
    };

    const filteredHistory = sales.filter((sale) => {
        const term = historySearch.trim().toLowerCase();
        if (!term) return true;
        return [
            sale.date,
            sale.soldBy ?? "",
            sale.notes ?? "",
            sale.items.map((item) => products.find((product) => product.id === item.productId)?.name ?? "").join(" "),
        ].join(" ").toLowerCase().includes(term);
    });

    return (
        <div>
            <h1>New Sale</h1>

            <div>
                <h2>Sale Header</h2>
                <div>
                    <div>
                        <label htmlFor="sale-date">Date</label>
                        <input id="sale-date" type="date" value={saleDate} onChange={(event) => {
                            const nextDate = event.target.value;
                            setSaleDate(nextDate);
                            persistCurrentDraft(cart, { date: nextDate, soldBy, notes, discount });
                        }} />
                    </div>
                    <div>
                        <label htmlFor="sold-by">Sold by</label>
                        <input id="sold-by" type="text" value={soldBy} onChange={(event) => {
                            const nextSoldBy = event.target.value;
                            setSoldBy(nextSoldBy);
                            persistCurrentDraft(cart, { date: saleDate, soldBy: nextSoldBy, notes, discount });
                        }} />
                    </div>
                    <div>
                        <label htmlFor="sale-notes">Notes</label>
                        <textarea id="sale-notes" value={notes} onChange={(event) => {
                            const nextNotes = event.target.value;
                            setNotes(nextNotes);
                            persistCurrentDraft(cart, { date: saleDate, soldBy, notes: nextNotes, discount });
                        }} rows={2} />
                    </div>
                </div>
            </div>

            <div>
                <h2>Product Search</h2>
                <div>
                    <label htmlFor="product-search">Search by name, generic name, barcode, or manufacturer</label>
                    <input
                        id="product-search"
                        type="search"
                        placeholder="Search products..."
                        value={productSearch}
                        onChange={(event) => setProductSearch(event.target.value)}
                    />
                    {productSearch.trim() && (
                        <div>
                            {filteredProducts.length > 0 ? filteredProducts.map((product) => (
                                <button key={product.id} type="button" onClick={() => selectProduct(product)}>
                                    <strong>{product.name}</strong> <span>{product.genericName}</span>
                                </button>
                            )) : <div>No product found.</div>}
                        </div>
                    )}
                </div>
                {selectedProduct && <div>Selected: {selectedProduct.name}</div>}
                {selectedProduct && activeVariant && (
                    <div>
                        <h3>Available Stock</h3>
                        {activeVariant.packagingUnits.length > 0 ? (
                            <div>
                                {stockBreakdownText}
                            </div>
                        ) : (
                            <div>No packaging units configured</div>
                        )}
                    </div>
                )}
            </div>

            {selectedProduct && (
                <div>
                    <h2>Item Entry</h2>
                    <div>
                        {hasMeaningfulVariantInfo && (
                            <div>
                                <label htmlFor="sale-variant">Variant</label>
                                <select id="sale-variant" value={activeVariant?.id ?? ""} onChange={(event) => selectVariant(event.target.value)}>
                                    {orderedVariants.map((variant) => (
                                        <option key={variant.id} value={variant.id}>{formatVariantInfo(variant) || "Default Variant"}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div>
                            <label htmlFor="sale-packaging">Packaging Unit</label>
                            <select id="sale-packaging" value={selectedPackagingUnit?.id ?? ""} onChange={(event) => selectPackagingUnit(event.target.value)}>
                                {packagingUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name || "Unnamed Unit"}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="sale-quantity">Quantity</label>
                            <input id="sale-quantity" type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
                        </div>
                        <div>
                            <label htmlFor="sale-unit-price">Unit Price</label>
                            <input id="sale-unit-price" type="number" min="0" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(Number(event.target.value))} />
                        </div>
                    </div>
                    {packagingUnits.length === 0 ? (
                        <p>This product has no packaging units configured — add one before selling it.</p>
                    ) : (
                        <div>
                            <h3>FEFO Allocation Preview</h3>
                            {allocationError ? <p>{allocationError}</p> : allocationPreview?.length ? allocationPreview.map((allocation, index) => (
                                <p key={`${allocation.batchNumber ?? "no-batch"}-${allocation.expiryDate ?? "no-expiry"}-${index}`}>
                                    {allocation.batchNumber || "Batch not recorded"}
                                    {allocation.expiryDate ? ` — ${formatExpiryStatus(allocation.expiryDate)}` : " — No expiry recorded"}
                                    {` — ${allocation.quantity} ${selectedPackagingUnit?.name ?? ""}`}
                                </p>
                            )) : allocationPreview ? <p>No stock is available for this sale.</p> : <p>Calculating allocation...</p>}
                            <p>Preview only. Inventory is rechecked when the sale is completed.</p>
                        </div>
                    )}
                    <button type="button" disabled={isDraftSaving || !selectedPackagingUnit || packagingUnits.length === 0} onClick={() => void addToSale()}>{isDraftSaving ? "Saving..." : "Add to Sale"}</button>
                </div>
            )}

            <div>
                <h2>Current Sale ({cart.length})</h2>
                {cart.length === 0 ? <p>No items added.</p> : cart.map((item) => (
                    <div key={item.id}>
                        <div>
                            <strong>{item.productName}{item.variantLabel ? ` (${item.variantLabel})` : ""}</strong>
                            <span>{item.packagingUnitName} | {item.quantity} x ₦{item.unitPrice.toFixed(2)} = ₦{calculateSaleLineAmount(item.quantity, item.unitPrice).toFixed(2)}</span>
                        </div>
                        <button type="button" onClick={() => editSaleItem(item)}>Edit</button>
                        <button type="button" onClick={() => void removeSaleItem(item.id)}>Remove</button>
                    </div>
                ))}

                <div>
                    <div><label>Subtotal</label><strong>₦{subtotal.toFixed(2)}</strong></div>
                    <div><label htmlFor="sale-discount">Discount (₦)</label><input id="sale-discount" type="number" min="0" step="0.01" value={discount} onChange={(event) => {
                        const nextDiscount = Number(event.target.value);
                        setDiscount(nextDiscount);
                        persistCurrentDraft(cart, { date: saleDate, soldBy, notes, discount: nextDiscount });
                    }} /></div>
                    <div><label>Grand Total</label><strong>₦{grandTotal.toFixed(2)}</strong></div>
                </div>
                <button type="button" disabled={isSaving || isDraftSaving || Boolean(editingSaleItemId)} onClick={() => void completeSale()}>{isSaving ? "Completing..." : "Complete Sale"}</button>
                <button type="button" onClick={clearSale}>Clear Sale</button>
            </div>

            {message && <p>{message}</p>}
            {error && <p>{error}</p>}

            <div>
                <button type="button" onClick={() => setHistoryExpanded((current) => !current)}>Sale History {historyExpanded ? "▴" : "▾"}</button>
                {historyExpanded && (
                    <div>
                        <input type="search" placeholder="Search date, staff, notes, or product..." value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} />
                        {filteredHistory.map((sale) => {
                            const expanded = selectedHistoryId === sale.id;
                            return (
                                <div key={sale.id}>
                                    <button type="button" onClick={() => setSelectedHistoryId(expanded ? null : sale.id)}>
                                        <strong>{sale.date}</strong> | {sale.items.length} item{sale.items.length === 1 ? "" : "s"} | ₦{sale.totalAmount.toFixed(2)} {sale.soldBy ? `| ${sale.soldBy}` : ""}
                                    </button>
                                    {expanded && <div>{sale.items.map((item) => {
                                        const product = products.find((entry) => entry.id === item.productId);
                                        const variant = product?.variants.find((entry) => entry.id === item.variantId);
                                        const unit = variant?.packagingUnits.find((entry) => entry.id === item.packagingUnitId);
                                        return <div key={item.id}><strong>{product?.name ?? "Unknown"}</strong> | {item.quantity} {unit?.name ?? "unit"} | ₦{item.unitPrice.toFixed(2)}{item.batchNumber ? ` | Batch: ${item.batchNumber}` : ""}{item.expiryDate ? ` | ${formatExpiryStatus(item.expiryDate)}` : ""}</div>;
                                    })}</div>}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SalesPage;