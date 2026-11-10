/** One value in an exported table. Money is whole cents; a date is an ISO day. */
export type ExportCell = string | number | null | { money: number } | { date: string };

export interface ExportSheet {
  name: string;
  rows: ExportCell[][];
}

const text = (cell: ExportCell): string => {
  if (cell === null) return "";
  if (typeof cell === "object") return "money" in cell ? (cell.money / 100).toFixed(2) : cell.date;
  return String(cell);
};

/** Comma-separated text that spreadsheets open directly. Values with commas, quotes or line breaks are quoted. */
export function toCsv(rows: ExportCell[][]): string {
  return rows.map((row) => row.map((cell) => (/[",\r\n]/.test(text(cell)) ? `"${text(cell).replace(/"/g, '""')}"` : text(cell))).join(",")).join("\r\n") + "\r\n";
}
