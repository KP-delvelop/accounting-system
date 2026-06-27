import { documentRemainingAmount } from '../shared/report-models.mjs';

const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:8787';
const testRunId = process.env.CODEX_TEST_RUN_ID ?? `lifecycle-${process.pid}-${Date.now()}`;
const testSessionId = process.env.CODEX_TEST_SESSION_ID ?? `lifecycle-session-${process.pid}`;

const ownerActor = {
  actorType: 'user',
  actorId: 'user-owner-demo',
  roleKey: 'owner',
  permissions: [],
};

let lifecycleCustomerId = '';
let lifecycleVendorId = '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { status: response.status, body };
}

function diagnosticHeaders(reason) {
  return {
    'X-Codex-State-Write-Source': 'document-lifecycle-test',
    'X-Codex-Run-Id': testRunId,
    'X-Codex-Session-Id': testSessionId,
    'X-Codex-State-Write-Reason': reason,
  };
}

async function postJson(path, body, headers = {}) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...diagnosticHeaders(path), ...headers },
    body: JSON.stringify(body),
  });
}

async function postReportQuery(reportKey, filters = {}) {
  return postJson(`/api/reports/${reportKey}/query`, { actor: ownerActor, filters });
}

async function action(key, payload) {
  return postJson(`/api/actions/${key}`, { actor: ownerActor, payload });
}

function assertError(result, status, code, label) {
  assert(result.status === status, `${label}: expected HTTP ${status}, got ${result.status}`);
  assert(result.body?.ok === false, `${label}: expected ok=false`);
  assert(result.body?.code === code, `${label}: expected code ${code}, got ${result.body?.code}`);
}

function documentById(state, documentId) {
  const document = state.documents.find((entry) => entry.id === documentId);
  assert(document, `document not found: ${documentId}`);
  return document;
}

function documentJournals(state, document) {
  return state.journalEntries.filter((entry) => entry.sourceType === document.kind && entry.sourceId === document.id);
}

function assertBalancedJournal(entry, label) {
  assert(entry, `${label}: expected journal entry`);
  const totals = entry.lines.reduce(
    (sum, line) => ({
      debit: sum.debit + line.debit,
      credit: sum.credit + line.credit,
    }),
    { debit: 0, credit: 0 },
  );
  assert(
    Math.round(totals.debit * 100) === Math.round(totals.credit * 100),
    `${label}: expected balanced journal, got debit ${totals.debit} credit ${totals.credit}`,
  );
}

function simpleLine(name, unitPrice) {
  return [
    {
      name,
      unit: 'service',
      quantity: 1,
      unitPrice,
      discount: 0,
      discountType: 'percentage',
      taxId: 'tax-none',
    },
  ];
}

function vatLine(name, unitPrice) {
  return [
    {
      name,
      unit: 'service',
      quantity: 1,
      unitPrice,
      discount: 0,
      discountType: 'percentage',
      taxId: 'tax-vat',
    },
  ];
}

function assertVatSummaryExcludes(report, reference, label) {
  const rows = report.body?.data?.rows ?? [];
  assert(!rows.some((row) => String(row.source ?? '').includes(reference)), `${label}: VAT summary should exclude ${reference}`);
}

function assertVatSummaryIncludes(report, reference, status, label) {
  const rows = report.body?.data?.rows ?? [];
  const row = rows.find((entry) => String(entry.source ?? '').includes(reference));
  assert(row, `${label}: VAT summary should include ${reference}`);
  assert(row.status === status, `${label}: expected status ${status}, got ${row.status}`);
  assert(row.taxAmount > 0, `${label}: expected positive tax amount`);
}

function assertUniqueDocumentNumbers(state) {
  const numbers = state.documents.map((document) => document.documentNumber);
  assert(new Set(numbers).size === numbers.length, `document numbers should be unique, got ${numbers.join(', ')}`);
}

async function createSalesDocument(payload = {}) {
  const result = await action('sales_document.create', {
    contactId: lifecycleCustomerId,
    documentDate: '2026-09-01',
    dueDate: '2026-09-30',
    reference: 'CODEX_LIFECYCLE_SALES_REF',
    title: 'Lifecycle sales document',
    categoryId: 'cat-sales-document',
    items: simpleLine('Lifecycle sales service', 100),
    ...payload,
  });
  assert(result.status === 200 && result.body?.ok === true, `sales document create failed: ${result.status}`);
  return result;
}

