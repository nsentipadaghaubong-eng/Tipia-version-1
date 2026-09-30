import { useEffect, useState } from "react";
import type {
    ActivityChange,
    ActivityChangeValue,
    ActivityEventType,
    ActivityRecord,
} from "../types/Activity";
import { getActivities } from "../database/database";
import "./ActivityPage.css";

export type ActivityFilter = "all" | ActivityEventType;

export const activityFilterOptions: Array<{ value: ActivityFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "delivery.received", label: "Deliveries" },
    { value: "product.edited", label: "Edited Products" },
    { value: "product.archived", label: "Archived Products" },
    { value: "sale.completed", label: "Sales" },
    { value: "product.created", label: "Created Products" },
];

const eventLabels: Record<ActivityEventType, string> = {
    "product.created": "Product created",
    "product.edited": "Product edited",
    "product.archived": "Product archived",
    "inventory.adjusted": "Inventory adjusted",
    "delivery.received": "Delivery received",
    "sale.completed": "Sale completed",
};

export const filterActivityRecords = (
    records: ActivityRecord[],
    filter: ActivityFilter,
    search: string
) => {
    const normalizedSearch = search.trim().toLowerCase();
    return records.filter((record) => {
        if (filter !== "all" && record.eventType !== filter) return false;
        if (!normalizedSearch) return true;

        const searchable = [
            record.eventType,
            record.entityType,
            record.entityId,
            record.entityLabel,
            record.summary,
            record.reason ?? "",
            record.occurredAt,
            JSON.stringify(record.changes ?? []),
            JSON.stringify(record.details ?? {}),
        ].join(" ").toLowerCase();
        return searchable.includes(normalizedSearch);
    });
};

const formatOccurredAt = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const formatMoney = (value: number) => new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
}).format(value);

const formatChangeValue = (value: ActivityChangeValue, field: string) => {
    if (value === null) return "Not set";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number" && field.toLowerCase().includes("price")) return formatMoney(value);
    return String(value);
};

const ChangeList = ({ changes }: { changes: ActivityChange[] }) => (
    changes.length === 0
        ? <p className="activity-muted">No field changes were recorded.</p>
        : <dl className="activity-changes">
            {changes.map((change, index) => (
                <div className="activity-change" key={`${change.field}-${index}`}>
                    <dt>{change.field}</dt>
                    <dd>
                        <span>{formatChangeValue(change.before, change.field)}</span>
                        <span className="activity-change-arrow" aria-label="changed to">→</span>
                        <span>{formatChangeValue(change.after, change.field)}</span>
                    </dd>
                </div>
            ))}
        </dl>
);

