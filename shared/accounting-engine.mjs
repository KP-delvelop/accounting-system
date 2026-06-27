export class ActionError extends Error {
  constructor(message, status = 400, code = 'ACTION_ERROR') {
    super(message);
    this.name = 'ActionError';
    this.status = status;
    this.code = code;
  }
}

export function isActionError(error) {
  return error instanceof ActionError;
}

export function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

const currencyLabels = {
  en: {
    LAK: 'LAK',
    THB: 'THB',
    USD: 'USD',
  },
  th: {
    LAK: 'กีบ',
    THB: 'บาท',
    USD: 'ดอลลาร์สหรัฐ',
  },
  lo: {
    LAK: 'ກີບ',
    THB: 'ບາດ',
    USD: 'ໂດລາສະຫະລັດ',
  },
};

function currencyLabel(currency = 'LAK', locale = 'en') {
  return currencyLabels[locale]?.[currency] ?? currencyLabels.en[currency] ?? currency;
}

export function formatMoney(value, currency = 'LAK', locale = 'en') {
  return `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyLabel(currency, locale)}`;
}

function normalizeCurrency(currency, fallback = 'LAK') {
  const value = String(currency ?? fallback).trim().toUpperCase();
  if (!['LAK', 'THB', 'USD'].includes(value)) {
    throw new ActionError('Unsupported currency.', 400, 'VALIDATION_ERROR');
  }
  return value;
}

export function calculateLineTotal(item) {
  const base = Number(item.quantity) * Number(item.unitPrice);
  const discount = item.discountType === 'percentage' ? base * (Number(item.discount) / 100) : Number(item.discount);
  const taxableAmount = Math.max(0, base - discount);
  const tax = taxableAmount * (Number(item.taxRate ?? 0) / 100);
  return taxableAmount + tax;
}

export function calculateItemsTotal(items) {
  return items.reduce((total, item) => total + calculateLineTotal(item), 0);
}

export function accountBalance(state, accountId) {
  const account = state.accounts.find((entry) => entry.id === accountId);
  if (!account) return 0;

  return state.journalEntries.reduce((balance, entry) => {
    return (
      balance +
      entry.lines.reduce((lineBalance, line) => {
        if (line.accountId !== accountId) return lineBalance;
        const movement = account.normalBalance === 'debit' ? line.debit - line.credit : line.credit - line.debit;
        return lineBalance + movement;
      }, 0)
    );
  }, account.openingBalance);
}

export function dashboardSummary(state) {
  const revenue = state.cashTransactions
    .filter((entry) => entry.kind === 'revenue')
    .reduce((total, entry) => total + entry.amount, 0);
  const payment = state.cashTransactions
    .filter((entry) => entry.kind === 'payment')
    .reduce((total, entry) => total + entry.amount, 0);
  const cashAccounts = state.accounts
    .filter((account) => account.kind === 'cash' || account.kind === 'bank')
    .map((account) => ({ account, balance: accountBalance(state, account.id) }));

  return {
    revenue,
    payment,
    net: revenue - payment,
    cashAccounts,
  };
}

function expectedAccountKindForCategoryKind(kind) {
  const categoryKind = normalizeCategoryKind(kind);
  return categoryKind === 'revenue' || categoryKind === 'sales' ? 'income' : 'expense';
}

function validateCategoryAccountKind(kind, account) {
  const expectedKind = expectedAccountKindForCategoryKind(kind);
  if (account.kind !== expectedKind) {
    throw new ActionError(`${kind} categories must use ${expectedKind} accounts.`, 400, 'VALIDATION_ERROR');
  }
}

function getCategoryAccount(state, categoryId, expectedKind) {
  const category = state.categories.find((entry) => entry.id === categoryId);
  if (!category) throw new ActionError('Category is required.', 400, 'VALIDATION_ERROR');
  if (expectedKind && category.kind !== normalizeCategoryKind(expectedKind)) {
    throw new ActionError(`${expectedKind} actions require a ${expectedKind} category.`, 400, 'VALIDATION_ERROR');
  }
  const account = state.accounts.find((entry) => entry.id === category.accountId);
  if (!account) throw new ActionError('Category account is missing.', 400, 'VALIDATION_ERROR');
  validateCategoryAccountKind(category.kind, account);
  return account;
}

function getCashAccount(state, accountId) {
  const account = state.accounts.find((entry) => entry.id === accountId);
  if (!account) throw new ActionError('Cash or bank account is required.', 400, 'VALIDATION_ERROR');
  return account;
}

function normalizeCategoryKind(kind) {
  if (kind === 'revenue' || kind === 'payment' || kind === 'sales' || kind === 'purchase') return kind;
  throw new ActionError(`Invalid category kind: ${kind}`, 400, 'VALIDATION_ERROR');
}

function normalizeExchangeRate(value) {
  const exchangeRate = Number(value ?? 1);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw new ActionError('Exchange rate must be greater than zero.', 400, 'VALIDATION_ERROR');
  }
  return exchangeRate;
}

function normalizeTagIds(state, tagIds = []) {
  if (!Array.isArray(tagIds)) throw new ActionError('Tags must be a list.', 400, 'VALIDATION_ERROR');
  const uniqueIds = [...new Set(tagIds.filter(Boolean).map(String))];

  for (const tagId of uniqueIds) {
    const tag = (state.tags ?? []).find((entry) => entry.id === tagId && entry.enabled);
    if (!tag) throw new ActionError(`Tag not found: ${tagId}`, 400, 'VALIDATION_ERROR');
  }

  return uniqueIds;
}

function createAttachmentReferences(state, ownerType, ownerId, attachmentNames = [], timestamp) {
  if (!Array.isArray(attachmentNames)) throw new ActionError('Attachments must be a list.', 400, 'VALIDATION_ERROR');

  return attachmentNames
    .map((name) => String(name ?? '').trim())
    .filter(Boolean)
    .map((name) => ({
      id: createId('attachment'),
      organizationId: state.organization.id,
      ownerType,
      ownerId,
      name,
      mimeType: 'application/octet-stream',
      sizeBytes: 0,
      createdAt: timestamp,
    }));
}

