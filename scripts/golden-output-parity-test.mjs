import { documentRemainingAmount } from '../shared/report-models.mjs';

const baseUrl = process.env.LOCAL_API_BASE_URL ?? 'http://127.0.0.1:8787';
const runId = `golden-output-parity-${process.pid}`;
const ownerActor = { actorType: 'user', actorId: 'golden-output-parity-builder', roleKey: 'owner', permissions: [] };
const baseHeaders = {
  'Content-Type': 'application/json',
  'X-Codex-State-Write-Source': 'golden-output-parity-test',
  'X-Codex-Run-Id': runId,
  'X-Codex-Session-Id': `${runId}-session`,
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep raw text for downloads.
  }
  return { status: response.status, body, headers: response.headers, text };
}

async function reset(reason) {
  const result = await request('/api/reset', {
    method: 'POST',
    headers: {
      ...baseHeaders,
      'X-Codex-Reset-Source': 'golden-output-parity-test',
      'X-Codex-Reset-Reason': reason,
    },
    body: JSON.stringify({ reason }),
  });
  assert(result.status === 200 && result.body?.ok === true, `reset failed: ${result.status}`);
  return result;
}

async function state() {
  const result = await request('/api/state');
  assert(result.status === 200 && result.body?.organization, `state failed: ${result.status}`);
  return result;
}

async function action(key, payload, headers = {}) {
  const result = await request(`/api/actions/${key}`, {
    method: 'POST',
    headers: { ...baseHeaders, ...headers },
    body: JSON.stringify({ actor: ownerActor, payload }),
  });
  assert(result.status === 200 && result.body?.ok === true, `${key} failed: ${result.status} ${JSON.stringify(result.body)}`);
  return result;
}

async function report(reportKey, filters = {}) {
  const result = await request(`/api/reports/${reportKey}/query`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ actor: ownerActor, filters }),
  });
  assert(result.status === 200 && result.body?.ok === true, `${reportKey} report failed: ${result.status}`);
  return result.body.data.rows ?? [];
}

function newest(list) {
  return list[0];
}

function balancedJournal(journal, label) {
  assert(journal, `${label} journal missing`);
  const debit = round(journal.lines.reduce((sum, line) => sum + Number(line.debit || 0), 0));
  const credit = round(journal.lines.reduce((sum, line) => sum + Number(line.credit || 0), 0));
  assert(debit === credit, `${label} journal is not balanced: ${debit} vs ${credit}`);
}

