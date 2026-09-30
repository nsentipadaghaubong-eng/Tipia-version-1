import {
    classifyExpiry,
    getDaysUntilExpiry as getDomainDaysUntilExpiry,
} from "../domain/expirySemantics";

export const getCurrentCalendarDate = (referenceDate = new Date()) => {
    const year = referenceDate.getFullYear();
    const month = String(referenceDate.getMonth() + 1).padStart(2, "0");
    const day = String(referenceDate.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

export const getDaysUntilExpiry = (
    expiryDate: string,
    referenceDate = new Date()
): number => {
    const daysUntilExpiry = getDomainDaysUntilExpiry(expiryDate, getCurrentCalendarDate(referenceDate));
    if (daysUntilExpiry === null) {
        throw new RangeError("Expiry and reference dates must be valid YYYY-MM-DD dates");
    }
    return daysUntilExpiry;
};

export const formatExpiryStatus = (expiryDate?: string | null, referenceDate = new Date()) => {
    const classification = classifyExpiry(expiryDate, getCurrentCalendarDate(referenceDate));

    if (classification.state === "missing") return "No expiry date";
    if (classification.state === "invalid") return "Invalid expiry date";
    if (classification.state === "expired") {
        return `Expired ${Math.abs(classification.daysUntilExpiry)} days ago`;
    }
    if (classification.state === "expiresToday") return "Expires today";
    if (classification.daysUntilExpiry === 1) return "1 day left";
    return `${classification.daysUntilExpiry} days left`;
};