function normalizeLineItems(state, items) {
  if (!Array.isArray(items) || !items.length) throw new ActionError('At least one line item is required.', 400, 'VALIDATION_ERROR');

  return items.map((item) => {
    const product = item.productId ? (state.products ?? []).find((entry) => entry.id === item.productId && entry.enabled) : undefined;
    if (item.productId && !product) throw new ActionError(`Product not found: ${item.productId}`, 400, 'VALIDATION_ERROR');

    const name = String(item.name ?? product?.name ?? '').trim();
    if (!name) throw new ActionError('Item name is required.', 400, 'VALIDATION_ERROR');

    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new ActionError('Quantity must be greater than zero.', 400, 'VALIDATION_ERROR');

    const unitPrice = Number(item.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new ActionError('Price cannot be negative.', 400, 'VALIDATION_ERROR');

    const discountType = item.discountType === 'amount' ? 'amount' : 'percentage';
    const discount = Number(item.discount ?? 0);
    if (!Number.isFinite(discount) || discount < 0) throw new ActionError('Discount cannot be negative.', 400, 'VALIDATION_ERROR');
    if (discountType === 'percentage' && discount > 100) throw new ActionError('Percentage discount cannot exceed 100.', 400, 'VALIDATION_ERROR');

    const hasTaxOverride = Object.prototype.hasOwnProperty.call(item, 'taxId');
    const taxId = hasTaxOverride ? item.taxId || 'tax-none' : product?.taxId || 'tax-none';
    const tax = taxId ? (state.taxes ?? []).find((entry) => entry.id === taxId && entry.enabled) : undefined;
    if (taxId && !tax) throw new ActionError(`Tax not found: ${taxId}`, 400, 'VALIDATION_ERROR');

    return {
      ...item,
      id: item.id || createId('item'),
      productId: product?.id,
      name,
      description: item.description,
      unit: String(item.unit ?? product?.unit ?? 'unit').trim() || 'unit',
      quantity,
      unitPrice,
      discount,
      discountType,
      taxId: tax?.id,
      taxName: tax?.name,
      taxRate: Number(tax?.rate ?? 0),
    };
  });
}

function journalLine(id, account, debit, credit, description) {
  return {
    id,
    accountId: account.id,
    debit,
    credit,
    description,
  };
}

function getSettlementCashAccount(state, currency, accountId, options = {}) {
  if (accountId) {
    const selectedAccount = state.accounts.find((account) => account.id === accountId);
    if (!selectedAccount) throw new ActionError('Settlement account is required.', 400, 'VALIDATION_ERROR');
    if (selectedAccount.kind !== 'cash' && selectedAccount.kind !== 'bank') {
      throw new ActionError('Settlement account must be cash or bank.', 400, 'VALIDATION_ERROR');
    }
    if (selectedAccount.currency !== currency && !options.allowCrossCurrency) {
      throw new ActionError('Settlement account currency must match the document currency.', 400, 'VALIDATION_ERROR');
    }
    return selectedAccount;
  }

  const exactCash = state.accounts.find((account) => account.kind === 'cash' && account.currency === currency);
  if (exactCash) return exactCash;

  const exactBank = state.accounts.find((account) => account.kind === 'bank' && account.currency === currency);
  if (exactBank) return exactBank;

  throw new ActionError('Cash or bank account in the document currency is required for settlement.', 400, 'VALIDATION_ERROR');
}

function getSettlementAdjustmentAccount(state, currency, accountId, expectedKinds, label) {
  const account = state.accounts.find((entry) => entry.id === accountId);
  if (!account) throw new ActionError(`${label} account is required.`, 400, 'VALIDATION_ERROR');
  if (!expectedKinds.includes(account.kind)) {
    throw new ActionError(`${label} account must be ${expectedKinds.join(' or ')}.`, 400, 'VALIDATION_ERROR');
  }
  if (account.currency !== currency) {
    throw new ActionError(`${label} account currency must match the settlement currency.`, 400, 'VALIDATION_ERROR');
  }
  return account;
}

function normalizeSettlementDate(value, timestamp) {
  if (value === undefined || value === null || value === '') return timestamp.slice(0, 10);

  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ActionError('Settlement date must use YYYY-MM-DD.', 400, 'VALIDATION_ERROR');
  }

  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new ActionError('Settlement date must be a valid date.', 400, 'VALIDATION_ERROR');
  }

  return text;
}

function cashLineAmount(state, entry) {
  const cashLine = entry.lines.find((line) => {
    const account = state.accounts.find((item) => item.id === line.accountId);
    return account?.kind === 'cash' || account?.kind === 'bank';
  });

  return cashLine ? Math.max(Number(cashLine.debit) || 0, Number(cashLine.credit) || 0) : 0;
}

function documentSettlementLineAmount(state, document, entry) {
  const category = state.categories.find((item) => item.id === document.categoryId);
  const categoryLine = category ? entry.lines.find((line) => line.accountId === category.accountId) : undefined;
  if (!categoryLine) return cashLineAmount(state, entry);
  const categoryAmount = Math.max(Number(categoryLine.debit) || 0, Number(categoryLine.credit) || 0);
  const cashLine = entry.lines.find((line) => {
    const account = state.accounts.find((item) => item.id === line.accountId);
    return account?.kind === 'cash' || account?.kind === 'bank';
  });
  const cashAccount = cashLine ? state.accounts.find((account) => account.id === cashLine.accountId) : null;
  if (cashAccount && cashAccount.currency !== document.currency) {
    return roundMoney(categoryAmount / normalizeExchangeRate(document.exchangeRate));
  }
  return categoryAmount;
}

function settledAmountForDocument(state, document) {
  return state.journalEntries
    .filter((entry) => entry.sourceType === document.kind && entry.sourceId === document.id)
    .reduce((total, entry) => total + documentSettlementLineAmount(state, document, entry), 0);
}

function normalizeSettlementAmount(value, remainingAmount) {
  const amount = value === undefined || value === null || value === '' ? remainingAmount : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ActionError('Settlement amount must be greater than zero.', 400, 'VALIDATION_ERROR');
  }
  if (amount > remainingAmount) {
    throw new ActionError('Settlement amount cannot exceed the remaining document balance.', 400, 'VALIDATION_ERROR');
  }

  return amount;
}

