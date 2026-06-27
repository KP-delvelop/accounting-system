export type Locale = 'en' | 'th' | 'lo';

export type CurrencyCode = 'LAK' | 'THB' | 'USD';

export type AccountKind = 'cash' | 'bank' | 'receivable' | 'payable' | 'income' | 'expense' | 'equity' | 'asset' | 'liability';

export type NormalBalance = 'debit' | 'credit';

export type ContactType = 'customer' | 'vendor';

export type CashTransactionKind = 'revenue' | 'payment';

export type DocumentKind = 'sales' | 'purchase';

export type DocumentStatus = 'draft' | 'quotation' | 'invoice' | 'receipt' | 'purchase_order' | 'bill' | 'paid';

export type RiskLevel = 'low' | 'medium' | 'high';

export type DiscountType = 'percentage' | 'amount';

export type AttachmentOwnerType = 'cash_transaction' | 'document';

export type ReportKey =
  | 'ledger'
  | 'source_trace'
  | 'trial_balance'
  | 'cash_movement'
  | 'settlement_history'
  | 'vat_summary'
  | 'customer_aging'
  | 'vendor_aging'
  | 'snapshot';

export interface Organization {
  id: string;
  name: string;
  baseCurrency: CurrencyCode;
}

export interface Account {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  currency: CurrencyCode;
  kind: AccountKind;
  normalBalance: NormalBalance;
  openingBalance: number;
}

export interface Category {
  id: string;
  organizationId: string;
  kind: CashTransactionKind | DocumentKind;
  name: string;
  accountingCode: string;
  accountId: string;
  enabled: boolean;
}

export interface Tax {
  id: string;
  organizationId: string;
  name: string;
  rate: number;
  enabled: boolean;
}

export interface Product {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  unit: string;
  unitPrice: number;
  taxId?: string;
  enabled: boolean;
}

export interface Tag {
  id: string;
  organizationId: string;
  name: string;
  color: string;
  enabled: boolean;
}

export interface AttachmentReference {
  id: string;
  organizationId: string;
  ownerType: AttachmentOwnerType;
  ownerId: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  storagePath?: string;
  contentHash?: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  organizationId: string;
  type: ContactType;
  name: string;
  code?: string;
  email?: string;
  phone?: string;
  taxNumber?: string;
  currency: CurrencyCode;
  address?: string;
  enabled: boolean;
}

export interface LineItem {
  id: string;
  productId?: string;
  name: string;
  description?: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  discountType: DiscountType;
  taxId?: string;
  taxName?: string;
  taxRate?: number;
}

