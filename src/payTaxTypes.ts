import type { PayObservation } from "./payTypes";
export type TaxMask = {
  federal: boolean;
  kentucky: boolean;
  socialSecurity: boolean;
  medicare: boolean;
  local: boolean;
};
export type TaxDeduction = {
  id: string;
  name: string;
  method: string;
  amount: string;
  percentBase: string;
  benefitsOnly: boolean;
  onPayDate: string | null;
  annualCap: string | null;
  reduces: TaxMask;
};
export type TaxLocal = {
  id: string;
  name: string;
  percent: string;
  perPay: string;
  wageCap: string | null;
  taxCap: string | null;
};
export type TaxProfile = {
  id: string;
  name: string;
  year: number;
  effectiveDate: string;
  regime: string;
  reviewed: boolean;
  ordinaryResidentW2: boolean;
  federal: {
    status: string;
    stepTwo: boolean;
    credits: string;
    otherIncome: string;
    deductions: string;
    extra: string;
    exempt: boolean;
    roundDollars: boolean;
  };
  kentuckyExempt: boolean;
  kentuckyExtra: string;
  localsReviewed: boolean;
  deductions: TaxDeduction[];
  locals: TaxLocal[];
  note: string;
};
export type TaxOtherPay = {
  name: string;
  amount: string;
  cash: boolean;
  taxable: TaxMask;
};
export type TaxInputs = {
  profileId: string;
  ytdDate: string;
  ytdConfirmed: boolean;
  socialSecurityYtd: string | null;
  medicareYtd: string | null;
  deductionYtd: Record<string, string>;
  localWageYtd: Record<string, string>;
  localTaxYtd: Record<string, string>;
  otherPay: TaxOtherPay[];
  oneTimeDeductions: TaxDeduction[];
  deductionOverrides: Record<string, string>;
  calibrationLimit: string;
};
export type TaxEstimate = {
  rules: string | null;
  context: {
    payDate: string;
    frequency: string;
    benefits: boolean;
    hourlyGrossCents: number;
  };
  profile: TaxProfile;
  inputs: TaxInputs;
  cashGrossCents: number;
  noncashCents: number;
  wages: Record<keyof TaxMask, number>;
  deductions: { name: string; cents: number }[];
  taxes: { name: string; cents: number }[];
  netCents: number | null;
  ssPhase: string;
  medicarePhase: string;
  warnings: string[];
};
export type TaxCalibration = {
  id: string;
  observation: PayObservation;
  estimate: TaxEstimate;
};
export type TaxResult = {
  estimate: TaxEstimate;
  correction: {
    support: TaxCalibration[];
    rawMedianCents: number | null;
    appliedCents: number | null;
    residualSpreadCents: number | null;
    warnings: string[];
  } | null;
};
