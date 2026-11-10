import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;
export type Row = Record<string, string | number | null>;

/** The whole data model: thirteen tables. Money is whole cents; dates are ISO text. */
const SCHEMA_V1 = `
create table settings (
  key text primary key,
  value text not null
);
create table categories (
  id integer primary key,
  name text not null,
  grp text not null,
  kind text not null default 'expense' check (kind in ('expense', 'income')),
  sort integer not null default 0,
  icon text,
  rollover integer not null default 0,
  archived integer not null default 0
);
create table budget_lines (
  month text not null,
  person text not null check (person in ('a', 'b')),
  category_id integer not null references categories(id),
  planned_cents integer not null,
  primary key (month, person, category_id)
);
create table months (
  month text not null,
  person text not null check (person in ('a', 'b')),
  start_balance_cents integer not null default 0,
  primary key (month, person)
);
create table recurring (
  id integer primary key,
  name text not null,
  category_id integer references categories(id),
  cadence text not null default 'monthly',
  due_day integer,
  next_date text,
  amount_cents integer not null default 0,
  paid_by text not null default 'a' check (paid_by in ('a', 'b')),
  split_json text not null,
  fund_id integer references funds(id),
  account text,
  active integer not null default 1
);
create table funds (
  id integer primary key,
  name text not null,
  owner text not null default 'a',
  target_cents integer,
  opening_cents integer not null default 0,
  archived integer not null default 0
);
create table merchants (
  name text primary key,
  category_id integer references categories(id),
  split_json text,
  updated_at text not null
);
create table imports (
  id integer primary key,
  created_at text not null,
  source text not null,
  note text
);
create table balance_checks (
  id integer primary key,
  account text not null,
  owner text not null,
  kind text not null,
  as_of text not null,
  balance_cents integer not null,
  source text not null default 'typed'
);
create table entries (
  id integer primary key,
  date text not null,
  description text not null,
  amount_cents integer not null,
  kind text not null check (kind in ('expense', 'income', 'settlement')),
  category_id integer references categories(id),
  paid_by text not null check (paid_by in ('a', 'b')),
  account text,
  split_json text not null,
  a_cents integer not null,
  b_cents integer not null,
  fund_id integer references funds(id),
  from_fund integer not null default 0,
  recurring_id integer references recurring(id),
  import_id integer references imports(id),
  split_of integer references entries(id),
  seen_in_bank integer not null default 0,
  note text,
  created_at text not null,
  updated_at text not null
);
create index entries_date on entries(date);
create table paychecks (
  id integer primary key,
  person text not null,
  period_start text not null,
  period_end text not null,
  pay_date text not null,
  no_benefits integer not null default 0,
  actual_gross_cents integer,
  actual_net_cents integer,
  note text
);
create table work_days (
  date text not null,
  person text not null,
  hours real not null default 0,
  tag text not null default 'worked',
  note text,
  primary key (date, person)
);
create table pay_profiles (
  id integer primary key,
  person text not null,
  effective_date text not null,
  kind text not null default 'hourly',
  rate_cents integer,
  net_per_check_cents integer,
  schedule_json text,
  w4_json text,
  deductions_json text
);
`;

/** v2: remember the last month each bill template created an entry for, so a deleted bill is not recreated. */
const SCHEMA_V2 = `alter table recurring add column last_generated text;`;

/** A fund is fed by one budget category, and may count toward the emergency runway. */
const SCHEMA_V3 = `
alter table funds add column category_id integer references categories(id);
alter table funds add column emergency integer not null default 0;
`;

/** Rollover starts in the month it is switched on, so old months are not swept in after the fact. */
const SCHEMA_V4 = `
alter table categories add column rollover_from text;
`;

const MIGRATIONS: string[] = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4];
export const MIGRATION_COUNT = MIGRATIONS.length;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec("pragma foreign_keys = on");
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  const current = (db.prepare("pragma user_version").get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`pragma user_version = ${v + 1}`);
    });
  }
}

/** Run `fn` inside one transaction; any error rolls everything back. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("begin immediate");
  try {
    const result = fn();
    db.exec("commit");
    return result;
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

export const all = <T = Row>(db: Db, sql: string, ...params: (string | number | null)[]) =>
  db.prepare(sql).all(...params) as T[];
export const get = <T = Row>(db: Db, sql: string, ...params: (string | number | null)[]) =>
  db.prepare(sql).get(...params) as T | undefined;
export const run = (db: Db, sql: string, ...params: (string | number | null)[]) => db.prepare(sql).run(...params);
