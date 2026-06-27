import actionContracts from '../data/action-contracts.json';
import {
  accountBalance,
  calculateItemsTotal,
  calculateLineTotal,
  createCategory,
  createContact,
  createCashTransaction,
  createDefaultLineItem,
  createDocument,
  createId,
  createProduct,
  dashboardSummary,
  deleteRecord,
  formatMoney,
  lockDocument,
  updateDocumentStatus,
} from '../shared/accounting-engine.mjs';
import {
  buildReportSnapshotPayload,
  cashMovementRows,
  documentAgingRows,
  documentRemainingAmount,
  documentSettlementRows,
  journalSourceTarget,
  ledgerRowsForAccount,
  snapshotMetricRows,
  stateWithReportFilters,
  trialBalanceRows,
  vatSummaryRows,
} from '../shared/report-models.mjs';
import type { ActionDescriptor, AppState } from './types';

const actionCatalog = actionContracts as ActionDescriptor[];

export interface SourceTraceRow {
  sourceType: AppState['journalEntries'][number]['sourceType'];
  sourceId: string;
  sourceDate: string;
  sourceReference: string;
  sourceStatus: string;
  sourceCurrency: AppState['organization']['baseCurrency'];
  sourceAmount: number;
  attachmentCount: number;
  entryId: string | null;
  journalDate: string | null;
  journalReference: string | null;
  journalDescription: string | null;
  journalLineCount: number;
  debitTotal: number;
  creditTotal: number;
  balanced: boolean | null;
  postingStatus: 'unposted' | 'balanced' | 'not_balanced';
  ledgerAccounts: string;
}

export function getActionCatalog() {
  return actionCatalog;
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function sourceTraceLineSummary(state: AppState, entry: AppState['journalEntries'][number]) {
  return entry.lines
    .map((line) => {
      const account = state.accounts.find((item) => item.id === line.accountId);
      const accountText = account ? `${account.code} ${account.name}` : line.accountId;
      return `${accountText} D:${line.debit} C:${line.credit}`;
    })
    .join(' | ');
}

function sourceTraceEntityRows(
  state: AppState,
  sourceType: AppState['journalEntries'][number]['sourceType'],
  source: AppState['cashTransactions'][number] | AppState['documents'][number],
): SourceTraceRow[] {
  const journals = state.journalEntries
    .filter((entry) => entry.sourceType === sourceType && entry.sourceId === source.id)
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const attachmentIds = source.attachmentIds ?? [];
  const sourceDate = 'transactionDate' in source ? source.transactionDate : source.documentDate;
  const sourceReference = source.reference || ('documentNumber' in source ? source.documentNumber : source.description) || source.id;
  const sourceStatus = 'status' in source ? source.status : 'posted';
  const sourceAmount = 'amount' in source ? source.amount : calculateItemsTotal(source.items);
  const base = {
    sourceType,
    sourceId: source.id,
    sourceDate,
    sourceReference,
    sourceStatus,
    sourceCurrency: source.currency,
    sourceAmount,
    attachmentCount: attachmentIds.filter((attachmentId) => (state.attachments ?? []).some((attachment) => attachment.id === attachmentId)).length,
  };

  if (!journals.length) {
    return [{
      ...base,
      entryId: null,
      journalDate: null,
      journalReference: null,
      journalDescription: null,
      journalLineCount: 0,
      debitTotal: 0,
      creditTotal: 0,
      balanced: null,
      postingStatus: 'unposted',
      ledgerAccounts: '',
    }];
  }

  return journals.map((entry) => {
    const debitTotal = roundMoney(entry.lines.reduce((total, line) => total + Number(line.debit || 0), 0));
    const creditTotal = roundMoney(entry.lines.reduce((total, line) => total + Number(line.credit || 0), 0));
    return {
      ...base,
      entryId: entry.id,
      journalDate: entry.entryDate,
      journalReference: entry.reference,
      journalDescription: entry.description ?? '',
      journalLineCount: entry.lines.length,
      debitTotal,
      creditTotal,
      balanced: debitTotal === creditTotal,
      postingStatus: debitTotal === creditTotal ? 'balanced' : 'not_balanced',
      ledgerAccounts: sourceTraceLineSummary(state, entry),
    };
  });
}

export function sourceTraceRows(state: AppState) {
  const cashRows = state.cashTransactions.flatMap((transaction) => sourceTraceEntityRows(state, transaction.kind, transaction));
  const documentRows = state.documents.flatMap((document) => sourceTraceEntityRows(state, document.kind, document));
  return [...cashRows, ...documentRows].sort(
    (a, b) =>
      (b.journalDate ?? b.sourceDate ?? '').localeCompare(a.journalDate ?? a.sourceDate ?? '') ||
      (b.sourceDate ?? '').localeCompare(a.sourceDate ?? '') ||
      a.sourceReference.localeCompare(b.sourceReference),
  );
}

export {
  accountBalance,
  calculateItemsTotal,
  calculateLineTotal,
  createCategory,
  createContact,
  createCashTransaction,
  createDefaultLineItem,
  createDocument,
  createId,
  createProduct,
  dashboardSummary,
  deleteRecord,
  cashMovementRows,
  documentAgingRows,
  documentRemainingAmount,
  documentSettlementRows,
  formatMoney,
  journalSourceTarget,
  ledgerRowsForAccount,
  lockDocument,
  snapshotMetricRows,
  stateWithReportFilters,
  trialBalanceRows,
  updateDocumentStatus,
  vatSummaryRows,
  buildReportSnapshotPayload,
};
