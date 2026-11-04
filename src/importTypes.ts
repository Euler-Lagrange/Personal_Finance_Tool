import type { Entry, EntryInput } from "./types";
export interface ImportMapping {
  dateColumn: number | null;
  descriptionColumn: number | null;
  amountColumn: number | null;
  debitColumn: number | null;
  creditColumn: number | null;
  statusColumn: number | null;
  typeColumn: number | null;
  postedDateColumn?: number | null;
  stableIdColumn?: number | null;
  currencyColumn?: number | null;
  stableIdsConfirmed?: boolean;
  amountMode: string;
  dateFormat: string;
  year: number | null;
  postedConfirmed: boolean;
}
export interface ImportSource {
  id: string;
  revision: number;
  name: string;
  format: string;
  accountId: string | null;
  state: string;
  error: string;
  rowCount: number;
  pendingCount: number;
  classificationCount?: number;
  importedCount: number;
  linkedCount: number;
  excludedCount: number;
  createdAt: string;
}
export interface ImportCandidate {
  postedDate?: string | null;
  stableId?: string | null;
  currency?: string;
  date: string | null;
  description: string;
  amountCents: number | null;
  direction: string;
  status: string;
  sourceType: string;
  warnings: string[];
}
export interface ImportMatch {
  id: string;
  revision: number;
  date: string;
  description: string;
  kind: string;
  amountCents: number;
}
export interface ImportRow {
  merchant?: string;
  bulkExpenseReason?: string;
  pendingEntry?: Entry | null;
  suggestion?: RuleSuggestion;
  id: string;
  ordinal: number;
  raw: string[];
  candidate: ImportCandidate;
  disposition: string;
  eventId: string | null;
  matches: ImportMatch[];
}
export interface ImportDetail {
  classificationProfile?: {
    profile: string;
    policy: ClassificationPolicy;
    automatic: boolean;
  } | null;
  classificationPolicy?: ClassificationPolicy | null;
  observation?: {
    parentId: string;
    parentName: string;
    suggestedAccountId: string | null;
  } | null;
  downloadProfile?: DownloadProfile | null;
  coverage?: ImportCoverage | null;
  overlap?: { items: ImportIdentity[]; notices: string[] };
  source: ImportSource;
  dataset: {
    pdfPages?: { number: number; lines: string[] }[];
    headers: string[];
    rows: string[][];
    sheetNames: string[];
    sheet: string;
    image: boolean;
    assisted?: boolean;
    notes: string[];
  };
  mapping: ImportMapping;
  rows: ImportRow[];
  previewUrl: string | null;
  undoId: string | null;
}
export interface CoverageInput {
  startDate: string;
  endDate: string;
  dateBasis: string;
  completeness: string;
  profile: string;
  observedAt: string;
  inclusive: boolean;
}
export interface ImportCoverage extends CoverageInput {
  accepted: boolean;
  newestActivityDate: string | null;
}
export interface ImportIdentity {
  rowId: string;
  action: string;
  reason: string;
  occurrenceId: string | null;
  eventId: string | null;
  eventRevision: number | null;
}
export interface ImportDecision {
  ruleSignature?: string | null;
  rowId: string;
  action: string;
  input: EntryInput | null;
  matchId: string | null;
  matchRevision: number | null;
  confirmed: boolean;
  separate: boolean;
}
export interface RuleSuggestion {
  categoryId: string | null;
  splitMode: string;
  splitValue: string;
  categoryAsk: boolean;
  ownershipAsk: boolean;
  explanations: string[];
  signature: string;
  ready: boolean;
}
export interface ImportReceipt {
  added: number;
  linked: number;
  excluded: number;
  alreadyProcessed: boolean;
}

export interface DownloadPattern {
  kind: string;
  days: number | null;
}
export interface DownloadProfile {
  profile: string;
  dateBasis: string;
  completeness: string;
  pattern: DownloadPattern;
}

export interface ClassificationPolicy {
  ordinaryCardCharges: boolean;
  ownership: string;
  types: { code: string; kind: string; accountId?: string | null }[];
}
