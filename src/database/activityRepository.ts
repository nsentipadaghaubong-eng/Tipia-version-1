import type { SqliteDatabase } from "./connection";
import type { ActivityRecord, ActivityRecordInput } from "../types/Activity";

export const insertActivityRecord = async (
    db: SqliteDatabase,
    activity: ActivityRecordInput
) => {
    await db.execute(`
        INSERT INTO activities(
            id,
            event_type,
            occurred_at,
            entity_type,
            entity_id,
            entity_label,
            summary,
            reason,
            changes,
            details
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        activity.id,
        activity.eventType,
        activity.occurredAt,
        activity.entityType,
        activity.entityId,
        activity.entityLabel,
        activity.summary,
        activity.reason ?? null,
        activity.changes == null ? null : JSON.stringify(activity.changes),
        activity.details == null ? null : JSON.stringify(activity.details),
    ]);
};

export const getActivityRecords = async (
    db: SqliteDatabase
): Promise<ActivityRecord[]> => {
    const rows = await db.select<Array<Omit<ActivityRecord, "changes" | "details"> & {
        changes: string | null;
        details: string | null;
    }>>(`
    SELECT
        id,
        event_type AS eventType,
        occurred_at AS occurredAt,
        entity_type AS entityType,
        entity_id AS entityId,
        entity_label AS entityLabel,
        summary,
        reason,
        changes,
        details
    FROM activities
    ORDER BY occurred_at DESC, id DESC
    `);

    return rows.map((row) => ({
        ...row,
        changes: row.changes === null ? null : JSON.parse(row.changes) as ActivityRecord["changes"],
        details: row.details === null ? null : JSON.parse(row.details) as ActivityRecord["details"],
    }));
};