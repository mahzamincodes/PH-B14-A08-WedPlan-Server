import { ObjectId } from "mongodb";

/**
 * Validates whether a value is a 24-character hexadecimal MongoDB ObjectId string.
 * @param {unknown} id - The value to validate.
 * @returns {boolean} True if the value is a valid ObjectId hex string.
 */
export function isValidObjectId(id) {
    return typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * Safely converts a valid ObjectId hex string into a MongoDB ObjectId instance.
 * Throws a clear error if the ID is invalid.
 * @param {string} id - The ObjectId hex string to convert.
 * @returns {import("mongodb").ObjectId} A MongoDB ObjectId instance.
 * @throws {Error} If the ID is not a valid 24-character hexadecimal string.
 */
export function toObjectId(id) {
    if (!isValidObjectId(id)) {
        throw new Error(
            `Invalid ObjectId: "${id}". Expected a 24-character hexadecimal string.`
        );
    }
    return new ObjectId(id);
}

/**
 * Normalizes a calendar date string (YYYY-MM-DD) to a JavaScript Date at UTC midnight.
 * Strictly validates the calendar date and rejects impossible dates (e.g., 2026-02-30).
 * The same function must be used for both booking inserts and duplicate checks.
 * @param {unknown} value - The date value to normalize.
 * @returns {Date} A Date object set to UTC midnight of the given calendar date.
 * @throws {Error} If the value is not a strict YYYY-MM-DD string or is an impossible calendar date.
 */
export function normalizeEventDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(
            `Invalid event date: "${value}". Expected a strict YYYY-MM-DD date string.`
        );
    }

    const [yearStr, monthStr, dayStr] = value.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);

    // Validate month range explicitly.
    if (month < 1 || month > 12) {
        throw new Error(
            `Invalid calendar date: "${value}" is not a real date.`
        );
    }

    // Build the date starting from the epoch, set UTC midnight, then set the
    // actual calendar components. setUTCFullYear does NOT remap years 0-99 to
    // 1900-1999 (unlike Date.UTC), so valid four-digit years like 0099 are
    // preserved exactly as supplied.
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);

    // Validate all three components round-trip correctly. This rejects
    // impossible dates like 2026-02-30 (which rolls into March).
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        throw new Error(
            `Invalid calendar date: "${value}" is not a real date.`
        );
    }

    return date;
}
