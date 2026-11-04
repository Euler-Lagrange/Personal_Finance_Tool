import { invoke, isTauri } from "@tauri-apps/api/core";
export const desktop = isTauri();
export async function command<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!desktop)
    throw new Error(
      "Open the desktop app with npm run desktop. Financial data is stored by the desktop app, not the browser.",
    );
  return invoke<T>(name, args);
}
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
export const dollars = (cents: number) => (cents / 100).toFixed(2);
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const monthName = (month: string) =>
  new Date(`${month}-02T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
export const shortDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
