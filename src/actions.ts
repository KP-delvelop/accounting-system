import { executeAccountingAction as executeSharedAccountingAction } from '../shared/accounting-engine.mjs';
import { getActionCatalog } from './domain';
import type {
  ActionActor,
  AppState,
  CashTransactionInput,
  CategoryInput,
  ContactInput,
  DocumentInput,
  DocumentLockInput,
  DocumentStatusInput,
  ProductInput,
  ReportFilterDeleteInput,
  ReportFilterSaveInput,
  ReportViewInput,
  RecordDeleteInput,
} from './types';

export type AccountingActionKey =
  | 'cash_revenue.create'
  | 'cash_payment.create'
  | 'customer.create'
  | 'vendor.create'
  | 'product.create'
  | 'category.create'
  | 'sales_document.create'
  | 'purchase_document.create'
  | 'sales_document.status.update'
  | 'purchase_document.status.update'
  | 'document.email.send'
  | 'record.delete'
  | 'document.lock'
  | 'report.view'
  | 'report.filter.save'
  | 'report.filter.delete';

export type AccountingActionPayload =
  | CashTransactionInput
  | CategoryInput
  | ContactInput
  | ProductInput
  | DocumentInput
  | DocumentLockInput
  | DocumentStatusInput
  | RecordDeleteInput
  | ReportFilterSaveInput
  | ReportFilterDeleteInput
  | ReportViewInput
  | Record<string, unknown>;

export interface AccountingActionRequest {
  key: AccountingActionKey;
  actor: ActionActor;
  payload: AccountingActionPayload;
}

export interface AccountingActionResult {
  ok: boolean;
  state?: AppState;
  error?: string;
}

export const humanOwnerActor: ActionActor = {
  actorType: 'user',
  roleKey: 'owner',
};

export function executeAccountingAction(state: AppState, request: AccountingActionRequest): AppState {
  return executeSharedAccountingAction(state, request, getActionCatalog());
}