function normalizeSettlementAdjustmentAmount(value, label) {
  const amount = value === undefined || value === null || value === '' ? 0 : Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ActionError(`${label} amount cannot be negative.`, 400, 'VALIDATION_ERROR');
  }
  return amount;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeInitialDocumentStatus(kind, status) {
  const defaultStatus = kind === 'sales' ? 'quotation' : 'purchase_order';
  if (status === undefined || status === null || status === '') return defaultStatus;

  const normalizedStatus = String(status).trim();
  const allowed = kind === 'sales' ? ['draft', 'quotation'] : ['draft', 'purchase_order'];
  if (!allowed.includes(normalizedStatus)) {
    throw new ActionError(
      `Initial ${kind} document status must be ${allowed.join(' or ')}.`,
      400,
      'VALIDATION_ERROR',
    );
  }

  return normalizedStatus;
}

function documentNumberPrefix(kind, status) {
  if (status === 'draft') return kind === 'sales' ? 'SD' : 'PD';
  return kind === 'sales' ? 'QT' : 'PO';
}

function nextDocumentNumber(state, kind, status) {
  const prefix = documentNumberPrefix(kind, status);
  const counters = { ...(state.documentNumberCounters ?? {}) };
  const counterValue = Number(counters[prefix] ?? 0);
  const maxExistingValue = (state.documents ?? []).reduce((maxValue, document) => {
    if (document.kind !== kind || !String(document.documentNumber ?? '').startsWith(prefix)) return maxValue;
    const suffix = String(document.documentNumber).slice(prefix.length);
    return /^\d+$/.test(suffix) ? Math.max(maxValue, Number(suffix)) : maxValue;
  }, 0);
  const nextValue = Math.max(counterValue, maxExistingValue) + 1;

  return {
    documentNumber: `${prefix}${String(nextValue).padStart(5, '0')}`,
    documentNumberCounters: {
      ...counters,
      [prefix]: nextValue,
    },
  };
}

function normalizeSettlementExchangeRate(value) {
  if (value === undefined || value === null || value === '') {
    throw new ActionError('Settlement exchange rate is required for cross-currency settlement.', 400, 'VALIDATION_ERROR');
  }

  const exchangeRate = Number(value);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw new ActionError('Settlement exchange rate must be greater than zero.', 400, 'VALIDATION_ERROR');
  }
  return exchangeRate;
}

function getExchangeDifferenceAccount(state, accountId, expectedKind, label, fallbackId, fallbackName) {
  const account =
    (accountId ? state.accounts.find((entry) => entry.id === accountId) : undefined) ??
    state.accounts.find((entry) => entry.id === fallbackId) ??
    state.accounts.find((entry) => entry.kind === expectedKind && entry.name.toLowerCase().includes(fallbackName));

  if (!account) throw new ActionError(`${label} account is required.`, 400, 'VALIDATION_ERROR');
  if (account.kind !== expectedKind) {
    throw new ActionError(`${label} account must be ${expectedKind}.`, 400, 'VALIDATION_ERROR');
  }
  if (account.currency !== state.organization.baseCurrency) {
    throw new ActionError(`${label} account currency must match the organization base currency.`, 400, 'VALIDATION_ERROR');
  }

  return account;
}

function crossCurrencySettlementDetails(state, document, amount, cashAccount, input) {
  if (cashAccount.currency === document.currency) return null;
  if (cashAccount.currency !== state.organization.baseCurrency) {
    throw new ActionError('Cross-currency settlement account must use the organization base currency in this phase.', 400, 'VALIDATION_ERROR');
  }

  const settlementExchangeRate = normalizeSettlementExchangeRate(input.settlementExchangeRate);
  const documentExchangeRate = normalizeExchangeRate(document.exchangeRate);
  const documentBaseAmount = roundMoney(amount * documentExchangeRate);
  const settlementBaseAmount = roundMoney(amount * settlementExchangeRate);
  const difference = roundMoney(settlementBaseAmount - documentBaseAmount);
  const gainAmount =
    document.kind === 'sales'
      ? difference > 0
        ? difference
        : 0
      : difference < 0
        ? Math.abs(difference)
        : 0;
  const lossAmount =
    document.kind === 'sales'
      ? difference < 0
        ? Math.abs(difference)
        : 0
      : difference > 0
        ? difference
        : 0;
  const gainAccount =
    gainAmount > 0
      ? getExchangeDifferenceAccount(
          state,
          input.settlementExchangeGainAccountId,
          'income',
          'Exchange gain',
          'acc-exchange-gain',
          'exchange gain',
        )
      : null;
  const lossAccount =
    lossAmount > 0
      ? getExchangeDifferenceAccount(
          state,
          input.settlementExchangeLossAccountId,
          'expense',
          'Exchange loss',
          'acc-exchange-loss',
          'exchange loss',
        )
      : null;

  return {
    documentExchangeRate,
    settlementExchangeRate,
    documentBaseAmount,
    settlementBaseAmount,
    gainAmount,
    lossAmount,
    gainAccount,
    lossAccount,
  };
}

