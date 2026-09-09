import type { Timestamp } from "firebase/firestore";

export function formatDate(value?: Timestamp | Date | null): string {
  if (!value) return "未設定";
  const date = value instanceof Date ? value : value.toDate();
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function toDateInputValue(value?: Timestamp | Date | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : value.toDate();
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** <input type="date"> の値（YYYY-MM-DD）をローカル時刻の Date にする。toDateInputValue の逆。 */
export function fromDateInputValue(value: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function daysUntil(value?: Timestamp | Date | null): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : value.toDate();
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.ceil((target - start) / (1000 * 60 * 60 * 24));
}

export function isExpiringSoon(value?: Timestamp | Date | null, withinDays = 7): boolean {
  const days = daysUntil(value);
  return days !== null && days >= 0 && days <= withinDays;
}

export function isExpired(value?: Timestamp | Date | null): boolean {
  const days = daysUntil(value);
  return days !== null && days < 0;
}
