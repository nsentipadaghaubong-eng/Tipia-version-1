// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSelectedStockAllocationForItem, SaleStockOptionButton, selectSaleStockOption } from "./SalesPage";

const databaseMocks = vi.hoisted(() => ({
    createSale: vi.fn(),
    deleteSaleDraft: vi.fn(),
    getAvailableQuantityInUnit: vi.fn(),
    getCurrentStockForAllProducts: vi.fn(),
    getProducts: vi.fn(),
    getSales: vi.fn(),
    getSaleStockAllocationPreview: vi.fn(),
    initializeDatabase: vi.fn(),
    saveSaleDraft: vi.fn(),
}));

vi.mock("../database/database", () => ({
    ...databaseMocks,
    INVENTORY_CHANGED_EVENT: "tipia:inventory-changed",
    PENDING_TASKS_CHANGED_EVENT: "tipia:pending-tasks-changed",
}));

vi.mock("../utils/expiry", () => ({
    formatExpiryStatus: (expiryDate: string) => expiryDate,
}));

const product = {
    id: "product-1",
    name: "Panadol Extra",
    genericName: "Paracetamol",
    category: "Analgesic",
    manufacturer: "Example Pharma",
    trackBatches: true,
    trackExpiry: true,
    status: "active" as const,
    variants: [{
        id: "variant-1",
        productId: "product-1",
        strength: "500/65",
        strengthUnit: "mg",
        form: "Caplet",
        packagingUnits: [
            { id: "pack", name: "Pack", sellingPrice: 6000, isDefault: true },
            { id: "card", name: "Card", sellingPrice: 15, isDefault: false },
        ],
    }],
};

const stockOptions = [
    {
        stockRowId: "stock-fefo",
        batchNumber: "BATCH-001",
        expiryDate: "2026-10-02",
        quantity: 10,
        sellingPrice: 7000,
        stockQuantity: 10,
        stockPackagingUnitId: "pack",
        quantityStep: 1,
        recommended: true,
    },
    {
        stockRowId: "stock-alternative",
        batchNumber: "BATCH-002",
        expiryDate: "2027-01-15",
        quantity: 15,
        sellingPrice: 7000,
        stockQuantity: 15,
        stockPackagingUnitId: "pack",
        quantityStep: 1,
        recommended: false,
    },
    {
        stockRowId: "stock-batch-003",
        batchNumber: "BATCH-003",
        expiryDate: "2027-05-15",
        quantity: 8,
        sellingPrice: 7500,
        stockQuantity: 8,
        stockPackagingUnitId: "pack",
        quantityStep: 1,
        recommended: false,
    },
];

const renderSalesPage = () => render(
    <MemoryRouter>
        <SalesPage />
    </MemoryRouter>
);

import SalesPage from "./SalesPage";

beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.createSale.mockResolvedValue({ success: true });
    databaseMocks.deleteSaleDraft.mockResolvedValue({ success: true });
    databaseMocks.getAvailableQuantityInUnit.mockResolvedValue(100);
    databaseMocks.getCurrentStockForAllProducts.mockResolvedValue({ "product-1": [] });
    databaseMocks.getProducts.mockResolvedValue([product]);
    databaseMocks.getSales.mockResolvedValue([]);
    databaseMocks.getSaleStockAllocationPreview.mockImplementation(async (_productId: string, _variantId: string, packagingUnitId: string) =>
        packagingUnitId === "card"
            ? stockOptions.map((option) => ({ ...option, quantity: option.quantity * 10, quantityStep: 10 }))
            : stockOptions
    );
    databaseMocks.initializeDatabase.mockResolvedValue(undefined);
    databaseMocks.saveSaleDraft.mockResolvedValue({ success: true });
});

afterEach(cleanup);

