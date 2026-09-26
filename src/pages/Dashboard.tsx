import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Delivery, Sale } from "../types/Product";
import {
    getDeliveries,
    getDashboardSummary,
    getSales,
    INVENTORY_CHANGED_EVENT,
    initializeDatabase,
    PENDING_TASKS_CHANGED_EVENT,
    type DashboardQuantity,
    type DashboardStockLine,
    type DashboardSummary,
} from "../database/database";
import { formatExpiryStatus, getDaysUntilExpiry } from "../utils/expiry";

const emptySummary: DashboardSummary = {
    nearExpiry: [],
    expired: [],
    lowStock: [],
    outOfStock: [],
};

const StockList = ({ lines, expired = false }: { lines: DashboardStockLine[]; expired?: boolean }) => (
    <div>
        {lines.length === 0 ? <p>No stock lines.</p> : lines.map((line) => {
            const days = line.expiryDate ? getDaysUntilExpiry(line.expiryDate) : 0;
            return (
                <div
                    key={line.id}
                    style={{
                        border: "1px solid #ddd",
                        borderLeft: `4px solid ${expired || days <= 30 ? "#c62828" : "#e0a000"}`,
                        padding: 10,
                        marginBottom: 8,
                    }}
                >
                    <strong>{line.productName}</strong>{line.variantLabel ? ` (${line.variantLabel})` : ""}
                    <div>{line.quantity} {line.packagingUnitName}</div>
                    <div>Batch: {line.batchNumber || "N/A"}</div>
                    <div>{formatExpiryStatus(line.expiryDate)}</div>
                </div>
            );
        })}
    </div>
);

const QuantityList = ({ entries, emptyLabel }: { entries: DashboardQuantity[]; emptyLabel: string }) => (
    <div>
        {entries.length === 0 ? <p>{emptyLabel}</p> : entries.map((entry) => (
            <div key={`${entry.productId}-${entry.variantId}`} style={{ border: "1px solid #ddd", padding: 10, marginBottom: 8 }}>
                <strong>{entry.productName}</strong>
                {entry.variantLabel ? <div>{entry.variantLabel}</div> : null}
                <div>Current: {entry.quantity} {entry.smallestUnitName}</div>
                <div>Low-stock threshold: {entry.threshold} {entry.smallestUnitName}</div>
            </div>
        ))}
    </div>
);

const Dashboard = () => {
    const navigate = useNavigate();
    const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
    const [expanded, setExpanded] = useState<keyof DashboardSummary | null>(null);
    const [error, setError] = useState("");
    const [pendingDeliveries, setPendingDeliveries] = useState<Delivery[]>([]);
    const [pendingSales, setPendingSales] = useState<Sale[]>([]);

    useEffect(() => {
        const loadSummary = async () => {
            try {
                await initializeDatabase();
                const [nextSummary, deliveries, sales] = await Promise.all([
                    getDashboardSummary(),
                    getDeliveries(),
                    getSales(),
                ]);
                setSummary(nextSummary);
                setPendingDeliveries(deliveries.filter((delivery) => delivery.status === "draft"));
                setPendingSales(sales.filter((sale) => sale.status === "draft"));
            } catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard");
            }
        };

        void loadSummary();
        const refresh = () => void loadSummary();
        window.addEventListener(PENDING_TASKS_CHANGED_EVENT, refresh);
        window.addEventListener(INVENTORY_CHANGED_EVENT, refresh);
        return () => {
            window.removeEventListener(PENDING_TASKS_CHANGED_EVENT, refresh);
            window.removeEventListener(INVENTORY_CHANGED_EVENT, refresh);
        };
    }, []);

    const cards: Array<{ key: keyof DashboardSummary; label: string; value: number }> = [
        { key: "nearExpiry", label: "Near Expiry", value: summary.nearExpiry.length },
        { key: "expired", label: "Already Expired", value: summary.expired.length },
        { key: "lowStock", label: "Low Stock", value: summary.lowStock.length },
        { key: "outOfStock", label: "Out of Stock", value: summary.outOfStock.length },
    ];
    const showSection = (key: keyof DashboardSummary) => expanded === null || expanded === key;

    return (
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
            <h1>Dashboard</h1>
            <p>Inventory issues that need attention.</p>

            <section>
                <h2>Pending Tasks</h2>
                {pendingDeliveries.length === 0 && pendingSales.length === 0 ? (
                    <p>No pending tasks.</p>
                ) : (
                    <div>
                        {pendingDeliveries.map((delivery) => (
                            <button
                                key={`delivery-${delivery.id}`}
                                type="button"
                                onClick={() => navigate("/receive-delivery", {
                                    state: { draftType: "delivery", draftId: delivery.id },
                                })}
                            >
                                <strong>Delivery — {delivery.supplier}</strong>
                                <div>Invoice: {delivery.invoiceNo} | Items: {delivery.items.length} | Date: {delivery.date}</div>
                            </button>
                        ))}
                        {pendingSales.map((sale) => (
                            <button
                                key={`sale-${sale.id}`}
                                type="button"
                                onClick={() => navigate("/sales-page", {
                                    state: { draftType: "sale", draftId: sale.id },
                                })}
                            >
                                <strong>Sale — {sale.items.length} item{sale.items.length === 1 ? "" : "s"}</strong>
                                <div>Total: ₦{sale.totalAmount.toLocaleString()} | Date: {sale.date}</div>
                            </button>
                        ))}
                    </div>
                )}
            </section>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                {cards.map((card) => (
                    <button
                        key={card.key}
                        type="button"
                        onClick={() => setExpanded(expanded === card.key ? null : card.key)}
                        style={{ textAlign: "left", padding: 16, border: "1px solid #ddd", background: "white", cursor: "pointer" }}
                    >
                        <div>{card.label}</div>
                        <strong style={{ fontSize: 28 }}>{card.value}</strong>
                    </button>
                ))}
            </div>

            {error && <p>{error}</p>}

            {showSection("nearExpiry") && <section>
                <h2>Near Expiry</h2>
                <StockList lines={summary.nearExpiry} />
            </section>}
            {showSection("expired") && <section>
                <h2>Already Expired</h2>
                <StockList lines={summary.expired} expired />
            </section>}
            {showSection("lowStock") && <section>
                <h2>Low Stock</h2>
                <QuantityList entries={summary.lowStock} emptyLabel="No low-stock products." />
            </section>}
            {showSection("outOfStock") && <section>
                <h2>Out of Stock</h2>
                <QuantityList entries={summary.outOfStock} emptyLabel="No out-of-stock products." />
            </section>}
        </div>
    );
};

export default Dashboard;
