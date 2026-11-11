/** The columns of the Transactions table, in their out-of-the-box order. */
export const TX_COLUMNS = [
  { id: "date", label: "Date", required: true },
  { id: "description", label: "Description", required: true },
  { id: "category", label: "Category", required: true },
  { id: "paid_by", label: "Paid by", required: false },
  { id: "split", label: "Split", required: false },
  { id: "fund", label: "Paid from", required: false },
  { id: "account", label: "Account", required: false },
  { id: "note", label: "Note", required: false },
  { id: "amount", label: "Amount", required: true },
  { id: "share", label: "Share", required: false },
] as const;

export type TxColumnId = (typeof TX_COLUMNS)[number]["id"];

/** One PC's choice of columns: every column in the order wanted, and which optional ones are ticked. */
export interface ColumnPrefs {
  order: TxColumnId[];
  shown: TxColumnId[];
}

const ALL: TxColumnId[] = TX_COLUMNS.map((c) => c.id);
const isColumn = (value: unknown): value is TxColumnId => ALL.includes(value as TxColumnId);
export const DEFAULT_SHOWN: TxColumnId[] = ["paid_by", "split", "share"];

/**
 * Reads saved preferences, whatever state they are in. Unknown names are dropped, and a column
 * the saved order has never heard of (one added in a later version) keeps its default neighbour.
 */
export function readColumnPrefs(savedOrder: unknown, savedShown: unknown): ColumnPrefs {
  const order = Array.isArray(savedOrder) ? [...new Set(savedOrder.filter(isColumn))] : [];
  for (const id of ALL) {
    if (order.includes(id)) continue;
    const before = ALL.slice(0, ALL.indexOf(id)).reverse().find((x) => order.includes(x));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id);
  }
  return { order, shown: Array.isArray(savedShown) ? [...new Set(savedShown.filter(isColumn))] : DEFAULT_SHOWN };
}

/**
 * Moves a column one place earlier (-1) or later (+1) among the columns on offer, by swapping it
 * with its neighbour there. Columns not on offer keep their places.
 */
export function moveColumn(order: TxColumnId[], offered: TxColumnId[], id: TxColumnId, by: -1 | 1): TxColumnId[] {
  const list = order.filter((c) => offered.includes(c));
  const neighbour = list[list.indexOf(id) + by];
  if (!list.includes(id) || neighbour === undefined) return order;
  return order.map((c) => (c === id ? neighbour : c === neighbour ? id : c));
}

/** The columns to draw, in order: the required ones, the ticked ones, and any that must show right now. */
export function visibleColumns(prefs: ColumnPrefs, offered: TxColumnId[], forced: TxColumnId[] = []): TxColumnId[] {
  return prefs.order.filter((id) => offered.includes(id) && (TX_COLUMNS.find((c) => c.id === id)!.required || prefs.shown.includes(id) || forced.includes(id)));
}
