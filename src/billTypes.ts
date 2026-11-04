import type { Person, EntryLine, LineInput } from "./types";
export interface BillDetails {
  name: string;
  merchant: string;
  categoryId: string;
  accountId: string | null;
  payer: Person;
  splitMode: string;
  splitValue: string;
  autopay: boolean;
  paymentKind?: "expense" | "debt_payment";
}
export interface BillPlan extends BillDetails {
  amountCents: number;
  lines?: EntryLine[];
}
export interface BillDraft extends BillDetails {
  amount: string;
  lines?: LineInput[];
}
export interface BillTemplate {
  id: string;
  revision: number;
  firstDue: string;
  everyMonths: number;
  endDate: string | null;
  archived: boolean;
  plan: BillPlan;
}
export interface BillPayment {
  id: string;
  eventId: string;
  date: string;
  description: string;
  amountCents: number;
}
export interface BillOccurrence {
  id: string;
  billId: string;
  period: string;
  revision: number;
  dueDate: string;
  plan: BillPlan;
  actualCents: number | null;
  cancelled: boolean;
  note: string;
  paidCents: number;
  remainingCents: number;
  previousCents: number | null;
  payments: BillPayment[];
  evidence: { id: string; name: string }[];
}
export interface BillCandidate {
  id: string;
  revision: number;
  date: string;
  description: string;
  amountCents: number;
  availableCents: number;
  suggested: boolean;
}
