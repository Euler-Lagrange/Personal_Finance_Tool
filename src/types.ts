export type Workspace = "demo" | "personal";
export type EntryKind =
  | "unclassified"
  | "expense"
  | "income"
  | "settlement"
  | "transfer"
  | "card_payment"
  | "refund"
  | "debt_payment"
  | "reward"
  | "paypal_cashout";
export const isBudgetOutflow = (kind: string) =>
  kind === "expense" || kind === "debt_payment";
export const isTransfer = (kind: EntryKind) =>
  kind === "transfer" || kind === "card_payment";
export type Person = "jacob" | "chelsea";
export const accountKindLabel = {
  checking: "Checking",
  credit: "Credit card",
  savings: "Savings",
};
export interface Entry {
  budgetOverride?: { month: string | null; reason: string } | null;
  movementLink?: string | null;
  activityDates?: { accountId: string; date: string }[];
  pending?: {
    direction: string;
    verifiedExpense: boolean;
    kindHint?: "card_payment" | "transfer" | null;
    categoryId: string | null;
  } | null;
  id: string;
  revision: number;
  kind: EntryKind;
  date: string;
  description: string;
  amountCents: number;
  payer: Person;
  categoryId: string | null;
  accountId: string | null;
  destinationAccountId: string | null;
  splitMode: string;
  splitValue: string;
  jacobCents: number;
  chelseaCents: number;
  householdDeltaCents: number;
  note: string;
  originalEventId?: string | null;
  lines?: EntryLine[];
  paypal?: PayPalInput | null;
}
export interface EntryInput {
  budgetOverride?: { month: string | null; reason: string } | null;
  id: string;
  revision: number;
  kind: EntryKind;
  date: string;
  description: string;
  amount: string;
  payer: Person;
  categoryId: string | null;
  accountId: string | null;
  destinationAccountId: string | null;
  splitMode: string;
  splitValue: string;
  note: string;
  originalEventId?: string | null;
  lines?: LineInput[];
  paypal?: PayPalInput | null;
}
export interface LineInput {
  id: string;
  label: string;
  categoryId: string;
  amount: string;
  splitMode: string;
  splitValue: string;
  originalLineId?: string | null;
}
export interface EntryLine extends Omit<LineInput, "amount"> {
  amountCents: number;
  jacobCents: number;
  chelseaCents: number;
}
export interface Account {
  id: string;
  name: string;
  kind: "checking" | "credit" | "savings";
  activityCents: number;
  revision: number;
  archived: boolean;
  trackingMode?: "imported" | "manual" | "untracked";
  balance?: {
    checkpointDate: string;
    checkpointCents: number;
    knownChangeCents: number;
    estimatedCents: number;
    throughDate: string;
  } | null;
}
export interface Category {
  rolloverCents?: number;
  availableCents?: number;
  rolloverMode?: "reset" | "carry";
  rolloverToken?: string;
  id: string;
  name: string;
  groupName: string;
  color: string;
  limitCents: number;
  spentCents: number;
  provisionalCents?: number;
  allowanceCents?: number;
  goalExcludedCents?: number;
  defaultLimitCents: number;
  revision: number;
  archived: boolean;
  icon: string;
}
export interface Snapshot {
  period?: { closed: boolean; changed: boolean; closedAt: string } | null;
  workspace: Workspace;
  month: string;
  entries: Entry[];
  householdEntries: Entry[];
  accounts: Account[];
  categories: Category[];
  spentCents: number;
  incomeCents: number;
  consumptionCents?: number;
  debtPaymentCents?: number;
  cashRewardCents?: number;
  cardRewardCents?: number;
  budgetCents: number;
  budgetConfigured: boolean;
  remainingCents: number;
  householdCents: number;
  householdMonthSpentCents: number;
  monthlyCount: number;
  incompleteImports: number;
  provisionalAllowanceCents?: number;
  allowanceCents?: number;
  goalExcludedCents?: number;
  pendingFundingCount?: number;
  fundingReviewEntries?: Entry[];
  unclassifiedCount?: number;
  dataPath: string;
  backups: string[];
}

export interface PayPalInput {
  receipts: { id: string; revision: number; amount: string }[];
  fee: string;
  feeCategoryId: string | null;
  other: string;
  otherNote: string;
}
export interface PayPalReceipt {
  id: string;
  revision: number;
  date: string;
  description: string;
  amountCents: number;
  availableCents: number;
}
export interface HouseholdOpening {
  revision: number;
  date: string;
  amountCents: number;
  note: string;
}