async function createPurchaseDocument(payload = {}) {
  const result = await action('purchase_document.create', {
    contactId: lifecycleVendorId,
    documentDate: '2026-09-01',
    dueDate: '2026-09-30',
    orderNumber: 'CODEX_LIFECYCLE_PO_REF',
    reference: 'CODEX_LIFECYCLE_PURCHASE_REF',
    title: 'Lifecycle purchase document',
    categoryId: 'cat-purchase-document',
    items: simpleLine('Lifecycle purchase service', 80),
    ...payload,
  });
  assert(result.status === 200 && result.body?.ok === true, `purchase document create failed: ${result.status}`);
  return result;
}

async function createUsdCustomer() {
  const result = await action('customer.create', {
    name: 'CODEX_LIFECYCLE_USD_CUSTOMER',
    code: 'CODEX_LIFECYCLE_USD',
    currency: 'USD',
  });
  assert(result.status === 200 && result.body?.ok === true, 'USD customer create should pass');
  return result.body.state.contacts.find((contact) => contact.code === 'CODEX_LIFECYCLE_USD');
}

async function createLifecycleContacts() {
  const customer = await action('customer.create', {
    name: 'CODEX_LIFECYCLE_CUSTOMER',
    code: 'CODEX_LIFECYCLE_CUSTOMER',
    currency: 'LAK',
  });
  assert(customer.status === 200 && customer.body?.ok === true, 'lifecycle customer create should pass');
  lifecycleCustomerId = customer.body.state.contacts.find((contact) => contact.code === 'CODEX_LIFECYCLE_CUSTOMER')?.id;
  assert(lifecycleCustomerId, 'lifecycle customer fixture should exist');

  const vendor = await action('vendor.create', {
    name: 'CODEX_LIFECYCLE_VENDOR',
    code: 'CODEX_LIFECYCLE_VENDOR',
    currency: 'LAK',
  });
  assert(vendor.status === 200 && vendor.body?.ok === true, 'lifecycle vendor create should pass');
  lifecycleVendorId = vendor.body.state.contacts.find((contact) => contact.code === 'CODEX_LIFECYCLE_VENDOR')?.id;
  assert(lifecycleVendorId, 'lifecycle vendor fixture should exist');
}

