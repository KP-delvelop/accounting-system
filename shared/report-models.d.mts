import type {
  Account,
  AppState,
  CashTransactionKind,
  CurrencyCode,
  DocumentKind,
  DocumentRecord,
  DocumentStatus,
  JournalEntry,
  JournalEntryLine,
  ReportFilterSettings,
  ReportKey,
} from '../src/types';

export const reportKeys: ReportKey[];
export const backendReportKeys: ReportKey[];
export const reportStatusOptions: Array<DocumentStatus | 'all'>;

export interface LedgerRow {
  entry: JournalEntry;
  line: JournalEntryLine;
  balance: number;
}

export interface CashMovementRow {
  account: Account;
  moneyIn: number;
  moneyOut: number;
  balance: number;
}

export interface DocumentSettlementRow {
  entry: JournalEntry;
  document: DocumentRecord;
  cashAccount?: Account;
  cashAmount: number;
  cashCurrency: CurrencyCode;
  amount: number;
}

export interface DocumentAgingRow {
  document: DocumentRecord;
  contactName: string;
  daysPastDue: number;
  remainingAmount: number;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  daysOver90: number;
}

export interface TrialBalanceRow {
  account: Account;
  debit: number;
  credit: number;
  endingBalance: number;
}

export interface VatSummaryRow {
  date: string;
  source: string;
  type: CashTransactionKind | DocumentKind;
  status: DocumentStatus | 'posted';
  contactName: string;
  direction: 'input' | 'output';
  currency: CurrencyCode;
  taxName: string;
  taxRate: number;
  netAmount: number;
  taxAmount: number;
  grossAmount: number;
}

export interface SnapshotMetricRow {
  key: string;
  value: string;
}

export function compareJournalRows(a: { entry: JournalEntry }, b: { entry: JournalEntry }): number;
export function ledgerRowsForAccount(state: AppState, accountId: string): LedgerRow[];
export function journalSourceTarget(state: AppState, entry: JournalEntry): string;
export function cashMovementRows(state: AppState): CashMovementRow[];
export function documentSettlementRows(state: AppState): DocumentSettlementRow[];
export function documentRemainingAmount(state: AppState, document: DocumentRecord): number;
export function documentAgingRows(state: AppState, kind: DocumentKind, asOfDate?: string): DocumentAgingRow[];
export function trialBalanceRows(state: AppState): TrialBalanceRow[];
export function vatSummaryRows(state: AppState): VatSummaryRow[];
export function snapshotMetricRows(state: AppState): SnapshotMetricRow[];
export function buildReportSnapshotPayload(
  state: AppState,
  filters?: Partial<ReportFilterSettings>,
  options?: {
    generatedAt?: string;
    dataSourceMode?: string;
    dataSourceLabel?: string;
  },
): {
  generatedAt: string;
  dataSource: {
    type: string;
    version: string;
    mode: string;
    label: string;
  };
  report: {
    key: 'snapshot';
    sourceReportKey: ReportKey;
    scope: string;
  };
  organization: AppState['organization'];
  filters: ReportFilterSettings;
  trialBalance: Array<{
    accountId: string;
    accountCode: string;
    accountName: string;
    currency: CurrencyCode;
    openingBalance: number;
    debit: number;
    credit: number;
    endingBalance: number;
  }>;
  vatSummary: VatSummaryRow[];
  snapshot: SnapshotMetricRow[];
};
export function stateWithReportFilters(state: AppState, settings: ReportFilterSettings): AppState;
export function normalizeReportFilters(state: AppState, reportKey: string, filters?: Partial<ReportFilterSettings>): ReportFilterSettings;
export function buildReportResponse(
  state: AppState,
  reportKey: string,
  filters?: Partial<ReportFilterSettings>,
): {
  ok: true;
  reportKey: ReportKey;
  filters: ReportFilterSettings;
  generatedAt: string;
  data: unknown;
};
