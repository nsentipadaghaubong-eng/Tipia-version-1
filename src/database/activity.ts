import type { SqliteDatabase } from "./connection";
import { insertActivityRecord } from "./activityRepository";
import type { ActivityRecordInput } from "../types/Activity";

export type ActivityEventInput = Omit<ActivityRecordInput, "id" | "occurredAt">;

export const recordActivity = (
    db: SqliteDatabase,
    event: ActivityEventInput
) => insertActivityRecord(db, {
    ...event,
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
});