import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "./db";
import { createApi, type CoreApi } from "./api";
import type { View } from "../shared/types";

let api: CoreApi;
let clothes: number;
let paycheck: number;

const spend = (date: string, amount_cents: number, over: object = {}) =>
  api["entries.create"]({ date, description: "Shop", amount_cents, kind: "expense", category_id: clothes, paid_by: "a", split: { type: "percent", a: 100 }, ...over });
const row = (month: string, view: View = "a") => api["budget.get"]({ month, view }).rows.find((r) => r.category_id === clothes)!;
const plan = (month: string, planned_cents: number, person: "a" | "b" = "a") => api["budget.setPlanned"]({ month, person, category_id: clothes, planned_cents });

beforeEach(() => {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = on");
  migrate(db);
  api = createApi(db, { now: () => new Date("2026-12-05T12:00:00Z") });
  const cats = api["categories.list"]();
  clothes = cats.find((c) => c.name === "Hobbies")!.id;
  paycheck = cats.find((c) => c.name === "Paycheck")!.id;
  plan("2026-09", 10000);
  spend("2026-09-10", 2000);
});

describe("budget rollover", () => {
  it("is off until switched on, and then starts with that month", () => {
    expect(row("2026-10")).toMatchObject({ carried: 0, rollover: false });
    api["categories.update"]({ id: clothes, patch: { rollover_from: "2026-10" } });
    // September was before rollover began, so its unused $80 is not swept in.
    expect(row("2026-10")).toMatchObject({ carried: 0, rollover: true, planned: 10000 });
    spend("2026-10-12", 6000);
    expect(row("2026-11").carried).toBe(4000);
    // November's own plan was copied forward when it was first looked at.
    spend("2026-11-03", 15000);
    expect(row("2026-12").carried).toBe(4000 + 10000 - 15000);
    expect(row("2026-10").carried).toBe(0);
  });

  it("follows a changed plan, a month never opened, and purchases paid from a fund", () => {
    api["categories.update"]({ id: clothes, patch: { rollover_from: "2026-10" } });
    plan("2026-10", 12000);
    // November is never opened: it stands on October's plan. The fund purchase is not budget spending.
    const fund = api["funds.create"]({ name: "Wardrobe", owner: "a", target_cents: null, category_id: null, emergency: false, balance_cents: 50000 });
    spend("2026-11-08", 9000, { paid_from_fund: fund });
    spend("2026-11-09", 1000);
    expect(row("2027-01").carried).toBe(12000 + (12000 - 1000) + 12000);
  });

  it("adds both people's carry in the household view and keeps each person's own", () => {
    api["categories.update"]({ id: clothes, patch: { rollover_from: "2026-10" } });
    plan("2026-10", 5000, "b");
    spend("2026-10-05", 4000, { split: { type: "percent", a: 50 } });
    expect(row("2026-11", "a").carried).toBe(10000 - 2000);
    expect(row("2026-11", "b").carried).toBe(5000 - 2000);
    expect(row("2026-11", "hh").carried).toBe(11000);
  });

  it("stops when switched off, and can be undone", () => {
    api["categories.update"]({ id: clothes, patch: { rollover_from: "2026-10" } });
    expect(api["categories.list"]().find((c) => c.id === clothes)!.rollover_from).toBe("2026-10");
    api["categories.update"]({ id: clothes, patch: { rollover_from: null } });
    expect(row("2026-12")).toMatchObject({ carried: 0, rollover: false });
    api["undo.run"]();
    expect(row("2026-12").carried).toBe(20000);
    expect(() => api["categories.update"]({ id: paycheck, patch: { rollover_from: "2026-10" } })).toThrow("spending categories");
    expect(() => api["categories.update"]({ id: clothes, patch: { rollover_from: "October" } })).toThrow("not valid");
  });

  it("shows in the statement's Left column", () => {
    api["categories.update"]({ id: clothes, patch: { rollover_from: "2026-10" } });
    const group = api["statement.data"]({ month: "2026-11", person: "a" }).budget.groups.find((g) => g.rows.some((r) => r.name === "Hobbies"))!;
    expect(group.rows.find((r) => r.name === "Hobbies")).toEqual({ name: "Hobbies", planned: 10000, actual: 0, carried: 10000 });
  });
});
