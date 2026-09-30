import { describe, expect, it, vi } from "vitest";
import type { ActivityRecord } from "../types/Activity";
import { getActivityRecords, insertActivityRecord } from "./activityRepository";

const createDatabase = () => ({
    execute: vi.fn(async (_sql: string, _bindings: unknown[] = []) => ({ rowsAffected: 1 })),
    select: vi.fn(async (_sql: string, _bindings: unknown[] = []): Promise<unknown[]> => []),
});

const activity: ActivityRecord = {
    id: "activity-1",
    eventType: "product.edited",
    occurredAt: "2026-09-30T12:00:00.000Z",
    entityType: "product",
    entityId: "product-1",
    entityLabel: "Example medicine",
    summary: "Product details edited",
    reason: "Incorrect selling price",
    changes: [{ field: "Selling price", before: 500, after: 600 }],
    details: null,
};

describe("Activity repository", () => {
    it("inserts every Activity field with a populated reason", async () => {
        const db = createDatabase();

        await insertActivityRecord(db as never, activity);

        expect(db.execute).toHaveBeenCalledTimes(1);
        const [sql, bindings] = db.execute.mock.calls[0];
        expect(sql).toContain("INSERT INTO activities");
        expect(bindings).toEqual([
            activity.id,
            activity.eventType,
            activity.occurredAt,
            activity.entityType,
            activity.entityId,
            activity.entityLabel,
            activity.summary,
            activity.reason,
            JSON.stringify(activity.changes),
            null,
        ]);
    });

    it("persists an omitted reason as null", async () => {
        const db = createDatabase();
        const { reason: _reason, ...activityWithoutReason } = activity;

        await insertActivityRecord(db as never, activityWithoutReason);

        expect(db.execute.mock.calls[0][1]).toEqual([
            activity.id,
            activity.eventType,
            activity.occurredAt,
            activity.entityType,
            activity.entityId,
            activity.entityLabel,
            activity.summary,
            null,
            JSON.stringify(activity.changes),
            null,
        ]);
    });

    it("returns Activity records newest-first with deterministic tie ordering", async () => {
        const newestFirst: ActivityRecord[] = [
            { ...activity, id: "activity-b", occurredAt: "2026-09-30T12:00:00.000Z" },
            { ...activity, id: "activity-a", occurredAt: "2026-09-30T12:00:00.000Z" },
            { ...activity, id: "activity-old", occurredAt: "2026-09-29T12:00:00.000Z" },
        ];
        const db = createDatabase();
        db.select.mockResolvedValue(newestFirst.map((record) => ({
            ...record,
            changes: JSON.stringify(record.changes),
            details: null,
        })));

        await expect(getActivityRecords(db as never)).resolves.toEqual(newestFirst);

        expect(db.select.mock.calls[0][0]).toContain("ORDER BY occurred_at DESC, id DESC");
    });

    it("round-trips event-specific details as structured data", async () => {
        const details: ActivityRecord["details"] = {
            saleDate: "2026-09-30",
            soldBy: "Tester",
            notes: "Manual discount approved",
            totalAmount: 12,
            discount: 2,
            items: [{
                productId: "product-1",
                productName: "Example medicine",
                variantId: "variant-1",
                variantLabel: "Tablet",
                packagingUnitId: "pack",
                packagingUnitName: "Pack",
                quantity: 2,
                unitPrice: 7,
                lineAmount: 14,
                allocations: [{ quantity: 2, batchNumber: "batch-1", expiryDate: "2027-01-01" }],
            }],
        };
        const db = createDatabase();
        await insertActivityRecord(db as never, { ...activity, details });

        const insertBindings = db.execute.mock.calls[0]?.[1];
        expect(insertBindings?.[9]).toBe(JSON.stringify(details));

        db.select.mockResolvedValue([{
            ...activity,
            changes: JSON.stringify(activity.changes),
            details: JSON.stringify(details),
        }]);
        await expect(getActivityRecords(db as never)).resolves.toMatchObject([{ details }]);
    });

    it("uses the caller's database transaction without controlling it", async () => {
        const db = createDatabase();

        await db.execute("BEGIN");
        await insertActivityRecord(db as never, { ...activity, reason: null });
        await db.execute("ROLLBACK");

        expect(db.execute.mock.calls.map(([sql]) => sql)).toEqual([
            "BEGIN",
            expect.stringContaining("INSERT INTO activities"),
            "ROLLBACK",
        ]);
    });
});