async function main() {
  let cleanupError = null;
  try {
    await reset('golden-output-parity-initial-seed');
    const seed = (await state()).body;
    const tax = seed.taxes.find((entry) => entry.id === 'tax-vat');
    const salesCategory = seed.categories.find((entry) => entry.id === 'cat-sales-document');
    const purchaseCategory = seed.categories.find((entry) => entry.id === 'cat-purchase-document');
    assert(tax, 'seed VAT tax missing');
    assert(salesCategory, 'seed sales document category missing');
    assert(purchaseCategory, 'seed purchase document category missing');

    const customer = newest(
      (await action('customer.create', {
        name: 'CODEX_GOLDEN_CUSTOMER_LAK',
        email: 'golden-customer@example.invalid',
        phone: '+856200000000',
        taxNumber: 'CODEX_GOLDEN_CUSTOMER_TAX',
        currency: 'LAK',
        address: 'Sanitized golden customer address',
      })).body.state.contacts,
    );
    const usdCustomer = newest((await action('customer.create', { name: 'CODEX_GOLDEN_CUSTOMER_USD', currency: 'USD' })).body.state.contacts);
    const usdVendor = newest((await action('vendor.create', { name: 'CODEX_GOLDEN_VENDOR_USD', currency: 'USD' })).body.state.contacts);
    const product = (await action('product.create', {
      code: 'CODEX_GOLDEN_SERVICE',
      name: 'CODEX_GOLDEN Service',
      unit: 'service',
      unitPrice: 100000,
      taxId: 'tax-vat',
    })).body.state.products.find((entry) => entry.code === 'CODEX_GOLDEN_SERVICE');
    const revenueCategory = newest(
      (await action('category.create', {
        kind: 'revenue',
        name: 'CODEX_GOLDEN_OTHER_INCOME',
        accountingCode: 'CODEX_GOLDEN_REV',
        accountId: 'acc-income-service',
      })).body.state.categories,
    );
    const paymentCategory = newest(
      (await action('category.create', {
        kind: 'payment',
        name: 'CODEX_GOLDEN_UTILITY_EXPENSE',
        accountingCode: 'CODEX_GOLDEN_PAY',
        accountId: 'acc-expense-admin',
      })).body.state.categories,
    );

    const revenueResult = await action('cash_revenue.create', {
      kind: 'revenue',
      transactionDate: '2026-06-26',
      accountId: 'acc-bank-lak',
      categoryId: revenueCategory.id,
      contactId: customer.id,
      reference: 'CODEX_GOLDEN_REVENUE_REF',
      description: 'Golden revenue with VAT',
      items: [{
        id: 'golden-revenue-line',
        productId: product.id,
        name: 'Golden revenue line',
        unit: 'service',
        quantity: 1,
        unitPrice: 100000,
        discount: 0,
        discountType: 'percentage',
        taxId: 'tax-vat',
      }],
    });
    const revenue = newest(revenueResult.body.state.cashTransactions);
    assert(revenue.amount === 110000, `golden revenue gross expected 110000, got ${revenue.amount}`);
    balancedJournal(newest(revenueResult.body.state.journalEntries), 'golden cash revenue');

    const paymentResult = await action('cash_payment.create', {
      kind: 'payment',
      transactionDate: '2026-06-26',
      accountId: 'acc-bank-lak',
      categoryId: paymentCategory.id,
      contactId: usdVendor.id,
      reference: 'CODEX_GOLDEN_PAYMENT_REF',
      description: 'Golden utility payment with VAT',
      items: [{
        id: 'golden-payment-line',
        name: 'Golden utility payment line',
        unit: 'service',
        quantity: 1,
        unitPrice: 100000,
        discount: 0,
        discountType: 'percentage',
        taxId: 'tax-vat',
      }],
    });
    const payment = newest(paymentResult.body.state.cashTransactions);
    assert(payment.amount === 110000, `golden payment gross expected 110000, got ${payment.amount}`);
    balancedJournal(newest(paymentResult.body.state.journalEntries), 'golden cash payment');

    const salesDocument = newest(
      (await action('sales_document.create', {
        kind: 'sales',
        contactId: usdCustomer.id,
        documentDate: '2026-06-26',
        dueDate: '2026-07-26',
        orderNumber: 'CODEX_GOLDEN_SO_001',
        reference: 'CODEX_GOLDEN_SALES_FX_REF',
        title: 'Golden USD invoice',
        categoryId: salesCategory.id,
        currency: 'USD',
        exchangeRate: 22000,
        attachmentNames: ['CODEX_GOLDEN_INVOICE_REFERENCE.pdf'],
        items: [{
          id: 'golden-sales-line',
          name: 'Golden USD invoice line',
          unit: 'service',
          quantity: 1,
          unitPrice: 100,
          discount: 0,
          discountType: 'percentage',
          taxId: 'tax-none',
        }],
      })).body.state.documents,
    );
    assert(salesDocument.status === 'quotation', 'sales document should start as quotation');
    await action('sales_document.status.update', { kind: 'sales', documentId: salesDocument.id, status: 'invoice' });
    const salesReceipt = await action('sales_document.status.update', {
      kind: 'sales',
      documentId: salesDocument.id,
      status: 'receipt',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-06-27',
      settlementAmount: 40,
      settlementExchangeRate: 23000,
      settlementBankFeeAmount: 2,
      settlementBankFeeAccountId: 'acc-bank-fee-expense',
      settlementWithholdingTaxAmount: 3,
      settlementWithholdingTaxAccountId: 'acc-wht-receivable',
      settlementExchangeGainAccountId: 'acc-exchange-gain',
      settlementExchangeLossAccountId: 'acc-exchange-loss',
    });
    const salesAfterPartial = salesReceipt.body.state.documents.find((entry) => entry.id === salesDocument.id);
    assert(salesAfterPartial.status === 'invoice', 'sales partial settlement should keep invoice status');
    assert(documentRemainingAmount(salesReceipt.body.state, salesAfterPartial) === 60, 'sales partial settlement should leave 60 USD');
    const salesJournal = salesReceipt.body.state.journalEntries.find((entry) => entry.sourceId === salesDocument.id);
    balancedJournal(salesJournal, 'golden sales FX partial');
    assert(salesJournal.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 805000), 'sales net cash line should match golden output');
    assert(salesJournal.lines.some((line) => line.accountId === 'acc-exchange-gain' && line.credit === 40000), 'sales FX gain should match golden output');

    const purchaseDocument = newest(
      (await action('purchase_document.create', {
        kind: 'purchase',
        contactId: usdVendor.id,
        documentDate: '2026-06-26',
        dueDate: '2026-07-26',
        orderNumber: 'CODEX_GOLDEN_PO_001',
        reference: 'CODEX_GOLDEN_PURCHASE_FX_REF',
        title: 'Golden USD bill',
        categoryId: purchaseCategory.id,
        currency: 'USD',
        exchangeRate: 22000,
        attachmentNames: ['CODEX_GOLDEN_BILL_REFERENCE.pdf'],
        items: [{
          id: 'golden-purchase-line',
          name: 'Golden USD bill line',
          unit: 'service',
          quantity: 1,
          unitPrice: 100,
          discount: 0,
          discountType: 'percentage',
          taxId: 'tax-none',
        }],
      })).body.state.documents,
    );
    await action('purchase_document.status.update', { kind: 'purchase', documentId: purchaseDocument.id, status: 'bill' });
    const purchasePaid = await action('purchase_document.status.update', {
      kind: 'purchase',
      documentId: purchaseDocument.id,
      status: 'paid',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-06-27',
      settlementAmount: 40,
      settlementExchangeRate: 23000,
      settlementBankFeeAmount: 2,
      settlementBankFeeAccountId: 'acc-bank-fee-expense',
      settlementWithholdingTaxAmount: 3,
      settlementWithholdingTaxAccountId: 'acc-wht-payable',
      settlementExchangeGainAccountId: 'acc-exchange-gain',
      settlementExchangeLossAccountId: 'acc-exchange-loss',
    });
    const purchaseAfterPartial = purchasePaid.body.state.documents.find((entry) => entry.id === purchaseDocument.id);
    assert(purchaseAfterPartial.status === 'bill', 'purchase partial payment should keep bill status');
    assert(documentRemainingAmount(purchasePaid.body.state, purchaseAfterPartial) === 60, 'purchase partial payment should leave 60 USD');
    const purchaseJournal = purchasePaid.body.state.journalEntries.find((entry) => entry.sourceId === purchaseDocument.id);
    balancedJournal(purchaseJournal, 'golden purchase FX partial');
    assert(purchaseJournal.lines.some((line) => line.accountId === 'acc-bank-lak' && line.credit === 897000), 'purchase net cash line should match golden output');
    assert(purchaseJournal.lines.some((line) => line.accountId === 'acc-exchange-loss' && line.debit === 40000), 'purchase FX loss should match golden output');

    const stateBeforeUpload = await state();
    const upload = await request('/api/attachments', {
      method: 'POST',
      headers: { ...baseHeaders, 'X-Codex-Expected-State-Revision': stateBeforeUpload.headers.get('x-codex-state-revision') },
      body: JSON.stringify({
        actor: ownerActor,
        ownerType: 'document',
        ownerId: salesDocument.id,
        fileName: 'CODEX_GOLDEN_REFERENCE.txt',
        contentType: 'text/plain',
        contentBase64: Buffer.from('golden output attachment reference').toString('base64'),
      }),
    });
    assert(upload.status === 201 && upload.body?.ok === true, `attachment upload failed: ${upload.status}`);
    assert(!upload.body.attachment.storagePath, 'attachment response must not expose storagePath');

    const download = await request(`/api/attachments/${encodeURIComponent(upload.body.attachment.id)}/download`);
    assert(download.status === 200 && download.text === 'golden output attachment reference', 'attachment download should return content');

    const draftDocument = newest(
      (await action('sales_document.create', {
        kind: 'sales',
        status: 'draft',
        contactId: customer.id,
        documentDate: '2026-06-26',
        dueDate: '2026-07-26',
        reference: 'CODEX_GOLDEN_DRAFT_REF',
        title: 'Golden draft document',
        categoryId: salesCategory.id,
        currency: 'LAK',
        items: [{
          id: 'golden-draft-line',
          name: 'Golden draft line',
          unit: 'service',
          quantity: 1,
          unitPrice: 1000,
          discount: 0,
          discountType: 'percentage',
          taxId: 'tax-vat',
        }],
      })).body.state.documents,
    );
    const quotationDocument = newest(
      (await action('sales_document.create', {
        kind: 'sales',
        contactId: customer.id,
        documentDate: '2026-06-26',
        dueDate: '2026-07-26',
        reference: 'CODEX_GOLDEN_QUOTATION_REF',
        title: 'Golden quotation document',
        categoryId: salesCategory.id,
        currency: 'LAK',
        items: [{
          id: 'golden-quotation-line',
          name: 'Golden quotation line',
          unit: 'service',
          quantity: 1,
          unitPrice: 1000,
          discount: 0,
          discountType: 'percentage',
          taxId: 'tax-vat',
        }],
      })).body.state.documents,
    );
    const purchaseOrderDocument = newest(
      (await action('purchase_document.create', {
        kind: 'purchase',
        contactId: usdVendor.id,
        documentDate: '2026-06-26',
        dueDate: '2026-07-26',
        reference: 'CODEX_GOLDEN_PURCHASE_ORDER_REF',
        title: 'Golden purchase order document',
        categoryId: purchaseCategory.id,
        currency: 'USD',
        exchangeRate: 22000,
        items: [{
          id: 'golden-purchase-order-line',
          name: 'Golden purchase order line',
          unit: 'service',
          quantity: 1,
          unitPrice: 10,
          discount: 0,
          discountType: 'percentage',
          taxId: 'tax-none',
        }],
      })).body.state.documents,
    );

    const settlementRows = await report('settlement_history');
    assert(settlementRows.some((row) => row.documentId === salesDocument.id && row.amount === 40 && row.currency === 'USD' && row.cashAmount === 805000 && row.cashCurrency === 'LAK'), 'sales settlement history should match golden output');
    assert(settlementRows.some((row) => row.documentId === purchaseDocument.id && row.amount === 40 && row.currency === 'USD' && row.cashAmount === 897000 && row.cashCurrency === 'LAK'), 'purchase settlement history should match golden output');

    const sourceTraceRows = await report('source_trace');
    const salesTrace = sourceTraceRows.find((row) => row.sourceId === salesDocument.id && row.entryId);
    const purchaseTrace = sourceTraceRows.find((row) => row.sourceId === purchaseDocument.id && row.entryId);
    const revenueTrace = sourceTraceRows.find((row) => row.sourceId === revenue.id && row.entryId);
    const draftTrace = sourceTraceRows.find((row) => row.sourceId === draftDocument.id);
    const quotationTrace = sourceTraceRows.find((row) => row.sourceId === quotationDocument.id);
    const purchaseOrderTrace = sourceTraceRows.find((row) => row.sourceId === purchaseOrderDocument.id);
    assert(salesTrace?.balanced === true && salesTrace.debitTotal === salesTrace.creditTotal, 'sales source trace should expose balanced journal totals');
    assert(purchaseTrace?.ledgerAccounts?.includes('D:') && purchaseTrace.ledgerAccounts.includes('C:'), 'purchase source trace should expose ledger line summary');
    assert(revenueTrace?.sourceAmount === 110000 && revenueTrace.sourceCurrency === 'LAK', 'revenue source trace should expose source amount and currency');
    for (const [label, trace] of [
      ['draft', draftTrace],
      ['quotation', quotationTrace],
      ['purchase order', purchaseOrderTrace],
    ]) {
      assert(trace?.entryId === null, `${label} source trace should not have a journal entry`);
      assert(trace?.journalLineCount === 0, `${label} source trace should not report journal lines`);
      assert(trace?.balanced === null, `${label} source trace should not report balanced true without a journal`);
      assert(trace?.postingStatus === 'unposted', `${label} source trace should report unposted status`);
    }

    const trialRows = await report('trial_balance');
    const cashRows = await report('cash_movement');
    assert(trialRows.some((row) => row.accountId === 'acc-bank-fee-expense'), 'trial balance should include bank fee account after golden settlements');
    assert(cashRows.some((row) => row.accountId === 'acc-bank-lak' && row.currency === 'LAK'), 'cash movement should include LAK bank row');

    const stale = await state();
    await action('customer.create', { name: 'CODEX_GOLDEN_CONFLICT_WINNER', currency: 'LAK' });
    const staleWrite = await request('/api/actions/customer.create', {
      method: 'POST',
      headers: { ...baseHeaders, 'X-Codex-Expected-State-Revision': stale.headers.get('x-codex-state-revision') },
      body: JSON.stringify({ actor: ownerActor, payload: { name: 'CODEX_GOLDEN_STALE_WRITE', currency: 'LAK' } }),
    });
    assert(staleWrite.status === 409 && staleWrite.body?.code === 'STATE_REVISION_CONFLICT', 'stale write should return 409 STATE_REVISION_CONFLICT');

    const summary = {
      ok: true,
      scenario: 'phase-14-golden-output-parity',
      taxRate: tax.rate,
      generatedFakeData: [
        'CODEX_GOLDEN_CUSTOMER_LAK',
        'CODEX_GOLDEN_CUSTOMER_USD',
        'CODEX_GOLDEN_VENDOR_USD',
        'CODEX_GOLDEN_SERVICE',
        'CODEX_GOLDEN_REVENUE_REF',
        'CODEX_GOLDEN_PAYMENT_REF',
        'CODEX_GOLDEN_SALES_FX_REF',
        'CODEX_GOLDEN_PURCHASE_FX_REF',
        'CODEX_GOLDEN_DRAFT_REF',
        'CODEX_GOLDEN_QUOTATION_REF',
        'CODEX_GOLDEN_PURCHASE_ORDER_REF',
        'CODEX_GOLDEN_REFERENCE.txt',
      ],
      goldenOutputs: {
        revenueGrossLak: revenue.amount,
        paymentGrossLak: payment.amount,
        salesPartial: { documentAmountUsd: 40, cashAmountLak: 805000, remainingUsd: 60 },
        purchasePartial: { documentAmountUsd: 40, cashAmountLak: 897000, remainingUsd: 60 },
        settlementHistoryRows: settlementRows.length,
        sourceTraceRows: sourceTraceRows.length,
        trialBalanceRows: trialRows.length,
        cashMovementRows: cashRows.length,
      },
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    try {
      await reset('golden-output-parity-final-cleanup');
    } catch (error) {
      cleanupError = error;
    }
    if (cleanupError) throw cleanupError;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
