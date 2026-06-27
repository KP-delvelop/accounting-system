import { ActionError, accountBalance, calculateItemsTotal, formatMoney } from './accounting-engine.mjs';

export const reportKeys = [
  'ledger',
  'source_trace',
  'trial_balance',
  'cash_movement',
  'settlement_history',
  'vat_summary',
  'customer_aging',
  'vendor_aging',
  'snapshot',
];

export const backendReportKeys = ['ledger', 'source_trace', 'trial_balance', 'cash_movement', 'settlement_history', 'vat_summary'];

export const reportStatusOptions = ['all', 'draft', 'quotation', 'invoice', 'receipt', 'purchase_order', 'bill', 'paid'];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function compareJournalRows(a, b) {
  return (
    a.entry.entryDate.localeCompare(b.entry.entryDate) ||
    a.entry.createdAt.localeCompare(b.entry.createdAt) ||
    a.entry.id.localeCompare(b.entry.id)
  );
}

function accountMovement(account, debit, credit) {
  return account.normalBalance === 'debit' ? debit - credit : credit - debit;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function documentCurrencySettlementAmount(document, cashAccount, settlementLine, cashLine) {
  const amount = settlementLine ? Math.max(settlementLine.debit, settlementLine.credit) : Math.max(cashLine.debit, cashLine.credit);
  if (cashAccount && cashAccount.currency !== document.currency) {
    const exchangeRate = Number(document.exchangeRate);
    return Number.isFinite(exchangeRate) && exchangeRate > 0 ? roundMoney(amount / exchangeRate) : amount;
  }
  return amount;
}

export function ledgerRowsForAccount(state, accountId) {
  const account = state.accounts.find((entry) => entry.id === accountId);
  if (!account) return [];

  let balance = account.openingBalance;
  return state.journalEntries
    .flatMap((entry) =>
      entry.lines
        .filter((line) => line.accountId === accountId)
        .map((line) => ({
          entry,
          line,
          balance: 0,
        })),
    )
    .sort(compareJournalRows)
    .map((row) => {
      balance += accountMovement(account, row.line.debit, row.line.credit);
      return { ...row, balance };
    })
    .reverse();
}

export function journalSourceTarget(state, entry) {
  if (entry.sourceType === 'revenue' || entry.sourceType === 'payment') {
    const transaction = state.cashTransactions.find((item) => item.id === entry.sourceId);
    return transaction?.reference ?? transaction?.description ?? entry.sourceId;
  }

  const document = state.documents.find((item) => item.id === entry.sourceId);
  return document?.documentNumber ?? document?.reference ?? entry.sourceId;
}

function journalDebitTotal(entry) {
  return roundMoney(entry.lines.reduce((total, line) => total + Number(line.debit || 0), 0));
}

function journalCreditTotal(entry) {
  return roundMoney(entry.lines.reduce((total, line) => total + Number(line.credit || 0), 0));
}

function journalLineSummary(state, entry) {
  return entry.lines
    .map((line) => {
      const account = state.accounts.find((item) => item.id === line.accountId);
      const accountText = account ? `${account.code} ${account.name}` : line.accountId;
      return `${accountText} D:${line.debit} C:${line.credit}`;
    })
    .join(' | ');
}

function sourceTraceEntityRows(state, sourceType, source) {
  const journals = state.journalEntries
    .filter((entry) => entry.sourceType === sourceType && entry.sourceId === source.id)
    .sort(compareJournalRows);
  const attachmentIds = source.attachmentIds ?? [];
  const base = {
    sourceType,
    sourceId: source.id,
    sourceDate: source.transactionDate ?? source.documentDate,
    sourceReference: source.reference ?? source.documentNumber ?? source.id,
    sourceStatus: source.status ?? 'posted',
    sourceCurrency: source.currency,
    sourceAmount: source.amount ?? calculateItemsTotal(source.items ?? []),
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
    const debitTotal = journalDebitTotal(entry);
    const creditTotal = journalCreditTotal(entry);
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
      ledgerAccounts: journalLineSummary(state, entry),
    };
  });
}

export function sourceTraceRows(state) {
  const cashRows = state.cashTransactions.flatMap((transaction) => sourceTraceEntityRows(state, transaction.kind, transaction));
  const documentRows = state.documents.flatMap((document) => sourceTraceEntityRows(state, document.kind, document));
  return [...cashRows, ...documentRows].sort(
    (a, b) =>
      (b.journalDate ?? b.sourceDate ?? '').localeCompare(a.journalDate ?? a.sourceDate ?? '') ||
      (b.sourceDate ?? '').localeCompare(a.sourceDate ?? '') ||
      a.sourceReference.localeCompare(b.sourceReference),
  );
}

