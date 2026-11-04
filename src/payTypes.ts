import type { TaxInputs, TaxResult } from "./payTaxTypes";
export type PayEvidence = { sourceId: string; location: string; quote: string };
export type PayPeriod = {
  id: string;
  name: string;
  payDate: string;
  weeks: string[];
  frequency: string;
  benefits: boolean;
  note: string;
  evidence: PayEvidence[];
};
export type PayHolidayChange = {
  date: string;
  name: string | null;
  evidence: PayEvidence | null;
};
export type PaySource = {
  id: string;
  name: string;
  format: string;
  mime: string;
  createdAt: string;
  applications: number;
};
export type PaySourceDetail = {
  source: PaySource;
  document: {
    chunks: { location: string; text: string }[];
    suggestions: {
      kind: string;
      date: string;
      payDate: string;
      name: string;
      frequency: string;
      benefits: boolean;
      location: string;
      quote: string;
    }[];
    warnings: string[];
    payObservations?: {
      input: PayObservationInput;
      location: string;
      quote: string;
    }[];
  };
};
export type PayObservation = {
  id: string;
  periodId: string | null;
  payDate: string;
  worked: number;
  sick: number;
  rate: number;
  grossCents: number;
  netCents: number | null;
  otherGrossCents: number;
  reimbursementCents: number;
  deductions: { name: string; cents: number }[];
  detailComplete: boolean;
  frequency: string;
  benefits: boolean;
  regime: string;
  reviewed: boolean;
  evidence: PayEvidence[];
  note: string;
};
export type PayObservationInput = Omit<
  PayObservation,
  | "worked"
  | "rate"
  | "grossCents"
  | "netCents"
  | "otherGrossCents"
  | "reimbursementCents"
  | "deductions"
> & {
  worked: string;
  rate: string;
  gross: string;
  net: string | null;
  otherGross: string;
  reimbursement: string;
  deductions: { name: string; amount: string }[];
};
export type Empirical = {
  netCents: number | null;
  observations: PayObservation[];
  distinctGrossPoints: number;
  minGrossCents: number | null;
  maxGrossCents: number | null;
  withinPointSpreadCents: number | null;
  fitMaeCents?: number | null;
  fitObservationCount?: number;
  extrapolated: boolean;
  warnings: string[];
};
export type ForecastInput = {
  id: string;
  periodId: string;
  method: string;
  regime: string;
  manualNet: string | null;
  reason: string;
  useUsual: boolean;
  extrapolate: boolean;
  tax?: TaxInputs | null;
};
export type PayForecast = {
  modelVersion: number;
  input: ForecastInput;
  basis: {
    period: PayPeriod;
    grossCents: number | null;
    worked: number;
    paidHours: number;
    sick: number;
    uniformRate: number | null;
    warnings: string[];
    blockers: string[];
    days: {
      date: string;
      hours: {
        planned: number;
        worked: number | null;
        sick: number;
        plannedSick: number;
      };
      rate: number | null;
      assumed: boolean;
    }[];
  };
  empirical: Empirical | null;
  netCents: number | null;
  warnings: string[];
  tax?: TaxResult | null;
};
export type ForecastStatus = {
  id: string;
  stale: boolean;
  createdAt: string;
  actualNetCents: number | null;
  actualMinusForecastCents: number | null;
};
