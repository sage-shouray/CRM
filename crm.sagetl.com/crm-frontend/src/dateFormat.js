// Single date-formatting utility for the whole app. Every displayed date uses
// day/month/year order — dd/mm/yyyy — never left to the browser/OS locale's
// own choice, which silently rendered mm/dd/yyyy on a US-configured machine
// and dd/mm/yyyy on others: the same lead showing a different date order
// depending on whose computer opened it.

const pad2 = (n) => String(n).padStart(2, "0");

// "dd/mm/yyyy". Invalid or empty input returns "" rather than "Invalid Date"
// or today's date, so a blank field reads as blank, not wrong.
export function formatDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// "dd/mm/yyyy, HH:mm" — for anything that also carries a time (an audit
// entry, a chat message, a note).
export function formatDateTime(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatDate(d)}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// "dd/mm/yy" — for a tight space (a small chip or badge) where the full
// 4-digit year would crowd the label. Still day/month order, just the short
// 2-digit year, per the same dd/mm rule as everywhere else.
export function formatDateShort(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// A friendly, spelled-out greeting-style date — "Monday, 7 September 2026".
// Built by hand, not `toLocaleDateString(undefined, ...)`: with `undefined`
// as the locale, that call defers to the browser/OS's own locale, which
// renders "September 7, 2026" (month before day) on a US-configured machine
// and "7 September 2026" elsewhere — the exact same inconsistency as the
// numeric dates, just spelled out. Day always comes before month here,
// unconditionally.
export function formatLongDate(value) {
  const d = value ? (value instanceof Date ? value : new Date(value)) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// The same, without the weekday — "7 September 2026".
export function formatMediumDate(value) {
  const d = value ? (value instanceof Date ? value : new Date(value)) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// Compact "Mon, 7 Sep" — weekday + day + short month, no year. For a list of
// recent entries where the year is implied.
export function formatShortWeekday(value) {
  const d = value ? (value instanceof Date ? value : new Date(value)) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return `${WEEKDAYS[d.getDay()].slice(0, 3)}, ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

// "7 Sep" — day + short month, no year, no weekday. A card badge where the
// year is implied and a weekday would be one word too many.
export function formatDayMonth(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}
