/**
 * Get today's date string in Asia/Tokyo timezone.
 * Returns YYYY-MM-DD
 */
export function todayJST(): string {
  return new Date()
    .toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // sv-SE gives YYYY-MM-DD
}

/**
 * Get current month string in Asia/Tokyo timezone.
 * Returns YYYY-MM
 */
export function currentMonthJST(): string {
  const d = new Date();
  const year = d.toLocaleString("en-US", { timeZone: "Asia/Tokyo", year: "numeric" });
  const month = d.toLocaleString("en-US", { timeZone: "Asia/Tokyo", month: "2-digit" });
  return `${year}-${month}`;
}