export function createCashTransaction(state, input) {
  const items = normalizeLineItems(state, input.items);
  const amount = calculateItemsTotal(items);
  if (amount <= 0) throw new ActionError('Amount must be greater than zero.', 400, 'VALIDATION_ERROR');

  const timestamp = new Date().toISOString();
  const cashAccount = getCashAccount(state, input.accountId);
  const categoryAccount = getCategoryAccount(state, input.categoryId, input.kind);
  const tagIds = normalizeTagIds(state, input.tagIds);
  const exchangeRate = normalizeExchangeRate(input.exchangeRate);
  const transactionId = createId(input.kind);
  const attachments = createAttachmentReferences(state, 'cash_transaction', transactionId, input.attachmentNames, timestamp);
  const transaction = {
    id: transactionId,
    organizationId: state.organization.id,
    kind: input.kind,
    transactionDate: input.transactionDate,
    accountId: input.accountId,
    categoryId: input.categoryId,
    contactId: input.contactId,
    currency: cashAccount.currency,
    exchangeRate,
    amount,
    reference: input.reference,
    description: input.description,
    tagIds,
    attachmentIds: attachments.map((attachment) => attachment.id),
    items,
    locked: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const lines =
    input.kind === 'revenue'
      ? [
          journalLine(createId('line'), cashAccount, amount, 0, input.description),
          journalLine(createId('line'), categoryAccount, 0, amount, input.description),
        ]
      : [
          journalLine(createId('line'), categoryAccount, amount, 0, input.description),
          journalLine(createId('line'), cashAccount, 0, amount, input.description),
        ];

  const journal = {
    id: createId('journal'),
    organizationId: state.organization.id,
    sourceType: input.kind,
    sourceId: transaction.id,
    entryDate: input.transactionDate,
    reference: input.reference?.trim() || `${input.kind}-${transaction.id}`,
    description: input.description,
    lines,
    createdAt: timestamp,
  };

  return {
    ...state,
    attachments: [...attachments, ...(state.attachments ?? [])],
    cashTransactions: [transaction, ...state.cashTransactions],
    journalEntries: [journal, ...state.journalEntries],
    auditLogs: [
      {
        id: createId('audit'),
        organizationId: state.organization.id,
        actorType: input.actorType ?? 'user',
        actorId: input.actorId,
        action: input.kind === 'revenue' ? 'cash_revenue.create' : 'cash_payment.create',
        risk: 'medium',
        targetType: 'cash_transaction',
        targetId: transaction.id,
        summary: `${input.kind} ${transaction.reference || transaction.id} posted with ${formatMoney(amount, transaction.currency)}.`,
        createdAt: timestamp,
      },
      ...state.auditLogs,
    ],
  };
}

export function createDocument(state, input) {
  const items = normalizeLineItems(state, input.items);
  const amount = calculateItemsTotal(items);
  if (amount <= 0) throw new ActionError('Document amount must be greater than zero.', 400, 'VALIDATION_ERROR');

  const contact = state.contacts.find((entry) => entry.id === input.contactId);
  if (!contact) throw new ActionError('Contact is required.', 400, 'VALIDATION_ERROR');
  getCategoryAccount(state, input.categoryId, input.kind);

  const timestamp = new Date().toISOString();
  const initialStatus = normalizeInitialDocumentStatus(input.kind, input.status);
  const { documentNumber, documentNumberCounters } = nextDocumentNumber(state, input.kind, initialStatus);
  const tagIds = normalizeTagIds(state, input.tagIds);
  const exchangeRate = normalizeExchangeRate(input.exchangeRate);
  const currency = normalizeCurrency(input.currency, contact.currency);
  const documentId = createId(input.kind === 'sales' ? 'invoice' : 'bill');
  const attachments = createAttachmentReferences(state, 'document', documentId, input.attachmentNames, timestamp);
  const document = {
    id: documentId,
    organizationId: state.organization.id,
    kind: input.kind,
    status: initialStatus,
    contactId: input.contactId,
    documentNumber,
    documentDate: input.documentDate,
    dueDate: input.dueDate,
    orderNumber: input.orderNumber,
    reference: input.reference,
    vatNumber: input.vatNumber,
    title: input.title,
    categoryId: input.categoryId,
    currency,
    exchangeRate,
    tagIds,
    attachmentIds: attachments.map((attachment) => attachment.id),
    items,
    locked: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    ...state,
    documentNumberCounters,
    attachments: [...attachments, ...(state.attachments ?? [])],
    documents: [document, ...state.documents],
    auditLogs: [
      {
        id: createId('audit'),
        organizationId: state.organization.id,
        actorType: input.actorType ?? 'user',
        actorId: input.actorId,
        action: input.kind === 'sales' ? 'sales_document.create' : 'purchase_document.create',
        risk: 'medium',
        targetType: 'document',
        targetId: document.id,
        summary: `${document.documentNumber} created as ${document.status} with ${formatMoney(amount, document.currency)}.`,
        createdAt: timestamp,
      },
      ...state.auditLogs,
    ],
  };
}

export function createContact(state, input) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new ActionError('Contact name is required.', 400, 'VALIDATION_ERROR');
  const type = input.type;
  if (type !== 'customer' && type !== 'vendor') throw new ActionError('Contact type is required.', 400, 'VALIDATION_ERROR');

  const timestamp = new Date().toISOString();
  const contact = {
    id: createId(type),
    organizationId: state.organization.id,
    type,
    name,
    code: input.code,
    email: input.email,
    phone: input.phone,
    taxNumber: input.taxNumber,
    currency: normalizeCurrency(input.currency, state.organization.baseCurrency ?? 'LAK'),
    address: input.address,
    enabled: true,
  };

  return {
    ...state,
    contacts: [contact, ...state.contacts],
    auditLogs: [
      {
        id: createId('audit'),
        organizationId: state.organization.id,
        actorType: input.actorType ?? 'user',
        actorId: input.actorId,
        action: type === 'customer' ? 'customer.create' : 'vendor.create',
        risk: 'medium',
        targetType: 'contact',
        targetId: contact.id,
        summary: `${type} ${contact.name} created.`,
        createdAt: timestamp,
      },
      ...state.auditLogs,
    ],
  };
}

export function createProduct(state, input) {
  const code = String(input.code ?? '').trim();
  const name = String(input.name ?? '').trim();
  const unit = String(input.unit ?? '').trim();
  const unitPrice = Number(input.unitPrice);

  if (!code) throw new ActionError('Product code is required.', 400, 'VALIDATION_ERROR');
  if (!name) throw new ActionError('Product name is required.', 400, 'VALIDATION_ERROR');
  if (!unit) throw new ActionError('Product unit is required.', 400, 'VALIDATION_ERROR');
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new ActionError('Product price cannot be negative.', 400, 'VALIDATION_ERROR');
  if ((state.products ?? []).some((entry) => entry.code.toLowerCase() === code.toLowerCase())) {
    throw new ActionError(`Product code already exists: ${code}`, 400, 'VALIDATION_ERROR');
  }

  const taxId = input.taxId || 'tax-none';
  const tax = (state.taxes ?? []).find((entry) => entry.id === taxId && entry.enabled);
  if (!tax) throw new ActionError(`Tax not found: ${taxId}`, 400, 'VALIDATION_ERROR');

  const timestamp = new Date().toISOString();
  const product = {
    id: createId('product'),
    organizationId: state.organization.id,
    code,
    name,
    unit,
    unitPrice,
    taxId: tax.id,
    enabled: true,
  };

  return {
    ...state,
    products: [product, ...(state.products ?? [])],
    auditLogs: [
      {
        id: createId('audit'),
        organizationId: state.organization.id,
        actorType: input.actorType ?? 'user',
        actorId: input.actorId,
        action: 'product.create',
        risk: 'medium',
        targetType: 'product',
        targetId: product.id,
        summary: `Product ${product.code} ${product.name} created.`,
        createdAt: timestamp,
      },
      ...state.auditLogs,
    ],
  };
}

