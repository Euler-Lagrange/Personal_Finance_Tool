import type { Cents } from "../core/money";
import type { Person, SplitSpec } from "../core/split";
import type { EntryKind } from "../core/balance";
import type { YearRow } from "../core/year";

export type View = Person | "hh";

export interface SplitPreset {
  label: string;
  spec: SplitSpec;
}

export interface Settings {
  people: Record<Person, string>;
  defaultSplit: SplitSpec;
  presets: SplitPreset[];
  groups: string[];
  /** Target share of planned income per group, in percent, per person. `hh` is the household's, used while finances are merged. */
  targets: Record<Person, Record<string, number>> & { hh?: Record<string, number> };
  /** Balance carried in from before the app. Positive: B owes A. */
  openingBalanceCents: Cents;
  /** One household budget: splits, each person's own budget and the balance are hidden. Nothing is converted. */
  mergedFinances: boolean;
}

export interface Category {
  id: number;
  name: string;
  grp: string;
  kind: "expense" | "income";
  sort: number;
  icon: string | null;
  /** The month from which what is unused or overspent carries into the next month. Null when rollover is off. */
  rollover_from: string | null;
  archived: boolean;
}

/** A bill's split: follow the household default, or a split of its own. */
export type TemplateSplit = SplitSpec | { type: "default" };

/** One recurring bill, with this month's entry if it has been created. */
export interface BillRow {
  id: number;
  name: string;
  category_id: number | null;
  category_name: string | null;
  due_day: number;
  expected_cents: Cents;
  paid_by: Person;
  split: TemplateSplit;
  active: boolean;
  entry: { id: number; date: string; amount_cents: Cents; a_cents: Cents; b_cents: Cents; seen_in_bank: boolean } | null;
  /** The amount of the most recent earlier month, to show when a bill has changed. */
  previous_cents: Cents | null;
}

export interface BillInput {
  name: string;
  category_id: number | null;
  due_day: number;
  amount_cents: Cents;
  paid_by: Person;
  split: TemplateSplit;
}

export interface Entry {
  id: number;
  date: string;
  description: string;
  amount_cents: Cents;
  kind: EntryKind;
  category_id: number | null;
  category_name: string | null;
  paid_by: Person;
  account: string | null;
  split: SplitSpec;
  a_cents: Cents;
  b_cents: Cents;
  /** Set together: the purchase was paid from this fund, so it is in neither the budget nor the balance. */
  fund_id: number | null;
  from_fund: boolean;
  split_of: number | null;
  recurring_id: number | null;
  seen_in_bank: boolean;
  note: string | null;
}

export interface EntryInput {
  date: string;
  description: string;
  amount_cents: Cents;
  kind: EntryKind;
  category_id: number | null;
  paid_by: Person;
  split?: SplitSpec;
  account?: string | null;
  note?: string | null;
  /** The fund this purchase was paid from, or null when it came out of the month's budget. */
  paid_from_fund?: number | null;
}

export type EntryPatch = Partial<EntryInput>;

export interface BackupFile {
  file: string;
  device: string;
  takenAt: string;
  bytes: number;
}

export interface BackupStatus {
  folder: string | null;
  device: string;
  lastBackupAt: string | null;
  lastError: string | null;
  dataFile: string;
}

/** Settings that belong to one PC and never travel with the data file. */
export interface LocalConfig {
  theme: string;
  backupFolder: string | null;
  device: string;
}

/** A setup file: everything needed to start a household without typing it in. */
export interface SetupFile {
  people?: Record<Person, string>;
  defaultSplitA?: number;
  presets?: { label: string; a: number }[];
  groups?: string[];
  targets?: Record<Person, Record<string, number>>;
  openingBalanceCents?: Cents;
  replaceCategories?: boolean;
  categories?: { name: string; group: string; kind?: "expense" | "income"; icon?: string }[];
  budget?: { month: string; a?: Record<string, number>; b?: Record<string, number> };
  pay?: Partial<Record<Person, PaySetup>>;
}

/** One person's pay in a setup file. Amounts are whole cents. */
export interface PaySetup {
  rates: { effective_date: string; kind?: PayKind; rate_cents?: Cents; net_per_check_cents?: Cents }[];
  rule?: "biweekly" | "monthdays";
  anchor?: string;
  lagDays?: number;
  monthDays?: number[];
  sickHoursPerYear?: number;
  usualHours?: number;
  grossGoalCents?: Cents | null;
  incomeCategory?: string;
  history?: KnownPaycheck[];
}

// ---- pay ---------------------------------------------------------------------

export type DayTag = "worked" | "sick" | "holiday" | "off";
export type PayKind = "hourly" | "salaried";

/** A past paycheck whose gross and take-home are both known. */
export interface KnownPaycheck {
  gross_cents: Cents;
  net_cents: Cents;
  no_benefits?: boolean;
}

export interface PaySchedule {
  /** Paid every two weeks, or on set days of the month. */
  rule: "biweekly" | "monthdays";
  /** Every two weeks: the Monday that starts any one real pay period. */
  anchor: string;
  /** Days from the end of a pay period to payday (5 = the following Friday). */
  lagDays: number;
  /** Set days: the paydays, where 31 means the last day of the month. */
  monthDays: number[];
  sickHoursPerYear: number;
  /** Hours a paycheck usually has. A pay period that is not over yet is predicted at this many until more are logged. 0 means no assumption. */
  usualHours: number;
  grossGoalCents: Cents | null;
  /** The income category paychecks are planned under. Null means the first one. */
  incomeCategoryId: number | null;
  /** Known past paychecks, used to predict take-home from gross. */
  history: KnownPaycheck[];
}

