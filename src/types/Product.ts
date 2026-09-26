export interface Product {
    id: string;
    name: string;
    genericName: string;
    category: string;
    manufacturer: string;
    nafdacNumber?: string;
    barcode?: string;
    sku?: string;
    lowStockLevel?: number;
    trackBatches: boolean;
    trackExpiry: boolean;
    status: "active" | "archived";
    createdAt?: string;
    variants: Variant[];
}

export interface FormData {
    name: string;
    genericName: string;
    category: string;
    manufacturer: string;
    nafdacNumber: string;
    barcode?: string;
    sku?: string;
    lowStockLevel?: number;
    trackBatches: boolean;
    trackExpiry: boolean;
    status: "active" | "archived";
}

export interface ProductRow {
    id: string;
    name: string;
    genericName: string;
    category: string;
    manufacturer: string;
    nafdacNumber: string
    barcode?: string;
    sku?: string;
    lowStockLevel?: number;
    trackBatches: number;
    trackExpiry: number;
    status: "active" | "archived";
    createdAt?: string | null;
}

export interface Delivery {
    id: string;
    supplier: string;
    invoiceNo: string;
    date: string;
    receivedBy: string;
    status?: "draft" | "approved";
    items: DeliveryItems[];
}

export interface DeliveryItems {
    id: string;
    deliveryId: string;
    productId: string;
    variantId: string;
    packagingUnitId: string;
    quantity: number;
    batchNumber?: string;
    expiryDate?: string;
    costPrice: number;
    sellingPrice: number;
}

export type Sale = {
    id: string;
    date: string;
    soldBy?: string;
    totalAmount: number;
    discount?: number;
    notes?: string;
    status?: "draft" | "completed";
    items: SaleItem[];
};

export type SaleItem = {
    id: string;
    saleId: string;
    productId: string;
    variantId: string;
    packagingUnitId: string;
    quantity: number;
    unitPrice: number;
    batchNumber?: string;
    expiryDate?: string;
};

export interface PackagingUnit {
    id: string;
    name: string;
    contains?: {
        quantity: number;
        unitId: string;
    };
    costPrice?: number;
    sellingPrice?: number;
    isDefault: boolean;
}

export interface PackagingUnitRow {
    id: string;
    variantId: string;
    name: string;
    level:number;
    containsQuantity: number | null;
    containsUnitId: string | null;
    costPrice: number | null;
    sellingPrice: number | null;
    isDefault: number;
}

export interface Variant {
    id: string;
    productId: string;
    strength?: string;
    strengthUnit?: string;
    form?: string;
    packagingUnits: PackagingUnit[];
}