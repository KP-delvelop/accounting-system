import { buildReportSnapshotPayload, documentRemainingAmount } from '../shared/report-models.mjs';
import { spawn } from 'node:child_process';

const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:8787';
const testRunId = process.env.CODEX_TEST_RUN_ID ?? `api-smoke-${process.pid}-${Date.now()}`;
const testSessionId = process.env.CODEX_TEST_SESSION_ID ?? `api-smoke-session-${process.pid}`;

const ownerActor = {
  actorType: 'user',
  actorId: 'user-owner-demo',
  roleKey: 'owner',
  permissions: [],
};

const viewerActor = {
  actorType: 'user',
  actorId: 'user-viewer-demo',
  roleKey: 'viewer',
  permissions: [],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  return requestAt(baseUrl, path, options);
}

async function requestAt(urlBase, path, options = {}) {
  const response = await fetch(`${urlBase}${path}`, options);
  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return {
    status: response.status,
    body,
    headers: {
      stateRevision: response.headers.get('x-codex-state-revision'),
    },
  };
}

async function getJson(path) {
  return request(path);
}

function diagnosticHeaders(reason) {
  return {
    'X-Codex-State-Write-Source': 'api-smoke-test',
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

async function putJson(path, body, headers = {}) {
  return request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...diagnosticHeaders(path), ...headers },
    body: JSON.stringify(body),
  });
}

async function deleteJson(path, body = {}, headers = {}) {
  return request(path, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...diagnosticHeaders(path), ...headers },
    body: JSON.stringify(body),
  });
}

async function postReportQuery(reportKey, body) {
  return request(`/api/reports/${reportKey}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function assertError(result, status, code, label) {
  assert(result.status === status, `${label}: expected HTTP ${status}, got ${result.status}`);
  assert(result.body?.ok === false, `${label}: expected ok=false`);
  assert(result.body?.code === code, `${label}: expected code ${code}, got ${result.body?.code}`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(urlBase, child) {
  for (let index = 0; index < 80; index += 1) {
    if (child.exitCode !== null) break;
    try {
      const health = await requestAt(urlBase, '/api/health');
      if (health.status === 200 && health.body?.ok === true) return health.body;
    } catch {
      // Keep waiting while the isolated auth server starts.
    }
    await wait(100);
  }
  throw new Error('auth-required local API did not become healthy');
}

async function runAuthRequiredApiChecks() {
  const authPort = Number(process.env.LOCAL_API_AUTH_TEST_PORT ?? 8797);
  const authBaseUrl = `http://127.0.0.1:${authPort}`;
  const authToken = `phase7b-auth-${process.pid}`;
  const adminToken = `phase7b-admin-${process.pid}`;
  const child = spawn(process.execPath, ['scripts/local-api.mjs'], {
    env: {
      ...process.env,
      LOCAL_API_PORT: String(authPort),
      LOCAL_API_AUTH_MODE: 'required',
      LOCAL_API_AUTH_TOKEN: authToken,
      LOCAL_API_ADMIN_TOKEN: adminToken,
      LOCAL_API_ACTOR_ID: 'server-viewer-demo',
      LOCAL_API_ROLE_KEY: 'viewer',
      LOCAL_API_PERMISSIONS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const health = await waitForHealth(authBaseUrl, child);
    assert(health.authMode === 'required', 'auth-required health should expose authMode');

    assertError(await requestAt(authBaseUrl, '/api/actions'), 401, 'UNAUTHENTICATED', 'auth-required actions list without token');
    assertError(
      await requestAt(authBaseUrl, '/api/reports/trial_balance/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: ownerActor, filters: {} }),
      }),
      401,
      'UNAUTHENTICATED',
      'auth-required report query without token',
    );
    assertError(
      await requestAt(authBaseUrl, '/api/actions/customer.create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: ownerActor, payload: { name: 'Spoofed owner customer' } }),
      }),
      401,
      'UNAUTHENTICATED',
      'auth-required action without token',
    );

    assertError(
      await requestAt(authBaseUrl, '/api/actions/customer.create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ actor: ownerActor, payload: { name: 'Spoofed owner customer' } }),
      }),
      403,
      'PERMISSION_DENIED',
      'auth-required action should ignore client owner actor and use server viewer actor',
    );

    assertError(
      await requestAt(authBaseUrl, '/api/reset-diagnostics?limit=1', {
        headers: { Authorization: `Bearer ${authToken}` },
      }),
      403,
      'ADMIN_REQUIRED',
      'auth-required diagnostics should require admin token',
    );
    assertError(
      await requestAt(authBaseUrl, '/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: '{}',
      }),
      403,
      'ADMIN_REQUIRED',
      'auth-required reset should require admin token',
    );

    const diagnostics = await requestAt(authBaseUrl, '/api/reset-diagnostics?limit=1', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(diagnostics.status === 200 && diagnostics.body?.ok === true, 'auth-required diagnostics should pass with admin token');
  } finally {
    child.kill('SIGTERM');
    await wait(150);
    if (stderr.trim()) {
      throw new Error(`auth-required local API wrote stderr: ${stderr.trim()}`);
    }
  }
}

function accountMovement(account, debit, credit) {
  return account.normalBalance === 'debit' ? debit - credit : credit - debit;
}

function ledgerRowsForAccount(state, accountId) {
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
    .sort(
      (a, b) =>
        a.entry.entryDate.localeCompare(b.entry.entryDate) ||
        a.entry.createdAt.localeCompare(b.entry.createdAt) ||
        a.entry.id.localeCompare(b.entry.id),
    )
    .map((row) => {
      balance += accountMovement(account, row.line.debit, row.line.credit);
      return { ...row, balance };
    })
    .reverse();
}

function cashMovementRows(state) {
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

      return {
        account,
        moneyIn: account.normalBalance === 'debit' ? totals.debit : totals.credit,
        moneyOut: account.normalBalance === 'debit' ? totals.credit : totals.debit,
      };
    });
}

function documentSettlementRows(state) {
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
      return {
        entry,
        document,
        cashLine,
        cashAccount: state.accounts.find((account) => account.id === cashLine.accountId),
      };
    })
    .filter(Boolean);
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

function mismatchedCashBankAccountId(state, currency, label) {
  const account = state.accounts.find((entry) => (entry.kind === 'cash' || entry.kind === 'bank') && entry.currency !== currency);
  assert(account, `${label}: expected at least one cash/bank account with a different currency`);
  return account.id;
}