export interface PayRate {
  id: number;
  effective_date: string;
  kind: PayKind;
  rate_cents: Cents | null;
  net_per_check_cents: Cents | null;
}

export interface PayProfile {
  person: Person;
  /** The rate in force today. */
  current: PayRate;
  rates: PayRate[];
  schedule: PaySchedule;
}

export interface PayProfileInput extends Omit<PaySchedule, "history"> {
  person: Person;
  kind: PayKind;
  /** A date that already has a rate corrects it; a new date adds a rate from then on. */
  effective_date: string;
  rate_cents: Cents | null;
  net_per_check_cents: Cents | null;
}

export interface PaycheckView {
  /** Null while the paycheck simply follows the schedule and nothing has been typed on it. */
  id: number | null;
  period_start: string;
  period_end: string;
  pay_date: string;
  kind: PayKind;
  /** Hours logged in the pay period, and what they come to at the rate. */
  hours: number;
  gross_cents: Cents;
  /** Set when the pay period is not over and the prediction assumes the usual hours instead of the fewer logged so far. */
  assumed_hours: number | null;
  predicted_net_cents: Cents | null;
  /** The gross is well outside the known paychecks, so the prediction is a guess. */
  uncertain: boolean;
  actual_gross_cents: Cents | null;
  actual_net_cents: Cents | null;
  no_benefits: boolean;
  /** This person's share of bills due from this payday up to the next one. Empty unless asked for. */
  bills: { name: string; date: string; cents: Cents }[];
  bills_cents: Cents;
  /** The month's planned savings, divided across the paychecks landing in that month. Zero unless asked for. */
  set_aside_cents: Cents;
  next_pay_date: string;
}

export interface PaycheckPatch {
  period_start?: string;
  period_end?: string;
  pay_date?: string;
  actual_gross_cents?: Cents | null;
  actual_net_cents?: Cents | null;
  no_benefits?: boolean;
}

export interface PayMonth {
  person: Person;
  profile: PayProfile | null;
  gridStart: string;
  gridEnd: string;
  days: { date: string; hours: number; tag: DayTag }[];
  bankHolidays: { date: string; name: string }[];
  paychecks: PaycheckView[];
  fit: { n: number; error: number; noBenefitsExtra: Cents | null } | null;
  /** The group whose planned amounts count as money set aside from each paycheck. */
  savingsGroup: string | null;
  /** Take-home landing in this month against what the budget plans for. */
  income: { category_id: number | null; category_name: string | null; expected_cents: Cents; planned_cents: Cents; checks: number };
  year: {
    year: string;
    checks: { pay_date: string; gross_cents: Cents; net_cents: Cents; actual: boolean }[];
    hours: number;
    gross_cents: Cents;
    net_cents: Cents;
    sickUsedHours: number;
    hoursToGoal: number | null;
    checksLeft: number;
  };
}

// ---- savings -------------------------------------------------------------------

export interface FundRow {
  id: number;
  name: string;
  /** Whose savings this is: one person's, or the household's. */
  owner: View;
  target_cents: Cents | null;
  /** The budget category that feeds the fund. Every expense in it is money set aside. */
  category_id: number | null;
  category_name: string | null;
  emergency: boolean;
  archived: boolean;
  balance_cents: Cents;
  /** Set aside and paid out in the month on screen. */
  month_in_cents: Cents;
  month_out_cents: Cents;
}

export interface FundInput {
  name: string;
  owner: View;
  target_cents: Cents | null;
  category_id: number | null;
  emergency: boolean;
  /** What is in the fund today. */
  balance_cents: Cents;
}

export interface Runway {
  /** The group whose spending is measured: the first one in Settings. */
  group: string | null;
  emergency_cents: Cents;
  monthly_cents: Cents;
  months: number | null;
  /** Whether the monthly figure is real spending over the months before, or this month's plan. */
  basis: "spending" | "plan";
  monthsUsed: number;
}

/** Something that renews every so many months: a yearly subscription, a registration, a twice-yearly premium. */
export interface RenewalRow {
  id: number;
  name: string;
  category_id: number | null;
  category_name: string | null;
  months: number;
  next_date: string;
  amount_cents: Cents;
  paid_by: Person;
  split: TemplateSplit;
  fund_id: number | null;
  active: boolean;
  a_cents: Cents;
  b_cents: Cents;
}

export interface RenewalInput {
  name: string;
  category_id: number | null;
  months: number;
  next_date: string;
  amount_cents: Cents;
  paid_by: Person;
  split: TemplateSplit;
  fund_id: number | null;
}

export interface RenewalList {
  rows: RenewalRow[];
  /** Each person's share of a year of the active renewals. */
  yearly_cents: Record<Person, Cents>;
  /** Paychecks in a year, from each person's pay schedule. Null until their pay is set up. */
  checksPerYear: Record<Person, number | null>;
}

// ---- the year ------------------------------------------------------------------

export interface YearView {
  year: string;
  /** Months of the year that have any entries. Averages are over these. */
  monthsWithData: number;
  rows: YearRow[];
  /** Hours and pay by the month of the payday, for each person on screen whose pay is set up. */
  pay: { person: Person; hours: number[]; gross_cents: Cents[]; net_cents: Cents[] }[];
  /** Where the money went: the largest totals by description. */
  merchants: { name: string; count: number; cents: Cents }[];
}

export interface ExportRequest {
  scope: "month" | "year";
  /** The month on screen. A year export covers the year this month is in. */
  month: string;
}
