export type ExpiryClassification =
    | { state: "missing" }
    | { state: "invalid" }
    | { state: "expired"; daysUntilExpiry: number }
    | { state: "expiresToday"; daysUntilExpiry: 0 }
    | { state: "expiringSoon"; daysUntilExpiry: number }
    | { state: "valid"; daysUntilExpiry: number };

type CalendarDate = {
    year: number;
    month: number;
    day: number;
};

const daysInMonth = (year: number, month: number): number => {
    if (month === 2) {
        const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        return isLeapYear ? 29 : 28;
    }

    return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

const parseCalendarDate = (value: string): CalendarDate | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
        return null;
    }

    return { year, month, day };
};

const toDayNumber = ({ year, month, day }: CalendarDate): number => {
    const previousYear = year - 1;
    let dayNumber = previousYear * 365
        + Math.floor(previousYear / 4)
        - Math.floor(previousYear / 100)
        + Math.floor(previousYear / 400);

    for (let currentMonth = 1; currentMonth < month; currentMonth++) {
        dayNumber += daysInMonth(year, currentMonth);
    }

    return dayNumber + day - 1;
};

export const isValidExpiryDate = (value: string | null | undefined): value is string =>
    typeof value === "string" && parseCalendarDate(value) !== null;

export const getDaysUntilExpiry = (
    expiryDate: string,
    referenceDate: string
): number | null => {
    const expiry = parseCalendarDate(expiryDate);
    const reference = parseCalendarDate(referenceDate);
    if (!expiry || !reference) return null;

    return toDayNumber(expiry) - toDayNumber(reference);
};

export const classifyExpiry = (
    expiryDate: string | null | undefined,
    referenceDate: string
): ExpiryClassification => {
    if (expiryDate === null || expiryDate === undefined || expiryDate === "") {
        return { state: "missing" };
    }

    const daysUntilExpiry = getDaysUntilExpiry(expiryDate, referenceDate);
    if (daysUntilExpiry === null) {
        return { state: "invalid" };
    }
    if (daysUntilExpiry < 0) {
        return { state: "expired", daysUntilExpiry };
    }
    if (daysUntilExpiry === 0) {
        return { state: "expiresToday", daysUntilExpiry: 0 };
    }
    if (daysUntilExpiry <= 90) {
        return { state: "expiringSoon", daysUntilExpiry };
    }

    return { state: "valid", daysUntilExpiry };
};