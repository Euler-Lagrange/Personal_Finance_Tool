import type { PayObservation, PayForecast } from "./payTypes";
export type PayCashPlan = {
  periodId: string;
  forecastId: string;
  name: string;
  payDate: string;
  targets: { accountId: string; cents: number }[];
  complete: boolean;
  cancelled: boolean;
  note: string;
};
export type PayDeposit = {
  eventId: string;
  revision: number;
  date: string;
  description: string;
  accountId: string;
  amountCents: number;
  availableCents: number;
  allocatedCents: number;
  suggested: boolean;
};
export type PayCashPlanView = {
  plan: PayCashPlan;
  expectedCents: number;
  depositedCents: number;
  varianceCents: number;
  remainingCents: number;
  changed: boolean;
  deposits: PayDeposit[];
};
export type PayTakeover = {
  scheduleId: string;
  fromDate: string;
  reason: string;
};
export type PayCashView = {
  revision: number;
  plans: PayCashPlanView[];
  schedules: {
    id: string;
    revision: number;
    anchor: string;
    cadence: string;
    archived: boolean;
    plan: { name: string; amount: string; accountId: string };
  }[];
  takeovers: Record<string, PayTakeover>;
  finalized: Record<string, boolean>;
};
export type PaidMonth = {
  month: string;
  approvedNetCents: number;
  allocatedNetCents: number;
  knownPaychecks: PayObservation[];
  plans: PayCashPlanView[];
  selectedPredictions: PayForecast[];
  allocatedDeposits: PayDeposit[];
  finalized: { periodId: string; reason: string }[];
};
export type PayAnnualView = {
  year: number;
  work: {
    month: string;
    recordedDays: number;
    unrecordedPlannedDays: number;
    worked: number;
    sick: number;
    unpaid: number;
    earnedGrossCents: number | null;
  }[];
  paid: PaidMonth[];
};