async function run() {
  const health = await getJson('/api/health');
  assert(health.status === 200 && health.body?.ok === true, 'health endpoint failed');
  assert(health.body.authMode === 'dev', 'default local API should run in dev auth mode');
  await runAuthRequiredApiChecks();

  const reset = await postJson('/api/reset', {}, {
    'X-Codex-Reset-Source': 'api-smoke-test',
    'X-Codex-Run-Id': testRunId,
    'X-Codex-Session-Id': testSessionId,
    'X-Codex-Reset-Reason': 'initial-seed',
  });
  assert(reset.status === 200 && reset.body?.ok === true, 'reset endpoint failed');
  assert(reset.body.state.contacts.length === 0, 'fresh seed should restore zero contacts');
  assert(reset.body.state.products.length === 0, 'fresh seed should restore zero products');
  assert(reset.body.state.tags.length === 0, 'fresh seed should restore zero tags');
  assert(reset.body.state.attachments.length === 0, 'seed should restore zero attachments');
  assert(reset.body.state.documents.length === 0, 'seed should restore zero documents');
  assert(reset.body.state.savedReportFilters.length === 0, 'seed should restore zero saved report filters');

  const resetDiagnostics = await getJson('/api/reset-diagnostics?limit=20');
  assert(resetDiagnostics.status === 200 && resetDiagnostics.body?.ok === true, 'reset diagnostics endpoint failed');
  assert(
    resetDiagnostics.body.diagnostics.some(
      (entry) =>
        entry.event === 'api.reset' &&
        entry.caller?.source === 'api-smoke-test' &&
        entry.caller?.runId === testRunId &&
        entry.caller?.sessionId === testSessionId &&
        entry.caller?.reason === 'initial-seed' &&
        entry.afterCounts?.documents === 0,
    ),
    'reset diagnostics should include api smoke initial reset entry',
  );

  const putSeedState = await putJson('/api/state', reset.body.state, {
    'X-Codex-State-Write-Reason': 'put-seed-state-diagnostics-check',
  });
  assert(putSeedState.status === 200 && putSeedState.body?.ok === true, 'PUT /api/state seed diagnostic check should pass');
  const statePutDiagnostics = await getJson('/api/reset-diagnostics?limit=20');
  assert(
    statePutDiagnostics.body.diagnostics.some(
      (entry) =>
        entry.event === 'api.state.put' &&
        entry.caller?.source === 'api-smoke-test' &&
        entry.caller?.runId === testRunId &&
        entry.caller?.sessionId === testSessionId &&
        entry.caller?.reason === 'put-seed-state-diagnostics-check' &&
        entry.afterCounts?.documents === 0,
    ),
    'state write diagnostics should include PUT /api/state entry',
  );

  const revisionState = await getJson('/api/state');
  const seedRevision = revisionState.headers.stateRevision;
  assert(seedRevision && seedRevision.length === 64, 'GET /api/state should expose a state revision header');

  const currentRevisionPut = await putJson('/api/state', revisionState.body, {
    'X-Codex-Expected-State-Revision': seedRevision,
    'X-Codex-State-Write-Reason': 'current-revision-put-check',
  });
  assert(
    currentRevisionPut.status === 200 && currentRevisionPut.body?.ok === true,
    'PUT /api/state with current revision should pass',
  );

  const revisionAction = await postJson(
    '/api/actions/customer.create',
    {
      actor: ownerActor,
      payload: {
        name: 'CODEX_REVISION_GUARD_CUSTOMER',
        currency: 'LAK',
      },
    },
    { 'X-Codex-Expected-State-Revision': seedRevision },
  );
  assert(
    revisionAction.status === 200 && revisionAction.body?.ok === true && revisionAction.headers.stateRevision !== seedRevision,
    'action with current revision should pass and return a new revision',
  );
  assert(
    revisionAction.body.state.contacts.some((contact) => contact.name === 'CODEX_REVISION_GUARD_CUSTOMER'),
    'revision action should persist the new customer',
  );

  assertError(
    await putJson('/api/state', revisionState.body, {
      'X-Codex-Expected-State-Revision': seedRevision,
      'X-Codex-State-Write-Reason': 'stale-revision-put-check',
    }),
    409,
    'STATE_REVISION_CONFLICT',
    'stale PUT /api/state should conflict',
  );
  assertError(
    await postJson(
      '/api/actions/customer.create',
      {
        actor: ownerActor,
        payload: {
          name: 'CODEX_STALE_REVISION_CUSTOMER',
          currency: 'LAK',
        },
      },
      { 'X-Codex-Expected-State-Revision': seedRevision },
    ),
    409,
    'STATE_REVISION_CONFLICT',
    'stale action should conflict',
  );

  const resetAfterRevisionChecks = await postJson('/api/reset', {}, {
    'X-Codex-Reset-Source': 'api-smoke-test',
    'X-Codex-Run-Id': testRunId,
    'X-Codex-Session-Id': testSessionId,
    'X-Codex-Reset-Reason': 'after-revision-guard-check',
  });
  assert(resetAfterRevisionChecks.status === 200 && resetAfterRevisionChecks.body?.ok === true, 'reset after revision checks should pass');

  const actions = await getJson('/api/actions');
  assert(actions.status === 200 && actions.body?.ok === true, 'actions endpoint failed');
  assert(actions.body.actions.some((action) => action.key === 'customer.create'), 'customer.create action missing');
  assert(actions.body.actions.some((action) => action.key === 'vendor.create'), 'vendor.create action missing');
  assert(actions.body.actions.some((action) => action.key === 'product.create'), 'product.create action missing');
  assert(actions.body.actions.some((action) => action.key === 'category.create'), 'category.create action missing');
  assert(
    actions.body.actions.some((action) => action.key === 'sales_document.status.update'),
    'sales document status action missing',
  );
  assert(actions.body.actions.some((action) => action.key === 'record.delete'), 'record.delete action missing');
  assert(actions.body.actions.some((action) => action.key === 'report.view'), 'report.view action missing');
  assert(actions.body.actions.some((action) => action.key === 'report.filter.save'), 'report.filter.save action missing');
  assert(actions.body.actions.some((action) => action.key === 'report.filter.delete'), 'report.filter.delete action missing');

  const stateBeforeReportView = await getJson('/api/state');
  const reportView = await postJson('/api/actions/report.view', {
    actor: ownerActor,
    payload: { reportKey: 'trial_balance' },
  });
  assert(reportView.status === 200 && reportView.body?.ok === true, 'report.view should pass for owner');
  assert(
    JSON.stringify(reportView.body.state) === JSON.stringify(stateBeforeReportView.body),
    'report.view should not mutate state',
  );

  assertError(
    await postJson('/api/actions/report.view', {
      actor: viewerActor,
      payload: { reportKey: 'trial_balance' },
    }),
    403,
    'PERMISSION_DENIED',
    'report view permission',
  );

  assertError(
    await postJson('/api/actions/report.view', {
      actor: ownerActor,
      payload: { reportKey: 'unknown_report' },
    }),
    400,
    'VALIDATION_ERROR',
    'report view key validation',
  );

  const reportStateBeforeEndpoint = await getJson('/api/state');
  const trialBalanceReport = await postReportQuery('trial_balance', {
    actor: ownerActor,
    filters: { dateFrom: '2026-06-01', dateTo: '2026-06-30', status: 'all' },
  });
  assert(trialBalanceReport.status === 200 && trialBalanceReport.body?.ok === true, 'trial balance report endpoint should pass');
  assert(trialBalanceReport.body.reportKey === 'trial_balance', 'trial balance report endpoint should echo report key');
  assert(trialBalanceReport.body.filters.dateFrom === '2026-06-01', 'trial balance report endpoint should normalize dateFrom');
  assert(
    trialBalanceReport.body.data.rows.length === reportStateBeforeEndpoint.body.accounts.length,
    'trial balance report endpoint should return one row per account',
  );
  const reportStateAfterEndpoint = await getJson('/api/state');
  assert(
    JSON.stringify(reportStateAfterEndpoint.body) === JSON.stringify(reportStateBeforeEndpoint.body),
    'report endpoint should not mutate state',
  );

  assertError(
    await postReportQuery('trial_balance', {
      actor: viewerActor,
      filters: {},
    }),
    403,
    'PERMISSION_DENIED',
    'report endpoint permission',
  );

  assertError(
    await postReportQuery('unknown_report', {
      actor: ownerActor,
      filters: {},
    }),
    400,
    'VALIDATION_ERROR',
    'report endpoint key validation',
  );

  assertError(
    await postReportQuery('ledger', {
      actor: ownerActor,
      filters: {},
    }),
    400,
    'VALIDATION_ERROR',
    'ledger report requires account id',
  );

  assertError(
    await postReportQuery('trial_balance', {
      actor: ownerActor,
      filters: { dateFrom: '2026-07-01', dateTo: '2026-06-01' },
    }),
    400,
    'VALIDATION_ERROR',
    'report endpoint date validation',
  );

  const savedReportFilter = await postJson('/api/actions/report.filter.save', {
    actor: ownerActor,
    payload: {
      name: '  CODEX_TEST API Report Filter  ',
      settings: {
        reportKey: 'trial_balance',
        accountId: 'acc-bank-lak',
        dateFrom: '2026-06-01',
        dateTo: '2026-06-30',
        status: 'all',
      },
    },
  });
  assert(savedReportFilter.status === 200 && savedReportFilter.body?.ok === true, 'report.filter.save should pass for owner');
  const createdReportFilter = savedReportFilter.body.state.savedReportFilters.find((filter) => filter.name === 'CODEX_TEST API Report Filter');
  assert(createdReportFilter, 'report.filter.save should create a saved filter');
  assert(createdReportFilter.settings.reportKey === 'trial_balance', 'saved report filter should persist report key');
  assert(createdReportFilter.settings.accountId === 'acc-bank-lak', 'saved report filter should persist account filter');
  assert(savedReportFilter.body.state.auditLogs[0]?.action === 'report.filter.save', 'report.filter.save should create audit log');
  const actionWriteDiagnostics = await getJson('/api/reset-diagnostics?limit=30');
  assert(
    actionWriteDiagnostics.body.diagnostics.some(
      (entry) =>
        entry.event === 'api.action.write' &&
        entry.actionKey === 'report.filter.save' &&
        entry.caller?.source === 'api-smoke-test' &&
        entry.caller?.runId === testRunId &&
        entry.caller?.sessionId === testSessionId &&
        entry.afterCounts?.savedReportFilters === 1,
    ),
    'state write diagnostics should include report.filter.save action entry',
  );

  assertError(
    await postJson('/api/actions/report.filter.save', {
      actor: ownerActor,
      payload: {
        name: 'CODEX_TEST API Report Filter',
        settings: { reportKey: 'ledger', accountId: 'acc-cash-lak', status: 'all' },
      },
    }),
    400,
    'VALIDATION_ERROR',
    'duplicate report filter name',
  );

  assertError(
    await postJson('/api/actions/report.filter.save', {
      actor: viewerActor,
      payload: {
        name: 'CODEX_TEST Viewer Report Filter',
        settings: { reportKey: 'ledger', accountId: 'acc-cash-lak', status: 'all' },
      },
    }),
    403,
    'PERMISSION_DENIED',
    'report filter save permission',
  );

  assertError(
    await postJson('/api/actions/report.filter.save', {
      actor: ownerActor,
      payload: {
        name: 'CODEX_TEST Bad Report Filter',
        settings: { reportKey: 'ledger', accountId: 'missing-account', status: 'all' },
      },
    }),
    400,
    'VALIDATION_ERROR',
    'report filter account validation',
  );

  assertError(
    await postJson('/api/actions/report.filter.save', {
      actor: ownerActor,
      payload: {
        name: 'CODEX_TEST Bad Date Report Filter',
        settings: { reportKey: 'vat_summary', dateFrom: '2026-07-01', dateTo: '2026-06-01', status: 'all' },
      },
    }),
    400,
    'VALIDATION_ERROR',
    'report filter date validation',
  );

  assertError(
    await postJson('/api/actions/report.filter.delete', {
      actor: viewerActor,
      payload: { filterId: createdReportFilter.id },
    }),
    403,
    'PERMISSION_DENIED',
    'report filter delete permission',
  );

  const deletedReportFilter = await postJson('/api/actions/report.filter.delete', {
    actor: ownerActor,
    payload: { filterId: createdReportFilter.id },
  });
  assert(deletedReportFilter.status === 200 && deletedReportFilter.body?.ok === true, 'report.filter.delete should pass for owner');
  assert(
    !deletedReportFilter.body.state.savedReportFilters.some((filter) => filter.id === createdReportFilter.id),
    'report.filter.delete should remove saved filter',
  );
  assert(deletedReportFilter.body.state.auditLogs[0]?.action === 'report.filter.delete', 'report.filter.delete should create audit log');

  const customer = await postJson('/api/actions/customer.create', {
    actor: ownerActor,
    payload: {
      type: 'customer',
      name: '  CODEX_TEST API Customer  ',
      code: 'CODEX_TEST_API_CUSTOMER',
      email: 'codex-api-customer@example.invalid',
      phone: '+856200000000',
      taxNumber: 'CODEX_TEST_TAX_CUSTOMER',
      address: 'CODEX_TEST customer address',
      currency: 'LAK',
    },
  });
  assert(customer.status === 200 && customer.body?.ok === true, 'customer.create should pass');
  const createdCustomer = customer.body.state.contacts.find((contact) => contact.code === 'CODEX_TEST_API_CUSTOMER');
  assert(createdCustomer?.name === 'CODEX_TEST API Customer', 'customer.create should trim name before saving');
  assert(createdCustomer?.email === 'codex-api-customer@example.invalid', 'customer.create should keep email');
  assert(createdCustomer?.phone === '+856200000000', 'customer.create should keep phone');
  assert(createdCustomer?.taxNumber === 'CODEX_TEST_TAX_CUSTOMER', 'customer.create should keep tax number');
  assert(createdCustomer?.address === 'CODEX_TEST customer address', 'customer.create should keep address');
  assert(customer.body.state.auditLogs[0]?.action === 'customer.create', 'customer.create should create audit log');

  const vendor = await postJson('/api/actions/vendor.create', {
    actor: ownerActor,
    payload: {
      type: 'vendor',
      name: 'CODEX_TEST API Vendor',
      code: 'CODEX_TEST_API_VENDOR',
      taxNumber: 'CODEX_TEST_TAX_VENDOR',
      currency: 'USD',
    },
  });
  assert(vendor.status === 200 && vendor.body?.ok === true, 'vendor.create should pass');
  const createdVendor = vendor.body.state.contacts.find((contact) => contact.code === 'CODEX_TEST_API_VENDOR');
  assert(createdVendor?.currency === 'USD', 'vendor.create should keep requested currency');
  assert(createdVendor?.taxNumber === 'CODEX_TEST_TAX_VENDOR', 'vendor.create should keep tax number');

  assertError(
    await postJson('/api/actions/customer.create', {
      actor: ownerActor,
      payload: { type: 'customer', name: '   ', currency: 'LAK' },
    }),
    400,
    'VALIDATION_ERROR',
    'blank customer name',
  );

  assertError(
    await postJson('/api/actions/vendor.create', {
      actor: viewerActor,
      payload: { type: 'vendor', name: 'CODEX_TEST Permission Vendor', currency: 'LAK' },
    }),
    403,
    'PERMISSION_DENIED',
    'vendor permission',
  );

  const product = await postJson('/api/actions/product.create', {
    actor: ownerActor,
    payload: {
      code: 'CODEX_TEST_API_PRODUCT',
      name: 'CODEX_TEST API Product',
      unit: 'service',
      unitPrice: 321,
      taxId: 'tax-vat',
    },
  });
  assert(product.status === 200 && product.body?.ok === true, 'product.create should pass');
  const createdProduct = product.body.state.products.find((entry) => entry.code === 'CODEX_TEST_API_PRODUCT');
  assert(createdProduct?.name === 'CODEX_TEST API Product', 'product.create should keep product name');
  assert(createdProduct?.unit === 'service', 'product.create should keep unit');
  assert(createdProduct?.unitPrice === 321, 'product.create should keep unit price');
  assert(createdProduct?.taxId === 'tax-vat', 'product.create should keep tax id');
  assert(product.body.state.auditLogs[0]?.action === 'product.create', 'product.create should create audit log');

  assertError(
    await postJson('/api/actions/product.create', {
      actor: ownerActor,
      payload: {
        code: 'CODEX_TEST_API_PRODUCT',
        name: 'CODEX_TEST Duplicate Product',
        unit: 'service',
        unitPrice: 100,
        taxId: 'tax-none',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'duplicate product code',
  );

  assertError(
    await postJson('/api/actions/product.create', {
      actor: ownerActor,
      payload: {
        code: 'CODEX_TEST_BLANK_PRODUCT',
        name: '   ',
        unit: 'service',
        unitPrice: 100,
        taxId: 'tax-none',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'blank product name',
  );

  assertError(
    await postJson('/api/actions/product.create', {
      actor: viewerActor,
      payload: {
        code: 'CODEX_TEST_PERMISSION_PRODUCT',
        name: 'CODEX_TEST Permission Product',
        unit: 'service',
        unitPrice: 100,
        taxId: 'tax-none',
      },
    }),
    403,
    'PERMISSION_DENIED',
    'product permission',
  );

  const category = await postJson('/api/actions/category.create', {
    actor: ownerActor,
    payload: {
      kind: 'revenue',
      name: 'CODEX_TEST API Revenue Category',
      accountingCode: 'CODEX_TEST_REV_CAT',
      accountId: 'acc-income-service',
    },
  });
  assert(category.status === 200 && category.body?.ok === true, 'category.create should pass');
  const createdRevenueCategory = category.body.state.categories.find((entry) => entry.accountingCode === 'CODEX_TEST_REV_CAT');
  assert(createdRevenueCategory?.kind === 'revenue', 'category.create should keep kind');
  assert(createdRevenueCategory?.name === 'CODEX_TEST API Revenue Category', 'category.create should keep name');
  assert(createdRevenueCategory?.accountId === 'acc-income-service', 'category.create should keep account');
  assert(category.body.state.auditLogs[0]?.action === 'category.create', 'category.create should create audit log');

  const salesCategory = await postJson('/api/actions/category.create', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      name: 'CODEX_TEST API Sales Category',
      accountingCode: 'CODEX_TEST_SALES_CAT',
      accountId: 'acc-income-service',
    },
  });
  assert(salesCategory.status === 200 && salesCategory.body?.ok === true, 'sales category.create should pass');
  const createdSalesCategory = salesCategory.body.state.categories.find((entry) => entry.accountingCode === 'CODEX_TEST_SALES_CAT');
  assert(createdSalesCategory?.kind === 'sales', 'sales category.create should keep kind');

  assertError(
    await postJson('/api/actions/category.create', {
      actor: ownerActor,
      payload: {
        kind: 'revenue',
        name: 'CODEX_TEST API Revenue Category',
        accountingCode: 'CODEX_TEST_REV_CAT_2',
        accountId: 'acc-income-service',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'duplicate category name',
  );

  assertError(
    await postJson('/api/actions/category.create', {
      actor: ownerActor,
      payload: {
        kind: 'revenue',
        name: 'CODEX_TEST API Revenue Category 2',
        accountingCode: 'CODEX_TEST_REV_CAT',
        accountId: 'acc-income-service',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'duplicate category code',
  );

  assertError(
    await postJson('/api/actions/category.create', {
      actor: ownerActor,
      payload: {
        kind: 'revenue',
        name: '   ',
        accountingCode: 'CODEX_TEST_BLANK_CAT',
        accountId: 'acc-income-service',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'blank category name',
  );

  assertError(
    await postJson('/api/actions/category.create', {
      actor: ownerActor,
      payload: {
        kind: 'unknown',
        name: 'CODEX_TEST Invalid Category',
        accountingCode: 'CODEX_TEST_INVALID_CAT',
        accountId: 'acc-income-service',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'invalid category kind',
  );

  assertError(
    await postJson('/api/actions/category.create', {
      actor: ownerActor,
      payload: {
        kind: 'revenue',
        name: 'CODEX_TEST Invalid Account Category',
        accountingCode: 'CODEX_TEST_INVALID_ACCOUNT_CAT',
        accountId: 'acc-does-not-exist',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'invalid category account',
  );

  assertError(
    await postJson('/api/actions/category.create', {
      actor: ownerActor,
      payload: {
        kind: 'revenue',
        name: 'CODEX_TEST Revenue Expense Account Category',
        accountingCode: 'CODEX_TEST_REV_EXP_ACCOUNT_CAT',
        accountId: 'acc-expense-admin',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'revenue category cannot use expense account',
  );

  assertError(
    await postJson('/api/actions/category.create', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        name: 'CODEX_TEST Sales Expense Account Category',
        accountingCode: 'CODEX_TEST_SALES_EXP_ACCOUNT_CAT',
        accountId: 'acc-expense-admin',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'sales category cannot use expense account',
  );

  assertError(
    await postJson('/api/actions/category.create', {
      actor: ownerActor,
      payload: {
        kind: 'payment',
        name: 'CODEX_TEST Payment Income Account Category',
        accountingCode: 'CODEX_TEST_PAY_INCOME_ACCOUNT_CAT',
        accountId: 'acc-income-service',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'payment category cannot use income account',
  );

  assertError(
    await postJson('/api/actions/category.create', {
      actor: ownerActor,
      payload: {
        kind: 'purchase',
        name: 'CODEX_TEST Purchase Income Account Category',
        accountingCode: 'CODEX_TEST_PURCHASE_INCOME_ACCOUNT_CAT',
        accountId: 'acc-income-service',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'purchase category cannot use income account',
  );

  assertError(
    await postJson('/api/actions/category.create', {
      actor: viewerActor,
      payload: {
        kind: 'revenue',
        name: 'CODEX_TEST Permission Category',
        accountingCode: 'CODEX_TEST_PERMISSION_CAT',
        accountId: 'acc-income-service',
      },
    }),
    403,
    'PERMISSION_DENIED',
    'category permission',
  );

  assertError(
    await postJson('/api/actions/unknown.action', {
      actor: ownerActor,
      payload: {},
    }),
    404,
    'UNKNOWN_ACTION',
    'unknown action',
  );

  assertError(
    await postJson('/api/actions/cash_revenue.create', {
      actor: ownerActor,
      payload: {
        kind: 'revenue',
        transactionDate: '2026-06-24',
        accountId: 'acc-cash-lak',
        categoryId: 'cat-admin-expense',
        reference: 'CODEX_TEST_WRONG_REVENUE_CATEGORY',
        description: 'Revenue should reject payment category',
        items: [
          {
            id: 'item-wrong-revenue-category',
            name: 'Wrong category revenue line',
            unit: 'service',
            quantity: 1,
            unitPrice: 100,
            discount: 0,
            discountType: 'percentage',
            taxId: 'tax-none',
          },
        ],
      },
    }),
    400,
    'VALIDATION_ERROR',
    'revenue action rejects payment category',
  );

  assertError(
    await postJson('/api/actions/cash_payment.create', {
      actor: ownerActor,
      payload: {
        kind: 'payment',
        transactionDate: '2026-06-24',
        accountId: 'acc-cash-lak',
        categoryId: 'cat-service-revenue',
        reference: 'CODEX_TEST_WRONG_PAYMENT_CATEGORY',
        description: 'Payment should reject revenue category',
        items: [
          {
            id: 'item-wrong-payment-category',
            name: 'Wrong category payment line',
            unit: 'service',
            quantity: 1,
            unitPrice: 100,
            discount: 0,
            discountType: 'percentage',
            taxId: 'tax-none',
          },
        ],
      },
    }),
    400,
    'VALIDATION_ERROR',
    'payment action rejects revenue category',
  );

  assertError(
    await postJson('/api/actions/sales_document.create', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        contactId: createdCustomer.id,
        documentDate: '2026-06-24',
        categoryId: 'cat-purchase-document',
        reference: 'CODEX_TEST_WRONG_SALES_CATEGORY',
        title: 'Sales should reject purchase category',
        items: [
          {
            id: 'item-wrong-sales-category',
            name: 'Wrong category sales line',
            unit: 'service',
            quantity: 1,
            unitPrice: 100,
            discount: 0,
            discountType: 'percentage',
            taxId: 'tax-none',
          },
        ],
      },
    }),
    400,
    'VALIDATION_ERROR',
    'sales document rejects purchase category',
  );

  assertError(
    await postJson('/api/actions/purchase_document.create', {
      actor: ownerActor,
      payload: {
        kind: 'purchase',
        contactId: createdVendor.id,
        documentDate: '2026-06-24',
        categoryId: 'cat-sales-document',
        reference: 'CODEX_TEST_WRONG_PURCHASE_CATEGORY',
        title: 'Purchase should reject sales category',
        items: [
          {
            id: 'item-wrong-purchase-category',
            name: 'Wrong category purchase line',
            unit: 'service',
            quantity: 1,
            unitPrice: 100,
            discount: 0,
            discountType: 'percentage',
            taxId: 'tax-none',
          },
        ],
      },
    }),
    400,
    'VALIDATION_ERROR',
    'purchase document rejects sales category',
  );

  const revenue = await postJson('/api/actions/cash_revenue.create', {
    actor: ownerActor,
    payload: {
      kind: 'revenue',
      transactionDate: '2026-06-24',
      accountId: 'acc-cash-lak',
      categoryId: createdRevenueCategory.id,
      contactId: createdCustomer.id,
      exchangeRate: 1.2,
      reference: 'CODEX_TEST_API_REVENUE_REF',
      description: 'API revenue with form parity fields',
      attachmentNames: ['CODEX_TEST revenue evidence.pdf'],
      items: [
        {
          id: 'item-api-revenue',
          productId: createdProduct.id,
          name: 'API consulting service',
          unit: 'service',
          description: '',
          quantity: 2,
          unitPrice: 800,
          discount: 10,
          discountType: 'percentage',
          taxId: 'tax-vat',
        },
      ],
    },
  });
  assert(revenue.status === 200 && revenue.body?.ok === true, 'cash_revenue.create should pass');
  const createdRevenue = revenue.body.state.cashTransactions[0];
  assert(createdRevenue.exchangeRate === 1.2, 'cash revenue should keep exchange rate');
  assert(createdRevenue.attachmentIds.length === 1, 'cash revenue should link attachment reference');
  assert(createdRevenue.items[0].productId === createdProduct.id, 'cash revenue item should keep product');
  assert(createdRevenue.items[0].unit === 'service', 'cash revenue item should keep unit');
  assert(createdRevenue.items[0].taxRate === 10, 'cash revenue item should snapshot tax rate');
  assert(createdRevenue.amount === 1584, `cash revenue amount should include discount and tax, got ${createdRevenue.amount}`);
  assert(revenue.body.state.journalEntries[0].reference === 'CODEX_TEST_API_REVENUE_REF', 'cash revenue journal should keep user reference');
  assert(
    revenue.body.state.attachments.some(
      (attachment) => attachment.ownerType === 'cash_transaction' && attachment.ownerId === createdRevenue.id,
    ),
    'cash revenue should create attachment reference',
  );

  const noTaxRevenue = await postJson('/api/actions/cash_revenue.create', {
    actor: ownerActor,
    payload: {
      kind: 'revenue',
      transactionDate: '2026-06-24',
      accountId: 'acc-cash-lak',
      categoryId: 'cat-service-revenue',
      contactId: createdCustomer.id,
      reference: 'CODEX_TEST_API_REVENUE_NO_TAX_REF',
      description: 'API revenue with product VAT overridden to no tax',
      items: [
        {
          id: 'item-api-revenue-no-tax',
          productId: createdProduct.id,
          name: 'API no tax override line',
          unit: 'service',
          description: '',
          quantity: 1,
          unitPrice: 100,
          discount: 0,
          discountType: 'percentage',
          taxId: 'tax-none',
        },
      ],
    },
  });
  assert(noTaxRevenue.status === 200 && noTaxRevenue.body?.ok === true, 'cash_revenue.create with tax override should pass');
  const createdNoTaxRevenue = noTaxRevenue.body.state.cashTransactions[0];
  assert(createdNoTaxRevenue.amount === 100, `tax-none override should not add VAT, got ${createdNoTaxRevenue.amount}`);
  assert(createdNoTaxRevenue.items[0].taxId === 'tax-none', 'tax-none override should persist on the line item');
  assert(createdNoTaxRevenue.items[0].taxRate === 0, 'tax-none override should snapshot zero tax rate');

  const salesDocument = await postJson('/api/actions/sales_document.create', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      contactId: createdCustomer.id,
      documentDate: '2026-06-24',
      dueDate: '2026-07-08',
      orderNumber: 'CODEX_TEST_API_SALES_ORDER',
      reference: 'CODEX_TEST_API_SALES_REF',
      vatNumber: 'CODEX_TEST_VAT_API',
      title: 'API status transition test',
      categoryId: createdSalesCategory.id,
      exchangeRate: 1.1,
      attachmentNames: ['CODEX_TEST invoice evidence.pdf'],
      items: [
        {
          id: 'item-api-sales',
          productId: createdProduct.id,
          name: 'API service line',
          unit: 'service',
          description: '',
          quantity: 1,
          unitPrice: 500,
          discount: 50,
          discountType: 'amount',
          taxId: 'tax-vat',
        },
      ],
    },
  });
  assert(salesDocument.status === 200 && salesDocument.body?.ok === true, 'sales document create should pass');
  const createdDocument = salesDocument.body.state.documents[0];
  assert(createdDocument.status === 'quotation', 'sales document should start as quotation');
  assert(createdDocument.reference === 'CODEX_TEST_API_SALES_REF', 'sales document should keep user reference');
  assert(createdDocument.dueDate === '2026-07-08', 'sales document should keep due date');
  assert(createdDocument.vatNumber === 'CODEX_TEST_VAT_API', 'sales document should keep VAT number');
  assert(createdDocument.exchangeRate === 1.1, 'sales document should keep exchange rate');
  assert(createdDocument.attachmentIds.length === 1, 'sales document should link attachment reference');
  assert(createdDocument.items[0].discountType === 'amount', 'sales document item should keep discount type');
  assert(createdDocument.items[0].taxRate === 10, 'sales document item should snapshot tax rate');

  const currencyOverrideDocument = await postJson('/api/actions/sales_document.create', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      contactId: createdCustomer.id,
      currency: 'THB',
      documentDate: '2026-06-24',
      dueDate: '2026-07-08',
      reference: 'CODEX_TEST_API_SALES_THB_REF',
      title: 'API currency override test',
      categoryId: createdSalesCategory.id,
      exchangeRate: 1,
      items: [
        {
          id: 'item-api-sales-thb',
          name: 'API THB override line',
          unit: 'service',
          quantity: 1,
          unitPrice: 100,
          discount: 0,
          discountType: 'percentage',
          taxId: 'tax-none',
        },
      ],
    },
  });
  assert(currencyOverrideDocument.status === 200 && currencyOverrideDocument.body?.ok === true, 'sales document currency override should pass');
  const createdCurrencyOverrideDocument = currencyOverrideDocument.body.state.documents.find((document) => document.reference === 'CODEX_TEST_API_SALES_THB_REF');
  assert(createdCurrencyOverrideDocument?.currency === 'THB', 'sales document should keep selected document currency independent of contact currency');

  const attachmentStateBeforeUpload = await getJson('/api/state');
  const uploadContent = 'CODEX real attachment storage payload';
  const attachmentUpload = await postJson(
    '/api/attachments',
    {
      actor: ownerActor,
      ownerType: 'document',
      ownerId: createdDocument.id,
      fileName: 'CODEX_TEST_real_attachment.txt',
      contentType: 'text/plain',
      contentBase64: Buffer.from(uploadContent, 'utf8').toString('base64'),
    },
    { 'X-Codex-Expected-State-Revision': attachmentStateBeforeUpload.headers.stateRevision },
  );
  assert(attachmentUpload.status === 201 && attachmentUpload.body?.ok === true, 'attachment upload should pass');
  assert(attachmentUpload.body.attachment.name === 'CODEX_TEST_real_attachment.txt', 'attachment upload should sanitize/persist filename');
  assert(attachmentUpload.body.attachment.mimeType === 'text/plain', 'attachment upload should persist content type');
  assert(attachmentUpload.body.attachment.sizeBytes === Buffer.byteLength(uploadContent), 'attachment upload should persist file size');
  assert(!attachmentUpload.body.attachment.storagePath, 'attachment upload response should not expose internal storage path');
  assert(attachmentUpload.body.state.documents.find((document) => document.id === createdDocument.id).attachmentIds.includes(attachmentUpload.body.attachment.id), 'attachment upload should link metadata to document');

  const attachmentList = await getJson(`/api/attachments?ownerType=document&ownerId=${encodeURIComponent(createdDocument.id)}`);
  assert(attachmentList.status === 200 && attachmentList.body?.ok === true, 'attachment list should pass');
  assert(
    attachmentList.body.attachments.some((attachment) => attachment.id === attachmentUpload.body.attachment.id),
    'attachment list should include uploaded attachment metadata',
  );

  const attachmentDownload = await request(`/api/attachments/${encodeURIComponent(attachmentUpload.body.attachment.id)}/download`);
  assert(attachmentDownload.status === 200, 'attachment download should pass');
  assert(attachmentDownload.body === uploadContent, 'attachment download should return stored file content');

  assertError(
    await postJson('/api/attachments', {
      actor: ownerActor,
      ownerType: 'document',
      ownerId: createdDocument.id,
      fileName: '../escape.txt',
      contentType: 'text/plain',
      contentBase64: Buffer.from('escape').toString('base64'),
    }),
    400,
    'INVALID_ATTACHMENT_NAME',
    'attachment path traversal filename should be rejected',
  );

  assertError(
    await postJson('/api/attachments', {
      actor: ownerActor,
      ownerType: 'document',
      ownerId: createdDocument.id,
      fileName: 'malware.exe',
      contentType: 'application/octet-stream',
      contentBase64: Buffer.from('blocked').toString('base64'),
    }),
    400,
    'INVALID_ATTACHMENT_TYPE',
    'attachment executable extension should be rejected',
  );

  assertError(
    await postJson('/api/attachments', {
      actor: ownerActor,
      ownerType: 'document',
      ownerId: createdDocument.id,
      fileName: 'oversized.txt',
      contentType: 'text/plain',
      contentBase64: Buffer.alloc(5_000_001, 'a').toString('base64'),
    }),
    413,
    'ATTACHMENT_TOO_LARGE',
    'attachment larger than max size should be rejected',
  );

  const attachmentStateBeforeDelete = await getJson('/api/state');
  const attachmentDelete = await deleteJson(
    `/api/attachments/${encodeURIComponent(attachmentUpload.body.attachment.id)}`,
    { actor: ownerActor },
    { 'X-Codex-Expected-State-Revision': attachmentStateBeforeDelete.headers.stateRevision },
  );
  assert(attachmentDelete.status === 200 && attachmentDelete.body?.ok === true, 'attachment delete should pass');
  assert(
    !attachmentDelete.body.state.attachments.some((attachment) => attachment.id === attachmentUpload.body.attachment.id),
    'attachment delete should remove metadata',
  );
  assert(
    !attachmentDelete.body.state.documents.find((document) => document.id === createdDocument.id).attachmentIds.includes(attachmentUpload.body.attachment.id),
    'attachment delete should detach metadata from document',
  );
  assertError(
    await request(`/api/attachments/${encodeURIComponent(attachmentUpload.body.attachment.id)}/download`),
    404,
    'ATTACHMENT_NOT_FOUND',
    'deleted attachment download should fail',
  );

  assertError(
    await postJson('/api/actions/sales_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: createdDocument.id,
        status: 'receipt',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'sales status skip',
  );

  const invoice = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: createdDocument.id,
      status: 'invoice',
    },
  });
  assert(invoice.status === 200 && invoice.body?.ok === true, 'quotation to invoice should pass');
  assert(
    invoice.body.state.documents.find((document) => document.id === createdDocument.id)?.status === 'invoice',
    'document should be invoice after valid transition',
  );

  assertError(
    await postJson('/api/actions/document.lock', {
      actor: viewerActor,
      payload: {
        kind: 'sales',
        documentId: createdDocument.id,
      },
    }),
    403,
    'PERMISSION_DENIED',
    'document lock permission',
  );

  assertError(
    await postJson('/api/actions/document.lock', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: 'missing-document-id',
      },
    }),
    404,
    'NOT_FOUND',
    'document lock missing record',
  );

  const lockedDocument = await postJson('/api/actions/document.lock', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: createdDocument.id,
    },
  });
  assert(lockedDocument.status === 200 && lockedDocument.body?.ok === true, 'document.lock should pass');
  assert(
    lockedDocument.body.state.documents.find((document) => document.id === createdDocument.id)?.locked === true,
    'document.lock should mark document locked',
  );
  assert(lockedDocument.body.state.auditLogs[0]?.action === 'document.lock', 'document.lock should create audit log');

  assertError(
    await postJson('/api/actions/document.lock', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: createdDocument.id,
      },
    }),
    400,
    'VALIDATION_ERROR',
    'document lock duplicate',
  );

  assertError(
    await postJson('/api/actions/sales_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: createdDocument.id,
        status: 'receipt',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'locked document status update',
  );

  const deletableDocumentResponse = await postJson('/api/actions/sales_document.create', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      contactId: createdCustomer.id,
      documentDate: '2026-06-24',
      dueDate: '2026-07-09',
      orderNumber: 'CODEX_TEST_API_DELETE_ORDER',
      reference: 'CODEX_TEST_API_DELETE_REF',
      title: 'API delete document test',
      categoryId: createdSalesCategory.id,
      attachmentNames: ['CODEX_TEST delete evidence.pdf'],
      items: [
        {
          id: 'item-api-delete-document',
          name: 'API deletable document line',
          unit: 'service',
          description: '',
          quantity: 1,
          unitPrice: 120,
          discount: 0,
          discountType: 'percentage',
          taxId: 'tax-none',
        },
      ],
    },
  });
  assert(deletableDocumentResponse.status === 200 && deletableDocumentResponse.body?.ok === true, 'deletable document create should pass');
  const deletableDocument = deletableDocumentResponse.body.state.documents[0];

  assertError(
    await postJson('/api/actions/record.delete', {
      actor: viewerActor,
      payload: {
        recordType: 'document',
        kind: 'sales',
        documentId: deletableDocument.id,
      },
    }),
    403,
    'PERMISSION_DENIED',
    'record delete permission',
  );

  assertError(
    await postJson('/api/actions/record.delete', {
      actor: ownerActor,
      payload: {
        recordType: 'document',
        kind: 'sales',
        documentId: 'missing-document-id',
      },
    }),
    404,
    'NOT_FOUND',
    'record delete missing document',
  );

  assertError(
    await postJson('/api/actions/record.delete', {
      actor: ownerActor,
      payload: {
        recordType: 'document',
        kind: 'sales',
        documentId: createdDocument.id,
      },
    }),
    400,
    'VALIDATION_ERROR',
    'record delete locked document',
  );

  const deletedDocument = await postJson('/api/actions/record.delete', {
    actor: ownerActor,
    payload: {
      recordType: 'document',
      kind: 'sales',
      documentId: deletableDocument.id,
    },
  });
  assert(deletedDocument.status === 200 && deletedDocument.body?.ok === true, 'record.delete document should pass');
  assert(
    !deletedDocument.body.state.documents.some((document) => document.id === deletableDocument.id),
    'record.delete should remove document',
  );
  assert(
    !deletedDocument.body.state.attachments.some((attachment) => attachment.ownerId === deletableDocument.id),
    'record.delete should remove document attachment references',
  );
  assert(deletedDocument.body.state.auditLogs[0]?.action === 'record.delete', 'record.delete should create audit log');
  assert(deletedDocument.body.state.auditLogs[0]?.risk === 'high', 'record.delete audit should be high risk');

  const salesSettlementDocument = await postJson('/api/actions/sales_document.create', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      contactId: createdCustomer.id,
      documentDate: '2026-06-24',
      dueDate: '2026-07-10',
      orderNumber: 'CODEX_TEST_API_SALES_SETTLE_ORDER',
      reference: 'CODEX_TEST_API_SALES_SETTLE_REF',
      title: 'API sales settlement test',
      categoryId: createdSalesCategory.id,
      items: [
        {
          id: 'item-api-sales-settlement',
          name: 'API sales settlement line',
          unit: 'service',
          description: '',
          quantity: 2,
          unitPrice: 300,
          discount: 0,
          discountType: 'percentage',
          taxId: 'tax-none',
        },
      ],
    },
  });
  assert(salesSettlementDocument.status === 200 && salesSettlementDocument.body?.ok === true, 'sales settlement document create should pass');
  const createdSalesSettlementDocument = salesSettlementDocument.body.state.documents[0];

  const settlementInvoice = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: createdSalesSettlementDocument.id,
      status: 'invoice',
    },
  });
  assert(settlementInvoice.status === 200 && settlementInvoice.body?.ok === true, 'sales settlement quotation to invoice should pass');
  assert(
    !settlementInvoice.body.state.journalEntries.some(
      (entry) => entry.sourceType === 'sales' && entry.sourceId === createdSalesSettlementDocument.id,
    ),
    'quotation to invoice should not post settlement journal',
  );

  assertError(
    await postJson('/api/actions/sales_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: createdSalesSettlementDocument.id,
        status: 'receipt',
        settlementAccountId: 'acc-expense-admin',
        settlementDate: '2026-07-11',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'settlement account rejects expense account',
  );

  assertError(
    await postJson('/api/actions/sales_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: createdSalesSettlementDocument.id,
        status: 'receipt',
        settlementAccountId: mismatchedCashBankAccountId(
          settlementInvoice.body.state,
          createdSalesSettlementDocument.currency,
          'sales settlement currency mismatch',
        ),
        settlementDate: '2026-07-11',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'settlement account rejects currency mismatch',
  );

  assertError(
    await postJson('/api/actions/sales_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: createdSalesSettlementDocument.id,
        status: 'receipt',
        settlementAccountId: 'acc-bank-lak',
        settlementDate: '2026-99-99',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'settlement rejects invalid date',
  );

  const receipt = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: createdSalesSettlementDocument.id,
      status: 'receipt',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-07-11',
    },
  });
  assert(receipt.status === 200 && receipt.body?.ok === true, 'invoice to receipt should pass');
  const receiptJournal = receipt.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'sales' && entry.sourceId === createdSalesSettlementDocument.id,
  );
  assert(receiptJournal?.reference === 'CODEX_TEST_API_SALES_SETTLE_REF', 'sales settlement journal should keep document reference');
  assert(receiptJournal?.entryDate === '2026-07-11', 'sales settlement journal should keep settlement date');
  assert(
    receiptJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 600 && line.credit === 0),
    'sales settlement journal should debit selected bank',
  );
  assert(
    receiptJournal?.lines.some((line) => line.accountId === 'acc-income-service' && line.debit === 0 && line.credit === 600),
    'sales settlement journal should credit income',
  );
  assert(receipt.body.state.auditLogs[0]?.summary.includes('Settlement journal posted'), 'receipt audit should mention settlement journal');
  const receiptLedgerRows = ledgerRowsForAccount(receipt.body.state, 'acc-bank-lak');
  assert(
    receiptLedgerRows.some((row) => row.entry.id === receiptJournal?.id && row.line.debit === 600 && row.balance === 600),
    'ledger report should show sales settlement bank debit and balance',
  );
  const receiptCashMovement = cashMovementRows(receipt.body.state).find((row) => row.account.id === 'acc-bank-lak');
  assert(
    receiptCashMovement?.moneyIn === 600 && receiptCashMovement?.moneyOut === 0,
    'cash movement report should show sales settlement money in',
  );
  const receiptSettlementRows = documentSettlementRows(receipt.body.state);
  assert(
    receiptSettlementRows.some(
      (row) =>
        row.entry.id === receiptJournal?.id &&
        row.document.documentNumber === createdSalesSettlementDocument.documentNumber &&
        row.cashAccount?.id === 'acc-bank-lak' &&
        Math.max(row.cashLine.debit, row.cashLine.credit) === 600,
    ),
    'settlement report should show sales receipt settlement',
  );

  const reportStateBeforeSettlementEndpoints = await getJson('/api/state');
  const ledgerEndpoint = await postReportQuery('ledger', {
    actor: ownerActor,
    filters: { accountId: 'acc-bank-lak', dateFrom: '2026-07-01', dateTo: '2026-07-31' },
  });
  assert(ledgerEndpoint.status === 200 && ledgerEndpoint.body?.ok === true, 'ledger report endpoint should pass');
  assert(ledgerEndpoint.body.data.account.id === 'acc-bank-lak', 'ledger report endpoint should include selected account');
  assert(
    ledgerEndpoint.body.data.rows.some(
      (row) => row.entryId === receiptJournal?.id && row.debit === 600 && row.credit === 0 && row.balance === 600,
    ),
    'ledger report endpoint should include sales receipt bank movement',
  );

  const cashMovementEndpoint = await postReportQuery('cash_movement', {
    actor: ownerActor,
    filters: { dateFrom: '2026-07-01', dateTo: '2026-07-31' },
  });
  assert(cashMovementEndpoint.status === 200 && cashMovementEndpoint.body?.ok === true, 'cash movement report endpoint should pass');
  const bankLakCashReport = cashMovementEndpoint.body.data.rows.find((row) => row.accountId === 'acc-bank-lak');
  assert(
    bankLakCashReport?.moneyIn === 600 && bankLakCashReport?.moneyOut === 0,
    'cash movement report endpoint should show sales settlement money in',
  );

  const settlementEndpoint = await postReportQuery('settlement_history', {
    actor: ownerActor,
    filters: { dateFrom: '2026-06-01', dateTo: '2026-07-31', status: 'all' },
  });
  assert(settlementEndpoint.status === 200 && settlementEndpoint.body?.ok === true, 'settlement history report endpoint should pass');
  assert(
    settlementEndpoint.body.data.rows.some(
      (row) =>
        row.entryId === receiptJournal?.id &&
        row.documentNumber === createdSalesSettlementDocument.documentNumber &&
        row.cashAccountId === 'acc-bank-lak' &&
        row.amount === 600 &&
        row.cashAmount === 600 &&
        row.cashCurrency === 'LAK',
    ),
    'settlement history report endpoint should include sales receipt settlement',
  );

  const vatSummaryEndpoint = await postReportQuery('vat_summary', {
    actor: ownerActor,
    filters: { dateFrom: '2026-06-01', dateTo: '2026-06-30', status: 'all' },
  });
  assert(vatSummaryEndpoint.status === 200 && vatSummaryEndpoint.body?.ok === true, 'VAT summary report endpoint should pass');
  assert(
    vatSummaryEndpoint.body.data.rows.some((row) => row.source.includes('CODEX_TEST_API_SALES_REF') && row.taxRate === 10),
    'VAT summary report endpoint should include sales document tax row',
  );

  const snapshotPayload = buildReportSnapshotPayload(
    receipt.body.state,
    { reportKey: 'ledger', accountId: 'acc-bank-lak', dateFrom: '2026-06-01', dateTo: '2026-07-31', status: 'all' },
    { generatedAt: '2026-07-31T00:00:00.000Z', dataSourceMode: 'api-smoke-test', dataSourceLabel: 'API smoke local state' },
  );
  assert(snapshotPayload.generatedAt === '2026-07-31T00:00:00.000Z', 'snapshot helper should keep generatedAt metadata');
  assert(snapshotPayload.dataSource.type === 'shared-report-models', 'snapshot helper should declare shared helper data source');
  assert(snapshotPayload.dataSource.version === 'phase-1', 'snapshot helper should declare phase version');
  assert(snapshotPayload.dataSource.mode === 'api-smoke-test', 'snapshot helper should keep data source mode');
  assert(snapshotPayload.report.key === 'snapshot', 'snapshot helper should include report key metadata');
  assert(snapshotPayload.filters.reportKey === 'ledger', 'snapshot helper should include active filter report key');
  assert(
    snapshotPayload.trialBalance.length === receipt.body.state.accounts.length,
    'snapshot helper trial balance should use shared report rows',
  );
  assert(
    snapshotPayload.vatSummary.some((row) => row.source.includes('CODEX_TEST_API_SALES_REF') && row.taxRate === 10),
    'snapshot helper VAT summary should use shared report rows',
  );
  assert(
    snapshotPayload.snapshot.some((row) => row.key === 'reportSource' && row.value === 'Localhost database'),
    'snapshot helper should include report source metric',
  );

  const reportStateAfterSettlementEndpoints = await getJson('/api/state');
  assert(
    JSON.stringify(reportStateAfterSettlementEndpoints.body) === JSON.stringify(reportStateBeforeSettlementEndpoints.body),
    'settlement report endpoints should not mutate state',
  );

  const usdCustomer = await postJson('/api/actions/customer.create', {
    actor: ownerActor,
    payload: {
      type: 'customer',
      name: 'CODEX_TEST API USD Customer',
      code: 'CODEX_TEST_API_USD_CUSTOMER',
      currency: 'USD',
    },
  });
  assert(usdCustomer.status === 200 && usdCustomer.body?.ok === true, 'USD customer.create should pass');
  const createdUsdCustomer = usdCustomer.body.state.contacts.find((contact) => contact.code === 'CODEX_TEST_API_USD_CUSTOMER');
  assert(createdUsdCustomer?.currency === 'USD', 'USD customer should keep USD currency');

  const crossCurrencyDocument = await postJson('/api/actions/sales_document.create', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      contactId: createdUsdCustomer.id,
      documentDate: '2026-06-24',
      dueDate: '2026-07-30',
      orderNumber: 'CODEX_TEST_API_FX_GAIN_ORDER',
      reference: 'CODEX_TEST_API_FX_GAIN_REF',
      title: 'API FX gain settlement test',
      categoryId: createdSalesCategory.id,
      exchangeRate: 22000,
      items: [
        {
          id: 'item-api-fx-gain',
          name: 'API FX gain line',
          unit: 'service',
          description: '',
          quantity: 1,
          unitPrice: 100,
          discount: 0,
          discountType: 'percentage',
          taxId: 'tax-none',
        },
      ],
    },
  });
  assert(crossCurrencyDocument.status === 200 && crossCurrencyDocument.body?.ok === true, 'cross-currency sales document create should pass');
  const createdCrossCurrencyDocument = crossCurrencyDocument.body.state.documents[0];
  assert(createdCrossCurrencyDocument.currency === 'USD', 'cross-currency sales document should use USD customer currency');
  assert(createdCrossCurrencyDocument.exchangeRate === 22000, 'cross-currency sales document should keep original exchange rate');

  const crossCurrencyInvoice = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: createdCrossCurrencyDocument.id,
      status: 'invoice',
    },
  });
  assert(crossCurrencyInvoice.status === 200 && crossCurrencyInvoice.body?.ok === true, 'cross-currency quotation to invoice should pass');

  const missingExchangeRate = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: createdCrossCurrencyDocument.id,
      status: 'receipt',
      settlementAccountId: 'acc-bank-lak',
    },
  });
  assertError(missingExchangeRate, 400, 'VALIDATION_ERROR', 'cross-currency settlement requires exchange rate');
  assert(
    missingExchangeRate.body.error.toLowerCase().includes('exchange rate'),
    'cross-currency missing rate error should mention exchange rate',
  );

  assertError(
    await postJson('/api/actions/sales_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: createdCrossCurrencyDocument.id,
        status: 'receipt',
        settlementAccountId: 'acc-bank-lak',
        settlementExchangeRate: 0,
      },
    }),
    400,
    'VALIDATION_ERROR',
    'cross-currency settlement rejects invalid exchange rate',
  );

  assertError(
    await postJson('/api/actions/sales_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: createdCrossCurrencyDocument.id,
        status: 'receipt',
        settlementAccountId: 'acc-bank-lak',
        settlementExchangeRate: 23000,
        settlementAmount: 0,
      },
    }),
    400,
    'VALIDATION_ERROR',
    'cross-currency settlement rejects zero amount',
  );

  assertError(
    await postJson('/api/actions/sales_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: createdCrossCurrencyDocument.id,
        status: 'receipt',
        settlementAccountId: 'acc-bank-lak',
        settlementExchangeRate: 23000,
        settlementBankFeeAmount: -1,
      },
    }),
    400,
    'VALIDATION_ERROR',
    'sales cross-currency settlement rejects negative bank fee',
  );

  assertError(
    await postJson('/api/actions/sales_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: createdCrossCurrencyDocument.id,
        status: 'receipt',
        settlementAccountId: 'acc-bank-lak',
        settlementExchangeRate: 23000,
        settlementBankFeeAmount: 80,
        settlementBankFeeAccountId: 'acc-bank-fee-expense',
        settlementWithholdingTaxAmount: 30,
        settlementWithholdingTaxAccountId: 'acc-wht-receivable',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'sales cross-currency settlement rejects adjustments that make net cash invalid',
  );

  assertError(
    await postJson('/api/actions/sales_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: createdCrossCurrencyDocument.id,
        status: 'receipt',
        settlementAccountId: 'acc-bank-thb',
        settlementExchangeRate: 650,
      },
    }),
    400,
    'VALIDATION_ERROR',
    'cross-currency settlement rejects non-base settlement account',
  );

  const crossCurrencyReceipt = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: createdCrossCurrencyDocument.id,
      status: 'receipt',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-07-30',
      settlementExchangeRate: 23000,
      settlementExchangeGainAccountId: 'acc-exchange-gain',
      settlementExchangeLossAccountId: 'acc-exchange-loss',
    },
  });
  assert(crossCurrencyReceipt.status === 200 && crossCurrencyReceipt.body?.ok === true, 'cross-currency receipt with exchange gain should pass');
  assert(
    crossCurrencyReceipt.body.state.documents.find((document) => document.id === createdCrossCurrencyDocument.id)?.status === 'receipt',
    'cross-currency final settlement should move document to receipt',
  );
  const crossCurrencyGainJournal = crossCurrencyReceipt.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'sales' && entry.sourceId === createdCrossCurrencyDocument.id,
  );
  assertBalancedJournal(crossCurrencyGainJournal, 'cross-currency sales gain journal');
  assert(crossCurrencyGainJournal?.reference === 'CODEX_TEST_API_FX_GAIN_REF', 'cross-currency journal should keep document reference');
  assert(crossCurrencyGainJournal?.entryDate === '2026-07-30', 'cross-currency journal should keep settlement date');
  assert(
    crossCurrencyGainJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 2300000 && line.credit === 0),
    'cross-currency gain journal should debit LAK bank at settlement rate',
  );
  assert(
    crossCurrencyGainJournal?.lines.some((line) => line.accountId === createdSalesCategory.accountId && line.debit === 0 && line.credit === 2200000),
    'cross-currency gain journal should credit sales at document exchange rate',
  );
  assert(
    crossCurrencyGainJournal?.lines.some((line) => line.accountId === 'acc-exchange-gain' && line.debit === 0 && line.credit === 100000),
    'cross-currency gain journal should credit realized exchange gain',
  );
  assert(crossCurrencyReceipt.body.state.auditLogs[0]?.summary.includes('exchange gain'), 'cross-currency audit should mention exchange gain');

  const crossCurrencyLossDocument = await postJson('/api/actions/sales_document.create', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      contactId: createdUsdCustomer.id,
      documentDate: '2026-06-24',
      dueDate: '2026-07-31',
      orderNumber: 'CODEX_TEST_API_FX_LOSS_ORDER',
      reference: 'CODEX_TEST_API_FX_LOSS_REF',
      title: 'API FX loss settlement test',
      categoryId: createdSalesCategory.id,
      exchangeRate: 22000,
      items: [
        {
          id: 'item-api-fx-loss',
          name: 'API FX loss line',
          unit: 'service',
          description: '',
          quantity: 1,
          unitPrice: 100,
          discount: 0,
          discountType: 'percentage',
          taxId: 'tax-none',
        },
      ],
    },
  });
  assert(crossCurrencyLossDocument.status === 200 && crossCurrencyLossDocument.body?.ok === true, 'cross-currency loss document create should pass');
  const createdCrossCurrencyLossDocument = crossCurrencyLossDocument.body.state.documents[0];
  const crossCurrencyLossInvoice = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: createdCrossCurrencyLossDocument.id,
      status: 'invoice',
    },
  });
  assert(crossCurrencyLossInvoice.status === 200 && crossCurrencyLossInvoice.body?.ok === true, 'cross-currency loss quotation to invoice should pass');

  const crossCurrencyLossReceipt = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: createdCrossCurrencyLossDocument.id,
      status: 'receipt',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-07-31',
      settlementExchangeRate: 21000,
    },
  });
  assert(crossCurrencyLossReceipt.status === 200 && crossCurrencyLossReceipt.body?.ok === true, 'cross-currency receipt with exchange loss should pass');
  const crossCurrencyLossJournal = crossCurrencyLossReceipt.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'sales' && entry.sourceId === createdCrossCurrencyLossDocument.id,
  );
  assertBalancedJournal(crossCurrencyLossJournal, 'cross-currency sales loss journal');
  assert(
    crossCurrencyLossJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 2100000 && line.credit === 0),
    'cross-currency loss journal should debit LAK bank at settlement rate',
  );
  assert(
    crossCurrencyLossJournal?.lines.some((line) => line.accountId === 'acc-exchange-loss' && line.debit === 100000 && line.credit === 0),
    'cross-currency loss journal should debit realized exchange loss',
  );
  assert(
    crossCurrencyLossJournal?.lines.some((line) => line.accountId === createdSalesCategory.accountId && line.debit === 0 && line.credit === 2200000),
    'cross-currency loss journal should credit sales at document exchange rate',
  );
  assert(crossCurrencyLossReceipt.body.state.auditLogs[0]?.summary.includes('exchange loss'), 'cross-currency audit should mention exchange loss');

  const createCrossCurrencySalesInvoice = async ({ code, reference, title }) => {
    const documentResult = await postJson('/api/actions/sales_document.create', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        contactId: createdUsdCustomer.id,
        documentDate: '2026-06-24',
        dueDate: '2026-08-05',
        orderNumber: `CODEX_TEST_API_${code}_ORDER`,
        reference,
        title,
        categoryId: createdSalesCategory.id,
        exchangeRate: 22000,
        items: [
          {
            id: `item-api-${code.toLowerCase()}`,
            name: `${title} line`,
            unit: 'service',
            description: '',
            quantity: 1,
            unitPrice: 100,
            discount: 0,
            discountType: 'percentage',
            taxId: 'tax-none',
          },
        ],
      },
    });
    assert(documentResult.status === 200 && documentResult.body?.ok === true, `${code} sales document create should pass`);
    const document = documentResult.body.state.documents[0];
    const invoiceResult = await postJson('/api/actions/sales_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: document.id,
        status: 'invoice',
      },
    });
    assert(invoiceResult.status === 200 && invoiceResult.body?.ok === true, `${code} quotation to invoice should pass`);
    return document;
  };

  const crossCurrencyPartialGainDocument = await createCrossCurrencySalesInvoice({
    code: 'SALES_FX_PARTIAL_GAIN',
    reference: 'CODEX_TEST_API_SALES_FX_PARTIAL_GAIN_REF',
    title: 'API sales FX partial gain settlement test',
  });
  const crossCurrencyPartialGainReceipt = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: crossCurrencyPartialGainDocument.id,
      status: 'receipt',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-08-05',
      settlementAmount: 40,
      settlementExchangeRate: 23000,
      settlementExchangeGainAccountId: 'acc-exchange-gain',
      settlementExchangeLossAccountId: 'acc-exchange-loss',
    },
  });
  assert(
    crossCurrencyPartialGainReceipt.status === 200 && crossCurrencyPartialGainReceipt.body?.ok === true,
    'sales cross-currency partial receipt with exchange gain should pass',
  );
  assert(
    crossCurrencyPartialGainReceipt.body.state.documents.find((document) => document.id === crossCurrencyPartialGainDocument.id)?.status === 'invoice',
    'sales cross-currency partial receipt should keep document in invoice status',
  );
  assert(
    documentRemainingAmount(
      crossCurrencyPartialGainReceipt.body.state,
      crossCurrencyPartialGainReceipt.body.state.documents.find((document) => document.id === crossCurrencyPartialGainDocument.id),
    ) === 60,
    'sales cross-currency partial receipt should leave 60 in document currency',
  );
  const crossCurrencyPartialGainJournal = crossCurrencyPartialGainReceipt.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'sales' && entry.sourceId === crossCurrencyPartialGainDocument.id,
  );
  assertBalancedJournal(crossCurrencyPartialGainJournal, 'sales cross-currency partial gain journal');
  assert(
    crossCurrencyPartialGainJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 920000 && line.credit === 0),
    'sales cross-currency partial gain journal should debit LAK bank for paid amount at settlement rate',
  );
  assert(
    crossCurrencyPartialGainJournal?.lines.some((line) => line.accountId === createdSalesCategory.accountId && line.debit === 0 && line.credit === 880000),
    'sales cross-currency partial gain journal should credit sales for paid amount at document rate',
  );
  assert(
    crossCurrencyPartialGainJournal?.lines.some((line) => line.accountId === 'acc-exchange-gain' && line.debit === 0 && line.credit === 40000),
    'sales cross-currency partial gain journal should credit exchange gain for paid amount',
  );
  assert(
    crossCurrencyPartialGainReceipt.body.state.auditLogs[0]?.summary.includes('Remaining balance is') &&
      crossCurrencyPartialGainReceipt.body.state.auditLogs[0]?.summary.includes('exchange gain'),
    'sales cross-currency partial gain audit should mention remaining balance and exchange gain',
  );

  assertError(
    await postJson('/api/actions/sales_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: crossCurrencyPartialGainDocument.id,
        status: 'receipt',
        settlementAccountId: 'acc-bank-lak',
        settlementDate: '2026-08-06',
        settlementAmount: 61,
        settlementExchangeRate: 23000,
      },
    }),
    400,
    'VALIDATION_ERROR',
    'sales cross-currency partial settlement rejects overpayment after first receipt',
  );

  const crossCurrencyPartialFinalReceipt = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: crossCurrencyPartialGainDocument.id,
      status: 'receipt',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-08-06',
      settlementAmount: 60,
      settlementExchangeRate: 21000,
    },
  });
  assert(
    crossCurrencyPartialFinalReceipt.status === 200 && crossCurrencyPartialFinalReceipt.body?.ok === true,
    'sales cross-currency final remaining receipt after partial should pass',
  );
  assert(
    crossCurrencyPartialFinalReceipt.body.state.documents.find((document) => document.id === crossCurrencyPartialGainDocument.id)?.status === 'receipt',
    'sales cross-currency final remaining receipt should move document to receipt',
  );
  assert(
    documentRemainingAmount(
      crossCurrencyPartialFinalReceipt.body.state,
      crossCurrencyPartialFinalReceipt.body.state.documents.find((document) => document.id === crossCurrencyPartialGainDocument.id),
    ) === 0,
    'sales cross-currency final remaining receipt should clear document balance',
  );
  const crossCurrencyPartialJournals = crossCurrencyPartialFinalReceipt.body.state.journalEntries.filter(
    (entry) => entry.sourceType === 'sales' && entry.sourceId === crossCurrencyPartialGainDocument.id,
  );
  assert(crossCurrencyPartialJournals.length === 2, 'sales cross-currency partial flow should keep both settlement journals');
  const crossCurrencyPartialFinalJournal = crossCurrencyPartialJournals.find((entry) => entry.entryDate === '2026-08-06');
  assertBalancedJournal(crossCurrencyPartialFinalJournal, 'sales cross-currency final remaining journal');
  assert(
    crossCurrencyPartialFinalJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 1260000 && line.credit === 0),
    'sales cross-currency final remaining journal should debit LAK bank at settlement rate',
  );
  assert(
    crossCurrencyPartialFinalJournal?.lines.some((line) => line.accountId === 'acc-exchange-loss' && line.debit === 60000 && line.credit === 0),
    'sales cross-currency final remaining journal should debit exchange loss for remaining amount',
  );
  assert(
    crossCurrencyPartialFinalJournal?.lines.some((line) => line.accountId === createdSalesCategory.accountId && line.debit === 0 && line.credit === 1320000),
    'sales cross-currency final remaining journal should credit sales for remaining amount at document rate',
  );

  const crossCurrencyPartialLossDocument = await createCrossCurrencySalesInvoice({
    code: 'SALES_FX_PARTIAL_LOSS',
    reference: 'CODEX_TEST_API_SALES_FX_PARTIAL_LOSS_REF',
    title: 'API sales FX partial loss settlement test',
  });
  const crossCurrencyPartialLossReceipt = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: crossCurrencyPartialLossDocument.id,
      status: 'receipt',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-08-07',
      settlementAmount: 40,
      settlementExchangeRate: 21000,
    },
  });
  assert(
    crossCurrencyPartialLossReceipt.status === 200 && crossCurrencyPartialLossReceipt.body?.ok === true,
    'sales cross-currency partial receipt with exchange loss should pass',
  );
  assert(
    crossCurrencyPartialLossReceipt.body.state.documents.find((document) => document.id === crossCurrencyPartialLossDocument.id)?.status === 'invoice',
    'sales cross-currency partial loss receipt should keep document in invoice status',
  );
  assert(
    documentRemainingAmount(
      crossCurrencyPartialLossReceipt.body.state,
      crossCurrencyPartialLossReceipt.body.state.documents.find((document) => document.id === crossCurrencyPartialLossDocument.id),
    ) === 60,
    'sales cross-currency partial loss receipt should leave 60 in document currency',
  );
  const crossCurrencyPartialLossJournal = crossCurrencyPartialLossReceipt.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'sales' && entry.sourceId === crossCurrencyPartialLossDocument.id,
  );
  assertBalancedJournal(crossCurrencyPartialLossJournal, 'sales cross-currency partial loss journal');
  assert(
    crossCurrencyPartialLossJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 840000 && line.credit === 0),
    'sales cross-currency partial loss journal should debit LAK bank for paid amount at settlement rate',
  );
  assert(
    crossCurrencyPartialLossJournal?.lines.some((line) => line.accountId === 'acc-exchange-loss' && line.debit === 40000 && line.credit === 0),
    'sales cross-currency partial loss journal should debit exchange loss for paid amount',
  );
  assert(
    crossCurrencyPartialLossJournal?.lines.some((line) => line.accountId === createdSalesCategory.accountId && line.debit === 0 && line.credit === 880000),
    'sales cross-currency partial loss journal should credit sales for paid amount at document rate',
  );

  const crossCurrencyAdjustedSalesFinalDocument = await createCrossCurrencySalesInvoice({
    code: 'SALES_FX_ADJUSTED_FINAL',
    reference: 'CODEX_TEST_API_SALES_FX_ADJUSTED_FINAL_REF',
    title: 'API sales FX adjusted final settlement test',
  });
  const crossCurrencyAdjustedSalesFinalReceipt = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: crossCurrencyAdjustedSalesFinalDocument.id,
      status: 'receipt',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-08-08',
      settlementExchangeRate: 23000,
      settlementBankFeeAmount: 5,
      settlementBankFeeAccountId: 'acc-bank-fee-expense',
      settlementWithholdingTaxAmount: 10,
      settlementWithholdingTaxAccountId: 'acc-wht-receivable',
      settlementExchangeGainAccountId: 'acc-exchange-gain',
      settlementExchangeLossAccountId: 'acc-exchange-loss',
    },
  });
  assert(
    crossCurrencyAdjustedSalesFinalReceipt.status === 200 && crossCurrencyAdjustedSalesFinalReceipt.body?.ok === true,
    'sales cross-currency final receipt with fee and withholding should pass',
  );
  const crossCurrencyAdjustedSalesFinalJournal = crossCurrencyAdjustedSalesFinalReceipt.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'sales' && entry.sourceId === crossCurrencyAdjustedSalesFinalDocument.id,
  );
  assertBalancedJournal(crossCurrencyAdjustedSalesFinalJournal, 'sales cross-currency adjusted final journal');
  assert(
    crossCurrencyAdjustedSalesFinalJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 1955000 && line.credit === 0),
    'sales cross-currency adjusted final journal should debit net LAK bank cash',
  );
  assert(
    crossCurrencyAdjustedSalesFinalJournal?.lines.some((line) => line.accountId === 'acc-bank-fee-expense' && line.debit === 115000 && line.credit === 0),
    'sales cross-currency adjusted final journal should debit bank fee at settlement rate',
  );
  assert(
    crossCurrencyAdjustedSalesFinalJournal?.lines.some((line) => line.accountId === 'acc-wht-receivable' && line.debit === 230000 && line.credit === 0),
    'sales cross-currency adjusted final journal should debit withholding receivable at settlement rate',
  );
  assert(
    crossCurrencyAdjustedSalesFinalJournal?.lines.some((line) => line.accountId === createdSalesCategory.accountId && line.debit === 0 && line.credit === 2200000),
    'sales cross-currency adjusted final journal should credit sales at document rate',
  );
  assert(
    crossCurrencyAdjustedSalesFinalJournal?.lines.some((line) => line.accountId === 'acc-exchange-gain' && line.debit === 0 && line.credit === 100000),
    'sales cross-currency adjusted final journal should credit exchange gain on settled amount',
  );

  const crossCurrencyAdjustedSalesPartialDocument = await createCrossCurrencySalesInvoice({
    code: 'SALES_FX_ADJUSTED_PARTIAL',
    reference: 'CODEX_TEST_API_SALES_FX_ADJUSTED_PARTIAL_REF',
    title: 'API sales FX adjusted partial settlement test',
  });
  const crossCurrencyAdjustedSalesPartialReceipt = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: crossCurrencyAdjustedSalesPartialDocument.id,
      status: 'receipt',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-08-09',
      settlementAmount: 40,
      settlementExchangeRate: 23000,
      settlementBankFeeAmount: 2,
      settlementBankFeeAccountId: 'acc-bank-fee-expense',
      settlementWithholdingTaxAmount: 3,
      settlementWithholdingTaxAccountId: 'acc-wht-receivable',
      settlementExchangeGainAccountId: 'acc-exchange-gain',
      settlementExchangeLossAccountId: 'acc-exchange-loss',
    },
  });
  assert(
    crossCurrencyAdjustedSalesPartialReceipt.status === 200 && crossCurrencyAdjustedSalesPartialReceipt.body?.ok === true,
    'sales cross-currency partial receipt with fee and withholding should pass',
  );
  assert(
    crossCurrencyAdjustedSalesPartialReceipt.body.state.documents.find((document) => document.id === crossCurrencyAdjustedSalesPartialDocument.id)?.status === 'invoice',
    'sales cross-currency adjusted partial receipt should keep document in invoice status',
  );
  assert(
    documentRemainingAmount(
      crossCurrencyAdjustedSalesPartialReceipt.body.state,
      crossCurrencyAdjustedSalesPartialReceipt.body.state.documents.find((document) => document.id === crossCurrencyAdjustedSalesPartialDocument.id),
    ) === 60,
    'sales cross-currency adjusted partial receipt should leave 60 in document currency',
  );
  const crossCurrencyAdjustedSalesPartialJournal = crossCurrencyAdjustedSalesPartialReceipt.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'sales' && entry.sourceId === crossCurrencyAdjustedSalesPartialDocument.id,
  );
  assertBalancedJournal(crossCurrencyAdjustedSalesPartialJournal, 'sales cross-currency adjusted partial journal');
  assert(
    crossCurrencyAdjustedSalesPartialJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 805000 && line.credit === 0),
    'sales cross-currency adjusted partial journal should debit net LAK bank cash',
  );
  assert(
    crossCurrencyAdjustedSalesPartialJournal?.lines.some((line) => line.accountId === 'acc-bank-fee-expense' && line.debit === 46000 && line.credit === 0),
    'sales cross-currency adjusted partial journal should debit bank fee at settlement rate',
  );
  assert(
    crossCurrencyAdjustedSalesPartialJournal?.lines.some((line) => line.accountId === 'acc-wht-receivable' && line.debit === 69000 && line.credit === 0),
    'sales cross-currency adjusted partial journal should debit withholding receivable at settlement rate',
  );
  assert(
    crossCurrencyAdjustedSalesPartialJournal?.lines.some((line) => line.accountId === createdSalesCategory.accountId && line.debit === 0 && line.credit === 880000),
    'sales cross-currency adjusted partial journal should credit sales at document rate',
  );
  assert(
    crossCurrencyAdjustedSalesPartialJournal?.lines.some((line) => line.accountId === 'acc-exchange-gain' && line.debit === 0 && line.credit === 40000),
    'sales cross-currency adjusted partial journal should credit exchange gain on settled amount',
  );

  assertError(
    await postJson('/api/actions/record.delete', {
      actor: ownerActor,
      payload: {
        recordType: 'document',
        kind: 'sales',
        documentId: createdSalesSettlementDocument.id,
      },
    }),
    400,
    'VALIDATION_ERROR',
    'record delete settled document',
  );

  const partialSettlementDocument = await postJson('/api/actions/sales_document.create', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      contactId: createdCustomer.id,
      documentDate: '2026-06-24',
      dueDate: '2026-07-12',
      orderNumber: 'CODEX_TEST_API_PARTIAL_SETTLE_ORDER',
      reference: 'CODEX_TEST_API_PARTIAL_SETTLE_REF',
      title: 'API partial settlement test',
      categoryId: createdSalesCategory.id,
      items: [
        {
          id: 'item-api-partial-settlement',
          name: 'API partial settlement line',
          unit: 'service',
          description: '',
          quantity: 1,
          unitPrice: 500,
          discount: 0,
          discountType: 'percentage',
          taxId: 'tax-none',
        },
      ],
    },
  });
  assert(partialSettlementDocument.status === 200 && partialSettlementDocument.body?.ok === true, 'partial settlement document create should pass');
  const createdPartialSettlementDocument = partialSettlementDocument.body.state.documents[0];

  const partialSettlementInvoice = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: createdPartialSettlementDocument.id,
      status: 'invoice',
    },
  });
  assert(partialSettlementInvoice.status === 200 && partialSettlementInvoice.body?.ok === true, 'partial settlement quotation to invoice should pass');

  const partialReceipt = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: createdPartialSettlementDocument.id,
      status: 'receipt',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-07-12',
      settlementAmount: 200,
    },
  });
  assert(partialReceipt.status === 200 && partialReceipt.body?.ok === true, 'partial settlement receipt should pass');
  assert(
    partialReceipt.body.state.documents.find((document) => document.id === createdPartialSettlementDocument.id)?.status === 'invoice',
    'partial settlement should keep document in invoice status',
  );
  const partialReceiptJournal = partialReceipt.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'sales' && entry.sourceId === createdPartialSettlementDocument.id,
  );
  assert(
    partialReceiptJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 200 && line.credit === 0),
    'partial settlement journal should debit selected bank with partial amount',
  );
  assert(
    partialReceipt.body.state.auditLogs[0]?.summary.includes('Remaining balance is'),
    'partial settlement audit should mention remaining balance',
  );

  assertError(
    await postJson('/api/actions/sales_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: createdPartialSettlementDocument.id,
        status: 'receipt',
        settlementAccountId: 'acc-bank-lak',
        settlementDate: '2026-07-13',
        settlementAmount: 301,
      },
    }),
    400,
    'VALIDATION_ERROR',
    'partial settlement rejects overpayment',
  );

  const finalPartialReceipt = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: createdPartialSettlementDocument.id,
      status: 'receipt',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-07-13',
      settlementAmount: 300,
    },
  });
  assert(finalPartialReceipt.status === 200 && finalPartialReceipt.body?.ok === true, 'final partial settlement receipt should pass');
  assert(
    finalPartialReceipt.body.state.documents.find((document) => document.id === createdPartialSettlementDocument.id)?.status === 'receipt',
    'final partial settlement should move document to receipt',
  );
  const partialSettlementJournals = finalPartialReceipt.body.state.journalEntries.filter(
    (entry) => entry.sourceType === 'sales' && entry.sourceId === createdPartialSettlementDocument.id,
  );
  assert(partialSettlementJournals.length === 2, 'partial settlement should keep both settlement journals');

  const adjustedSettlementDocument = await postJson('/api/actions/sales_document.create', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      contactId: createdCustomer.id,
      documentDate: '2026-06-24',
      dueDate: '2026-07-12',
      orderNumber: 'CODEX_TEST_API_ADJUSTED_SETTLE_ORDER',
      reference: 'CODEX_TEST_API_ADJUSTED_SETTLE_REF',
      title: 'API adjusted settlement test',
      categoryId: createdSalesCategory.id,
      items: [
        {
          id: 'item-api-adjusted-settlement',
          name: 'API adjusted settlement line',
          unit: 'service',
          description: '',
          quantity: 1,
          unitPrice: 500,
          discount: 0,
          discountType: 'percentage',
          taxId: 'tax-none',
        },
      ],
    },
  });
  assert(adjustedSettlementDocument.status === 200 && adjustedSettlementDocument.body?.ok === true, 'adjusted settlement document create should pass');
  const createdAdjustedSettlementDocument = adjustedSettlementDocument.body.state.documents[0];

  const adjustedSettlementInvoice = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: createdAdjustedSettlementDocument.id,
      status: 'invoice',
    },
  });
  assert(adjustedSettlementInvoice.status === 200 && adjustedSettlementInvoice.body?.ok === true, 'adjusted settlement quotation to invoice should pass');

  assertError(
    await postJson('/api/actions/sales_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: createdAdjustedSettlementDocument.id,
        status: 'receipt',
        settlementAccountId: 'acc-bank-lak',
        settlementAmount: 500,
        settlementBankFeeAmount: 10,
        settlementBankFeeAccountId: 'acc-bank-lak',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'sales settlement rejects bank fee account with wrong kind',
  );

  assertError(
    await postJson('/api/actions/sales_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        documentId: createdAdjustedSettlementDocument.id,
        status: 'receipt',
        settlementAccountId: 'acc-bank-lak',
        settlementAmount: 500,
        settlementWithholdingTaxAmount: 50,
        settlementWithholdingTaxAccountId: 'acc-bank-fee-expense',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'sales settlement rejects withholding account with wrong kind',
  );

  const adjustedReceipt = await postJson('/api/actions/sales_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'sales',
      documentId: createdAdjustedSettlementDocument.id,
      status: 'receipt',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-07-14',
      settlementAmount: 500,
      settlementBankFeeAmount: 10,
      settlementBankFeeAccountId: 'acc-bank-fee-expense',
      settlementWithholdingTaxAmount: 50,
      settlementWithholdingTaxAccountId: 'acc-wht-receivable',
    },
  });
  assert(adjustedReceipt.status === 200 && adjustedReceipt.body?.ok === true, 'adjusted sales receipt should pass');
  assert(
    adjustedReceipt.body.state.documents.find((document) => document.id === createdAdjustedSettlementDocument.id)?.status === 'receipt',
    'adjusted sales settlement should move document to receipt',
  );
  const adjustedReceiptJournal = adjustedReceipt.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'sales' && entry.sourceId === createdAdjustedSettlementDocument.id,
  );
  assert(
    adjustedReceiptJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 440 && line.credit === 0),
    'adjusted sales settlement should debit net cash',
  );
  assert(
    adjustedReceiptJournal?.lines.some((line) => line.accountId === 'acc-bank-fee-expense' && line.debit === 10 && line.credit === 0),
    'adjusted sales settlement should debit bank fee expense',
  );
  assert(
    adjustedReceiptJournal?.lines.some((line) => line.accountId === 'acc-wht-receivable' && line.debit === 50 && line.credit === 0),
    'adjusted sales settlement should debit withholding receivable',
  );
  assert(
    adjustedReceiptJournal?.lines.some((line) => line.accountId === createdSalesCategory.accountId && line.debit === 0 && line.credit === 500),
    'adjusted sales settlement should credit gross sales amount',
  );
  assert(adjustedReceipt.body.state.auditLogs[0]?.summary.includes('Net cash is'), 'adjusted sales audit should mention net cash');
  assert(adjustedReceipt.body.state.auditLogs[0]?.summary.includes('withholding tax'), 'adjusted sales audit should mention withholding tax');
  const adjustedSettlementEndpoint = await postReportQuery('settlement_history', {
    actor: ownerActor,
    filters: { dateFrom: '2026-06-01', dateTo: '2026-07-31', status: 'all' },
  });
  assert(adjustedSettlementEndpoint.status === 200 && adjustedSettlementEndpoint.body?.ok === true, 'adjusted settlement history endpoint should pass');
  assert(
    adjustedSettlementEndpoint.body.data.rows.some(
      (row) =>
        row.entryId === adjustedReceiptJournal?.id &&
        row.documentNumber === createdAdjustedSettlementDocument.documentNumber &&
        row.amount === 500 &&
        row.currency === 'LAK' &&
        row.cashAmount === 440 &&
        row.cashCurrency === 'LAK',
    ),
    'adjusted settlement history should disclose document amount and net cash amount separately',
  );

  const adjustedPurchaseDocument = await postJson('/api/actions/purchase_document.create', {
    actor: ownerActor,
    payload: {
      kind: 'purchase',
      contactId: createdVendor.id,
      currency: 'LAK',
      documentDate: '2026-06-24',
      dueDate: '2026-07-24',
      orderNumber: 'CODEX_TEST_API_ADJUSTED_PURCHASE_ORDER',
      reference: 'CODEX_TEST_API_ADJUSTED_PURCHASE_REF',
      title: 'API adjusted purchase settlement test',
      categoryId: 'cat-purchase-document',
      items: [
        {
          id: 'item-api-adjusted-purchase',
          name: 'API adjusted purchase settlement line',
          unit: 'service',
          description: '',
          quantity: 1,
          unitPrice: 500,
          discount: 0,
          discountType: 'percentage',
          taxId: 'tax-none',
        },
      ],
    },
  });
  assert(adjustedPurchaseDocument.status === 200 && adjustedPurchaseDocument.body?.ok === true, 'adjusted purchase document create should pass');
  const createdAdjustedPurchaseDocument = adjustedPurchaseDocument.body.state.documents[0];

  const adjustedPurchaseBill = await postJson('/api/actions/purchase_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'purchase',
      documentId: createdAdjustedPurchaseDocument.id,
      status: 'bill',
    },
  });
  assert(adjustedPurchaseBill.status === 200 && adjustedPurchaseBill.body?.ok === true, 'adjusted purchase_order to bill should pass');

  const adjustedPaid = await postJson('/api/actions/purchase_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'purchase',
      documentId: createdAdjustedPurchaseDocument.id,
      status: 'paid',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-07-24',
      settlementAmount: 500,
      settlementBankFeeAmount: 10,
      settlementBankFeeAccountId: 'acc-bank-fee-expense',
      settlementWithholdingTaxAmount: 50,
      settlementWithholdingTaxAccountId: 'acc-wht-payable',
    },
  });
  assert(adjustedPaid.status === 200 && adjustedPaid.body?.ok === true, 'adjusted purchase paid should pass');
  const adjustedPaidJournal = adjustedPaid.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'purchase' && entry.sourceId === createdAdjustedPurchaseDocument.id,
  );
  assert(
    adjustedPaidJournal?.lines.some((line) => line.accountId === 'acc-expense-admin' && line.debit === 500 && line.credit === 0),
    'adjusted purchase settlement should debit gross purchase amount',
  );
  assert(
    adjustedPaidJournal?.lines.some((line) => line.accountId === 'acc-bank-fee-expense' && line.debit === 10 && line.credit === 0),
    'adjusted purchase settlement should debit bank fee expense',
  );
  assert(
    adjustedPaidJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 0 && line.credit === 460),
    'adjusted purchase settlement should credit net cash',
  );
  assert(
    adjustedPaidJournal?.lines.some((line) => line.accountId === 'acc-wht-payable' && line.debit === 0 && line.credit === 50),
    'adjusted purchase settlement should credit withholding payable',
  );

  const purchaseDocument = await postJson('/api/actions/purchase_document.create', {
    actor: ownerActor,
    payload: {
      kind: 'purchase',
      contactId: createdVendor.id,
      documentDate: '2026-06-24',
      dueDate: '2026-07-24',
      orderNumber: 'CODEX_TEST_API_PURCHASE_ORDER',
      reference: 'CODEX_TEST_API_PURCHASE_REF',
      title: 'API purchase transition test',
      categoryId: 'cat-purchase-document',
      exchangeRate: 22000,
      attachmentNames: ['CODEX_TEST purchase evidence.pdf'],
      items: [
        {
          id: 'item-api-purchase',
          name: 'API office supply',
          unit: 'piece',
          description: '',
          quantity: 3,
          unitPrice: 250,
          discount: 0,
          discountType: 'percentage',
          taxId: 'tax-none',
        },
      ],
    },
  });
  assert(purchaseDocument.status === 200 && purchaseDocument.body?.ok === true, 'purchase document create should pass');
  const createdPurchaseDocument = purchaseDocument.body.state.documents[0];
  assert(createdPurchaseDocument.status === 'purchase_order', 'purchase document should start as purchase_order');
  assert(createdPurchaseDocument.exchangeRate === 22000, 'purchase document should keep exchange rate');
  assert(createdPurchaseDocument.items[0].unit === 'piece', 'purchase document item should keep unit');

  assertError(
    await postJson('/api/actions/purchase_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'purchase',
        documentId: createdPurchaseDocument.id,
        status: 'paid',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'purchase status skip',
  );

  const bill = await postJson('/api/actions/purchase_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'purchase',
      documentId: createdPurchaseDocument.id,
      status: 'bill',
    },
  });
  assert(bill.status === 200 && bill.body?.ok === true, 'purchase_order to bill should pass');
  assert(
    !bill.body.state.journalEntries.some((entry) => entry.sourceType === 'purchase' && entry.sourceId === createdPurchaseDocument.id),
    'purchase_order to bill should not post settlement journal',
  );

  const missingPurchaseExchangeRate = await postJson('/api/actions/purchase_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'purchase',
      documentId: createdPurchaseDocument.id,
      status: 'paid',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-07-25',
    },
  });
  assertError(missingPurchaseExchangeRate, 400, 'VALIDATION_ERROR', 'purchase cross-currency settlement requires exchange rate');
  assert(
    missingPurchaseExchangeRate.body.error.toLowerCase().includes('exchange rate'),
    'purchase cross-currency missing rate error should mention exchange rate',
  );

  assertError(
    await postJson('/api/actions/purchase_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'purchase',
        documentId: createdPurchaseDocument.id,
        status: 'paid',
        settlementAccountId: 'acc-bank-lak',
        settlementDate: '2026-07-25',
        settlementExchangeRate: 0,
      },
    }),
    400,
    'VALIDATION_ERROR',
    'purchase cross-currency settlement rejects invalid exchange rate',
  );

  assertError(
    await postJson('/api/actions/purchase_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'purchase',
        documentId: createdPurchaseDocument.id,
        status: 'paid',
        settlementAccountId: 'acc-bank-lak',
        settlementDate: '2026-07-25',
        settlementAmount: 1000,
        settlementExchangeRate: 23000,
      },
    }),
    400,
    'VALIDATION_ERROR',
    'purchase cross-currency settlement rejects overpayment',
  );

  assertError(
    await postJson('/api/actions/purchase_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'purchase',
        documentId: createdPurchaseDocument.id,
        status: 'paid',
        settlementAccountId: 'acc-bank-thb',
        settlementDate: '2026-07-25',
        settlementExchangeRate: 650,
      },
    }),
    400,
    'VALIDATION_ERROR',
    'purchase cross-currency settlement rejects non-base settlement account',
  );

  assertError(
    await postJson('/api/actions/purchase_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'purchase',
        documentId: createdPurchaseDocument.id,
        status: 'paid',
        settlementAccountId: 'acc-bank-lak',
        settlementDate: '2026-07-25',
        settlementExchangeRate: 23000,
        settlementWithholdingTaxAmount: -1,
      },
    }),
    400,
    'VALIDATION_ERROR',
    'purchase cross-currency settlement rejects negative withholding tax',
  );

  assertError(
    await postJson('/api/actions/purchase_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'purchase',
        documentId: createdPurchaseDocument.id,
        status: 'paid',
        settlementAccountId: 'acc-bank-lak',
        settlementDate: '2026-07-25',
        settlementExchangeRate: 23000,
        settlementBankFeeAmount: 1000,
      },
    }),
    400,
    'VALIDATION_ERROR',
    'purchase cross-currency settlement rejects excessive bank fee',
  );

  const paid = await postJson('/api/actions/purchase_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'purchase',
      documentId: createdPurchaseDocument.id,
      status: 'paid',
    },
  });
  assert(paid.status === 200 && paid.body?.ok === true, 'bill to paid should pass');
  const paidJournal = paid.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'purchase' && entry.sourceId === createdPurchaseDocument.id,
  );
  assert(paidJournal?.reference === 'CODEX_TEST_API_PURCHASE_REF', 'purchase settlement journal should keep document reference');
  assert(
    paidJournal?.lines.some((line) => line.accountId === 'acc-expense-admin' && line.debit === 750 && line.credit === 0),
    'purchase settlement journal should debit expense',
  );
  assert(
    paidJournal?.lines.some((line) => line.accountId === 'acc-bank-usd' && line.debit === 0 && line.credit === 750),
    'purchase settlement journal should credit fallback bank',
  );
  assert(paid.body.state.auditLogs[0]?.summary.includes('Settlement journal posted'), 'paid audit should mention settlement journal');
  const paidLedgerRows = ledgerRowsForAccount(paid.body.state, 'acc-bank-usd');
  assert(
    paidLedgerRows.some((row) => row.entry.id === paidJournal?.id && row.line.credit === 750 && row.balance === -750),
    'ledger report should show purchase settlement bank credit and balance',
  );
  const paidCashMovement = cashMovementRows(paid.body.state).find((row) => row.account.id === 'acc-bank-usd');
  assert(
    paidCashMovement?.moneyIn === 0 && paidCashMovement?.moneyOut === 750,
    'cash movement report should show purchase settlement money out',
  );
  const paidSettlementRows = documentSettlementRows(paid.body.state);
  assert(
    paidSettlementRows.some(
      (row) =>
        row.entry.id === paidJournal?.id &&
        row.document.documentNumber === createdPurchaseDocument.documentNumber &&
        row.cashAccount?.id === 'acc-bank-usd' &&
        Math.max(row.cashLine.debit, row.cashLine.credit) === 750,
    ),
    'settlement report should show purchase paid settlement',
  );

  const createCrossCurrencyPurchaseBill = async ({ code, reference, title }) => {
    const documentResult = await postJson('/api/actions/purchase_document.create', {
      actor: ownerActor,
      payload: {
        kind: 'purchase',
        contactId: createdVendor.id,
        documentDate: '2026-06-24',
        dueDate: '2026-08-01',
        orderNumber: `CODEX_TEST_API_${code}_ORDER`,
        reference,
        title,
        categoryId: 'cat-purchase-document',
        exchangeRate: 22000,
        items: [
          {
            id: `item-api-${code.toLowerCase()}`,
            name: `${title} line`,
            unit: 'service',
            description: '',
            quantity: 1,
            unitPrice: 100,
            discount: 0,
            discountType: 'percentage',
            taxId: 'tax-none',
          },
        ],
      },
    });
    assert(documentResult.status === 200 && documentResult.body?.ok === true, `${code} purchase document create should pass`);
    const document = documentResult.body.state.documents[0];
    const billResult = await postJson('/api/actions/purchase_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'purchase',
        documentId: document.id,
        status: 'bill',
      },
    });
    assert(billResult.status === 200 && billResult.body?.ok === true, `${code} purchase_order to bill should pass`);
    return document;
  };

  const sameCurrencyPurchasePartialDocument = await createCrossCurrencyPurchaseBill({
    code: 'PURCHASE_SAME_CURRENCY_PARTIAL',
    reference: 'CODEX_TEST_API_PURCHASE_SAME_CURRENCY_PARTIAL_REF',
    title: 'API purchase same-currency partial settlement test',
  });
  const sameCurrencyPurchasePartialPaid = await postJson('/api/actions/purchase_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'purchase',
      documentId: sameCurrencyPurchasePartialDocument.id,
      status: 'paid',
      settlementAccountId: 'acc-bank-usd',
      settlementDate: '2026-08-03',
      settlementAmount: 40,
    },
  });
  assert(
    sameCurrencyPurchasePartialPaid.status === 200 && sameCurrencyPurchasePartialPaid.body?.ok === true,
    'purchase same-currency partial payment should pass',
  );
  assert(
    sameCurrencyPurchasePartialPaid.body.state.documents.find((document) => document.id === sameCurrencyPurchasePartialDocument.id)?.status === 'bill',
    'purchase same-currency partial payment should keep document in bill status',
  );
  assert(
    documentRemainingAmount(
      sameCurrencyPurchasePartialPaid.body.state,
      sameCurrencyPurchasePartialPaid.body.state.documents.find((document) => document.id === sameCurrencyPurchasePartialDocument.id),
    ) === 60,
    'purchase same-currency partial payment should leave 60 in document currency',
  );
  const sameCurrencyPurchasePartialJournal = sameCurrencyPurchasePartialPaid.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'purchase' && entry.sourceId === sameCurrencyPurchasePartialDocument.id,
  );
  assertBalancedJournal(sameCurrencyPurchasePartialJournal, 'purchase same-currency partial journal');
  assert(
    sameCurrencyPurchasePartialJournal?.lines.some((line) => line.accountId === 'acc-expense-admin' && line.debit === 40 && line.credit === 0),
    'purchase same-currency partial journal should debit purchase expense for paid amount',
  );
  assert(
    sameCurrencyPurchasePartialJournal?.lines.some((line) => line.accountId === 'acc-bank-usd' && line.debit === 0 && line.credit === 40),
    'purchase same-currency partial journal should credit selected USD bank for paid amount',
  );

  const purchaseFxPartialLossDocument = await createCrossCurrencyPurchaseBill({
    code: 'PURCHASE_FX_PARTIAL_LOSS',
    reference: 'CODEX_TEST_API_PURCHASE_FX_PARTIAL_LOSS_REF',
    title: 'API purchase FX partial loss settlement test',
  });
  const purchaseFxPartialLossPaid = await postJson('/api/actions/purchase_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'purchase',
      documentId: purchaseFxPartialLossDocument.id,
      status: 'paid',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-08-03',
      settlementAmount: 40,
      settlementExchangeRate: 23000,
      settlementExchangeGainAccountId: 'acc-exchange-gain',
      settlementExchangeLossAccountId: 'acc-exchange-loss',
    },
  });
  assert(
    purchaseFxPartialLossPaid.status === 200 && purchaseFxPartialLossPaid.body?.ok === true,
    'purchase cross-currency partial payment with exchange loss should pass',
  );
  assert(
    purchaseFxPartialLossPaid.body.state.documents.find((document) => document.id === purchaseFxPartialLossDocument.id)?.status === 'bill',
    'purchase cross-currency partial loss payment should keep document in bill status',
  );
  assert(
    documentRemainingAmount(
      purchaseFxPartialLossPaid.body.state,
      purchaseFxPartialLossPaid.body.state.documents.find((document) => document.id === purchaseFxPartialLossDocument.id),
    ) === 60,
    'purchase cross-currency partial loss payment should leave 60 in document currency',
  );
  const purchaseFxPartialLossJournal = purchaseFxPartialLossPaid.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'purchase' && entry.sourceId === purchaseFxPartialLossDocument.id,
  );
  assertBalancedJournal(purchaseFxPartialLossJournal, 'purchase cross-currency partial loss journal');
  assert(
    purchaseFxPartialLossJournal?.lines.some((line) => line.accountId === 'acc-expense-admin' && line.debit === 880000 && line.credit === 0),
    'purchase cross-currency partial loss journal should debit purchase expense for paid amount at document rate',
  );
  assert(
    purchaseFxPartialLossJournal?.lines.some((line) => line.accountId === 'acc-exchange-loss' && line.debit === 40000 && line.credit === 0),
    'purchase cross-currency partial loss journal should debit exchange loss for paid amount',
  );
  assert(
    purchaseFxPartialLossJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 0 && line.credit === 920000),
    'purchase cross-currency partial loss journal should credit LAK bank for paid amount at settlement rate',
  );
  assert(
    !purchaseFxPartialLossJournal?.lines.some((line) => line.accountId === 'acc-exchange-gain' && (line.debit > 0 || line.credit > 0)),
    'purchase cross-currency partial loss journal should not post exchange gain',
  );
  assert(
    purchaseFxPartialLossPaid.body.state.auditLogs[0]?.summary.includes('Remaining balance is') &&
      purchaseFxPartialLossPaid.body.state.auditLogs[0]?.summary.includes('exchange loss'),
    'purchase cross-currency partial loss audit should mention remaining balance and exchange loss',
  );

  assertError(
    await postJson('/api/actions/purchase_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'purchase',
        documentId: purchaseFxPartialLossDocument.id,
        status: 'paid',
        settlementAccountId: 'acc-bank-lak',
        settlementDate: '2026-08-04',
        settlementAmount: 61,
        settlementExchangeRate: 23000,
      },
    }),
    400,
    'VALIDATION_ERROR',
    'purchase cross-currency partial settlement rejects overpayment after first payment',
  );

  const purchaseFxPartialFinalPaid = await postJson('/api/actions/purchase_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'purchase',
      documentId: purchaseFxPartialLossDocument.id,
      status: 'paid',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-08-04',
      settlementAmount: 60,
      settlementExchangeRate: 21000,
    },
  });
  assert(
    purchaseFxPartialFinalPaid.status === 200 && purchaseFxPartialFinalPaid.body?.ok === true,
    'purchase cross-currency final remaining payment after partial should pass',
  );
  assert(
    purchaseFxPartialFinalPaid.body.state.documents.find((document) => document.id === purchaseFxPartialLossDocument.id)?.status === 'paid',
    'purchase cross-currency final remaining payment should move document to paid',
  );
  assert(
    documentRemainingAmount(
      purchaseFxPartialFinalPaid.body.state,
      purchaseFxPartialFinalPaid.body.state.documents.find((document) => document.id === purchaseFxPartialLossDocument.id),
    ) === 0,
    'purchase cross-currency final remaining payment should clear document balance',
  );
  const purchaseFxPartialJournals = purchaseFxPartialFinalPaid.body.state.journalEntries.filter(
    (entry) => entry.sourceType === 'purchase' && entry.sourceId === purchaseFxPartialLossDocument.id,
  );
  assert(purchaseFxPartialJournals.length === 2, 'purchase cross-currency partial flow should keep both settlement journals');
  const purchaseFxPartialFinalJournal = purchaseFxPartialJournals.find((entry) => entry.entryDate === '2026-08-04');
  assertBalancedJournal(purchaseFxPartialFinalJournal, 'purchase cross-currency final remaining journal');
  assert(
    purchaseFxPartialFinalJournal?.lines.some((line) => line.accountId === 'acc-expense-admin' && line.debit === 1320000 && line.credit === 0),
    'purchase cross-currency final remaining journal should debit purchase expense at document rate',
  );
  assert(
    purchaseFxPartialFinalJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 0 && line.credit === 1260000),
    'purchase cross-currency final remaining journal should credit LAK bank at settlement rate',
  );
  assert(
    purchaseFxPartialFinalJournal?.lines.some((line) => line.accountId === 'acc-exchange-gain' && line.debit === 0 && line.credit === 60000),
    'purchase cross-currency final remaining journal should credit exchange gain for remaining amount',
  );

  const purchaseFxPartialGainDocument = await createCrossCurrencyPurchaseBill({
    code: 'PURCHASE_FX_PARTIAL_GAIN',
    reference: 'CODEX_TEST_API_PURCHASE_FX_PARTIAL_GAIN_REF',
    title: 'API purchase FX partial gain settlement test',
  });
  const purchaseFxPartialGainPaid = await postJson('/api/actions/purchase_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'purchase',
      documentId: purchaseFxPartialGainDocument.id,
      status: 'paid',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-08-05',
      settlementAmount: 40,
      settlementExchangeRate: 21000,
      settlementExchangeGainAccountId: 'acc-exchange-gain',
      settlementExchangeLossAccountId: 'acc-exchange-loss',
    },
  });
  assert(
    purchaseFxPartialGainPaid.status === 200 && purchaseFxPartialGainPaid.body?.ok === true,
    'purchase cross-currency partial payment with exchange gain should pass',
  );
  assert(
    purchaseFxPartialGainPaid.body.state.documents.find((document) => document.id === purchaseFxPartialGainDocument.id)?.status === 'bill',
    'purchase cross-currency partial gain payment should keep document in bill status',
  );
  assert(
    documentRemainingAmount(
      purchaseFxPartialGainPaid.body.state,
      purchaseFxPartialGainPaid.body.state.documents.find((document) => document.id === purchaseFxPartialGainDocument.id),
    ) === 60,
    'purchase cross-currency partial gain payment should leave 60 in document currency',
  );
  const purchaseFxPartialGainJournal = purchaseFxPartialGainPaid.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'purchase' && entry.sourceId === purchaseFxPartialGainDocument.id,
  );
  assertBalancedJournal(purchaseFxPartialGainJournal, 'purchase cross-currency partial gain journal');
  assert(
    purchaseFxPartialGainJournal?.lines.some((line) => line.accountId === 'acc-expense-admin' && line.debit === 880000 && line.credit === 0),
    'purchase cross-currency partial gain journal should debit purchase expense for paid amount at document rate',
  );
  assert(
    purchaseFxPartialGainJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 0 && line.credit === 840000),
    'purchase cross-currency partial gain journal should credit LAK bank for paid amount at settlement rate',
  );
  assert(
    purchaseFxPartialGainJournal?.lines.some((line) => line.accountId === 'acc-exchange-gain' && line.debit === 0 && line.credit === 40000),
    'purchase cross-currency partial gain journal should credit exchange gain for paid amount',
  );
  assert(
    !purchaseFxPartialGainJournal?.lines.some((line) => line.accountId === 'acc-exchange-loss' && (line.debit > 0 || line.credit > 0)),
    'purchase cross-currency partial gain journal should not post exchange loss',
  );

  const purchaseFxAdjustedPartialDocument = await createCrossCurrencyPurchaseBill({
    code: 'PURCHASE_FX_ADJUSTED_PARTIAL',
    reference: 'CODEX_TEST_API_PURCHASE_FX_ADJUSTED_PARTIAL_REF',
    title: 'API purchase FX adjusted partial settlement test',
  });
  const purchaseFxAdjustedPartialPaid = await postJson('/api/actions/purchase_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'purchase',
      documentId: purchaseFxAdjustedPartialDocument.id,
      status: 'paid',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-08-06',
      settlementAmount: 40,
      settlementExchangeRate: 23000,
      settlementBankFeeAmount: 2,
      settlementBankFeeAccountId: 'acc-bank-fee-expense',
      settlementWithholdingTaxAmount: 3,
      settlementWithholdingTaxAccountId: 'acc-wht-payable',
      settlementExchangeGainAccountId: 'acc-exchange-gain',
      settlementExchangeLossAccountId: 'acc-exchange-loss',
    },
  });
  assert(
    purchaseFxAdjustedPartialPaid.status === 200 && purchaseFxAdjustedPartialPaid.body?.ok === true,
    'purchase cross-currency partial payment with fee and withholding should pass',
  );
  assert(
    purchaseFxAdjustedPartialPaid.body.state.documents.find((document) => document.id === purchaseFxAdjustedPartialDocument.id)?.status === 'bill',
    'purchase cross-currency adjusted partial payment should keep document in bill status',
  );
  assert(
    documentRemainingAmount(
      purchaseFxAdjustedPartialPaid.body.state,
      purchaseFxAdjustedPartialPaid.body.state.documents.find((document) => document.id === purchaseFxAdjustedPartialDocument.id),
    ) === 60,
    'purchase cross-currency adjusted partial payment should leave 60 in document currency',
  );
  const purchaseFxAdjustedPartialJournal = purchaseFxAdjustedPartialPaid.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'purchase' && entry.sourceId === purchaseFxAdjustedPartialDocument.id,
  );
  assertBalancedJournal(purchaseFxAdjustedPartialJournal, 'purchase cross-currency adjusted partial journal');
  assert(
    purchaseFxAdjustedPartialJournal?.lines.some((line) => line.accountId === 'acc-expense-admin' && line.debit === 880000 && line.credit === 0),
    'purchase cross-currency adjusted partial journal should debit purchase expense at document rate',
  );
  assert(
    purchaseFxAdjustedPartialJournal?.lines.some((line) => line.accountId === 'acc-bank-fee-expense' && line.debit === 46000 && line.credit === 0),
    'purchase cross-currency adjusted partial journal should debit bank fee at settlement rate',
  );
  assert(
    purchaseFxAdjustedPartialJournal?.lines.some((line) => line.accountId === 'acc-exchange-loss' && line.debit === 40000 && line.credit === 0),
    'purchase cross-currency adjusted partial journal should debit exchange loss on settled amount',
  );
  assert(
    purchaseFxAdjustedPartialJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 0 && line.credit === 897000),
    'purchase cross-currency adjusted partial journal should credit net LAK bank cash',
  );
  assert(
    purchaseFxAdjustedPartialJournal?.lines.some((line) => line.accountId === 'acc-wht-payable' && line.debit === 0 && line.credit === 69000),
    'purchase cross-currency adjusted partial journal should credit withholding payable at settlement rate',
  );

  const purchaseFxAdjustedFinalDocument = await createCrossCurrencyPurchaseBill({
    code: 'PURCHASE_FX_ADJUSTED_FINAL',
    reference: 'CODEX_TEST_API_PURCHASE_FX_ADJUSTED_FINAL_REF',
    title: 'API purchase FX adjusted final settlement test',
  });
  const purchaseFxAdjustedFinalPaid = await postJson('/api/actions/purchase_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'purchase',
      documentId: purchaseFxAdjustedFinalDocument.id,
      status: 'paid',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-08-07',
      settlementExchangeRate: 23000,
      settlementBankFeeAmount: 5,
      settlementBankFeeAccountId: 'acc-bank-fee-expense',
      settlementWithholdingTaxAmount: 10,
      settlementWithholdingTaxAccountId: 'acc-wht-payable',
      settlementExchangeGainAccountId: 'acc-exchange-gain',
      settlementExchangeLossAccountId: 'acc-exchange-loss',
    },
  });
  assert(
    purchaseFxAdjustedFinalPaid.status === 200 && purchaseFxAdjustedFinalPaid.body?.ok === true,
    'purchase cross-currency final payment with fee and withholding should pass',
  );
  const purchaseFxAdjustedFinalJournal = purchaseFxAdjustedFinalPaid.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'purchase' && entry.sourceId === purchaseFxAdjustedFinalDocument.id,
  );
  assertBalancedJournal(purchaseFxAdjustedFinalJournal, 'purchase cross-currency adjusted final journal');
  assert(
    purchaseFxAdjustedFinalJournal?.lines.some((line) => line.accountId === 'acc-expense-admin' && line.debit === 2200000 && line.credit === 0),
    'purchase cross-currency adjusted final journal should debit purchase expense at document rate',
  );
  assert(
    purchaseFxAdjustedFinalJournal?.lines.some((line) => line.accountId === 'acc-bank-fee-expense' && line.debit === 115000 && line.credit === 0),
    'purchase cross-currency adjusted final journal should debit bank fee at settlement rate',
  );
  assert(
    purchaseFxAdjustedFinalJournal?.lines.some((line) => line.accountId === 'acc-exchange-loss' && line.debit === 100000 && line.credit === 0),
    'purchase cross-currency adjusted final journal should debit exchange loss on settled amount',
  );
  assert(
    purchaseFxAdjustedFinalJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 0 && line.credit === 2185000),
    'purchase cross-currency adjusted final journal should credit net LAK bank cash',
  );
  assert(
    purchaseFxAdjustedFinalJournal?.lines.some((line) => line.accountId === 'acc-wht-payable' && line.debit === 0 && line.credit === 230000),
    'purchase cross-currency adjusted final journal should credit withholding payable at settlement rate',
  );

  const purchaseFxLossDocument = await createCrossCurrencyPurchaseBill({
    code: 'PURCHASE_FX_LOSS',
    reference: 'CODEX_TEST_API_PURCHASE_FX_LOSS_REF',
    title: 'API purchase FX loss settlement test',
  });
  const purchaseFxLossPaid = await postJson('/api/actions/purchase_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'purchase',
      documentId: purchaseFxLossDocument.id,
      status: 'paid',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-08-01',
      settlementExchangeRate: 23000,
      settlementExchangeGainAccountId: 'acc-exchange-gain',
      settlementExchangeLossAccountId: 'acc-exchange-loss',
    },
  });
  assert(purchaseFxLossPaid.status === 200 && purchaseFxLossPaid.body?.ok === true, 'purchase cross-currency payment with exchange loss should pass');
  const purchaseFxLossJournal = purchaseFxLossPaid.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'purchase' && entry.sourceId === purchaseFxLossDocument.id,
  );
  assertBalancedJournal(purchaseFxLossJournal, 'purchase cross-currency loss journal');
  assert(
    purchaseFxLossJournal?.lines.some((line) => line.accountId === 'acc-expense-admin' && line.debit === 2200000 && line.credit === 0),
    'purchase cross-currency loss journal should debit purchase expense at document exchange rate',
  );
  assert(
    purchaseFxLossJournal?.lines.some((line) => line.accountId === 'acc-exchange-loss' && line.debit === 100000 && line.credit === 0),
    'purchase cross-currency loss journal should debit realized exchange loss',
  );
  assert(
    purchaseFxLossJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 0 && line.credit === 2300000),
    'purchase cross-currency loss journal should credit LAK bank at settlement rate',
  );
  assert(
    !purchaseFxLossJournal?.lines.some((line) => line.accountId === 'acc-exchange-gain' && (line.debit > 0 || line.credit > 0)),
    'purchase cross-currency loss journal should not post exchange gain',
  );
  assert(purchaseFxLossPaid.body.state.auditLogs[0]?.summary.includes('exchange loss'), 'purchase cross-currency audit should mention exchange loss');

  const purchaseFxGainDocument = await createCrossCurrencyPurchaseBill({
    code: 'PURCHASE_FX_GAIN',
    reference: 'CODEX_TEST_API_PURCHASE_FX_GAIN_REF',
    title: 'API purchase FX gain settlement test',
  });
  const purchaseFxGainPaid = await postJson('/api/actions/purchase_document.status.update', {
    actor: ownerActor,
    payload: {
      kind: 'purchase',
      documentId: purchaseFxGainDocument.id,
      status: 'paid',
      settlementAccountId: 'acc-bank-lak',
      settlementDate: '2026-08-02',
      settlementExchangeRate: 21000,
    },
  });
  assert(purchaseFxGainPaid.status === 200 && purchaseFxGainPaid.body?.ok === true, 'purchase cross-currency payment with exchange gain should pass');
  const purchaseFxGainJournal = purchaseFxGainPaid.body.state.journalEntries.find(
    (entry) => entry.sourceType === 'purchase' && entry.sourceId === purchaseFxGainDocument.id,
  );
  assertBalancedJournal(purchaseFxGainJournal, 'purchase cross-currency gain journal');
  assert(
    purchaseFxGainJournal?.lines.some((line) => line.accountId === 'acc-expense-admin' && line.debit === 2200000 && line.credit === 0),
    'purchase cross-currency gain journal should debit purchase expense at document exchange rate',
  );
  assert(
    purchaseFxGainJournal?.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 0 && line.credit === 2100000),
    'purchase cross-currency gain journal should credit LAK bank at settlement rate',
  );
  assert(
    purchaseFxGainJournal?.lines.some((line) => line.accountId === 'acc-exchange-gain' && line.debit === 0 && line.credit === 100000),
    'purchase cross-currency gain journal should credit realized exchange gain',
  );
  assert(
    !purchaseFxGainJournal?.lines.some((line) => line.accountId === 'acc-exchange-loss' && (line.debit > 0 || line.credit > 0)),
    'purchase cross-currency gain journal should not post exchange loss',
  );
  assert(purchaseFxGainPaid.body.state.auditLogs[0]?.summary.includes('exchange gain'), 'purchase cross-currency audit should mention exchange gain');

  assertError(
    await postJson('/api/actions/purchase_document.status.update', {
      actor: ownerActor,
      payload: {
        kind: 'purchase',
        documentId: createdPurchaseDocument.id,
        status: 'bill',
      },
    }),
    400,
    'VALIDATION_ERROR',
    'paid status cannot go backward',
  );

  assertError(
    await putJson('/api/state', { invalid: true }),
    400,
    'INVALID_STATE_SHAPE',
    'invalid state shape',
  );
}

try {
  await run();
  console.log('API smoke test passed.');
} finally {
  const reset = await postJson('/api/reset', {}, {
    'X-Codex-Reset-Source': 'api-smoke-test',
    'X-Codex-Run-Id': testRunId,
    'X-Codex-Session-Id': testSessionId,
    'X-Codex-Reset-Reason': 'final-cleanup',
  });
  if (reset.status !== 200) {
    console.error(`Final reset failed with HTTP ${reset.status}.`);
    process.exitCode = 1;
  }
}