export function createCategory(state, input) {
  const kind = normalizeCategoryKind(input.kind);
  const name = String(input.name ?? '').trim();
  const accountingCode = String(input.accountingCode ?? '').trim();
  const account = state.accounts.find((entry) => entry.id === input.accountId);

  if (!name) throw new ActionError('Category name is required.', 400, 'VALIDATION_ERROR');
  if (!accountingCode) throw new ActionError('Category accounting code is required.', 400, 'VALIDATION_ERROR');
  if (!account) throw new ActionError('Category account is required.', 400, 'VALIDATION_ERROR');
  validateCategoryAccountKind(kind, account);
  if (
    state.categories.some(
      (entry) =>
        entry.kind === kind &&
        (entry.name.toLowerCase() === name.toLowerCase() || entry.accountingCode.toLowerCase() === accountingCode.toLowerCase()),
    )
  ) {
    throw new ActionError(`Category already exists for ${kind}: ${name} / ${accountingCode}`, 400, 'VALIDATION_ERROR');
  }

  const timestamp = new Date().toISOString();
  const category = {
    id: createId('category'),
    organizationId: state.organization.id,
    kind,
    name,
    accountingCode,
    accountId: account.id,
    enabled: true,
  };

  return {
    ...state,
    categories: [category, ...state.categories],
    auditLogs: [
      {
        id: createId('audit'),
        organizationId: state.organization.id,
        actorType: input.actorType ?? 'user',
        actorId: input.actorId,
        action: 'category.create',
        risk: 'medium',
        targetType: 'category',
        targetId: category.id,
        summary: `Category ${category.kind} ${category.accountingCode} ${category.name} created.`,
        createdAt: timestamp,
      },
      ...state.auditLogs,
    ],
  };
}

function allowedDocumentStatuses(kind) {
  return kind === 'sales' ? ['draft', 'quotation', 'invoice', 'receipt'] : ['draft', 'purchase_order', 'bill', 'paid'];
}

function nextDocumentStatuses(kind, currentStatus) {
  const transitions =
    kind === 'sales'
      ? {
          draft: ['quotation'],
          quotation: ['invoice'],
          invoice: ['receipt'],
          receipt: [],
        }
      : {
          draft: ['purchase_order'],
          purchase_order: ['bill'],
          bill: ['paid'],
          paid: [],
        };

  return transitions[currentStatus] ?? [];
}

function normalizeDocumentKind(kind) {
  if (kind === 'sales' || kind === 'purchase') return kind;
  throw new ActionError(`Invalid document kind: ${kind}`, 400, 'VALIDATION_ERROR');
}

function findDocumentForAction(state, input) {
  const kind = normalizeDocumentKind(input.kind);
  const document = state.documents.find((entry) => entry.id === input.documentId && entry.kind === kind);
  if (!document) throw new ActionError('Document not found.', 404, 'NOT_FOUND');
  return document;
}

function isSettlementStatus(kind, status) {
  return (kind === 'sales' && status === 'receipt') || (kind === 'purchase' && status === 'paid');
}

