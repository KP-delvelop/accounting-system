import type {
  ActionActor,
  ActionDescriptor,
  AppState,
  CashTransactionInput,
  CategoryInput,
  ContactInput,
  DocumentInput,
  DocumentLockInput,
  DocumentStatusInput,
  LineItem,
  ProductInput,
  ReportFilterDeleteInput,
  ReportFilterSaveInput,
  ReportViewInput,
  RecordDeleteInput,
} from '../src/types';

export class ActionError extends Error {
  status: number;
  code: string;
  constructor(message: string, status?: number, code?: string);
}

export function isActionError(error: unknown): error is ActionError;
export function createId(prefix: string): string;
export function formatMoney(value: number, currency?: string, locale?: string): string;
export function calculateLineTotal(item: LineItem): number;
export function calculateItemsTotal(items: LineItem[]): number;
export function accountBalance(state: AppState, accountId: string): number;
export function dashboardSummary(state: AppState): {
  revenue: number;
  payment: number;
  net: number;
  cashAccounts: Array<{ account: AppState['accounts'][number]; balance: number }>;
};
export function createCashTransaction(state: AppState, input: CashTransactionInput): AppState;
export function createCategory(state: AppState, input: CategoryInput): AppState;
export function createContact(state: AppState, input: ContactInput): AppState;
export function createProduct(state: AppState, input: ProductInput): AppState;
export function createDocument(state: AppState, input: DocumentInput): AppState;
export function updateDocumentStatus(state: AppState, input: DocumentStatusInput): AppState;
export function lockDocument(state: AppState, input: DocumentLockInput): AppState;
export function deleteRecord(state: AppState, input: RecordDeleteInput): AppState;
export function viewReport(state: AppState, input: ReportViewInput): AppState;
export function saveReportFilter(state: AppState, input: ReportFilterSaveInput): AppState;
export function deleteReportFilter(state: AppState, input: ReportFilterDeleteInput): AppState;
export function createDefaultLineItem(name: string, unitPrice: number, options?: Partial<LineItem>): LineItem;
export function executeAccountingAction(
  state: AppState,
  request: { key: string; actor?: ActionActor; payload: unknown },
  actionCatalog: ActionDescriptor[],
): AppState;
