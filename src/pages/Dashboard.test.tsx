import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DashboardStockLine, DashboardSummary } from "../database/database";
import { DashboardSummaryCards } from "./Dashboard";

const makeLine = (id: string, expiryDate = "2026-09-29"): DashboardStockLine => ({
    id,
    productId: `product-${id}`,
    productName: `Product ${id}`,
    variantId: `variant-${id}`,
    variantLabel: "",
    packagingUnitId: `unit-${id}`,
    packagingUnitName: "Unit",
    quantity: 1,
    expiryDate,
});

const renderCards = (summary: Partial<DashboardSummary> = {}) => renderToStaticMarkup(
    <DashboardSummaryCards
        summary={{
            nearExpiry: [],
            expiresToday: [],
            expired: [],
            lowStock: [],
            outOfStock: [],
            ...summary,
        }}
        onToggle={() => undefined}
    />
);

describe("Dashboard Expires Today card visibility", () => {
    it("does not render the card when no stock lines expire today", () => {
        expect(renderCards()).not.toContain("Expires Today");
    });

    it("renders the card when one stock line expires today", () => {
        expect(renderCards({ expiresToday: [makeLine("today")] })).toContain("Expires Today");
    });

    it("renders the card when multiple stock lines expire today", () => {
        expect(renderCards({ expiresToday: [makeLine("today-1"), makeLine("today-2")] }))
            .toContain("Expires Today");
    });

    it("does not render the card for tomorrow or later expiry lines", () => {
        expect(renderCards({ nearExpiry: [makeLine("tomorrow", "2026-09-30")] })).not.toContain("Expires Today");
        expect(renderCards({ nearExpiry: [makeLine("later", "2026-10-10")] })).not.toContain("Expires Today");
    });

    it("does not render the card for expired lines", () => {
        expect(renderCards({ expired: [makeLine("expired", "2026-09-28")] })).not.toContain("Expires Today");
    });
});