function createDocumentSettlementJournal(state, document, status, timestamp, input) {
  if (!isSettlementStatus(document.kind, status)) return null;

  const documentAmount = calculateItemsTotal(document.items);
  if (documentAmount <= 0) throw new ActionError('Document settlement amount must be greater than zero.', 400, 'VALIDATION_ERROR');

  const alreadySettledAmount = settledAmountForDocument(state, document);
  const remainingAmount = Math.max(0, documentAmount - alreadySettledAmount);
  if (remainingAmount <= 0) throw new ActionError('Document is already fully settled.', 400, 'VALIDATION_ERROR');

  const settlementDate = normalizeSettlementDate(input.settlementDate, timestamp);
  const amount = normalizeSettlementAmount(input.settlementAmount, remainingAmount);
  const cashAccount = getSettlementCashAccount(state, document.currency, input.settlementAccountId, {
    allowCrossCurrency: true,
  });
  const isCrossCurrency = cashAccount.currency !== document.currency;
  if (isCrossCurrency && (input.settlementExchangeRate === undefined || input.settlementExchangeRate === null || input.settlementExchangeRate === '')) {
    normalizeSettlementExchangeRate(input.settlementExchangeRate);
  }
  const categoryAccount = getCategoryAccount(state, document.categoryId, document.kind);
  if (isCrossCurrency && categoryAccount.currency !== state.organization.baseCurrency) {
    throw new ActionError('Cross-currency settlement category account must use the organization base currency.', 400, 'VALIDATION_ERROR');
  }
  const bankFeeAmount = normalizeSettlementAdjustmentAmount(input.settlementBankFeeAmount, 'Bank fee');
  const withholdingTaxAmount = normalizeSettlementAdjustmentAmount(input.settlementWithholdingTaxAmount, 'Withholding tax');
  if (isCrossCurrency && bankFeeAmount > amount) {
    throw new ActionError('Bank fee amount cannot exceed the settlement amount.', 400, 'VALIDATION_ERROR');
  }
  const settlementComponentCurrency = isCrossCurrency ? state.organization.baseCurrency : document.currency;
  const bankFeeAccount =
    bankFeeAmount > 0
      ? getSettlementAdjustmentAccount(state, settlementComponentCurrency, input.settlementBankFeeAccountId, ['expense'], 'Bank fee')
      : null;
  const withholdingTaxAccount =
    withholdingTaxAmount > 0
      ? getSettlementAdjustmentAccount(
          state,
          settlementComponentCurrency,
          input.settlementWithholdingTaxAccountId,
          document.kind === 'sales' ? ['asset'] : ['liability'],
          'Withholding tax',
        )
      : null;
  if (withholdingTaxAmount > amount) {
    throw new ActionError('Withholding tax amount cannot exceed the settlement amount.', 400, 'VALIDATION_ERROR');
  }
  const cashAmount =
    document.kind === 'sales'
      ? amount - bankFeeAmount - withholdingTaxAmount
      : amount - withholdingTaxAmount + bankFeeAmount;
  if (cashAmount <= 0) {
    throw new ActionError('Net settlement cash amount must be greater than zero.', 400, 'VALIDATION_ERROR');
  }
  const exchange = crossCurrencySettlementDetails(state, document, amount, cashAccount, input);
  const bankFeeJournalAmount = exchange ? roundMoney(bankFeeAmount * exchange.settlementExchangeRate) : bankFeeAmount;
  const withholdingTaxJournalAmount = exchange ? roundMoney(withholdingTaxAmount * exchange.settlementExchangeRate) : withholdingTaxAmount;
  const cashJournalAmount = exchange ? roundMoney(cashAmount * exchange.settlementExchangeRate) : cashAmount;
  const description = document.title || `${document.documentNumber} ${status}`;
  const lines = exchange
    ? document.kind === 'sales'
      ? [
          journalLine(createId('line'), cashAccount, cashJournalAmount, 0, description),
          ...(bankFeeAccount ? [journalLine(createId('line'), bankFeeAccount, bankFeeJournalAmount, 0, description)] : []),
          ...(withholdingTaxAccount ? [journalLine(createId('line'), withholdingTaxAccount, withholdingTaxJournalAmount, 0, description)] : []),
          ...(exchange.lossAccount ? [journalLine(createId('line'), exchange.lossAccount, exchange.lossAmount, 0, description)] : []),
          journalLine(createId('line'), categoryAccount, 0, exchange.documentBaseAmount, description),
          ...(exchange.gainAccount ? [journalLine(createId('line'), exchange.gainAccount, 0, exchange.gainAmount, description)] : []),
        ]
      : [
          journalLine(createId('line'), categoryAccount, exchange.documentBaseAmount, 0, description),
          ...(bankFeeAccount ? [journalLine(createId('line'), bankFeeAccount, bankFeeJournalAmount, 0, description)] : []),
          ...(exchange.lossAccount ? [journalLine(createId('line'), exchange.lossAccount, exchange.lossAmount, 0, description)] : []),
          journalLine(createId('line'), cashAccount, 0, cashJournalAmount, description),
          ...(withholdingTaxAccount ? [journalLine(createId('line'), withholdingTaxAccount, 0, withholdingTaxJournalAmount, description)] : []),
          ...(exchange.gainAccount ? [journalLine(createId('line'), exchange.gainAccount, 0, exchange.gainAmount, description)] : []),
        ]
    : document.kind === 'sales'
      ? [
          journalLine(createId('line'), cashAccount, cashAmount, 0, description),
          ...(bankFeeAccount ? [journalLine(createId('line'), bankFeeAccount, bankFeeAmount, 0, description)] : []),
          ...(withholdingTaxAccount ? [journalLine(createId('line'), withholdingTaxAccount, withholdingTaxAmount, 0, description)] : []),
          journalLine(createId('line'), categoryAccount, 0, amount, description),
        ]
      : [
          journalLine(createId('line'), categoryAccount, amount, 0, description),
          ...(bankFeeAccount ? [journalLine(createId('line'), bankFeeAccount, bankFeeAmount, 0, description)] : []),
          journalLine(createId('line'), cashAccount, 0, cashAmount, description),
          ...(withholdingTaxAccount ? [journalLine(createId('line'), withholdingTaxAccount, 0, withholdingTaxAmount, description)] : []),
        ];

  return {
    amount,
    account: cashAccount,
    cashAmount: cashJournalAmount,
    bankFeeAmount,
    withholdingTaxAmount,
    exchange,
    completed: amount >= remainingAmount,
    remainingAmount: Math.max(0, remainingAmount - amount),
    settlementDate,
    journal: {
      id: createId('journal'),
      organizationId: state.organization.id,
      sourceType: document.kind,
      sourceId: document.id,
      entryDate: settlementDate,
      reference: document.reference?.trim() || document.documentNumber,
      description,
      lines,
      createdAt: timestamp,
    },
  };
}

export function updateDocumentStatus(state, input) {
  if (!allowedDocumentStatuses(input.kind).includes(input.status)) {
    throw new ActionError(`Invalid ${input.kind} document status: ${input.status}`, 400, 'VALIDATION_ERROR');
  }

  const document = findDocumentForAction(state, input);
  if (document.locked) throw new ActionError('Locked documents cannot change status.', 400, 'VALIDATION_ERROR');
  if (!nextDocumentStatuses(input.kind, document.status).includes(input.status)) {
    throw new ActionError(
      `Invalid ${input.kind} document status transition: ${document.status} -> ${input.status}`,
      400,
      'VALIDATION_ERROR',
    );
  }

  const timestamp = new Date().toISOString();
  const settlement = createDocumentSettlementJournal(state, document, input.status, timestamp, input);
  const nextStatus = settlement && !settlement.completed ? document.status : input.status;
  const shouldIssuePostedNumber =
    document.status === 'draft' &&
    ((document.kind === 'sales' && input.status === 'quotation') || (document.kind === 'purchase' && input.status === 'purchase_order'));
  const issuedNumber = shouldIssuePostedNumber ? nextDocumentNumber(state, document.kind, input.status) : null;
  const updatedDocument = {
    ...document,
    status: nextStatus,
    documentNumber: issuedNumber?.documentNumber ?? document.documentNumber,
    updatedAt: timestamp,
  };
  const adjustmentSummary = settlement
    ? [
        `Net cash is ${formatMoney(settlement.cashAmount, settlement.account.currency)}`,
        settlement.bankFeeAmount > 0 ? `bank fee ${formatMoney(settlement.bankFeeAmount, document.currency)}` : null,
        settlement.withholdingTaxAmount > 0 ? `withholding tax ${formatMoney(settlement.withholdingTaxAmount, document.currency)}` : null,
        settlement.exchange
          ? `exchange rate ${settlement.exchange.settlementExchangeRate}; original rate ${settlement.exchange.documentExchangeRate}`
          : null,
        settlement.exchange?.gainAmount > 0 ? `exchange gain ${formatMoney(settlement.exchange.gainAmount, settlement.account.currency)}` : null,
        settlement.exchange?.lossAmount > 0 ? `exchange loss ${formatMoney(settlement.exchange.lossAmount, settlement.account.currency)}` : null,
      ]
        .filter(Boolean)
        .join('; ')
    : '';
  const settlementSummary = settlement
    ? ` Settlement journal posted with ${formatMoney(settlement.amount, document.currency)} on ${settlement.settlementDate} via ${settlement.account.name}. ${adjustmentSummary}.${
        settlement.completed ? '' : ` Remaining balance is ${formatMoney(settlement.remainingAmount, document.currency)}.`
      }`
    : '';
  const statusSummary =
    settlement && !settlement.completed
      ? `${document.documentNumber} partial settlement posted; status remains ${document.status}.${settlementSummary}`
      : `${updatedDocument.documentNumber} status changed from ${document.status} to ${input.status}.${settlementSummary}${
          issuedNumber ? ` Document number changed from ${document.documentNumber} to ${updatedDocument.documentNumber}.` : ''
        }`;

  return {
    ...state,
    ...(issuedNumber ? { documentNumberCounters: issuedNumber.documentNumberCounters } : {}),
    documents: state.documents.map((entry) => (entry.id === document.id ? updatedDocument : entry)),
    journalEntries: settlement ? [settlement.journal, ...state.journalEntries] : state.journalEntries,
    auditLogs: [
      {
        id: createId('audit'),
        organizationId: state.organization.id,
        actorType: input.actorType ?? 'user',
        actorId: input.actorId,
        action: input.kind === 'sales' ? 'sales_document.status.update' : 'purchase_document.status.update',
        risk: 'medium',
        targetType: 'document',
        targetId: document.id,
        summary: statusSummary,
        createdAt: timestamp,
      },
      ...state.auditLogs,
    ],
  };
}

