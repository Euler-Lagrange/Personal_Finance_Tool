import type { Cents } from "../core/money";
import type { Person, SplitSpec } from "../core/split";
import type { EntryKind } from "../core/balance";

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
  /** Target share of planned income per group, in percent, per person. */
  targets: Record<Person, Record<string, number>>;
  /** Balance carried in from before the app. Positive: B owes A. */
  openingBalanceCents: Cents;
  mergedFinances: boolean;
}

export interface Category {
  id: number;
  name: string;
  grp: string;
  kind: "expense" | "income";
  sort: number;
  icon: string | null;
  rollover: boolean;
  archived: boolean;
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
  from_fund: boolean;
  split_of: number | null;
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
}