describe("Sales stock selection handoff", () => {
    it("preserves selected stock price when the preview temporarily omits that row", async () => {
        renderSalesPage();

        fireEvent.change(screen.getByLabelText(/Search by name/), { target: { value: "Panadol" } });
        fireEvent.click(await screen.findByRole("button", { name: /Panadol Extra/ }));
        fireEvent.click(await screen.findByRole("button", { name: "Select batch BATCH-003" }));
        fireEvent.change(screen.getByLabelText("Unit Price"), { target: { value: "7200" } });

        databaseMocks.getSaleStockAllocationPreview.mockImplementationOnce(async () => []);
        fireEvent.change(screen.getByLabelText("Packaging Unit"), { target: { value: "card" } });

        await waitFor(() => expect(databaseMocks.getSaleStockAllocationPreview).toHaveBeenCalledWith(
            "product-1",
            "variant-1",
            "card",
            1
        ));
        fireEvent.change(screen.getByLabelText("Packaging Unit"), { target: { value: "pack" } });

        expect((screen.getByLabelText("Unit Price") as HTMLInputElement).value).toBe("7200");
    });

    it.each([
        ["BATCH-001", 7000],
        ["BATCH-003", 7500],
    ])("prefills and submits the selected Inventory price for %s", async (batchNumber, expectedPrice) => {
        renderSalesPage();

        fireEvent.change(screen.getByLabelText(/Search by name/), { target: { value: "Panadol" } });
        fireEvent.click(await screen.findByRole("button", { name: /Panadol Extra/ }));
        const batchButton = await screen.findByRole("button", { name: `Select batch ${batchNumber}` });
        fireEvent.click(batchButton);

        expect((screen.getByLabelText("Unit Price") as HTMLInputElement).value).toBe(String(expectedPrice));
        expect(batchButton.textContent).not.toContain(String(expectedPrice));
        if (batchNumber === "BATCH-001") {
            expect(batchButton.textContent).toContain("FEFO Recommended");
        }

        const editedPrice = Number(expectedPrice) - 300;
        fireEvent.change(screen.getByLabelText("Unit Price"), { target: { value: String(editedPrice) } });
        fireEvent.change(screen.getByLabelText("Sold by"), { target: { value: "Pharmacist" } });
        expect((screen.getByLabelText("Unit Price") as HTMLInputElement).value).toBe(String(editedPrice));

        fireEvent.change(screen.getByLabelText("Packaging Unit"), { target: { value: "card" } });
        fireEvent.change(screen.getByLabelText("Packaging Unit"), { target: { value: "pack" } });
        expect((screen.getByLabelText("Unit Price") as HTMLInputElement).value).toBe(String(editedPrice));

        fireEvent.click(screen.getByRole("button", { name: "Add to Sale" }));
        await screen.findByText("Item added to sale.");
        fireEvent.click(screen.getByRole("button", { name: "Complete Sale" }));

        await waitFor(() => expect(databaseMocks.createSale).toHaveBeenCalledTimes(1));
        const sale = databaseMocks.createSale.mock.calls[0][0];
        expect(sale.items[0].unitPrice).toBe(editedPrice);
        expect(sale.selectedAllocation.items[0].allocations[0].sellingPrice).toBe(expectedPrice);
    });

    it("opens the existing item form with the clicked batch selected and keeps packaging and quantity editable", async () => {
        renderSalesPage();

        fireEvent.change(screen.getByLabelText(/Search by name/), { target: { value: "Panadol" } });
        fireEvent.click(await screen.findByRole("button", { name: /Panadol Extra/ }));

        const alternateBatch = await screen.findByRole("button", { name: "Select batch BATCH-002" });
        expect(screen.queryByText("Item Entry")).toBeNull();
        expect(screen.getByRole("button", { name: "Select batch BATCH-001" }).textContent).toContain("FEFO Recommended");

        fireEvent.click(alternateBatch);

        expect(screen.getByText("Item Entry")).toBeTruthy();
        expect(screen.getByText("Selected: Panadol Extra")).toBeTruthy();
        expect((screen.getByLabelText("Variant") as HTMLSelectElement).value).toBe("variant-1");
        expect(screen.getByText(/Selected stock: BATCH-002/).textContent).toContain("2027-01-15");
        expect((screen.getByLabelText("Packaging Unit") as HTMLSelectElement).tagName).toBe("SELECT");
        expect((screen.getByLabelText("Packaging Unit") as HTMLSelectElement).value).toBe("pack");
        expect((screen.getByLabelText("Quantity") as HTMLInputElement).value).toBe("1");
        expect(databaseMocks.createSale).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText("Packaging Unit"), { target: { value: "card" } });
        expect((screen.getByLabelText("Packaging Unit") as HTMLSelectElement).value).toBe("card");
        expect(screen.getByText(/Selected stock: BATCH-002/)).toBeTruthy();
        expect((screen.getByLabelText("Quantity") as HTMLInputElement).value).toBe("1");

        fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "10" } });
        expect(screen.queryByLabelText("Quantity from BATCH-002")).toBeNull();
        expect(screen.queryByText(/\b\d+\s*\/\s*\d+\s+selected\b/i)).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Add to Sale" }));
        await screen.findByText("Item added to sale.");
        fireEvent.click(screen.getByRole("button", { name: "Complete Sale" }));

        await waitFor(() => expect(databaseMocks.createSale).toHaveBeenCalledTimes(1));
        const sale = databaseMocks.createSale.mock.calls[0][0];
        expect(sale.items[0]).toMatchObject({
            productId: "product-1",
            variantId: "variant-1",
            packagingUnitId: "card",
            quantity: 10,
        });
        expect(sale.selectedAllocation.items[0].allocations).toEqual([expect.objectContaining({
            stockRowId: "stock-alternative",
            quantity: 10,
            batchNumber: "BATCH-002",
            expiryDate: "2027-01-15",
        })]);
    });

    it("removes per-batch quantity inputs while keeping the selected stock and sale quantity", async () => {
        renderSalesPage();
        fireEvent.change(screen.getByLabelText(/Search by name/), { target: { value: "Panadol" } });
        fireEvent.click(await screen.findByRole("button", { name: /Panadol Extra/ }));
        fireEvent.click(await screen.findByRole("button", { name: "Select batch BATCH-002" }));

        expect(screen.queryByLabelText("Quantity from BATCH-001")).toBeNull();
        expect(screen.queryByLabelText("Quantity from BATCH-002")).toBeNull();
        expect((screen.getByLabelText("Quantity") as HTMLInputElement).value).toBe("1");
        expect(screen.getByText(/Selected stock: BATCH-002/)).toBeTruthy();
    });

    it("renders eligible stock as a selectable control with FEFO recommendation and batch details", () => {
        const markup = renderToStaticMarkup(
            <SaleStockOptionButton
                allocation={{
                    stockRowId: "stock-fefo",
                    batchNumber: "batch-fefo",
                    expiryDate: "2027-01-01",
                    quantity: 5,
                    stockQuantity: 10,
                    recommended: true,
                }}
                selected={false}
                onSelect={() => undefined}
            />
        );

        expect(markup).toContain("<button");
        expect(markup).toContain("aria-pressed=\"false\"");
        expect(markup).toContain("batch-fefo");
        expect(markup).not.toContain("10 Packs");
        expect(markup).not.toContain("available");
        expect(markup).toContain("FEFO Recommended");
    });

    it("selects the clicked physical stock row without changing the requested sale quantity", () => {
        expect(selectSaleStockOption("stock-alt", 3)).toEqual({
            selectedStockRowIds: ["stock-alt"],
            selectedStockQuantities: { "stock-alt": 3 },
        });
    });

    it("preserves FEFO as a recommendation while honoring an explicit alternate batch selection", () => {
        const item = {
            productId: "product-1",
            variantId: "variant-1",
            packagingUnitId: "card",
            quantity: 5,
        };

        const selection = buildSelectedStockAllocationForItem(item, [
            {
                stockRowId: "stock-fefo",
                batchNumber: "batch-fefo",
                expiryDate: "2027-01-01",
                quantity: 5,
                recommended: true,
            },
            {
                stockRowId: "stock-alt",
                batchNumber: "batch-alt",
                expiryDate: "2028-01-01",
                quantity: 5,
                recommended: false,
            },
        ], { "stock-alt": 5 });

        expect(selection).toEqual({
            items: [{
                productId: "product-1",
                variantId: "variant-1",
                packagingUnitId: "card",
                quantity: 5,
                allocations: [{
                    stockRowId: "stock-alt",
                    quantity: 5,
                    batchNumber: "batch-alt",
                    expiryDate: "2028-01-01",
                }],
            }],
        });
    });

    it("rejects a selection that does not match the requested quantity", () => {
        const item = {
            productId: "product-1",
            variantId: "variant-1",
            packagingUnitId: "card",
            quantity: 5,
        };

        expect(() => buildSelectedStockAllocationForItem(item, [
            {
                stockRowId: "stock-fefo",
                batchNumber: "batch-fefo",
                expiryDate: "2027-01-01",
                quantity: 3,
                recommended: true,
            },
        ], { "stock-fefo": 3 })).toThrow("Selected stock allocation is invalid");
    });

    it("supports an explicit quantity split across selected batches", () => {
        const item = {
            productId: "product-1",
            variantId: "variant-1",
            packagingUnitId: "card",
            quantity: 5,
        };

        const selection = buildSelectedStockAllocationForItem(item, [
            {
                stockRowId: "stock-fefo",
                batchNumber: "batch-fefo",
                expiryDate: "2027-01-01",
                quantity: 4,
                recommended: true,
            },
            {
                stockRowId: "stock-alt",
                batchNumber: "batch-alt",
                expiryDate: "2028-01-01",
                quantity: 4,
                recommended: false,
            },
        ], { "stock-fefo": 2, "stock-alt": 3 });

        expect(selection.items[0].allocations.map(({ stockRowId, quantity }) => ({ stockRowId, quantity })))
            .toEqual([
                { stockRowId: "stock-fefo", quantity: 2 },
                { stockRowId: "stock-alt", quantity: 3 },
            ]);
    });

    it("rejects quantities that split a source packaging unit", () => {
        const item = {
            productId: "product-1",
            variantId: "variant-1",
            packagingUnitId: "card",
            quantity: 3,
        };

        expect(() => buildSelectedStockAllocationForItem(item, [{
            stockRowId: "stock-pack",
            batchNumber: "batch-pack",
            expiryDate: "2027-01-01",
            quantity: 6,
            quantityStep: 2,
        }], { "stock-pack": 3 })).toThrow("Selected stock allocation is invalid");
    });
});
