const dateToUtcDay = (value: string) => {
    const [year, month, day] = value.slice(0, 10).split("-").map(Number);
    return Date.UTC(year, month - 1, day);
};

export const getDaysUntilExpiry = (expiryDate: string, referenceDate = new Date()) => {
    const year = referenceDate.getFullYear();
    const month = String(referenceDate.getMonth() + 1).padStart(2, "0");
    const day = String(referenceDate.getDate()).padStart(2, "0");
    const today = `${year}-${month}-${day}`;
    return Math.round((dateToUtcDay(expiryDate) - dateToUtcDay(today)) / 86400000);
};

export const formatExpiryStatus = (expiryDate?: string | null) => {
    if (!expiryDate) return "No expiry date";

    const days = getDaysUntilExpiry(expiryDate);
    if (days < 0) return `Expired ${Math.abs(days)} days ago`;
    if (days === 0) return "Expires today";
    if (days === 1) return "1 day left";
    return `${days} days left`;
};