async function run() {
  const health = await request('/api/health');
  assert(health.status === 200 && health.body?.ok === true, 'health endpoint failed');

  const reset = await postJson('/api/reset', {}, {
    'X-Codex-Reset-Source': 'document-lifecycle-test',
    'X-Codex-Run-Id': testRunId,
    'X-Codex-Session-Id': testSessionId,
    'X-Codex-Reset-Reason': 'initial-seed',
  });
  assert(reset.status === 200 && reset.body?.ok === true, 'initial reset failed');
  await createLifecycleContacts();

  const salesDraftResult = await createSalesDocument({ status: 'draft', reference: 'CODEX_LIFECYCLE_SALES_DRAFT_REF' });
  const salesDraft = salesDraftResult.body.state.documents[0];
  assert(salesDraft.status === 'draft', 'sales draft should start as draft');
  assert(salesDraft.documentNumber === 'SD00001', `sales draft number should be SD00001, got ${salesDraft.documentNumber}`);
  assert(documentJournals(salesDraftResult.body.state, salesDraft).length === 0, 'sales draft should not post journals');

  const salesDefaultResult = await createSalesDocument({ reference: 'CODEX_LIFECYCLE_SALES_DEFAULT_REF' });
  const salesDefault = salesDefaultResult.body.state.documents[0];
  assert(salesDefault.status === 'quotation', 'default sales document should remain quotation for compatibility');
  assert(salesDefault.documentNumber === 'QT00001', `default sales number should be QT00001, got ${salesDefault.documentNumber}`);

  const salesDraftToQuotation = await action('sales_document.status.update', {
    documentId: salesDraft.id,
    status: 'quotation',
  });
  assert(salesDraftToQuotation.status === 200 && salesDraftToQuotation.body?.ok === true, 'sales draft to quotation should pass');
  const postedSalesDraft = documentById(salesDraftToQuotation.body.state, salesDraft.id);
  assert(postedSalesDraft.status === 'quotation', 'sales draft should become quotation');
  assert(postedSalesDraft.documentNumber === 'QT00002', `posted sales draft should receive QT00002, got ${postedSalesDraft.documentNumber}`);
  assert(documentJournals(salesDraftToQuotation.body.state, postedSalesDraft).length === 0, 'draft to quotation should not post journals');

  const secondSalesDraftResult = await createSalesDocument({ status: 'draft', reference: 'CODEX_LIFECYCLE_SECOND_SALES_DRAFT_REF' });
  const secondSalesDraft = secondSalesDraftResult.body.state.documents[0];
  assert(secondSalesDraft.documentNumber === 'SD00002', `second sales draft should not reuse SD00001, got ${secondSalesDraft.documentNumber}`);
  assertUniqueDocumentNumbers(secondSalesDraftResult.body.state);

  assertError(
    await action('sales_document.status.update', {
      documentId: secondSalesDraft.id,
      status: 'receipt',
      settlementAccountId: 'acc-cash-lak',
    }),
    400,
    'VALIDATION_ERROR',
    'sales draft cannot settle directly to receipt',
  );

  const salesInvoice = await action('sales_document.status.update', {
    documentId: salesDefault.id,
    status: 'invoice',
  });
  assert(salesInvoice.status === 200 && salesInvoice.body?.ok === true, 'sales quotation to invoice should pass');
  assert(documentJournals(salesInvoice.body.state, documentById(salesInvoice.body.state, salesDefault.id)).length === 0, 'quotation to invoice should not post journals');

  const salesReceipt = await action('sales_document.status.update', {
    documentId: salesDefault.id,
    status: 'receipt',
    settlementAccountId: 'acc-cash-lak',
    settlementDate: '2026-09-05',
  });
  assert(salesReceipt.status === 200 && salesReceipt.body?.ok === true, 'same-currency sales receipt should pass');
  assert(documentById(salesReceipt.body.state, salesDefault.id).status === 'receipt', 'same-currency sales receipt should finish as receipt');
  assertBalancedJournal(documentJournals(salesReceipt.body.state, documentById(salesReceipt.body.state, salesDefault.id))[0], 'same-currency sales receipt');

  const purchaseDraftResult = await createPurchaseDocument({ status: 'draft', reference: 'CODEX_LIFECYCLE_PURCHASE_DRAFT_REF' });
  const purchaseDraft = purchaseDraftResult.body.state.documents[0];
  assert(purchaseDraft.status === 'draft', 'purchase draft should start as draft');
  assert(purchaseDraft.documentNumber === 'PD00001', `purchase draft number should be PD00001, got ${purchaseDraft.documentNumber}`);
  assert(documentJournals(purchaseDraftResult.body.state, purchaseDraft).length === 0, 'purchase draft should not post journals');

  const purchaseDefaultResult = await createPurchaseDocument({ reference: 'CODEX_LIFECYCLE_PURCHASE_DEFAULT_REF' });
  const purchaseDefault = purchaseDefaultResult.body.state.documents[0];
  assert(purchaseDefault.status === 'purchase_order', 'default purchase document should remain purchase_order for compatibility');
  assert(purchaseDefault.documentNumber === 'PO00001', `default purchase number should be PO00001, got ${purchaseDefault.documentNumber}`);

  const purchaseDraftToOrder = await action('purchase_document.status.update', {
    documentId: purchaseDraft.id,
    status: 'purchase_order',
  });
  assert(purchaseDraftToOrder.status === 200 && purchaseDraftToOrder.body?.ok === true, 'purchase draft to purchase_order should pass');
  const postedPurchaseDraft = documentById(purchaseDraftToOrder.body.state, purchaseDraft.id);
  assert(postedPurchaseDraft.status === 'purchase_order', 'purchase draft should become purchase_order');
  assert(postedPurchaseDraft.documentNumber === 'PO00002', `posted purchase draft should receive PO00002, got ${postedPurchaseDraft.documentNumber}`);
  assert(documentJournals(purchaseDraftToOrder.body.state, postedPurchaseDraft).length === 0, 'draft to purchase_order should not post journals');

  const secondPurchaseDraftResult = await createPurchaseDocument({ status: 'draft', reference: 'CODEX_LIFECYCLE_SECOND_PURCHASE_DRAFT_REF' });
  const secondPurchaseDraft = secondPurchaseDraftResult.body.state.documents[0];
  assert(secondPurchaseDraft.documentNumber === 'PD00002', `second purchase draft should not reuse PD00001, got ${secondPurchaseDraft.documentNumber}`);
  assertUniqueDocumentNumbers(secondPurchaseDraftResult.body.state);

  assertError(
    await action('purchase_document.status.update', {
      documentId: secondPurchaseDraft.id,
      status: 'paid',
      settlementAccountId: 'acc-cash-lak',
    }),
    400,
    'VALIDATION_ERROR',
    'purchase draft cannot settle directly to paid',
  );

  const salesVatDraftResult = await createSalesDocument({
    status: 'draft',
    reference: 'CODEX_PHASE16A_VAT_DEBUG_DRAFT',
    title: 'Lifecycle VAT draft sales',
    items: vatLine('Lifecycle draft VAT service', 250),
  });
  const salesVatDraft = salesVatDraftResult.body.state.documents[0];
  assert(salesVatDraft.status === 'draft', 'VAT sales draft should remain draft');
  assert(documentJournals(salesVatDraftResult.body.state, salesVatDraft).length === 0, 'VAT sales draft should not post journal');

  const salesVatQuotationResult = await createSalesDocument({
    reference: 'CODEX_PHASE16A_VAT_DEBUG_QUOTATION',
    title: 'Lifecycle VAT quotation sales',
    items: vatLine('Lifecycle quotation VAT service', 300),
  });
  const salesVatQuotation = salesVatQuotationResult.body.state.documents[0];
  assert(salesVatQuotation.status === 'quotation', 'VAT sales quotation should remain quotation');

  const purchaseVatDraftResult = await createPurchaseDocument({
    status: 'draft',
    reference: 'CODEX_PHASE16A_VAT_DEBUG_PURCHASE_DRAFT',
    title: 'Lifecycle VAT draft purchase',
    items: vatLine('Lifecycle purchase draft VAT service', 120),
  });
  const purchaseVatDraft = purchaseVatDraftResult.body.state.documents[0];
  assert(purchaseVatDraft.status === 'draft', 'VAT purchase draft should remain draft');

  const purchaseVatOrderResult = await createPurchaseDocument({
    reference: 'CODEX_PHASE16A_VAT_DEBUG_PURCHASE_ORDER',
    title: 'Lifecycle VAT purchase order',
    items: vatLine('Lifecycle purchase order VAT service', 140),
  });
  const purchaseVatOrder = purchaseVatOrderResult.body.state.documents[0];
  assert(purchaseVatOrder.status === 'purchase_order', 'VAT purchase order should remain purchase_order');

  const nonPostingVatReport = await postReportQuery('vat_summary');
  assert(nonPostingVatReport.status === 200 && nonPostingVatReport.body?.ok === true, 'VAT summary should pass');
  assertVatSummaryExcludes(nonPostingVatReport, 'CODEX_PHASE16A_VAT_DEBUG_DRAFT', 'sales draft VAT');
  assertVatSummaryExcludes(nonPostingVatReport, 'CODEX_PHASE16A_VAT_DEBUG_QUOTATION', 'sales quotation VAT');
  assertVatSummaryExcludes(nonPostingVatReport, 'CODEX_PHASE16A_VAT_DEBUG_PURCHASE_DRAFT', 'purchase draft VAT');
  assertVatSummaryExcludes(nonPostingVatReport, 'CODEX_PHASE16A_VAT_DEBUG_PURCHASE_ORDER', 'purchase order VAT');
  assert(
    Number(nonPostingVatReport.body.data.totalsByCurrency?.LAK?.taxAmount ?? 0) === 0 &&
      Number(nonPostingVatReport.body.data.totalsByCurrency?.LAK?.inputTax ?? 0) === 0 &&
      Number(nonPostingVatReport.body.data.totalsByCurrency?.LAK?.outputTax ?? 0) === 0,
    'VAT tax totals should stay zero while only non-posting documents have VAT',
  );

  const salesVatInvoiceResult = await action('sales_document.status.update', {
    documentId: salesVatQuotation.id,
    status: 'invoice',
  });
  assert(salesVatInvoiceResult.status === 200 && salesVatInvoiceResult.body?.ok === true, 'VAT quotation to invoice should pass');
  const purchaseVatBillResult = await action('purchase_document.status.update', {
    documentId: purchaseVatOrder.id,
    status: 'bill',
  });
  assert(purchaseVatBillResult.status === 200 && purchaseVatBillResult.body?.ok === true, 'VAT purchase_order to bill should pass');

  const postingVatReport = await postReportQuery('vat_summary');
  assert(postingVatReport.status === 200 && postingVatReport.body?.ok === true, 'posting VAT summary should pass');
  assertVatSummaryExcludes(postingVatReport, 'CODEX_PHASE16A_VAT_DEBUG_DRAFT', 'sales draft VAT after posting others');
  assertVatSummaryExcludes(postingVatReport, 'CODEX_PHASE16A_VAT_DEBUG_PURCHASE_DRAFT', 'purchase draft VAT after posting others');
  assertVatSummaryIncludes(postingVatReport, 'CODEX_PHASE16A_VAT_DEBUG_QUOTATION', 'invoice', 'sales invoice VAT');
  assertVatSummaryIncludes(postingVatReport, 'CODEX_PHASE16A_VAT_DEBUG_PURCHASE_ORDER', 'bill', 'purchase bill VAT');
  assert(postingVatReport.body.data.totalsByCurrency?.LAK?.outputTax === 30, 'VAT summary should include 30 LAK output tax for invoice');
  assert(postingVatReport.body.data.totalsByCurrency?.LAK?.inputTax === 14, 'VAT summary should include 14 LAK input tax for bill');

  const purchaseBill = await action('purchase_document.status.update', {
    documentId: purchaseDefault.id,
    status: 'bill',
  });
  assert(purchaseBill.status === 200 && purchaseBill.body?.ok === true, 'purchase_order to bill should pass');
  assert(documentJournals(purchaseBill.body.state, documentById(purchaseBill.body.state, purchaseDefault.id)).length === 0, 'purchase_order to bill should not post journals');

  const purchasePaid = await action('purchase_document.status.update', {
    documentId: purchaseDefault.id,
    status: 'paid',
    settlementAccountId: 'acc-cash-lak',
    settlementDate: '2026-09-06',
  });
  assert(purchasePaid.status === 200 && purchasePaid.body?.ok === true, 'same-currency purchase paid should pass');
  assert(documentById(purchasePaid.body.state, purchaseDefault.id).status === 'paid', 'same-currency purchase should finish as paid');
  assertBalancedJournal(documentJournals(purchasePaid.body.state, documentById(purchasePaid.body.state, purchaseDefault.id))[0], 'same-currency purchase paid');

  const usdCustomer = await createUsdCustomer();
  const fxDocumentResult = await createSalesDocument({
    contactId: usdCustomer.id,
    reference: 'CODEX_LIFECYCLE_FX_PARTIAL_REF',
    title: 'Lifecycle FX partial settlement',
    exchangeRate: 22000,
    items: simpleLine('Lifecycle USD service', 100),
  });
  const fxDocument = fxDocumentResult.body.state.documents[0];
  const fxInvoice = await action('sales_document.status.update', {
    documentId: fxDocument.id,
    status: 'invoice',
  });
  assert(fxInvoice.status === 200 && fxInvoice.body?.ok === true, 'FX sales quotation to invoice should pass');

  const fxPartial = await action('sales_document.status.update', {
    documentId: fxDocument.id,
    status: 'receipt',
    settlementAccountId: 'acc-bank-lak',
    settlementDate: '2026-09-07',
    settlementAmount: 40,
    settlementExchangeRate: 23000,
    settlementBankFeeAmount: 2,
    settlementBankFeeAccountId: 'acc-bank-fee-expense',
    settlementWithholdingTaxAmount: 3,
    settlementWithholdingTaxAccountId: 'acc-wht-receivable',
    settlementExchangeGainAccountId: 'acc-exchange-gain',
    settlementExchangeLossAccountId: 'acc-exchange-loss',
  });
  assert(fxPartial.status === 200 && fxPartial.body?.ok === true, 'FX partial receipt with fee/WHT should pass');
  const fxPartialDocument = documentById(fxPartial.body.state, fxDocument.id);
  assert(fxPartialDocument.status === 'invoice', 'FX partial receipt should keep invoice open');
  assert(documentRemainingAmount(fxPartial.body.state, fxPartialDocument) === 60, 'FX partial receipt should leave 60 USD remaining');
  const fxPartialJournal = documentJournals(fxPartial.body.state, fxPartialDocument)[0];
  assertBalancedJournal(fxPartialJournal, 'FX partial receipt with fee/WHT');
  assert(fxPartialJournal.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 805000), 'FX partial receipt should debit LAK bank net cash');
  assert(fxPartialJournal.lines.some((line) => line.accountId === 'acc-bank-fee-expense' && line.debit === 46000), 'FX partial receipt should debit bank fee');
  assert(fxPartialJournal.lines.some((line) => line.accountId === 'acc-wht-receivable' && line.debit === 69000), 'FX partial receipt should debit withholding receivable');
  assert(fxPartialJournal.lines.some((line) => line.accountId === 'acc-exchange-gain' && line.credit === 40000), 'FX partial receipt should credit exchange gain');
}

try {
  await run();
  console.log('Document lifecycle numbering test passed.');
} finally {
  const reset = await postJson('/api/reset', {}, {
    'X-Codex-Reset-Source': 'document-lifecycle-test',
    'X-Codex-Run-Id': testRunId,
    'X-Codex-Session-Id': testSessionId,
    'X-Codex-Reset-Reason': 'final-cleanup',
  });
  if (reset.status !== 200) {
    console.error(`Final reset failed with HTTP ${reset.status}.`);
    process.exitCode = 1;
  }
}
