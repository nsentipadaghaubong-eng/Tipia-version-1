import { describe, expect, it } from "vitest";
import { classifyExpiry, getDaysUntilExpiry, isValidExpiryDate } from "./expirySemantics";

describe("expiry date-only semantics", () => {
    const referenceDate = "2026-09-29";

    it.each([
        ["yesterday", "2026-09-28", -1],
        ["today", "2026-09-29", 0],
        ["tomorrow", "2026-09-30", 1],
        ["several days before", "2026-09-20", -9],
        ["several days after", "2026-10-10", 11],
    ])("calculates the calendar-day difference for %s", (_label, expiryDate, expectedDays) => {
        expect(getDaysUntilExpiry(expiryDate, referenceDate)).toBe(expectedDays);
    });

    it.each([
        "2026-09-29",
        "2024-02-29",
        "0000-02-29",
        "2026-04-30",
    ])("accepts valid date %s", (value) => {
        expect(isValidExpiryDate(value)).toBe(true);
    });

    it.each([
        "",
        "2026-9-29",
        "2026/09/29",
        "2026-09-29T00:00:00Z",
        "2026-02-30",
        "2023-02-29",
        "2026-13-01",
        "2026-04-31",
        "abc",
    ])("rejects invalid date %s", (value) => {
        expect(isValidExpiryDate(value)).toBe(false);
        expect(getDaysUntilExpiry(value, referenceDate)).toBeNull();
    });

    it("treats null, undefined, and empty as missing", () => {
        expect(classifyExpiry(null, referenceDate)).toEqual({ state: "missing" });
        expect(classifyExpiry(undefined, referenceDate)).toEqual({ state: "missing" });
        expect(classifyExpiry("", referenceDate)).toEqual({ state: "missing" });
    });

    it("classifies malformed expiry and reference dates as invalid", () => {
        expect(classifyExpiry("2026-02-30", referenceDate)).toEqual({ state: "invalid" });
        expect(classifyExpiry("2026-09-30", "2026/09/29")).toEqual({ state: "invalid" });
    });

    it("classifies expired, today, near, and valid dates", () => {
        expect(classifyExpiry("2026-09-28", referenceDate)).toEqual({ state: "expired", daysUntilExpiry: -1 });
        expect(classifyExpiry("2026-09-29", referenceDate)).toEqual({ state: "expiresToday", daysUntilExpiry: 0 });
        expect(classifyExpiry("2026-09-30", referenceDate)).toEqual({ state: "expiringSoon", daysUntilExpiry: 1 });
        expect(classifyExpiry("2026-12-28", referenceDate)).toEqual({ state: "expiringSoon", daysUntilExpiry: 90 });
        expect(classifyExpiry("2026-12-29", referenceDate)).toEqual({ state: "valid", daysUntilExpiry: 91 });
    });

    it("handles leap day and month/year boundaries as calendar days", () => {
        expect(getDaysUntilExpiry("2024-03-01", "2024-02-29")).toBe(1);
        expect(getDaysUntilExpiry("2025-01-01", "2024-12-31")).toBe(1);
    });

    it("does not shift date-only values through timezone or time-of-day conversion", () => {
        expect(getDaysUntilExpiry("2026-09-29", "2026-09-29")).toBe(0);
        expect(getDaysUntilExpiry("2026-09-30", "2026-09-29")).toBe(1);
    });
});