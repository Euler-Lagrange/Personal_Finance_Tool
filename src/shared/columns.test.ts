import { describe, expect, it } from "vitest";
import { DEFAULT_SHOWN, TX_COLUMNS, moveColumn, readColumnPrefs, visibleColumns, type TxColumnId } from "./columns";

const all = TX_COLUMNS.map((c) => c.id);

describe("transaction columns", () => {
  it("start in the usual order with the usual three extras", () => {
    const prefs = readColumnPrefs(null, null);
    expect(prefs.order).toEqual(all);
    expect(prefs.shown).toEqual(DEFAULT_SHOWN);
    expect(visibleColumns(prefs, all)).toEqual(["date", "description", "category", "paid_by", "split", "amount", "share"]);
  });

  it("survive saved preferences that are old, damaged or from a newer version", () => {
    expect(readColumnPrefs("nonsense", { a: 1 })).toEqual({ order: all, shown: DEFAULT_SHOWN });
    // An order saved before "fund" and "note" existed: each new column goes after its usual neighbour.
    const old = readColumnPrefs(["amount", "date", "description", "category", "paid_by", "split", "account", "share", "tags", "amount"], ["note", "bogus"]);
    expect(old.order).toEqual(["amount", "date", "description", "category", "paid_by", "split", "fund", "account", "note", "share"]);
    expect(old.shown).toEqual(["note"]);
    expect([...old.order].sort()).toEqual([...all].sort());
    // Everything hidden is a valid choice, not a reason to fall back to the defaults.
    expect(readColumnPrefs(all, []).shown).toEqual([]);
  });

  it("move one place at a time and stop at the ends", () => {
    let order: TxColumnId[] = [...all];
    order = moveColumn(order, all, "amount", -1);
    expect(order.slice(6)).toEqual(["account", "amount", "note", "share"]);
    order = moveColumn(order, all, "date", 1);
    expect(order.slice(0, 3)).toEqual(["description", "date", "category"]);
    expect(moveColumn(order, all, "description", -1)).toBe(order);
    expect(moveColumn(order, all, "share", 1)).toBe(order);
    expect([...order].sort()).toEqual([...all].sort());
  });

  it("skip over columns that are not on offer, leaving them where they were", () => {
    const offered = all.filter((c) => c !== "split" && c !== "share");
    const moved = moveColumn([...all], offered, "fund", -1);
    expect(moved).toEqual(["date", "description", "category", "fund", "split", "paid_by", "account", "note", "amount", "share"]);
    expect(moveColumn([...all], offered, "split", 1)).toEqual(all);
    expect(visibleColumns(readColumnPrefs(all, all), offered)).toEqual(offered);
  });

  it("show a column that is needed right now even when it is not ticked", () => {
    const prefs = readColumnPrefs(null, []);
    expect(visibleColumns(prefs, all)).toEqual(["date", "description", "category", "amount"]);
    expect(visibleColumns(prefs, all, ["fund"])).toEqual(["date", "description", "category", "fund", "amount"]);
  });
});