export function lockDocument(state, input) {
  const document = findDocumentForAction(state, input);
  if (document.locked) throw new ActionError('Document is already locked.', 400, 'VALIDATION_ERROR');

  const timestamp = new Date().toISOString();
  const updatedDocument = {
    ...document,
    locked: true,
    updatedAt: timestamp,
  };

  return {
    ...state,
    documents: state.documents.map((entry) => (entry.id === document.id ? updatedDocument : entry)),
    auditLogs: [
      {
        id: createId('audit'),
        organizationId: state.organization.id,
        actorType: input.actorType ?? 'user',
        actorId: input.actorId,
        action: 'document.lock',
        risk: 'high',
        targetType: 'document',
        targetId: document.id,
        summary: `${document.documentNumber} locked.`,
        createdAt: timestamp,
      },
      ...state.auditLogs,
    ],
  };
}

export function deleteRecord(state, input) {
  if (input.recordType !== 'document') {
    throw new ActionError('Only document deletion is implemented in Phase 1.', 400, 'VALIDATION_ERROR');
  }

  const documentId = String(input.documentId ?? input.recordId ?? '').trim();
  if (!documentId) throw new ActionError('Document is required.', 400, 'VALIDATION_ERROR');

  const document = findDocumentForAction(state, { ...input, documentId });
  if (document.locked) throw new ActionError('Locked documents cannot be deleted.', 400, 'VALIDATION_ERROR');

  const linkedJournal = state.journalEntries.find((entry) => entry.sourceType === document.kind && entry.sourceId === document.id);
  if (linkedJournal) {
    throw new ActionError('Documents with journal entries cannot be deleted.', 400, 'VALIDATION_ERROR');
  }

  const timestamp = new Date().toISOString();
  const attachmentIds = new Set(document.attachmentIds ?? []);

  return {
    ...state,
    attachments: (state.attachments ?? []).filter((attachment) => !attachmentIds.has(attachment.id)),
    documents: state.documents.filter((entry) => entry.id !== document.id),
    auditLogs: [
      {
        id: createId('audit'),
        organizationId: state.organization.id,
        actorType: input.actorType ?? 'user',
        actorId: input.actorId,
        action: 'record.delete',
        risk: 'high',
        targetType: 'document',
        targetId: document.id,
        summary: `${document.documentNumber} deleted.`,
        createdAt: timestamp,
      },
      ...state.auditLogs,
    ],
  };
}

const allowedReportKeys = new Set([
  'ledger',
  'source_trace',
  'trial_balance',
  'cash_movement',
  'settlement_history',
  'vat_summary',
  'customer_aging',
  'vendor_aging',
  'snapshot',
]);

const allowedReportFilterStatuses = new Set(['all', 'draft', 'quotation', 'invoice', 'receipt', 'purchase_order', 'bill', 'paid']);

function normalizeReportDate(value, label) {
  if (value === undefined || value === null || value === '') return undefined;

  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ActionError(`${label} must use YYYY-MM-DD.`, 400, 'VALIDATION_ERROR');
  }

  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new ActionError(`${label} must be a valid date.`, 400, 'VALIDATION_ERROR');
  }

  return text;
}

function normalizeReportFilterSettings(state, settings = {}) {
  if (!settings || typeof settings !== 'object') {
    throw new ActionError('Report filter settings are required.', 400, 'VALIDATION_ERROR');
  }

  const reportKey = String(settings.reportKey ?? '').trim();
  if (!allowedReportKeys.has(reportKey)) {
    throw new ActionError('A valid report key is required.', 400, 'VALIDATION_ERROR');
  }

  const accountId = settings.accountId === undefined || settings.accountId === null ? undefined : String(settings.accountId).trim();
  if (accountId && !state.accounts.some((account) => account.id === accountId)) {
    throw new ActionError('Report filter account was not found.', 400, 'VALIDATION_ERROR');
  }

  const dateFrom = normalizeReportDate(settings.dateFrom, 'Report date from');
  const dateTo = normalizeReportDate(settings.dateTo, 'Report date to');
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new ActionError('Report date from cannot be after report date to.', 400, 'VALIDATION_ERROR');
  }

  const status = settings.status === undefined || settings.status === null || settings.status === '' ? 'all' : String(settings.status).trim();
  if (!allowedReportFilterStatuses.has(status)) {
    throw new ActionError('A valid report status filter is required.', 400, 'VALIDATION_ERROR');
  }

  return {
    reportKey,
    ...(accountId ? { accountId } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    status,
  };
}

export function viewReport(state, input = {}) {
  const reportKey = String(input.reportKey ?? '').trim();
  if (!allowedReportKeys.has(reportKey)) {
    throw new ActionError('A valid report key is required.', 400, 'VALIDATION_ERROR');
  }

  return state;
}

