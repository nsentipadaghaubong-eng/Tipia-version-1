import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Product, Delivery, DeliveryItems } from "../types/Product";
import CreateProductForm from "../components/CreateProductForm";
import {
    getProducts,
    getDeliveries,
    receiveDelivery,
    saveDeliveryDraft,
    INVENTORY_CHANGED_EVENT,
    PENDING_TASKS_CHANGED_EVENT,
    initializeDatabase,
    createProduct,
    updateProduct,
} from "../database/database";
import { formatExpiryStatus } from "../utils/expiry";

const createNewDeliveryState = (): Delivery => ({
    id: crypto.randomUUID(),
    supplier: "",
    invoiceNo: "",
    date: new Date().toISOString().split("T")[0],
    receivedBy: "",
    status: "draft",
    items: [],
});

const initialDeliveryItem: DeliveryItems = {
    id: "",
    deliveryId: "",
    productId: "",
    variantId: "",
    packagingUnitId: "",
    quantity: 0,
    batchNumber: "",
    expiryDate: "",
    costPrice: 0,
    sellingPrice: 0,
};

const ReceiveDelivery = () => {
    const location = useLocation();
    const routeState = location.state as { draftType?: string; draftId?: string } | null;
    const requestedDraftId = routeState?.draftType === "delivery" ? routeState.draftId : undefined;
    const [productSearch, setProductSearch] = useState("");
    const [delivery, setDelivery] = useState<Delivery>(createNewDeliveryState());
    const [savedDeliveries, setSavedDeliveries] = useState<Delivery[]>([]);
    const [item, setItem] = useState<DeliveryItems>(initialDeliveryItem);
    const [products, setProducts] = useState<Product[]>([]);
    const [error, setError] = useState("");
    const [showCreateProduct, setShowCreateProduct] = useState(false);
    const [editingExistingProduct, setEditingExistingProduct] = useState<Product | null>(null);
    const [historyExpanded, setHistoryExpanded] = useState(false);
    const [historySearch, setHistorySearch] = useState("");
    const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

    const fetchSavedDeliveries = async (draftIdToLoad?: string, loadDraft = true) => {
        const deliveriesFromDB = await getDeliveries();
        setSavedDeliveries(deliveriesFromDB);

        if (!loadDraft) return;

        const draft = draftIdToLoad
            ? deliveriesFromDB.find((entry) => entry.id === draftIdToLoad && entry.status === "draft")
            : deliveriesFromDB.find((entry) => entry.status === "draft");
        if (draftIdToLoad && !draft) {
            setError("The selected delivery draft is no longer available.");
            return;
        }
        if (draft) {
            setDelivery({
                ...draft,
                status: "draft",
            });
        }
    };

    useEffect(() => {
        async function fetchInitialData() {
            await initializeDatabase();

            const productsFromDB = await getProducts();
            setProducts(productsFromDB);

            await fetchSavedDeliveries(requestedDraftId);
        }

        fetchInitialData();
    }, []);

    const filteredProducts = productSearch.trim() === ""
        ? []
        : products.filter((product) => {
            const search = productSearch.toLowerCase();
            return (
                product.name.toLowerCase().includes(search) ||
                product.genericName.toLowerCase().includes(search) ||
                product.manufacturer.toLowerCase().includes(search) ||
                (product.barcode ?? "").toLowerCase().includes(search)
            );
        });

    const selectedProduct = products.find((product) => product.id === item.productId);

    const activeVariant = selectedProduct?.variants.find((v) => v.id === item.variantId)
        ?? selectedProduct?.variants[0];

    const hasMeaningfulVariantInfo = selectedProduct?.variants.some((variant) =>
        [variant.strength, variant.strengthUnit, variant.form]
            .some((value) => value?.trim())
    ) ?? false;

    const packagingUnits = activeVariant?.packagingUnits ?? [];

    const formatVariantInfo = (variant: Product["variants"][number] | undefined) =>
        [variant?.strength, variant?.strengthUnit, variant?.form]
            .filter((value) => value?.trim())
            .join(" ");

    const selectProduct = (product: Product) => {
        const firstVariant = product.variants[0];
        const defaultPackaging = firstVariant?.packagingUnits.find((unit) => unit.isDefault)
            ?? firstVariant?.packagingUnits[0];

        setItem({
            ...initialDeliveryItem,
            productId: product.id,
            variantId: firstVariant?.id ?? "",
            packagingUnitId: defaultPackaging?.id ?? "",
            costPrice: defaultPackaging?.costPrice ?? 0,
            sellingPrice: defaultPackaging?.sellingPrice ?? 0,
        });

        setProductSearch("");
        setShowCreateProduct(false);
    };

    const selectVariant = (variantId: string) => {
        if (!selectedProduct) return;

        const variant = selectedProduct.variants.find((v) => v.id === variantId)
            ?? selectedProduct.variants[0];

        const defaultPackaging = variant?.packagingUnits.find((u) => u.isDefault)
            ?? variant?.packagingUnits[0];

        setItem((prev) => ({
            ...prev,
            variantId: variant?.id ?? "",
            packagingUnitId: defaultPackaging?.id ?? "",
            costPrice: defaultPackaging?.costPrice ?? 0,
            sellingPrice: defaultPackaging?.sellingPrice ?? 0,
        }));
    };

    const selectPackaging = (unitId: string) => {
        const unit = packagingUnits.find((u) => u.id === unitId);
        if (!unit) return;

        setItem((prev) => ({
            ...prev,
            packagingUnitId: unit.id,
            costPrice: unit.costPrice ?? 0,
            sellingPrice: unit.sellingPrice ?? 0,
        }));
    };

    const addItemToDelivery = async () => {
        if (!item.productId) {
            setError("Please search and select a product first");
            return;
        }

        if (!item.variantId) {
            setError("Please select a variant for this product");
            return;
        }

        if (!item.packagingUnitId) {
            setError("Please select a packaging unit");
            return;
        }

        if (!item.quantity || item.quantity <= 0) {
            setError("Quantity must be greater than zero");
            return;
        }

        if (item.costPrice < 0 || item.sellingPrice < 0) {
            setError("Prices cannot be negative");
            return;
        }

        const product = products.find((entry) => entry.id === item.productId);
        const variant = product?.variants.find((entry) => entry.id === item.variantId);
        if (!product || !variant || variant.packagingUnits.length === 0) {
            setError("This product has no packaging units configured for delivery.");
            return;
        }

        const selectedPackagingUnit = variant.packagingUnits.find((unit) => unit.id === item.packagingUnitId);
        if (!selectedPackagingUnit) {
            setError("Selected packaging unit is not valid for this product variant.");
            return;
        }

        const newItem: DeliveryItems = {
            id: crypto.randomUUID(),
            deliveryId: delivery.id,
            productId: item.productId.trim(),
            variantId: item.variantId,
            packagingUnitId: item.packagingUnitId.trim(),
            quantity: item.quantity,
            batchNumber: item.batchNumber?.trim(),
            expiryDate: item.expiryDate?.trim(),
            costPrice: item.costPrice,
            sellingPrice: item.sellingPrice,
        };

        const nextDelivery: Delivery = {
            ...delivery,
            status: "draft",
            items: [...delivery.items, newItem],
        };

        try {
            await saveDeliveryDraft(nextDelivery);
            setDelivery(nextDelivery);
            setItem(initialDeliveryItem);
            setError("");
            await fetchSavedDeliveries(undefined, false);
            window.dispatchEvent(new Event(PENDING_TASKS_CHANGED_EVENT));
        } catch (saveError) {
            console.error("Failed to persist delivery draft:", saveError);
            setError("Failed to save the current draft. Please try again.");
        }
    };

    function removeItemFromDelivery(id: string) {
        setDelivery((previousDelivery) => ({
            ...previousDelivery,
            items: previousDelivery.items.filter((item) => item.id !== id),
        }));
    }

    async function validateDelivery() {
        if (!delivery.supplier.trim() || delivery.supplier === "select") {
            setError("Supplier is required");
            return;
        }

        if (!delivery.invoiceNo.trim()) {
            setError("Invoice No. is required");
            return;
        }

        if (!delivery.date.trim()) {
            setError("Date is required");
            return;
        }

        if (!delivery.receivedBy.trim()) {
            setError("Received by is required");
            return;
        }

        if (delivery.items.length === 0) {
            setError("Add at least one product to the delivery");
            return;
        }

        setError("");

        try {
            const approvedDelivery: Delivery = {
                ...delivery,
                status: "approved",
            };

            await receiveDelivery(approvedDelivery);
            window.dispatchEvent(new Event(INVENTORY_CHANGED_EVENT));

            await fetchSavedDeliveries(undefined, false);
            window.dispatchEvent(new Event(PENDING_TASKS_CHANGED_EVENT));

            setDelivery(createNewDeliveryState());
            setItem(initialDeliveryItem);
            setProductSearch("");
            setError("");
        } catch (deliveryError) {
            console.error("Failed to approve delivery:", deliveryError);
            setError("Failed to approve delivery. Nothing was saved.");
        }
    }

    const filteredHistory = savedDeliveries.filter((saved) => {
        const term = historySearch.trim().toLowerCase();
        if (!term) return true;
        const searchable = [
            saved.invoiceNo,
            saved.supplier,
            saved.date,
            saved.receivedBy,
            saved.items.map((item) => {
                const product = products.find((entry) => entry.id === item.productId);
                return product?.name ?? "";
            }).join(" "),
        ].join(" ").toLowerCase();

        return searchable.includes(term);
    });

    return (
        <div>
            <h1>Receive Delivery</h1>

            <div>
                <h2>Delivery Header</h2>

                <div>
                    <label>Supplier: </label>
                    <input
                        type="text"
                        value={delivery.supplier}
                        placeholder="Enter supplier name"
                        onChange={(e) => setDelivery({ ...delivery, supplier: e.target.value })}
                    />
                </div>

                <div>
                    <label>Invoice No: </label>
                    <input
                        type="text"
                        value={delivery.invoiceNo}
                        onChange={(e) => setDelivery({ ...delivery, invoiceNo: e.target.value })}
                    />
                </div>

                <div>
                    <label>Date: </label>
                    <input
                        type="date"
                        value={delivery.date}
                        onChange={(e) => setDelivery({ ...delivery, date: e.target.value })}
                    />
                </div>

                <div>
                    <label>Received by: </label>
                    <input
                        type="text"
                        value={delivery.receivedBy}
                        onChange={(e) => setDelivery({ ...delivery, receivedBy: e.target.value })}
                    />
                </div>
            </div>

            <div>
                <h2>Select Product</h2>

                <label>Search product or scan barcode: </label>
                <input
                    type="text"
                    placeholder="Type product name or barcode..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                />

                {productSearch.trim() !== "" && (
                    <div>
                        {filteredProducts.length > 0 ? (
                            filteredProducts.map((product) => (
                                <button
                                    key={product.id}
                                    type="button"
                                    onClick={() => selectProduct(product)}
                                >
                                    {product.name} ({product.genericName})
                                </button>
                            ))
                        ) : (
                            <div>
                                <p>No product found.</p>
                                <button type="button" onClick={() => setShowCreateProduct(true)}>
                                    Create New Product
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {selectedProduct && (
                    <p>
                        Selected Product: {selectedProduct.name}
                    </p>
                )}
            </div>

            {showCreateProduct && (
                <div style={{ border: "1px solid #ccc", padding: 16, marginTop: 16 }}>
                    <CreateProductForm
                        existingProducts={products}
                        initialProduct={editingExistingProduct}
                        onSave={async (savedProduct, stockEntries) => {
                            if (editingExistingProduct) {
                                await updateProduct(savedProduct);
                                const refreshedProducts = await getProducts();
                                setProducts(refreshedProducts);
                                setShowCreateProduct(false);
                                setEditingExistingProduct(null);
                                selectProduct(savedProduct);
                                setError("");
                                return;
                            }

                            await createProduct(savedProduct, stockEntries);
                            const refreshedProducts = await getProducts();
                            setProducts(refreshedProducts);
                            setShowCreateProduct(false);
                            const created = refreshedProducts.find((product) => product.id === savedProduct.id)
                                ?? refreshedProducts.find((product) => product.name === savedProduct.name)
                                ?? refreshedProducts[refreshedProducts.length - 1];

                            if (created) {
                                selectProduct(created);
                            }
                            setError("");
                        }}
                        onCancel={() => {
                            setShowCreateProduct(false);
                            setEditingExistingProduct(null);
                        }}
                        onUseExistingProduct={(product) => {
                            setShowCreateProduct(false);
                            setEditingExistingProduct(null);
                            selectProduct(product);
                        }}
                        onModifyExistingProduct={(product) => {
                            setEditingExistingProduct(product);
                            setShowCreateProduct(true);
                        }}
                    />
                </div>
            )}

            {selectedProduct && (
                <div>
                    <h2>Item Details</h2>

                    {hasMeaningfulVariantInfo && (
                        <div>
                            <label>Variant / Form: </label>
                            <select
                                value={item.variantId}
                                onChange={(e) => selectVariant(e.target.value)}
                            >
                                {selectedProduct.variants.map((v) => {
                                    const label = formatVariantInfo(v);
                                    return (
                                        <option key={v.id} value={v.id}>
                                            {label.trim() !== "" ? label : "Default Variant"}
                                        </option>
                                    );
                                })}
                            </select>
                        </div>
                    )}

                    <div>
                        <label>Packaging Unit: </label>
                        <select
                            value={item.packagingUnitId}
                            onChange={(e) => selectPackaging(e.target.value)}
                        >
                            {packagingUnits.map((unit) => (
                                <option key={unit.id} value={unit.id}>
                                    {unit.name || "Unnamed Unit"}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label>Quantity: </label>
                        <input
                            type="number"
                            min="1"
                            value={item.quantity || ""}
                            onChange={(e) =>
                                setItem((prev) => ({
                                    ...prev,
                                    quantity: Number(e.target.value),
                                }))
                            }
                        />
                    </div>

                    <div>
                        <label>Batch Number: </label>
                        <input
                            type="text"
                            value={item.batchNumber}
                            onChange={(e) =>
                                setItem((prev) => ({
                                    ...prev,
                                    batchNumber: e.target.value,
                                }))
                            }
                        />
                    </div>

                    <div>
                        <label>Expiry Date: </label>
                        <input
                            type="date"
                            value={item.expiryDate}
                            onChange={(e) =>
                                setItem((prev) => ({
                                    ...prev,
                                    expiryDate: e.target.value,
                                }))
                            }
                        />
                    </div>

                    <div>
                        <label>Cost Price: </label>
                        <input
                            type="number"
                            value={item.costPrice}
                            onChange={(e) =>
                                setItem((prev) => ({
                                    ...prev,
                                    costPrice: Number(e.target.value),
                                }))
                            }
                        />
                    </div>

                    <div>
                        <label>Selling Price: </label>
                        <input
                            type="number"
                            value={item.sellingPrice}
                            onChange={(e) =>
                                setItem((prev) => ({
                                    ...prev,
                                    sellingPrice: Number(e.target.value),
                                }))
                            }
                        />
                    </div>

                    <button type="button" onClick={addItemToDelivery}>
                        Add to Delivery
                    </button>
                </div>
            )}

            {error && <p>{error}</p>}

            <h2>Products In Delivery ({delivery.items.length})</h2>
            {delivery.items.map((delItem) => {
                const prod = products.find((p) => p.id === delItem.productId);
                const variant = prod?.variants.find((v) => v.id === delItem.variantId);
                const unitName = variant?.packagingUnits.find((u) => u.id === delItem.packagingUnitId)?.name ?? delItem.packagingUnitId;
                const variantInfo = formatVariantInfo(variant);

                return (
                    <div key={delItem.id}>
                        <strong>{prod?.name}</strong>{variantInfo && ` (${variantInfo})`}<br />
                        Packaging: {unitName} | Qty: {delItem.quantity}<br />
                        Batch: {delItem.batchNumber || "N/A"} | Expiry: {formatExpiryStatus(delItem.expiryDate)}<br />
                        Cost: ₦{delItem.costPrice} | Selling: ₦{delItem.sellingPrice}<br />
                        <button type="button" onClick={() => removeItemFromDelivery(delItem.id)}>
                            Remove
                        </button>
                    </div>
                );
            })}

            <div style={{ display: "flex", gap: 12 }}>
                <button type="button" onClick={validateDelivery}>
                    Approve Delivery
                </button>
            </div>

            <div style={{ marginTop: 24 }}>
                <button type="button" onClick={() => setHistoryExpanded((prev) => !prev)}>
                    Delivery History {historyExpanded ? "▴" : "▾"}
                </button>

                {historyExpanded && (
                    <div style={{ marginTop: 12 }}>
                        <input
                            type="text"
                            placeholder="Search invoice, supplier, date, product..."
                            value={historySearch}
                            onChange={(e) => setHistorySearch(e.target.value)}
                        />

                        {filteredHistory.map((saved) => {
                            const isSelected = selectedHistoryId === saved.id;
                            const historyProductNames = saved.items
                                .map((item) => products.find((product) => product.id === item.productId)?.name ?? "")
                                .filter(Boolean)
                                .join(", ");

                            return (
                                <div key={saved.id} style={{ border: "1px solid #ddd", padding: 12, marginTop: 8 }}>
                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <button type="button" onClick={() => setSelectedHistoryId(isSelected ? null : saved.id)} style={{ flex: 1, textAlign: "left" }}>
                                            <strong>Invoice:</strong> {saved.invoiceNo} | <strong>Supplier:</strong> {saved.supplier} | <strong>Date:</strong> {saved.date} | <strong>Received by:</strong> {saved.receivedBy} | <strong>Items:</strong> {saved.items.length}
                                        </button>
                                        {saved.status === "draft" && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setDelivery({
                                                        ...saved,
                                                        status: "draft",
                                                    });
                                                    setSelectedHistoryId(saved.id);
                                                }}
                                            >
                                                Resume Draft
                                            </button>
                                        )}
                                    </div>

                                    {isSelected && (
                                        <div style={{ marginTop: 8 }}>
                                            <div><strong>Products:</strong> {historyProductNames || "—"}</div>
                                            {saved.items.map((item) => {
                                                const product = products.find((entry) => entry.id === item.productId);
                                                const variant = product?.variants.find((entry) => entry.id === item.variantId);
                                                const unitName = variant?.packagingUnits.find((entry) => entry.id === item.packagingUnitId)?.name ?? "Unit";
                                                return (
                                                    <div key={item.id} style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #eee" }}>
                                                        <div><strong>Product:</strong> {product?.name ?? "Unknown"}</div>
                                                        <div><strong>Qty:</strong> {item.quantity} {unitName}</div>
                                                        <div><strong>Batch:</strong> {item.batchNumber || "N/A"}</div>
                                                        <div><strong>Expiry:</strong> {formatExpiryStatus(item.expiryDate)}</div>
                                                        <div><strong>Cost:</strong> ₦{item.costPrice}</div>
                                                        <div><strong>Selling:</strong> ₦{item.sellingPrice}</div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReceiveDelivery;