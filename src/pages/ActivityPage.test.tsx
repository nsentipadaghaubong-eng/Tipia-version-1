import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "../types/Activity";
import { activityFilterOptions, ActivityTimeline, filterActivityRecords } from "./ActivityPage";

const makeActivity = (overrides: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id: "activity-1",
    eventType: "product.created",
    occurredAt: "2026-09-30T12:00:00.000Z",
    entityType: "product",
    entityId: "product-1",
    entityLabel: "Panadol Extra",
    summary: "Product created: Panadol Extra",
    reason: null,
    changes: null,
    details: null,
    ...overrides,
});

const renderTimeline = (records: ActivityRecord[]) => renderToStaticMarkup(
    <ActivityTimeline records={records} />
);

const activities: ActivityRecord[] = [
    makeActivity({
        id: "created",
        details: {
            genericName: "Paracetamol",
            manufacturer: "Acme",
            category: "Analgesic",
            variants: [{ label: "500 mg Tablet", initialQuantities: [{ quantity: 4, packagingUnitName: "Pack" }] }],
        },
    }),
    makeActivity({
        id: "edited",
        eventType: "product.edited",
        summary: "Product edited: Panadol Extra",
        reason: "Incorrect selling price",
        changes: [{ field: "Selling price", before: 500, after: 600 }],
        details: null,
    }),
    makeActivity({
        id: "archived",
        eventType: "product.archived",
        summary: "Product archived: Panadol Extra",
        changes: [{ field: "Product status", before: "active", after: "archived" }],
    }),
    makeActivity({
        id: "delivery",
        eventType: "delivery.received",
        entityType: "delivery",
        entityId: "delivery-1",
        entityLabel: "Invoice INV-44",
        summary: "Delivery from North supplier received",
        details: {
            supplier: "North supplier",
            invoiceNo: "INV-44",
            deliveryDate: "2026-09-29",
            receivedBy: "Mina",
            items: [
                { productId: "product-1", productName: "Panadol Extra", variantId: "variant-1", variantLabel: "500 mg Tablet", packagingUnitId: "pack", packagingUnitName: "Pack", quantity: 4, batchNumber: "B-1", expiryDate: "2027-10-15", costPrice: 400, sellingPrice: 600 },
                { productId: "product-2", productName: "Vitamin C", variantId: "variant-2", variantLabel: "100 mg Tablet", packagingUnitId: "box", packagingUnitName: "Box", quantity: 2, batchNumber: "B-2", expiryDate: "2027-12-01", costPrice: 200, sellingPrice: 350 },
            ],
        },
    }),
    makeActivity({
        id: "sale",
        eventType: "sale.completed",
        entityType: "sale",
        entityId: "sale-1",
        entityLabel: "Sale 2026-09-30",
        summary: "Completed sale: 2 items, total ₦1,200.00",
        details: {
            saleDate: "2026-09-30",
            soldBy: "Mina",
            notes: "Customer requested a receipt",
            totalAmount: 1200,
            discount: 100,
            items: [
                { productId: "product-1", productName: "Panadol Extra", variantId: "variant-1", variantLabel: "500 mg Tablet", packagingUnitId: "pack", packagingUnitName: "Pack", quantity: 1, unitPrice: 700, lineAmount: 700, allocations: [{ quantity: 1, batchNumber: "B-1", expiryDate: "2027-10-15" }] },
                { productId: "product-2", productName: "Vitamin C", variantId: "variant-2", variantLabel: "100 mg Tablet", packagingUnitId: "box", packagingUnitName: "Box", quantity: 1, unitPrice: 600, lineAmount: 600, allocations: [{ quantity: 1, batchNumber: "B-2", expiryDate: "2027-12-01" }] },
            ],
        },
    }),
];

describe("Activity Page presentation", () => {
    it("provides all required filters and All returns every event", () => {
        expect(activityFilterOptions.map(({ label }) => label)).toEqual([
            "All", "Deliveries", "Edited Products", "Archived Products", "Sales", "Created Products",
        ]);
        expect(filterActivityRecords(activities, "all", "")).toEqual(activities);
    });

    it.each([
        ["delivery.received", "Deliveries", "delivery"],
        ["product.edited", "Edited Products", "edited"],
        ["product.archived", "Archived Products", "archived"],
        ["sale.completed", "Sales", "sale"],
        ["product.created", "Created Products", "created"],
    ] as const)("filters %s through %s", (eventType, _label, id) => {
        expect(filterActivityRecords(activities, eventType, "").map((record) => record.id)).toEqual([id]);
    });

    it("searches entity data, reasons, summaries, and structured details", () => {
        expect(filterActivityRecords(activities, "all", "incorrect selling price").map(({ id }) => id)).toEqual(["edited"]);
        expect(filterActivityRecords(activities, "all", "North supplier").map(({ id }) => id)).toEqual(["delivery"]);
        expect(filterActivityRecords(activities, "all", "receipt").map(({ id }) => id)).toEqual(["sale"]);
        expect(filterActivityRecords(activities, "all", "Paracetamol").map(({ id }) => id)).toEqual(["created"]);
    });

    it("renders concise Product Created information without packaging hierarchy", () => {
        const markup = renderTimeline([activities[0]]);
        expect(markup).toContain("Panadol Extra");
        expect(markup).toContain("Paracetamol");
        expect(markup).toContain("Acme");
        expect(markup).toContain("Analgesic");
        expect(markup).toContain("1 variant");
        expect(markup).toContain("4 Pack");
        expect(markup).not.toContain("Contains");
    });

    it("renders Product Edited before/after changes and the reason", () => {
        const markup = renderTimeline([activities[1]]);
        expect(markup).toContain("Selling price");
        expect(markup).toContain("₦500");
        expect(markup).toContain("₦600");
        expect(markup).toContain("Incorrect selling price");
    });

    it("renders a multi-item Delivery inside one Activity event", () => {
        const markup = renderTimeline([activities[3]]);
        expect((markup.match(/<article/g) ?? []).length).toBe(1);
        expect(markup).toContain("North supplier");
        expect(markup).toContain("INV-44");
        expect(markup).toContain("Panadol Extra");
        expect(markup).toContain("Vitamin C");
        expect(markup).toContain("B-1");
        expect(markup).toContain("2027-10-15");
        expect(markup).toContain("₦400");
        expect(markup).toContain("₦350");
    });

    it("renders multiple Sale lines and Sales Notes inside one Activity event", () => {
        const markup = renderTimeline([activities[4]]);
        expect((markup.match(/<article/g) ?? []).length).toBe(1);
        expect(markup).toContain("Panadol Extra");
        expect(markup).toContain("Vitamin C");
        expect(markup).toContain("Sales Notes");
        expect(markup).toContain("Customer requested a receipt");
        expect(markup).toContain("₦700");
        expect(markup).toContain("₦600");
        expect(markup).toContain("Batch: B-1");
    });

    it("does not expose Activity mutation controls", () => {
        const markup = renderTimeline(activities);
        expect(markup).not.toMatch(/<(button|input|select)\b/i);
        expect(markup).not.toMatch(/\b(Edit|Delete|Correct|Archive|Unarchive)\b/i);
    });
});