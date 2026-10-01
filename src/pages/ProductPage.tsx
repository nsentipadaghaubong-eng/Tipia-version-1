import { useState, useEffect } from "react"
import type { Product } from "../types/Product"
import ProductRow from "../components/ProductRow"
import CreateProductForm from "../components/CreateProductForm"
import { getProducts, createProduct, initializeDatabase, updateProduct, deleteProduct as deleteProductFromDatabase, getCurrentStockForProduct, getCurrentStockForAllProducts, INVENTORY_CHANGED_EVENT, type CurrentStockEntry } from "../database/database"
import { formatExpiryStatus } from "../utils/expiry"
import { calculateStockBreakdown } from "../domain/stockBreakdown"

interface InitialStockEntry {
    id: string;
    packagingUnitId: string;
    quantity: number;
    batchNumber?: string;
    expiryDate?: string;
    costPrice: number;
    sellingPrice: number;
}

const ProductPage = () => {
    const [products, setProducts] = useState<Product[]>([])
    const [search, setSearch] = useState("")
    const [drawer, setDrawer] = useState<boolean>(false)
    const [error, setError] = useState("")
    const [editingProduct, setEditingProduct] = useState<Product | null>(null)
    const [viewingProduct, setViewingProduct] = useState<Product | null>(null)
    const [productStock, setProductStock] = useState<Record<string, CurrentStockEntry[]>>({})

    const filteredProducts = products.filter((product) => {
        const query = search.toLowerCase();

        return (
            product.name.toLowerCase().includes(query) ||
            product.genericName.toLowerCase().includes(query) ||
            (product.barcode ?? "").toLowerCase().includes(query) ||
            product.manufacturer.toLowerCase().includes(query)
        );
    });

    useEffect(() => {
        const loadProducts = async () => {
            try {
                await initializeDatabase();

                const [productsFromDB, stockByProduct] = await Promise.all([
                    getProducts(),
                    getCurrentStockForAllProducts(),
                ]);
                setProducts(productsFromDB);
                setProductStock(stockByProduct);
            } catch (error) {
                console.error("Failed to load products:", error);
                setError("Failed to load products");
            }
        };

        loadProducts();
    }, []);

    useEffect(() => {
        const refreshStock = async () => {
            try {
                setProductStock(await getCurrentStockForAllProducts());
            } catch (stockError) {
                console.error("Failed to refresh product stock:", stockError);
            }
        };

        window.addEventListener(INVENTORY_CHANGED_EVENT, refreshStock);
        return () => window.removeEventListener(INVENTORY_CHANGED_EVENT, refreshStock);
    }, []);

    function addProduct() {
        setEditingProduct(null)
        setViewingProduct(null)
        setError("")
        setDrawer(true)
    }

    function closeProduct() {
        setDrawer(false)
        setEditingProduct(null)
        setViewingProduct(null)
        setError("")
    }

    async function handleCreateProductSave(
        product: Product,
        initialStock: InitialStockEntry[]
    ) {
        try {
            await createProduct(product, initialStock);
            setProducts((current) => [product, ...current]);

            const currentStock = await getCurrentStockForProduct(product.id);
            setProductStock((current) => ({
                ...current,
                [product.id]: currentStock,
            }));

            closeProduct();
        } catch (saveError) {
            console.error(saveError);
            setError(
                saveError instanceof Error ? saveError.message : "Something went wrong while saving the product"
            );
        }
    }

    async function handleProductEditSave(product: Product, editReason: string) {
        try {
            await updateProduct(product, editReason);
            setProducts((current) =>
                current.map((currentProduct) =>
                    currentProduct.id === product.id ? product : currentProduct
                )
            );
            closeProduct();
        } catch (saveError) {
            console.error(saveError);
            setError(
                saveError instanceof Error ? saveError.message : "Something went wrong while saving the product"
            );
        }
    }

    async function editProduct(product: Product) {
        setViewingProduct(null)
        setEditingProduct(product)
        setError("")
        setDrawer(true)
    }

    async function viewProduct(product: Product) {
        setEditingProduct(null)
        setViewingProduct(product)
        setError("")
        setDrawer(true)

        try {
            const currentStock = await getCurrentStockForProduct(product.id)
            setProductStock((prev) => ({
                ...prev,
                [product.id]: currentStock,
            }))
            setError("")
        } catch (error) {
            console.error(error)
            setProductStock((prev) => ({
                ...prev,
                [product.id]: [],
            }))
            setError("Unable to load stock.")
        }
    }

    const isViewing = viewingProduct !== null

    function getPackagingUnitById(variant: Product["variants"][number], unitId: string) {
        return variant.packagingUnits.find((unit) => unit.id === unitId)
    }

    function formatContainsLabel(variant: Product["variants"][number], unit: Product["variants"][number]["packagingUnits"][number]): string {
        if (!unit.contains || !unit.contains.unitId) return ""

        const containedUnit = getPackagingUnitById(variant, unit.contains.unitId)
        if (!containedUnit) return ""

        return `Contains: ${unit.contains.quantity} ${containedUnit.name || "unit"}`
    }

    async function deleteProduct(product: Product) {
        try {
            await deleteProductFromDatabase(product.id)
            setProducts((currentProducts) =>
                currentProducts.filter((currentProduct) => currentProduct.id !== product.id)
            )
        } catch (error) {
            console.error(error)
            setError(
                error instanceof Error
                    ? error.message
                    : "Something went wrong while deleting the product"
            )
        }
    }

    return (
        <div>
            <p>Manage products in your Pharmacy with Tipia</p>

            <input
                type="text"
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
            />

            {!drawer ? (
                <button onClick={addProduct}>Add Product</button>
            ) : !isViewing ? (
                <button onClick={closeProduct}>Close</button>
            ) : null}

            {drawer && (
                <div>
                    {isViewing && viewingProduct ? (
                        <div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <h3>Product Details</h3>
                                <div>
                                    <button type="button" onClick={() => editProduct(viewingProduct)}>Edit</button>
                                    <button type="button" onClick={closeProduct}>Close</button>
                                </div>
                            </div>

                            <div>
                                <h4>1. Product Information</h4>

                                <p><strong>Product Name:</strong> {viewingProduct.name || "—"}</p>
                                <p><strong>Category:</strong> {viewingProduct.category || "—"}</p>
                                <p><strong>Generic Name:</strong> {viewingProduct.genericName || "—"}</p>
                                <p><strong>Manufacturer:</strong> {viewingProduct.manufacturer || "—"}</p>
                                <p><strong>NAFDAC Number:</strong> {viewingProduct.nafdacNumber || "—"}</p>
                                <p><strong>Barcode:</strong> {viewingProduct.barcode || "—"}</p>
                                <p><strong>SKU:</strong> {viewingProduct.sku || "—"}</p>
                                <p><strong>Low Stock Level:</strong> {viewingProduct.lowStockLevel ?? "—"}</p>
                                <p><strong>Track Batches:</strong> {viewingProduct.trackBatches ? "Yes" : "No"}</p>
                                <p><strong>Track Expiry:</strong> {viewingProduct.trackExpiry ? "Yes" : "No"}</p>
                                <p><strong>Status:</strong> {viewingProduct.status || "—"}</p>
                            </div>

                            <div>
                                <h4>2. Stock</h4>
                                {viewingProduct.variants && viewingProduct.variants.length > 0 ? (
                                    viewingProduct.variants.map((variant, index) => {
                                        const stockEntries = (productStock[viewingProduct.id] ?? []).filter(
                                            (stock) => stock.variantId === variant.id
                                        )

                                        const stockText = stockEntries.length > 0
                                            ? stockEntries.map((stock) => {
                                                const unit = getPackagingUnitById(variant, stock.packagingUnitId)
                                                const unitName = unit?.name ?? "unit"
                                                const expiry = stock.expiryDate ? ` | ${formatExpiryStatus(stock.expiryDate)}` : ""
                                                const batch = stock.batchNumber ? ` | Batch: ${stock.batchNumber}` : ""
                                                return `${stock.quantity} ${unitName}${stock.quantity === 1 ? "" : "s"}${batch}${expiry}`
                                            }).join(" / ")
                                            : "No stock recorded"

                                        return (
                                            <p key={variant.id || index}>
                                                <strong>{viewingProduct.variants.length > 1 ? `Variant #${index + 1}` : "Current Stock"}:</strong> {stockText}
                                            </p>
                                        )
                                    })
                                ) : (
                                    <p><strong>Current Stock:</strong> No stock recorded</p>
                                )}
                            </div>

                            <div>
                                <h4>3. Variants & Packaging</h4>

                                {viewingProduct.variants && viewingProduct.variants.length > 0 ? (
                                    viewingProduct.variants.map((variant, variantIndex) => (
                                        <div key={variant.id || variantIndex} style={{ marginBottom: 20 }}>
                                            <h5>Variant #{variantIndex + 1}</h5>
                                            <p><strong>Strength:</strong> {variant.strength ? `${variant.strength} ${variant.strengthUnit || ""}`.trim() : "—"}</p>
                                            <p><strong>Form:</strong> {variant.form || "—"}</p>

                                            {variant.packagingUnits && variant.packagingUnits.length > 0 && (
                                                <div>
                                                    <p><strong>Packaging:</strong></p>
                                                    {variant.packagingUnits.map((unit) => {
                                                        const containsLabel = formatContainsLabel(variant, unit)

                                                        return (
                                                            <div key={unit.id} style={{ marginBottom: 10, border: "1px solid #ddd", padding: 10 }}>
                                                                <p><strong>{unit.name || "Unnamed Unit"}</strong></p>
                                                                {containsLabel ? <p>{containsLabel}</p> : null}
                                                                <p>Cost Price: {unit.costPrice != null ? `₦${unit.costPrice}` : "—"}</p>
                                                                <p>Selling Price: {unit.sellingPrice != null ? `₦${unit.sellingPrice}` : "—"}</p>
                                                                {unit.isDefault ? <p><em>Default Unit</em></p> : null}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    ))
                                ) : (
                                    <p>No variants available.</p>
                                )}
                            </div>

                            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
                                <button type="button" onClick={() => editProduct(viewingProduct)}>Edit</button>
                            </div>
                        </div>
                    ) : (
                        <CreateProductForm
                            existingProducts={products}
                            initialProduct={editingProduct}
                            onSave={handleCreateProductSave}
                            onEdit={handleProductEditSave}
                            showStockFields={!editingProduct}
                            onCancel={closeProduct}
                            onUseExistingProduct={(product) => {
                                void viewProduct(product);
                            }}
                            onModifyExistingProduct={(product) => {
                                editProduct(product);
                            }}
                            allowDuplicateWarning={true}
                        />
                    )}

                    {error && <p>{error}</p>}
                </div>
            )}

            {filteredProducts.length > 0 ? (
                filteredProducts.map((product) => {
                    const stockEntries = productStock[product.id] ?? [];
                    const stockBreakdowns = product.variants.map((variant) => ({
                        variantId: variant.id,
                        entries: calculateStockBreakdown(
                            stockEntries
                                .filter((entry) => entry.variantId === variant.id)
                                .map(({ packagingUnitId, quantity }) => ({ packagingUnitId, quantity })),
                            variant.packagingUnits
                        ),
                    }));

                    return (
                        <ProductRow
                            key={product.id}
                            product={product}
                            stockEntries={stockEntries}
                            stockBreakdowns={stockBreakdowns}
                            onView={viewProduct}
                            onUpdate={editProduct}
                            onDelete={deleteProduct}
                        />
                    );
                })
            ) : (
                <h2>No item found</h2>
            )}
        </div>
    );
}

export default ProductPage;