export interface CashTransaction {
  id: string;
  organizationId: string;
  kind: CashTransactionKind;
  transactionDate: string;
  accountId: string;
  categoryId: string;
  contactId?: string;
  currency: CurrencyCode;
  exchangeRate: number;
  amount: number;
  reference?: string;
  description?: string;
  tagIds: string[];
  attachmentIds: string[];
  items: LineItem[];
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRecord {
  id: string;
  organizationId: string;
  kind: DocumentKind;
  status: DocumentStatus;
  contactId: string;
  documentNumber: string;
  documentDate: string;
  dueDate?: string;
  orderNumber?: string;
  reference?: string;
  vatNumber?: string;
  title?: string;
  categoryId: string;
  currency: CurrencyCode;
  exchangeRate: number;
  tagIds: string[];
  attachmentIds: string[];
  items: LineItem[];
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JournalEntryLine {
  id: string;
  accountId: string;
  debit: number;
  credit: number;
  description?: string;
}

export interface JournalEntry {
  id: string;
  organizationId: string;
  sourceType: CashTransactionKind | DocumentKind;
  sourceId: string;
  entryDate: string;
  reference: string;
  description?: string;
  lines: JournalEntryLine[];
  createdAt: string;
}

export interface AuditLog {
  id: string;
  organizationId: string;
  actorType: 'user' | 'ai_agent' | 'system';
  actorId?: string;
  action: string;
  risk: RiskLevel;
  targetType: string;
  targetId: string;
  summary: string;
  createdAt: string;
}

export interface ReportFilterSettings {
  reportKey: ReportKey;
  accountId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: DocumentStatus | 'all';
}

export interface SavedReportFilter {
  id: string;
  organizationId: string;
  name: string;
  settings: ReportFilterSettings;
  createdAt: string;
  updatedAt: string;
}

export interface AppState {
  organization: Organization;
  documentNumberCounters?: Record<string, number>;
  accounts: Account[];
  categories: Category[];
  taxes: Tax[];
  products: Product[];
  tags: Tag[];
  attachments: AttachmentReference[];
  contacts: Contact[];
  cashTransactions: CashTransaction[];
  documents: DocumentRecord[];
  journalEntries: JournalEntry[];
  savedReportFilters: SavedReportFilter[];
  auditLogs: AuditLog[];
}

export interface CashTransactionInput {
  kind: CashTransactionKind;
  actorType?: AuditLog['actorType'];
  actorId?: string;
  transactionDate: string;
  accountId: string;
  categoryId: string;
  contactId?: string;
  exchangeRate?: number;
  amount: number;
  reference?: string;
  description?: string;
  tagIds?: string[];
  attachmentNames?: string[];
  items: LineItem[];
}

export interface DocumentInput {
  kind: DocumentKind;
  actorType?: AuditLog['actorType'];
  actorId?: string;
  status?: DocumentStatus;
  contactId: string;
  currency?: CurrencyCode;
  documentDate: string;
  dueDate?: string;
  orderNumber?: string;
  reference?: string;
  vatNumber?: string;
  title?: string;
  categoryId: string;
  exchangeRate?: number;
  tagIds?: string[];
  attachmentNames?: string[];
  items: LineItem[];
}

export interface DocumentStatusInput {
  kind: DocumentKind;
  actorType?: AuditLog['actorType'];
  actorId?: string;
  documentId: string;
  status: DocumentStatus;
  settlementAccountId?: string;
  settlementDate?: string;
  settlementAmount?: number;
  settlementBankFeeAccountId?: string;
  settlementBankFeeAmount?: number;
  settlementWithholdingTaxAccountId?: string;
  settlementWithholdingTaxAmount?: number;
  settlementExchangeRate?: number;
  settlementExchangeGainAccountId?: string;
  settlementExchangeLossAccountId?: string;
}

export interface DocumentLockInput {
  kind: DocumentKind;
  actorType?: AuditLog['actorType'];
  actorId?: string;
  documentId: string;
}

export interface RecordDeleteInput {
  recordType: 'document';
  kind: DocumentKind;
  actorType?: AuditLog['actorType'];
  actorId?: string;
  recordId?: string;
  documentId?: string;
}

export interface ReportViewInput {
  reportKey: ReportKey;
  actorType?: AuditLog['actorType'];
  actorId?: string;
}

export interface ReportFilterSaveInput {
  filterId?: string;
  actorType?: AuditLog['actorType'];
  actorId?: string;
  name: string;
  settings: ReportFilterSettings;
}

export interface ReportFilterDeleteInput {
  actorType?: AuditLog['actorType'];
  actorId?: string;
  filterId: string;
}

export interface CategoryInput {
  actorType?: AuditLog['actorType'];
  actorId?: string;
  kind: CashTransactionKind | DocumentKind;
  name: string;
  accountingCode: string;
  accountId: string;
}

export interface ProductInput {
  actorType?: AuditLog['actorType'];
  actorId?: string;
  code: string;
  name: string;
  unit: string;
  unitPrice: number;
  taxId?: string;
}

export interface ContactInput {
  type: ContactType;
  actorType?: AuditLog['actorType'];
  actorId?: string;
  name: string;
  code?: string;
  email?: string;
  phone?: string;
  taxNumber?: string;
  currency?: CurrencyCode;
  address?: string;
}

export interface ActionDescriptor {
  key: string;
  permission: string;
  risk: RiskLevel;
  requiresConfirmation: boolean;
  dryRunAvailable: boolean;
}

export interface ActionActor {
  actorType: AuditLog['actorType'];
  actorId?: string;
  roleKey?: string;
  permissions?: string[];
}