export function saveReportFilter(state, input = {}) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new ActionError('Report filter name is required.', 400, 'VALIDATION_ERROR');
  if (name.length > 80) throw new ActionError('Report filter name cannot exceed 80 characters.', 400, 'VALIDATION_ERROR');

  const filterId = String(input.filterId ?? '').trim();
  const existingFilter = filterId ? (state.savedReportFilters ?? []).find((entry) => entry.id === filterId) : undefined;
  if (filterId && !existingFilter) throw new ActionError('Report filter not found.', 404, 'NOT_FOUND');

  const duplicate = (state.savedReportFilters ?? []).find(
    (entry) => entry.id !== filterId && entry.name.toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) throw new ActionError(`Report filter already exists: ${name}`, 400, 'VALIDATION_ERROR');

  const timestamp = new Date().toISOString();
  const settings = normalizeReportFilterSettings(state, input.settings);
  const savedFilter = {
    id: existingFilter?.id ?? createId('report-filter'),
    organizationId: state.organization.id,
    name,
    settings,
    createdAt: existingFilter?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  const savedReportFilters = existingFilter
    ? (state.savedReportFilters ?? []).map((entry) => (entry.id === savedFilter.id ? savedFilter : entry))
    : [savedFilter, ...(state.savedReportFilters ?? [])];

  return {
    ...state,
    savedReportFilters,
    auditLogs: [
      {
        id: createId('audit'),
        organizationId: state.organization.id,
        actorType: input.actorType ?? 'user',
        actorId: input.actorId,
        action: 'report.filter.save',
        risk: 'low',
        targetType: 'report_filter',
        targetId: savedFilter.id,
        summary: `Report filter ${savedFilter.name} saved for ${savedFilter.settings.reportKey}.`,
        createdAt: timestamp,
      },
      ...state.auditLogs,
    ],
  };
}

export function deleteReportFilter(state, input = {}) {
  const filterId = String(input.filterId ?? '').trim();
  if (!filterId) throw new ActionError('Report filter is required.', 400, 'VALIDATION_ERROR');

  const filter = (state.savedReportFilters ?? []).find((entry) => entry.id === filterId);
  if (!filter) throw new ActionError('Report filter not found.', 404, 'NOT_FOUND');

  const timestamp = new Date().toISOString();

  return {
    ...state,
    savedReportFilters: (state.savedReportFilters ?? []).filter((entry) => entry.id !== filter.id),
    auditLogs: [
      {
        id: createId('audit'),
        organizationId: state.organization.id,
        actorType: input.actorType ?? 'user',
        actorId: input.actorId,
        action: 'report.filter.delete',
        risk: 'medium',
        targetType: 'report_filter',
        targetId: filter.id,
        summary: `Report filter ${filter.name} deleted.`,
        createdAt: timestamp,
      },
      ...state.auditLogs,
    ],
  };
}

export function createDefaultLineItem(name, unitPrice, options = {}) {
  return {
    id: createId('item'),
    productId: options.productId,
    name,
    description: '',
    unit: options.unit ?? 'unit',
    quantity: 1,
    unitPrice,
    discount: options.discount ?? 0,
    discountType: options.discountType ?? 'percentage',
    taxId: options.taxId ?? 'tax-none',
    taxName: options.taxName,
    taxRate: options.taxRate ?? 0,
  };
}

function requirePermission(key, actor = {}, actionCatalog) {
  const descriptor = actionCatalog.find((action) => action.key === key);
  if (!descriptor) throw new ActionError(`Unknown action: ${key}`, 404, 'UNKNOWN_ACTION');
  if (actor.roleKey === 'owner') return descriptor;
  if (actor.permissions?.includes(descriptor.permission)) return descriptor;
  throw new ActionError(`Permission denied: ${descriptor.permission}`, 403, 'PERMISSION_DENIED');
}

export function executeAccountingAction(state, request, actionCatalog) {
  const actor = request.actor ?? { actorType: 'user', roleKey: 'owner' };
  requirePermission(request.key, actor, actionCatalog);

  switch (request.key) {
    case 'cash_revenue.create':
      return createCashTransaction(state, { ...request.payload, kind: 'revenue', actorType: actor.actorType, actorId: actor.actorId });
    case 'cash_payment.create':
      return createCashTransaction(state, { ...request.payload, kind: 'payment', actorType: actor.actorType, actorId: actor.actorId });
    case 'customer.create':
      return createContact(state, { ...request.payload, type: 'customer', actorType: actor.actorType, actorId: actor.actorId });
    case 'vendor.create':
      return createContact(state, { ...request.payload, type: 'vendor', actorType: actor.actorType, actorId: actor.actorId });
    case 'product.create':
      return createProduct(state, { ...request.payload, actorType: actor.actorType, actorId: actor.actorId });
    case 'category.create':
      return createCategory(state, { ...request.payload, actorType: actor.actorType, actorId: actor.actorId });
    case 'sales_document.create':
      return createDocument(state, { ...request.payload, kind: 'sales', actorType: actor.actorType, actorId: actor.actorId });
    case 'purchase_document.create':
      return createDocument(state, { ...request.payload, kind: 'purchase', actorType: actor.actorType, actorId: actor.actorId });
    case 'sales_document.status.update':
      return updateDocumentStatus(state, { ...request.payload, kind: 'sales', actorType: actor.actorType, actorId: actor.actorId });
    case 'purchase_document.status.update':
      return updateDocumentStatus(state, { ...request.payload, kind: 'purchase', actorType: actor.actorType, actorId: actor.actorId });
    case 'document.lock':
      return lockDocument(state, { ...request.payload, actorType: actor.actorType, actorId: actor.actorId });
    case 'record.delete':
      return deleteRecord(state, { ...request.payload, actorType: actor.actorType, actorId: actor.actorId });
    case 'report.view':
      return viewReport(state, { ...request.payload, actorType: actor.actorType, actorId: actor.actorId });
    case 'report.filter.save':
      return saveReportFilter(state, { ...request.payload, actorType: actor.actorType, actorId: actor.actorId });
    case 'report.filter.delete':
      return deleteReportFilter(state, { ...request.payload, actorType: actor.actorType, actorId: actor.actorId });
    case 'document.email.send':
      throw new ActionError(`${request.key} is mapped as a guarded action but is not implemented in Phase 1.`, 404, 'NOT_IMPLEMENTED');
    default:
      throw new ActionError(`Unknown action: ${request.key}`, 404, 'UNKNOWN_ACTION');
  }
}