export function cashMovementRows(state) {
  return state.accounts
    .filter((account) => account.kind === 'cash' || account.kind === 'bank')
    .map((account) => {
      const totals = state.journalEntries.reduce(
        (sum, entry) => {
          entry.lines
            .filter((line) => line.accountId === account.id)
            .forEach((line) => {
              sum.debit += line.debit;
              sum.credit += line.credit;
            });
          return sum;
        },
        { debit: 0, credit: 0 },
      );
      const moneyIn = account.normalBalance === 'debit' ? totals.debit : totals.credit;
      const moneyOut = account.normalBalance === 'debit' ? totals.credit : totals.debit;
      return {
        account,
        moneyIn,
        moneyOut,
        balance: accountBalance(state, account.id),
      };
    });
}

export function documentSettlementRows(state) {
  return state.journalEntries
    .map((entry) => {
      if (entry.sourceType !== 'sales' && entry.sourceType !== 'purchase') return null;
      const document = state.documents.find((item) => item.id === entry.sourceId);
      if (!document) return null;
      const cashLine = entry.lines.find((line) => {
        const account = state.accounts.find((item) => item.id === line.accountId);
        return account?.kind === 'cash' || account?.kind === 'bank';
      });
      if (!cashLine) return null;
      const category = state.categories.find((item) => item.id === document.categoryId);
      const settlementLine = category ? entry.lines.find((line) => line.accountId === category.accountId) : undefined;
      const cashAccount = state.accounts.find((account) => account.id === cashLine.accountId);
      const cashAmount = Math.max(Number(cashLine.debit) || 0, Number(cashLine.credit) || 0);
      return {
        entry,
        document,
        cashAccount,
        cashAmount,
        cashCurrency: cashAccount?.currency ?? document.currency,
        amount: documentCurrencySettlementAmount(document, cashAccount, settlementLine, cashLine),
      };
    })
    .filter(Boolean)
    .sort((a, b) => compareJournalRows(b, a));
}

function documentSettledAmount(state, document) {
  return documentSettlementRows(state)
    .filter((row) => row.document.id === document.id)
    .reduce((total, row) => total + row.amount, 0);
}

export function documentRemainingAmount(state, document) {
  return Math.max(0, calculateItemsTotal(document.items) - documentSettledAmount(state, document));
}