const ActivityEntry = ({ record }: { record: ActivityRecord }) => {
    const details = record.details;
    const title = record.eventType === "delivery.received" && details && "supplier" in details
        ? details.supplier
        : record.entityLabel;

    return (
        <article className="activity-entry" data-event-type={record.eventType}>
            <header className="activity-entry-header">
                <div>
                    <p className="activity-event-type">{eventLabels[record.eventType]}</p>
                    <h2>{title}</h2>
                </div>
                <time dateTime={record.occurredAt}>{formatOccurredAt(record.occurredAt)}</time>
            </header>
            <p className="activity-summary">{record.summary}</p>

            {record.eventType === "product.created" && details && "variants" in details && (
                <div className="activity-detail-block">
                    <dl className="activity-meta">
                        <div><dt>Generic name</dt><dd>{details.genericName || "Not recorded"}</dd></div>
                        <div><dt>Manufacturer</dt><dd>{details.manufacturer || "Not recorded"}</dd></div>
                        <div><dt>Category</dt><dd>{details.category || "Not recorded"}</dd></div>
                    </dl>
                    {details.variants.length > 0 && (
                        <div>
                            <h3>{details.variants.length} variant{details.variants.length === 1 ? "" : "s"}</h3>
                            <ul className="activity-compact-list">
                                {details.variants.map((variant, index) => (
                                    <li key={`${variant.label}-${index}`}>
                                        <strong>{variant.label}</strong>
                                        <span>
                                            {variant.initialQuantities.length > 0
                                                ? variant.initialQuantities.map(({ quantity, packagingUnitName }) => `${quantity} ${packagingUnitName}`).join(", ")
                                                : "No initial quantity recorded"}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            {record.eventType === "product.edited" && (
                <div className="activity-detail-block">
                    {record.changes && <ChangeList changes={record.changes} />}
                    <div className="activity-reason">
                        <strong>Reason</strong>
                        <p>{record.reason || "Not recorded"}</p>
                    </div>
                </div>
            )}

            {record.eventType === "product.archived" && record.changes && (
                <div className="activity-detail-block">
                    <ChangeList changes={record.changes} />
                </div>
            )}

            {record.eventType === "delivery.received" && details && "supplier" in details && (
                <div className="activity-detail-block">
                    <dl className="activity-meta">
                        <div><dt>Invoice / reference</dt><dd>{details.invoiceNo}</dd></div>
                        <div><dt>Delivery date</dt><dd>{details.deliveryDate}</dd></div>
                        <div><dt>Received by</dt><dd>{details.receivedBy}</dd></div>
                    </dl>
                    <div className="activity-item-list">
                        {details.items.map((item, index) => (
                            <section className="activity-item" key={`${item.productId}-${item.packagingUnitId}-${index}`}>
                                <h3>{item.productName ?? item.productId}</h3>
                                {item.variantLabel && <p>{item.variantLabel}</p>}
                                <p><strong>Received:</strong> {item.quantity} {item.packagingUnitName ?? "unit"}</p>
                                <dl className="activity-meta">
                                    <div><dt>Batch</dt><dd>{item.batchNumber || "Not recorded"}</dd></div>
                                    <div><dt>Expiry</dt><dd>{item.expiryDate || "Not recorded"}</dd></div>
                                    <div><dt>Cost price</dt><dd>{formatMoney(item.costPrice)}</dd></div>
                                    <div><dt>Selling price</dt><dd>{formatMoney(item.sellingPrice)}</dd></div>
                                </dl>
                            </section>
                        ))}
                    </div>
                </div>
            )}

            {record.eventType === "sale.completed" && details && "saleDate" in details && (
                <div className="activity-detail-block">
                    <dl className="activity-meta">
                        <div><dt>Sale date</dt><dd>{details.saleDate}</dd></div>
                        <div><dt>Sold by</dt><dd>{details.soldBy || "Not recorded"}</dd></div>
                        <div><dt>Total</dt><dd className="activity-total">{formatMoney(details.totalAmount)}</dd></div>
                        <div><dt>Discount</dt><dd>{formatMoney(details.discount)}</dd></div>
                    </dl>
                    {details.notes && (
                        <div className="activity-notes">
                            <strong>Sales Notes</strong>
                            <p>{details.notes}</p>
                        </div>
                    )}
                    <div className="activity-item-list">
                        {details.items.map((item, index) => (
                            <section className="activity-item" key={`${item.productId}-${item.packagingUnitId}-${index}`}>
                                <h3>{item.productName ?? item.productId}</h3>
                                {item.variantLabel && <p>{item.variantLabel}</p>}
                                <p>{item.quantity} {item.packagingUnitName ?? "unit"}</p>
                                <dl className="activity-meta">
                                    <div><dt>Unit price</dt><dd>{formatMoney(item.unitPrice)}</dd></div>
                                    <div><dt>Line amount</dt><dd>{formatMoney(item.lineAmount)}</dd></div>
                                </dl>
                                {item.allocations.length > 0 && (
                                    <ul className="activity-compact-list activity-allocations">
                                        {item.allocations.map((allocation, allocationIndex) => (
                                            <li key={`${allocation.batchNumber ?? "batch"}-${allocationIndex}`}>
                                                <span>{allocation.quantity} allocated</span>
                                                <span>Batch: {allocation.batchNumber || "Not recorded"}</span>
                                                <span>Expiry: {allocation.expiryDate || "Not recorded"}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        ))}
                    </div>
                </div>
            )}
        </article>
    );
};

export const ActivityTimeline = ({ records }: { records: ActivityRecord[] }) => (
    records.length === 0
        ? <p className="activity-empty">No activity matches your search.</p>
        : <div className="activity-list">{records.map((record) => <ActivityEntry key={record.id} record={record} />)}</div>
);

const ActivityPage = () => {
    const [records, setRecords] = useState<ActivityRecord[]>([]);
    const [filter, setFilter] = useState<ActivityFilter>("all");
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let active = true;
        const load = async () => {
            try {
                const activities = await getActivities();
                if (active) setRecords(activities);
            } catch (loadError) {
                if (active) setError(loadError instanceof Error ? loadError.message : "Failed to load activity");
            } finally {
                if (active) setLoading(false);
            }
        };

        void load();
        return () => { active = false; };
    }, []);

    const visibleRecords = filterActivityRecords(records, filter, search);

    return (
        <main className="activity-page">
            <h1>Activity</h1>
            <div className="activity-controls">
                <input
                    type="search"
                    aria-label="Search activity"
                    placeholder="Search activity..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                />
                <select
                    aria-label="Filter activity"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value as ActivityFilter)}
                >
                    {activityFilterOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
            </div>
            {error && <p role="alert" className="activity-error">{error}</p>}
            {loading
                ? <p className="activity-empty">Loading activity...</p>
                : <ActivityTimeline records={visibleRecords} />}
        </main>
    );
};

export default ActivityPage;