function daysPastDue(dueDate, asOfDate) {
  if (!dueDate) return 0;
  const due = new Date(`${dueDate}T00:00:00.000Z`).getTime();
  const asOf = new Date(`${asOfDate}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(due) || !Number.isFinite(asOf)) return 0;
  return Math.max(0, Math.floor((asOf - due) / 86_400_000));
}

function agingBucketFor(days) {
  if (days <= 0) return 'current';
  if (days <= 30) return 'days1To30';
  if (days <= 60) return 'days31To60';
  if (days <= 90) return 'days61To90';
  return 'daysOver90';
}

function emptyAgingBuckets() {
  return {
    current: 0,
    days1To30: 0,
    days31To60: 0,
    days61To90: 0,
    daysOver90: 0,
  };
}

export function documentAgingRows(state, kind, asOfDate = todayIsoDate()) {
  const openStatus = kind === 'sales' ? 'invoice' : 'bill';

  return state.documents
    .filter((document) => document.kind === kind && document.status === openStatus)
    .map((document) => {
      const remainingAmount = documentRemainingAmount(state, document);
      if (remainingAmount <= 0) return null;

      const days = daysPastDue(document.dueDate, asOfDate);
      const buckets = emptyAgingBuckets();
      buckets[agingBucketFor(days)] = remainingAmount;
      const contact = state.contacts.find((entry) => entry.id === document.contactId);

      return {
        document,
        contactName: contact?.name ?? '-',
        daysPastDue: days,
        remainingAmount,
        ...buckets,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.document.dueDate ?? '').localeCompare(b.document.dueDate ?? '') || a.document.documentNumber.localeCompare(b.document.documentNumber));
}

export function trialBalanceRows(state) {
  return state.accounts
    .map((account) => {
      const totals = state.journalEntries.reduce(
        (sum, entry) => {
          entry.lines
            .filter((line) => line.accountId === account.id)
            .forEach((line) => {
              sum.debit += line.debit;
              sum.credit += line.credit;
            });
          return sum;
        },
        { debit: 0, credit: 0 },
      );

      return {
        account,
        debit: totals.debit,
        credit: totals.credit,
        endingBalance: accountBalance(state, account.id),
      };
    })
    .sort((a, b) => a.account.code.localeCompare(b.account.code));
}

function lineTaxBreakdown(item) {
  const base = Number(item.quantity) * Number(item.unitPrice);
  const discount = item.discountType === 'amount' ? Number(item.discount) : base * (Number(item.discount) / 100);
  const netAmount = Math.max(0, base - discount);
  const taxAmount = netAmount * (Number(item.taxRate ?? 0) / 100);
  return {
    netAmount,
    taxAmount,
    grossAmount: netAmount + taxAmount,
  };
}

function taxLabel(state, item) {
  const tax = item.taxId ? state.taxes.find((entry) => entry.id === item.taxId) : undefined;
  return item.taxName ?? tax?.name ?? 'None';
}

function isVatImpactDocumentStatus(document) {
  return document.kind === 'sales' ? document.status === 'invoice' || document.status === 'receipt' : document.status === 'bill' || document.status === 'paid';
}

export function vatSummaryRows(state) {
  const cashRows = state.cashTransactions.flatMap((transaction) => {
    const contact = transaction.contactId ? state.contacts.find((entry) => entry.id === transaction.contactId) : undefined;
    return transaction.items.map((item) => ({
      date: transaction.transactionDate,
      source: transaction.reference || transaction.description || transaction.id,
      type: transaction.kind,
      status: 'posted',
      contactName: contact?.name ?? '-',
      direction: transaction.kind === 'revenue' ? 'output' : 'input',
      currency: transaction.currency,
      taxName: taxLabel(state, item),
      taxRate: Number(item.taxRate ?? 0),
      ...lineTaxBreakdown(item),
    }));
  });

  const documentRows = state.documents.filter(isVatImpactDocumentStatus).flatMap((document) => {
    const contact = state.contacts.find((entry) => entry.id === document.contactId);
    return document.items.map((item) => ({
      date: document.documentDate,
      source: `${document.documentNumber}${document.reference ? ` / ${document.reference}` : ''}`,
      type: document.kind,
      status: document.status,
      contactName: contact?.name ?? '-',
      direction: document.kind === 'sales' ? 'output' : 'input',
      currency: document.currency,
      taxName: taxLabel(state, item),
      taxRate: Number(item.taxRate ?? 0),
      ...lineTaxBreakdown(item),
    }));
  });

  return [...cashRows, ...documentRows]
    .filter((row) => row.grossAmount > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || a.source.localeCompare(b.source));
}

function formatCurrencyTotals(totals) {
  const rows = Object.entries(totals)
    .filter(([, amount]) => Number(amount) > 0)
    .map(([currency, amount]) => formatMoney(Number(amount), currency));

  return rows.length ? rows.join(', ') : formatMoney(0);
}

function agingCurrencyTotals(rows) {
  return rows.reduce((totals, row) => {
    totals[row.document.currency] = (totals[row.document.currency] ?? 0) + row.remainingAmount;
    return totals;
  }, {});
}

export function snapshotMetricRows(state) {
  const customerAgingTotals = agingCurrencyTotals(documentAgingRows(state, 'sales'));
  const vendorAgingTotals = agingCurrencyTotals(documentAgingRows(state, 'purchase'));
  const openInvoices = state.documents.filter((document) => document.kind === 'sales' && document.status === 'invoice').length;
  const openBills = state.documents.filter((document) => document.kind === 'purchase' && document.status === 'bill').length;
  const vatRows = vatSummaryRows(state);

  return [
    { key: 'generatedDate', value: todayIsoDate() },
    { key: 'reportSource', value: 'Localhost database' },
    { key: 'accountCount', value: String(state.accounts.length) },
    { key: 'journalCount', value: String(state.journalEntries.length) },
    { key: 'openInvoices', value: String(openInvoices) },
    { key: 'openBills', value: String(openBills) },
    { key: 'customerAgingBalance', value: formatCurrencyTotals(customerAgingTotals) },
    { key: 'vendorAgingBalance', value: formatCurrencyTotals(vendorAgingTotals) },
    { key: 'vatRows', value: String(vatRows.length) },
  ];
}

function snapshotTrialBalanceRows(state) {
  return trialBalanceRows(state).map((row) => ({
    accountId: row.account.id,
    accountCode: row.account.code,
    accountName: row.account.name,
    currency: row.account.currency,
    openingBalance: row.account.openingBalance,
    debit: row.debit,
    credit: row.credit,
    endingBalance: row.endingBalance,
  }));
}

export function buildReportSnapshotPayload(state, filters = {}, options = {}) {
  const snapshotFilters = {
    reportKey: filters.reportKey ?? 'snapshot',
    ...(filters.accountId ? { accountId: filters.accountId } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
    status: filters.status ?? 'all',
  };
  const reportState = stateWithReportFilters(state, snapshotFilters);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const dataSource = {
    type: 'shared-report-models',
    version: 'phase-1',
    mode: options.dataSourceMode ?? 'localhost-api',
    label: options.dataSourceLabel ?? 'Localhost database',
  };

  return {
    generatedAt,
    dataSource,
    report: {
      key: 'snapshot',
      sourceReportKey: snapshotFilters.reportKey,
      scope: 'reports-export-print-qa-phase-1',
    },
    organization: reportState.organization,
    filters: snapshotFilters,
    trialBalance: snapshotTrialBalanceRows(reportState),
    vatSummary: vatSummaryRows(reportState),
    snapshot: snapshotMetricRows(reportState),
  };
}

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

function dateWithinRange(date, dateFrom, dateTo) {
  if (!date) return true;
  if (dateFrom && date < dateFrom) return false;
  if (dateTo && date > dateTo) return false;
  return true;
}

export function stateWithReportFilters(state, settings = {}) {
  const dateFrom = settings.dateFrom?.trim();
  const dateTo = settings.dateTo?.trim();
  const status = settings.status ?? 'all';

  return {
    ...state,
    cashTransactions: state.cashTransactions.filter((entry) => dateWithinRange(entry.transactionDate, dateFrom, dateTo)),
    documents: state.documents.filter(
      (document) => dateWithinRange(document.documentDate, dateFrom, dateTo) && (status === 'all' || document.status === status),
    ),
    journalEntries: state.journalEntries.filter((entry) => dateWithinRange(entry.entryDate, dateFrom, dateTo)),
  };
}

export function normalizeReportFilters(state, reportKey, filters = {}) {
  const normalizedReportKey = String(reportKey ?? filters.reportKey ?? '').trim();
  if (!reportKeys.includes(normalizedReportKey)) {
    throw new ActionError('A valid report key is required.', 400, 'VALIDATION_ERROR');
  }
  if (!backendReportKeys.includes(normalizedReportKey)) {
    throw new ActionError('This report endpoint is not implemented in Phase 1.', 404, 'NOT_IMPLEMENTED');
  }

  const accountId = filters.accountId === undefined || filters.accountId === null ? undefined : String(filters.accountId).trim();
  if (accountId && !state.accounts.some((account) => account.id === accountId)) {
    throw new ActionError('Report filter account was not found.', 400, 'VALIDATION_ERROR');
  }
  if (normalizedReportKey === 'ledger' && !accountId) {
    throw new ActionError('Ledger report requires an accountId filter.', 400, 'VALIDATION_ERROR');
  }

  const dateFrom = normalizeReportDate(filters.dateFrom, 'Report date from');
  const dateTo = normalizeReportDate(filters.dateTo, 'Report date to');
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new ActionError('Report date from cannot be after report date to.', 400, 'VALIDATION_ERROR');
  }

  const status = filters.status === undefined || filters.status === null || filters.status === '' ? 'all' : String(filters.status).trim();
  if (!reportStatusOptions.includes(status)) {
    throw new ActionError('A valid report status filter is required.', 400, 'VALIDATION_ERROR');
  }

  return {
    reportKey: normalizedReportKey,
    ...(accountId ? { accountId } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    status,
  };
}

function accountPayload(account) {
  if (!account) return null;
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    kind: account.kind,
    currency: account.currency,
    normalBalance: account.normalBalance,
    openingBalance: account.openingBalance,
  };
}

function totalsByCurrency(rows, fields) {
  return rows.reduce((totals, row) => {
    const currency = row.currency ?? row.account?.currency ?? row.document?.currency;
    if (!currency) return totals;
    totals[currency] ??= {};
    for (const field of fields) {
      totals[currency][field] = (totals[currency][field] ?? 0) + Number(row[field] ?? 0);
    }
    return totals;
  }, {});
}

function buildLedgerReport(state, filters) {
  const account = state.accounts.find((entry) => entry.id === filters.accountId);
  const rows = ledgerRowsForAccount(state, filters.accountId).map((row) => ({
    id: `${row.entry.id}:${row.line.id}`,
    entryId: row.entry.id,
    lineId: row.line.id,
    date: row.entry.entryDate,
    reference: row.entry.reference,
    sourceType: row.entry.sourceType,
    sourceId: row.entry.sourceId,
    sourceLabel: journalSourceTarget(state, row.entry),
    description: row.line.description ?? row.entry.description,
    debit: row.line.debit,
    credit: row.line.credit,
    balance: row.balance,
  }));

  return {
    account: accountPayload(account),
    openingBalance: account?.openingBalance ?? 0,
    endingBalance: account ? accountBalance(state, account.id) : 0,
    currency: account?.currency ?? state.organization.baseCurrency,
    rows,
  };
}

function buildSourceTraceReport(state) {
  const rows = sourceTraceRows(state);
  return {
    rows,
    totals: {
      sources: new Set(rows.map((row) => `${row.sourceType}:${row.sourceId}`)).size,
      journals: rows.filter((row) => row.entryId).length,
      unpostedSources: rows.filter((row) => !row.entryId).length,
      unbalancedJournals: rows.filter((row) => row.entryId && !row.balanced).length,
    },
  };
}

function buildTrialBalanceReport(state) {
  const rows = trialBalanceRows(state).map((row) => ({
    account: accountPayload(row.account),
    accountId: row.account.id,
    accountCode: row.account.code,
    accountName: row.account.name,
    currency: row.account.currency,
    openingBalance: row.account.openingBalance,
    debit: row.debit,
    credit: row.credit,
    endingBalance: row.endingBalance,
  }));

  return {
    rows,
    totalsByCurrency: totalsByCurrency(rows, ['openingBalance', 'debit', 'credit', 'endingBalance']),
  };
}

function buildCashMovementReport(state) {
  const rows = cashMovementRows(state).map((row) => ({
    account: accountPayload(row.account),
    accountId: row.account.id,
    accountCode: row.account.code,
    accountName: row.account.name,
    currency: row.account.currency,
    openingBalance: row.account.openingBalance,
    moneyIn: row.moneyIn,
    moneyOut: row.moneyOut,
    endingBalance: row.balance,
  }));

  return {
    rows,
    totalsByCurrency: totalsByCurrency(rows, ['openingBalance', 'moneyIn', 'moneyOut', 'endingBalance']),
  };
}

function buildSettlementHistoryReport(state) {
  const rows = documentSettlementRows(state).map((row) => ({
    id: `${row.entry.id}:${row.document.id}`,
    entryId: row.entry.id,
    documentId: row.document.id,
    documentNumber: row.document.documentNumber,
    documentKind: row.document.kind,
    documentStatus: row.document.status,
    date: row.entry.entryDate,
    reference: row.entry.reference,
    cashAccount: accountPayload(row.cashAccount),
    cashAccountId: row.cashAccount?.id,
    amount: row.amount,
    currency: row.document.currency,
    cashAmount: row.cashAmount,
    cashCurrency: row.cashCurrency,
  }));

  return {
    rows,
    totalsByCurrency: totalsByCurrency(rows, ['amount']),
  };
}

function buildVatSummaryReport(state) {
  const rows = vatSummaryRows(state);
  return {
    rows,
    totalsByCurrency: rows.reduce((totals, row) => {
      totals[row.currency] ??= { netAmount: 0, taxAmount: 0, grossAmount: 0, inputTax: 0, outputTax: 0 };
      totals[row.currency].netAmount += row.netAmount;
      totals[row.currency].taxAmount += row.taxAmount;
      totals[row.currency].grossAmount += row.grossAmount;
      if (row.direction === 'input') totals[row.currency].inputTax += row.taxAmount;
      if (row.direction === 'output') totals[row.currency].outputTax += row.taxAmount;
      return totals;
    }, {}),
  };
}

export function buildReportResponse(state, reportKey, filters = {}) {
  const normalizedFilters = normalizeReportFilters(state, reportKey, filters);
  const filteredState = stateWithReportFilters(state, normalizedFilters);
  let data;

  switch (normalizedFilters.reportKey) {
    case 'ledger':
      data = buildLedgerReport(filteredState, normalizedFilters);
      break;
    case 'source_trace':
      data = buildSourceTraceReport(filteredState);
      break;
    case 'trial_balance':
      data = buildTrialBalanceReport(filteredState);
      break;
    case 'cash_movement':
      data = buildCashMovementReport(filteredState);
      break;
    case 'settlement_history':
      data = buildSettlementHistoryReport(filteredState);
      break;
    case 'vat_summary':
      data = buildVatSummaryReport(filteredState);
      break;
    default:
      throw new ActionError('This report endpoint is not implemented in Phase 1.', 404, 'NOT_IMPLEMENTED');
  }

  return {
    ok: true,
    reportKey: normalizedFilters.reportKey,
    filters: normalizedFilters,
    generatedAt: new Date().toISOString(),
    data,
  };
}
