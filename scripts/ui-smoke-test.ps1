$ErrorActionPreference = 'Stop'

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$AppUrl = if ($env:UI_BASE_URL) { $env:UI_BASE_URL } else { 'http://127.0.0.1:5173' }
$ApiUrl = if ($env:API_BASE_URL) { $env:API_BASE_URL } else { 'http://127.0.0.1:8787' }
$Session = if ($env:AGENT_BROWSER_SESSION) { $env:AGENT_BROWSER_SESSION } else { "accounting-ui-smoke-$PID-$(Get-Random)" }
$RunId = if ($env:CODEX_TEST_RUN_ID) { $env:CODEX_TEST_RUN_ID } else { "ui-smoke-$PID-$(Get-Random)" }
$AgentBrowser = $env:AGENT_BROWSER_BIN
if (-not $AgentBrowser) {
  $Candidate = Join-Path $env:APPDATA 'npm\agent-browser.cmd'
  if (Test-Path -LiteralPath $Candidate) {
    $AgentBrowser = $Candidate
  } else {
    $AgentBrowser = 'agent-browser'
  }
}

function Wait-Until {
  param(
    [scriptblock]$Predicate,
    [string]$Label,
    [int]$TimeoutSeconds = 15
  )

  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $Deadline) {
    try {
      if (& $Predicate) {
        return
      }
    } catch {
      Start-Sleep -Milliseconds 250
      continue
    }

    Start-Sleep -Milliseconds 250
  }

  throw "$Label timed out"
}

function Test-ApiReady {
  $Health = Invoke-RestMethod -Uri "$ApiUrl/api/health" -Headers @{ Accept = 'application/json' }
  return $Health.ok -eq $true
}

function Test-AppReady {
  $Response = Invoke-WebRequest -Uri "$AppUrl/" -UseBasicParsing
  return $Response.StatusCode -eq 200
}

function Stop-ProcessTree {
  param([int]$ProcessIdToStop)

  $Processes = Get-CimInstance Win32_Process
  $Children = $Processes | Where-Object { $_.ParentProcessId -eq $ProcessIdToStop }
  foreach ($Child in $Children) {
    Stop-ProcessTree $Child.ProcessId
  }

  Stop-Process -Id $ProcessIdToStop -Force -ErrorAction SilentlyContinue
}

function Read-ProcessTask {
  param($Task)

  if ($Task.Wait(1000)) {
    return $Task.Result
  }

  return ''
}

function Invoke-Agent {
  param(
    [string[]]$Arguments,
    [int]$TimeoutSeconds = 30,
    [AllowNull()][string]$InputText = $null
  )

  $AgentArguments = @('--session', $Session) + $Arguments
  $ProcessInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $ProcessInfo.FileName = $AgentBrowser
  $ProcessInfo.Arguments = ($AgentArguments | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join ' '
  $ProcessInfo.UseShellExecute = $false
  $ProcessInfo.CreateNoWindow = $true
  $ProcessInfo.RedirectStandardOutput = $true
  $ProcessInfo.RedirectStandardError = $true
  $ProcessInfo.RedirectStandardInput = $null -ne $InputText

  $Process = [System.Diagnostics.Process]::new()
  $Process.StartInfo = $ProcessInfo
  [void]$Process.Start()
  $OutputTask = $Process.StandardOutput.ReadToEndAsync()
  $ErrorTask = $Process.StandardError.ReadToEndAsync()
  if ($null -ne $InputText) {
    $Process.StandardInput.Write($InputText)
    $Process.StandardInput.Close()
  }

  if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-ProcessTree $Process.Id
    $Output = Read-ProcessTask $OutputTask
    $ErrorOutput = Read-ProcessTask $ErrorTask
    throw "agent-browser timed out: $($Arguments -join ' ')`n$($Output -join "`n")`n$($ErrorOutput -join "`n")"
  }
  $Process.WaitForExit()

  $ExitCode = $Process.ExitCode
  $Output = Read-ProcessTask $OutputTask
  $ErrorOutput = Read-ProcessTask $ErrorTask
  if ($null -eq $ExitCode -and -not $ErrorOutput) {
    $ExitCode = 0
  }

  if ($Output) {
    $Output | Write-Output
  }
  if ($ErrorOutput) {
    $ErrorOutput | ForEach-Object { Write-Host $_ }
  }
  if ($ExitCode -ne 0) {
    throw "agent-browser failed ($ExitCode): $($Arguments -join ' ')`n$($Output -join "`n")`n$($ErrorOutput -join "`n")"
  }
}

try {
  Write-Host 'UI smoke: checking existing dev server'
  Wait-Until { (Test-ApiReady) -and (Test-AppReady) } 'existing dev server at 127.0.0.1:5173 and 127.0.0.1:8787' 15

  Invoke-RestMethod -Uri "$ApiUrl/api/reset" -Method Post -Headers @{
    Accept = 'application/json'
    'X-Codex-Reset-Source' = 'ui-smoke-test'
    'X-Codex-Run-Id' = $RunId
    'X-Codex-Session-Id' = $Session
    'X-Codex-Reset-Reason' = 'initial-seed'
  } | Out-Null

  Write-Host 'UI smoke: opening browser session'
  Invoke-Agent @('open', $AppUrl) | Out-Null

  Write-Host 'UI smoke: running browser flow'
  $BrowserFlow = @'
(async () => {
  const result = {
    ok: false,
    assertions: [],
  };
  const apiBaseUrl = '__API_BASE_URL__';
  const categoryName = 'CODEX_UI_INLINE_SALES_' + Date.now();
  const categoryCode = 'CODEX_UI_SALES_' + String(Date.now()).slice(-6);
  const productCode = 'CODEX_UI_PRODUCT_' + String(Date.now()).slice(-6);
  const productName = 'CODEX_UI Inline Product ' + String(Date.now()).slice(-6);
  const debugContext = {};
  window.sessionStorage.setItem('accounting-system-diagnostics-source', 'ui-smoke-browser');
  window.sessionStorage.setItem('accounting-system-diagnostics-run-id', '__RUN_ID__');
  window.sessionStorage.setItem('accounting-system-diagnostics-session-id', '__SESSION_ID__');

  function assert(condition, message) {
    if (!condition) throw new Error(message);
    result.assertions.push(message);
  }

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor(predicate, message, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = await predicate();
      if (value) return value;
      await delay(100);
    }
    throw new Error(message);
  }

  function setValue(control, value) {
    const prototype = Object.getPrototypeOf(control);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor?.set) descriptor.set.call(control, value);
    else control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function apiState() {
    return fetch(`${apiBaseUrl}/api/state`, { cache: 'no-store' }).then((response) => response.json());
  }

  async function browserState() {
    const raw = window.localStorage.getItem('accounting-system-phase-1-state');
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        return { stateError: 'Invalid browser state JSON' };
      }
    }
    return { stateError: 'Browser state is empty' };
  }

  async function state() {
    return apiState();
  }

  async function diagnostics(error) {
    const currentState = await state().catch((stateError) => ({ stateError: stateError.message }));
    const currentBrowserState = await browserState().catch((stateError) => ({ stateError: stateError.message }));
    const currentApiState = await apiState().catch((stateError) => ({ stateError: stateError.message }));
    return {
      ok: false,
      error: error?.message ?? String(error),
      url: location.href,
      h1: document.querySelector('h1')?.textContent,
      storageLabel: document.querySelector('.pill.ok')?.textContent?.trim() ?? null,
      storageTitle: document.querySelector('.pill.ok')?.getAttribute('title') ?? null,
      formError: document.querySelector('.form-error')?.textContent?.trim() ?? null,
      dialogText: document.querySelector('.confirmation-dialog')?.textContent?.trim() ?? null,
      actionButtons: Array.from(document.querySelectorAll('.table-action')).map((button) => ({
        text: button.textContent.trim(),
        disabled: button.disabled,
      })),
      documents: Array.isArray(currentState.documents)
        ? currentState.documents.map((document) => ({
            id: document.id,
            documentNumber: document.documentNumber,
            reference: document.reference,
            status: document.status,
            locked: document.locked,
          }))
        : currentState,
      browserDocuments: Array.isArray(currentBrowserState.documents)
        ? currentBrowserState.documents.map((document) => ({
            id: document.id,
            documentNumber: document.documentNumber,
            reference: document.reference,
            status: document.status,
            locked: document.locked,
          }))
        : currentBrowserState,
      apiDocuments: Array.isArray(currentApiState.documents)
        ? currentApiState.documents.map((document) => ({
            id: document.id,
            documentNumber: document.documentNumber,
            reference: document.reference,
            status: document.status,
            locked: document.locked,
          }))
        : currentApiState,
      categories: Array.isArray(currentState.categories)
        ? currentState.categories.slice(0, 8).map((category) => ({
            id: category.id,
            kind: category.kind,
            name: category.name,
            accountingCode: category.accountingCode,
          }))
        : [],
      products: Array.isArray(currentState.products)
        ? currentState.products.slice(0, 8).map((product) => ({
            id: product.id,
            code: product.code,
            name: product.name,
          }))
        : [],
      savedReportFilters: Array.isArray(currentState.savedReportFilters)
        ? currentState.savedReportFilters.map((filter) => ({
            id: filter.id,
            name: filter.name,
            settings: filter.settings,
          }))
        : [],
      debugContext,
      bodySnippet: document.body.innerText.slice(0, 2400),
    };
  }

  function clickButtonByText(text, scope = document) {
    const button = Array.from(scope.querySelectorAll('button')).find((entry) => entry.textContent.trim() === text);
    assert(button, 'button exists: ' + text);
    button.click();
    return button;
  }

  function clickNav(text) {
    const dropdown = document.querySelector('.nav-dropdown');
    if (dropdown && !dropdown.open) {
      dropdown.querySelector('summary')?.click();
    }
    const button = Array.from(document.querySelectorAll('.nav-item')).find((entry) => entry.textContent.includes(text));
    assert(button, 'nav exists: ' + text);
    button.click();
  }

  async function openCreateForm(actionText) {
    if (!document.querySelector('.form-panel')) {
      clickButtonByText(actionText);
    }
    return await waitFor(() => document.querySelector('.form-panel'), 'create form should open: ' + actionText);
  }

  function openSystemMenu() {
    const menu = document.querySelector('.system-menu');
    assert(menu, 'system menu should exist');
    if (!menu.open) {
      menu.querySelector('summary')?.click();
    }
    return menu;
  }

  function fieldByLabel(label, scope = document) {
    const field = Array.from(scope.querySelectorAll('.field')).find((entry) => entry.querySelector('span')?.textContent.trim() === label);
    assert(field, 'field exists: ' + label);
    return field;
  }

  async function setField(label, value, scope = document) {
    const control = fieldByLabel(label, scope).querySelector('input, select');
    assert(control, 'control exists: ' + label);
    setValue(control, value);
    await waitFor(() => control.value === String(value), `field value should commit: ${label}`);
    await delay(60);
    return control;
  }

  async function inlineBlock(heading) {
    await waitFor(
      () => Array.from(document.querySelectorAll('.inline-create')).some((entry) => entry.textContent.includes(heading)),
      'inline block should appear: ' + heading,
    );
    const block = Array.from(document.querySelectorAll('.inline-create')).find((entry) => entry.textContent.includes(heading));
    assert(block, 'inline block exists: ' + heading);
    return block;
  }

  function documentRow(documentNumber) {
    return Array.from(document.querySelectorAll('tbody tr')).find((row) => row.cells[0]?.textContent.trim() === documentNumber);
  }

  function documentRows(documentNumber) {
    return Array.from(document.querySelectorAll('tbody tr')).filter((row) => row.cells[0]?.textContent.trim() === documentNumber);
  }

  function documentAmount(documentRecord) {
    return documentRecord.items.reduce((sum, item) => {
      const gross = item.quantity * item.unitPrice;
      const discount = item.discountType === 'amount' ? item.discount : gross * (item.discount / 100);
      const net = Math.max(0, gross - discount);
      return sum + net + net * ((item.taxRate ?? 0) / 100);
    }, 0);
  }

  function roundedAmount(value) {
    return Math.round(value * 100) / 100;
  }

  function assertJournalBalanced(entry, label) {
    assert(entry, label + ' should exist');
    const totals = entry.lines.reduce(
      (sum, line) => ({ debit: sum.debit + line.debit, credit: sum.credit + line.credit }),
      { debit: 0, credit: 0 },
    );
    assert(Math.round(totals.debit * 100) === Math.round(totals.credit * 100), label + ' should balance');
  }

  function panelByHeading(text) {
    return Array.from(document.querySelectorAll('.panel')).find((panel) => panel.querySelector('h2')?.textContent.includes(text));
  }

  function savedFilterRow(name) {
    const panel = panelByHeading('Saved report filters');
    if (!panel) return null;
    return Array.from(panel.querySelectorAll('tbody tr')).find((row) => row.cells[0]?.textContent.trim() === name);
  }

  async function waitForLocalhostDatabase(label = 'app should use localhost database') {
    await waitFor(() => document.body.textContent.includes('Localhost database'), label, 15000);
    assert(document.body.textContent.includes('Localhost database'), label);
  }

  async function clickDocumentAction(documentNumber, text) {
    const button = await waitFor(() => {
      const row = documentRow(documentNumber);
      if (!row) return null;
      return Array.from(row.querySelectorAll('button')).find((entry) => entry.textContent.trim() === text);
    }, `document ${documentNumber} action exists: ${text}`);
    assert(button, `document ${documentNumber} action exists: ${text}`);
    button.click();
    return button;
  }

  try {
    const localeSelect = await waitFor(() => document.querySelector('.locale-control select'), 'locale selector should render');
    setValue(localeSelect, 'lo');
    await waitFor(() => document.querySelector('.app-shell')?.dataset.locale === 'lo', 'Lao locale should apply');
    const laoFontFamily = window.getComputedStyle(document.querySelector('.app-shell')).fontFamily;
    assert(laoFontFamily.includes('Noto Sans Lao'), 'Lao locale should use Noto Sans Lao font');
    assert(document.querySelector('.app-shell')?.getAttribute('lang') === 'lo', 'Lao locale should set lang attribute');
    assert(document.body.textContent.includes('\u0e97\u0eb0\u0e99\u0eb2\u0e84\u0eb2\u0e99\u0e81\u0eb2\u0e99\u0e84\u0ec9\u0eb2'), 'Lao master account name should be localized');
    assert(document.body.textContent.includes('\u0e8a\u0eb8\u0e94\u0e97\u0ebb\u0e94\u0eaa\u0ead\u0e9a\u0ec3\u0e99\u0ec0\u0e84\u0eb7\u0ec8\u0ead\u0e87'), 'Lao session label should be localized');
    assert(!document.body.textContent.includes('Local session stub'), 'Lao UI should not show English session fallback');
    setValue(localeSelect, 'th');
    await waitFor(() => document.querySelector('.app-shell')?.dataset.locale === 'th', 'Thai locale should apply');
    assert(document.body.textContent.includes('\u0e18\u0e19\u0e32\u0e04\u0e32\u0e23\u0e1e\u0e32\u0e13\u0e34\u0e0a\u0e22\u0e4c'), 'Thai master account name should be localized');
    assert(!document.body.textContent.includes('\u0e97\u0eb0\u0e99\u0eb2\u0e84\u0eb2\u0e99\u0e81\u0eb2\u0e99\u0e84\u0ec9\u0eb2'), 'Thai UI should not show Lao master account fallback');
    assert(!document.body.textContent.includes('\u0e81\u0eb5\u0e9a'), 'Thai locale should not show Lao kip money label');
    assert(document.body.textContent.includes('\u0e01\u0e35\u0e1a'), 'Thai locale should show Thai kip money label');
    assert(document.body.textContent.includes('\u0e0a\u0e38\u0e14\u0e17\u0e14\u0e2a\u0e2d\u0e1a\u0e43\u0e19\u0e40\u0e04\u0e23\u0e37\u0e48\u0e2d\u0e07'), 'Thai session label should be localized');
    assert(!document.body.textContent.includes('Local session stub'), 'Thai UI should not show English session fallback');
    setValue(localeSelect, 'en');
    await waitFor(() => document.body.textContent.includes('Invoices'), 'English locale should apply');
    assert(document.body.textContent.includes('Commercial bank'), 'English master account name should be localized');
    assert(!document.body.textContent.includes('\u0e97\u0eb0\u0e99\u0eb2\u0e84\u0eb2\u0e99\u0e81\u0eb2\u0e99\u0e84\u0ec9\u0eb2'), 'English UI should not show Lao master account fallback');
    const themeToggle = await waitFor(() => document.querySelector('.theme-toggle'), 'theme toggle should render');
    if (document.documentElement.dataset.theme !== 'dark') {
      themeToggle.click();
    }
    await waitFor(() => document.documentElement.dataset.theme === 'dark', 'dark mode should apply');
    assert(window.localStorage.getItem('accounting-system-theme') === 'dark', 'dark mode preference should persist');
    assert(window.getComputedStyle(document.body).backgroundColor !== 'rgb(245, 247, 244)', 'dark mode should change page background');
    themeToggle.click();
    await waitFor(() => document.documentElement.dataset.theme === 'light', 'light mode should restore');
    assert(window.localStorage.getItem('accounting-system-theme') === 'light', 'light mode preference should persist');
    await waitForLocalhostDatabase('storage mode should be localhost database before reset');
    const systemMenu = openSystemMenu();
    const resetButton = systemMenu.querySelector('[title="Reset demo"]');
    assert(resetButton, 'reset button should exist');
    await waitFor(async () => {
      const nextApiState = await apiState();
      const nextBrowserState = await browserState();
      return nextApiState.documents.length === 0 &&
        nextApiState.cashTransactions.length === 0 &&
        nextApiState.journalEntries.length === 0 &&
        nextApiState.products.length === 2 &&
        nextApiState.categories.length === 5 &&
        nextBrowserState.documents.length === 0 &&
        nextBrowserState.cashTransactions.length === 0 &&
        nextBrowserState.journalEntries.length === 0 &&
        nextBrowserState.products.length === 2 &&
        nextBrowserState.categories.length === 5;
    }, 'initial browser and API state should synchronize seed state');
    await waitForLocalhostDatabase('storage mode should remain localhost database after seed sync');
    await delay(250);

    clickNav('Invoices');
    await waitFor(() => document.querySelector('h1')?.textContent.includes('Invoices'), 'invoice module should open');
    await openCreateForm('Create invoice');

    const categoryBlock = await inlineBlock('New category');
    await setField('Name', categoryName, categoryBlock);
    await setField('Accounting code', categoryCode, categoryBlock);
    const conflictMutation = await fetch(`${apiBaseUrl}/api/actions/customer.create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Codex-State-Write-Source': 'ui-smoke-browser',
        'X-Codex-Run-Id': '__RUN_ID__',
        'X-Codex-Session-Id': '__SESSION_ID__',
        'X-Codex-State-Write-Reason': 'phase-8b-conflict-setup',
      },
      body: JSON.stringify({
        actor: { actorType: 'user', roleKey: 'owner' },
        payload: { name: 'CODEX_UI_CONFLICT_CUSTOMER_' + Date.now(), currency: 'LAK' },
      }),
    });
    assert(conflictMutation.ok, 'external state mutation should set up a stale UI revision');
    clickButtonByText('Create and use', categoryBlock);
    await waitFor(
      () => document.body.textContent.includes('Local data changed in another session'),
      'UI should show revision conflict message',
      15000,
    );
    assert(document.body.textContent.includes('Local data changed in another session'), 'UI should show revision conflict message');
    clickButtonByText('Refresh latest state');
    await waitFor(() => !document.querySelector('.auth-banner'), 'refresh latest should clear the global conflict banner');
    await waitForLocalhostDatabase('storage mode should remain localhost database after conflict refresh');
    clickButtonByText('Create and use', categoryBlock);
    await waitForLocalhostDatabase('storage mode should remain localhost database after category create');
    await waitFor(
      async () => (await state()).categories.some((entry) => entry.accountingCode === categoryCode && entry.name === categoryName),
      'inline category should persist',
      15000,
    );
    const categorySelect = fieldByLabel('Category').querySelector('select');
    await waitFor(() => categorySelect.selectedOptions[0]?.textContent.includes(categoryName), 'created category should be selected');
    assert(categorySelect.selectedOptions[0]?.textContent.includes(categoryName), 'created category should be selected');

    const productBlock = await inlineBlock('New product/service');
    await setField('Code', productCode, productBlock);
    await setField('Name', productName, productBlock);
    await setField('Unit', 'hour', productBlock);
    await setField('Price', '222', productBlock);
    await setField('Tax', 'tax-none', productBlock);
    clickButtonByText('Create and use', productBlock);
    await waitForLocalhostDatabase('storage mode should remain localhost database after product create');
    await waitFor(
      async () => (await state()).products.some((entry) => entry.code === productCode && entry.name === productName),
      'inline product should persist',
      15000,
    );
    await waitFor(() => Array.from(document.querySelectorAll('.line-item-editor select')).some((entry) => entry.selectedOptions[0]?.textContent.includes(productName)), 'created product should be selected');

    clickButtonByText('Save', document.querySelector('.form-panel'));
    await waitForLocalhostDatabase('storage mode should remain localhost database after document create');
    const createdDocument = await waitFor(async () => {
      const nextState = await state();
      return nextState.documents.find((entry) => entry.reference === 'CODEX_TEST_INVOICE_PHASE1');
    }, 'invoice should be created', 15000);
    assert(createdDocument.status === 'quotation', 'invoice flow should start as quotation');
    await waitFor(() => documentRow(createdDocument.documentNumber), `created document row should render: ${createdDocument.documentNumber}`);
    const attachmentFileName = 'CODEX_UI_REAL_ATTACHMENT.txt';
    const createdDocumentRow = documentRow(createdDocument.documentNumber);
    const attachmentInput = createdDocumentRow.querySelector('.attachment-manager input[type="file"]');
    assert(attachmentInput, 'document attachment upload input should render');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['CODEX_UI real attachment body'], attachmentFileName, { type: 'text/plain' }));
    attachmentInput.files = transfer.files;
    attachmentInput.dispatchEvent(new Event('change', { bubbles: true }));
    await waitForLocalhostDatabase('storage mode should remain localhost database after attachment upload');
    const uploadedAttachment = await waitFor(async () => {
      const nextState = await state();
      return nextState.attachments.find((entry) => entry.ownerId === createdDocument.id && entry.name === attachmentFileName);
    }, 'UI attachment upload should persist metadata', 15000);
    assert(uploadedAttachment.mimeType === 'text/plain', 'UI attachment upload should persist content type');
    await waitFor(() => documentRow(createdDocument.documentNumber)?.textContent.includes(attachmentFileName), 'uploaded attachment should appear in document row');
    assert(!documentRow(createdDocument.documentNumber)?.textContent.includes('storagePath'), 'attachment UI should not expose storagePath');
    const downloadButton = documentRow(createdDocument.documentNumber).querySelector(`button[title="Download file"]`);
    assert(downloadButton, 'attachment download button should render');
    const deleteAttachmentButton = documentRow(createdDocument.documentNumber).querySelector(`button[title="Delete file"]`);
    assert(deleteAttachmentButton, 'attachment delete button should render');
    deleteAttachmentButton.click();
    await waitForLocalhostDatabase('storage mode should remain localhost database after attachment delete');
    await waitFor(async () => {
      const nextState = await state();
      const nextDocument = nextState.documents.find((entry) => entry.id === createdDocument.id);
      return !nextState.attachments.some((entry) => entry.id === uploadedAttachment.id) && !nextDocument.attachmentIds.includes(uploadedAttachment.id);
    }, 'UI attachment delete should remove metadata and detach document', 15000);
    await waitFor(() => !documentRow(createdDocument.documentNumber)?.textContent.includes(attachmentFileName), 'deleted attachment should disappear from document row');

    await clickDocumentAction(createdDocument.documentNumber, 'invoice');
    await waitForLocalhostDatabase('storage mode should remain localhost database after invoice status update');
    await waitFor(async () => {
      const nextDocument = (await state()).documents.find((entry) => entry.id === createdDocument.id);
      return nextDocument?.status === 'invoice';
    }, 'quotation should move to invoice');

    await clickDocumentAction(createdDocument.documentNumber, 'receipt');
    await waitFor(() => document.body.textContent.includes('Confirm settlement'), 'settlement dialog should open');
    const settlementSelect = fieldByLabel('Settlement account').querySelector('select');
    const settlementOptions = Array.from(settlementSelect.options).map((option) => option.textContent);
    assert(settlementOptions.length > 0, 'settlement account options should exist');
    assert(settlementOptions.every((label) => label.includes('(LAK)')), 'settlement options should only show LAK accounts');
    const settlementAmountInput = fieldByLabel('Settlement amount').querySelector('input');
    assert(Number(settlementAmountInput.value) > 0, 'settlement amount should default to remaining balance');
    const bankFeeAmountInput = fieldByLabel('Bank fee amount').querySelector('input');
    assert(Number(bankFeeAmountInput.value) === 0, 'bank fee amount should default to zero');
    const bankFeeAccountSelect = fieldByLabel('Bank fee account').querySelector('select');
    assert(Array.from(bankFeeAccountSelect.options).some((option) => option.textContent.includes('Bank fees (LAK)')), 'bank fee account should offer LAK expense account');
    assert(bankFeeAccountSelect.selectedOptions[0]?.textContent.includes('Bank fees (LAK)'), 'bank fee account should default to Bank fees');
    const withholdingTaxAmountInput = fieldByLabel('Withholding tax amount').querySelector('input');
    assert(Number(withholdingTaxAmountInput.value) === 0, 'withholding tax amount should default to zero');
    const withholdingTaxAccountSelect = fieldByLabel('Withholding tax account').querySelector('select');
    assert(
      Array.from(withholdingTaxAccountSelect.options).some((option) => option.textContent.includes('Withholding tax receivable (LAK)')),
      'sales withholding tax account should offer LAK asset account',
    );
    clickButtonByText('Cancel', document.querySelector('.confirmation-dialog'));
    await waitFor(() => !document.body.textContent.includes('Confirm settlement'), 'settlement dialog should close');

    const documentCountBeforeAdjustedSettlement = (await state()).documents.length;
    clickButtonByText('Save', document.querySelector('.form-panel'));
    await waitForLocalhostDatabase('storage mode should remain localhost database after adjusted document create');
    const adjustedSettlementDocument = await waitFor(async () => {
      const nextState = await state();
      return nextState.documents.find(
        (entry) =>
          entry.id !== createdDocument.id &&
          entry.status === 'quotation' &&
          entry.locked === false &&
          nextState.documents.length > documentCountBeforeAdjustedSettlement,
      );
    }, 'adjusted settlement document should be created', 15000);
    await waitFor(() => documentRow(adjustedSettlementDocument.documentNumber), `adjusted settlement row should render: ${adjustedSettlementDocument.documentNumber}`);
    await clickDocumentAction(adjustedSettlementDocument.documentNumber, 'invoice');
    await waitForLocalhostDatabase('storage mode should remain localhost database after adjusted invoice status update');
    await waitFor(async () => {
      const nextDocument = (await state()).documents.find((entry) => entry.id === adjustedSettlementDocument.id);
      return nextDocument?.status === 'invoice';
    }, 'adjusted settlement document should move to invoice');
    await clickDocumentAction(adjustedSettlementDocument.documentNumber, 'receipt');
    const adjustedDialog = await waitFor(() => document.querySelector('.confirmation-dialog'), 'adjusted settlement dialog should open');
    const adjustedBankFeeAccountSelect = fieldByLabel('Bank fee account', adjustedDialog).querySelector('select');
    assert(
      adjustedBankFeeAccountSelect.selectedOptions[0]?.textContent.includes('Bank fees (LAK)'),
      'adjusted settlement bank fee account should default to Bank fees',
    );
    await setField('Bank fee amount', '10', adjustedDialog);
    await setField('Withholding tax amount', '50', adjustedDialog);
    clickButtonByText('Confirm settlement', adjustedDialog);
    await waitForLocalhostDatabase('storage mode should remain localhost database after adjusted settlement');
    const adjustedApiState = await waitFor(async () => {
      const nextApiState = await apiState();
      const nextDocument = nextApiState.documents.find((entry) => entry.id === adjustedSettlementDocument.id);
      const nextJournal = nextApiState.journalEntries.find((entry) => entry.sourceType === 'sales' && entry.sourceId === adjustedSettlementDocument.id);
      return nextDocument?.status === 'receipt' && nextJournal ? nextApiState : null;
    }, 'adjusted settlement should post receipt journal through UI', 15000);
    const adjustedJournal = adjustedApiState.journalEntries.find((entry) => entry.sourceType === 'sales' && entry.sourceId === adjustedSettlementDocument.id);
    assert(
      adjustedJournal.lines.some((line) => line.accountId === 'acc-bank-fee-expense' && line.debit === 10 && line.credit === 0),
      'UI adjusted settlement should post bank fee to Bank fees account',
    );
    assert(
      adjustedJournal.lines.some((line) => line.accountId === 'acc-wht-receivable' && line.debit === 50 && line.credit === 0),
      'UI adjusted settlement should post withholding tax receivable',
    );

    const salesFxReference = 'CODEX_UI_FX_SALES_' + String(Date.now()).slice(-6);
    const customerBlock = await inlineBlock('New customer');
    await setField('Name', 'CODEX_UI FX Customer', customerBlock);
    await setField('Currency', 'USD', customerBlock);
    clickButtonByText('Create', customerBlock);
    await waitForLocalhostDatabase('storage mode should remain localhost database after FX customer create');
    await waitFor(() => fieldByLabel('Contact').querySelector('select').selectedOptions[0]?.textContent.includes('CODEX_UI FX Customer'), 'FX customer should be selected');
    assert(fieldByLabel('Currency').querySelector('select').value === 'USD', 'sales document currency selector should default to selected customer currency');
    await setField('Reference', salesFxReference);
    await setField('Title', 'CODEX_UI FX sales settlement');
    await setField('Exchange rate', '22000');
    clickButtonByText('Save', document.querySelector('.form-panel'));
    await waitForLocalhostDatabase('storage mode should remain localhost database after FX sales document create');
    const salesFxDocument = await waitFor(async () => {
      const nextState = await state();
      return nextState.documents.find((entry) => entry.reference === salesFxReference);
    }, 'FX sales document should be created', 15000);
    assert(salesFxDocument.currency === 'USD', 'FX sales document should persist selected document currency');
    await waitFor(() => documentRow(salesFxDocument.documentNumber), `FX sales row should render: ${salesFxDocument.documentNumber}`);
    await clickDocumentAction(salesFxDocument.documentNumber, 'invoice');
    await waitFor(async () => {
      const nextDocument = (await state()).documents.find((entry) => entry.id === salesFxDocument.id);
      return nextDocument?.status === 'invoice';
    }, 'FX sales document should move to invoice');
    await clickDocumentAction(salesFxDocument.documentNumber, 'receipt');
    const salesFxDialog = await waitFor(() => document.querySelector('.confirmation-dialog'), 'FX sales settlement dialog should open');
    const salesFxSettlementSelect = fieldByLabel('Settlement account', salesFxDialog).querySelector('select');
    const salesFxSettlementOptions = Array.from(salesFxSettlementSelect.options).map((option) => option.textContent);
    assert(salesFxSettlementOptions.some((label) => label.includes('(USD)')), 'FX sales settlement should offer same-currency USD account');
    assert(salesFxSettlementOptions.some((label) => label.includes('(LAK)')), 'FX sales settlement should offer base-currency LAK account');
    assert(!salesFxSettlementOptions.some((label) => label.includes('(THB)')), 'FX sales settlement should not offer unsupported THB account');
    await setField('Settlement account', 'acc-bank-lak', salesFxDialog);
    await waitFor(() => fieldByLabel('Settlement exchange rate', salesFxDialog), 'FX sales exchange rate field should appear');
    assert(salesFxDialog.textContent.includes('Net cash'), 'FX sales dialog should show net cash preview');
    assert(fieldByLabel('Bank fee amount', salesFxDialog).querySelector('input').disabled === false, 'FX sales bank fee amount should be enabled');
    assert(fieldByLabel('Bank fee account', salesFxDialog).querySelector('select').selectedOptions[0]?.textContent.includes('Bank fees (LAK)'), 'FX sales bank fee account should use base-currency Bank fees');
    assert(fieldByLabel('Withholding tax amount', salesFxDialog).querySelector('input').disabled === false, 'FX sales withholding amount should be enabled');
    assert(fieldByLabel('Withholding tax account', salesFxDialog).querySelector('select').selectedOptions[0]?.textContent.includes('Withholding tax receivable (LAK)'), 'FX sales withholding account should use base-currency receivable');
    clickButtonByText('Confirm settlement', salesFxDialog);
    await waitFor(() => salesFxDialog.textContent.includes('exchange rate'), 'FX sales missing exchange rate should show dialog validation');
    const salesFxTotal = documentAmount(salesFxDocument);
    const salesFxPartialAmount = roundedAmount(salesFxTotal / 2);
    const salesFxRemainingAmount = roundedAmount(salesFxTotal - salesFxPartialAmount);
    const salesFxPartialBankFee = 2;
    const salesFxPartialWithholding = 3;
    const salesFxFinalBankFee = 1;
    const salesFxFinalWithholding = 2;
    await setField('Settlement exchange rate', '23000', salesFxDialog);
    await setField('Bank fee amount', '-1', salesFxDialog);
    clickButtonByText('Confirm settlement', salesFxDialog);
    await waitFor(() => salesFxDialog.textContent.includes('negative'), 'FX sales negative fee should show dialog validation');
    await setField('Bank fee amount', '0', salesFxDialog);
    await setField('Settlement amount', String(roundedAmount(salesFxTotal + 1)), salesFxDialog);
    clickButtonByText('Confirm settlement', salesFxDialog);
    await waitFor(() => salesFxDialog.textContent.includes('remaining balance'), 'FX sales overpayment should show dialog validation');
    await setField('Settlement amount', String(salesFxPartialAmount), salesFxDialog);
    await setField('Bank fee amount', String(roundedAmount(salesFxPartialAmount + 1)), salesFxDialog);
    clickButtonByText('Confirm settlement', salesFxDialog);
    await waitFor(() => salesFxDialog.textContent.includes('Bank fee'), 'FX sales excessive bank fee should show dialog validation');
    await setField('Bank fee amount', String(salesFxPartialAmount), salesFxDialog);
    await setField('Withholding tax amount', '0', salesFxDialog);
    clickButtonByText('Confirm settlement', salesFxDialog);
    await waitFor(() => salesFxDialog.textContent.includes('Net cash'), 'FX sales net cash invalid should show dialog validation');
    await setField('Bank fee amount', String(salesFxPartialBankFee), salesFxDialog);
    await setField('Withholding tax amount', String(salesFxPartialWithholding), salesFxDialog);
    clickButtonByText('Confirm settlement', salesFxDialog);
    const salesFxPartialApiState = await waitFor(async () => {
      const nextApiState = await apiState();
      const nextDocument = nextApiState.documents.find((entry) => entry.id === salesFxDocument.id);
      const nextJournal = nextApiState.journalEntries.find((entry) => entry.sourceType === 'sales' && entry.sourceId === salesFxDocument.id);
      return nextDocument?.status === 'invoice' && nextJournal ? nextApiState : null;
    }, 'FX sales partial receipt should post through UI', 15000);
    const salesFxPartialDocument = salesFxPartialApiState.documents.find((entry) => entry.id === salesFxDocument.id);
    const salesFxPartialJournal = salesFxPartialApiState.journalEntries.find((entry) => entry.sourceType === 'sales' && entry.sourceId === salesFxDocument.id);
    assert(roundedAmount(documentAmount(salesFxPartialDocument) - salesFxPartialAmount) === salesFxRemainingAmount, 'FX sales partial should leave expected document-currency balance');
    assertJournalBalanced(salesFxPartialJournal, 'FX sales partial journal');
    assert(
      salesFxPartialJournal.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === roundedAmount((salesFxPartialAmount - salesFxPartialBankFee - salesFxPartialWithholding) * 23000) && line.credit === 0),
      'FX sales partial UI should debit net LAK bank cash',
    );
    assert(
      salesFxPartialJournal.lines.some((line) => line.accountId === 'acc-bank-fee-expense' && line.debit === roundedAmount(salesFxPartialBankFee * 23000) && line.credit === 0),
      'FX sales partial UI should debit bank fee at settlement rate',
    );
    assert(
      salesFxPartialJournal.lines.some((line) => line.accountId === 'acc-wht-receivable' && line.debit === roundedAmount(salesFxPartialWithholding * 23000) && line.credit === 0),
      'FX sales partial UI should debit withholding receivable at settlement rate',
    );
    assert(
      salesFxPartialJournal.lines.some((line) => line.accountId === 'acc-exchange-gain' && line.debit === 0 && line.credit === roundedAmount(salesFxPartialAmount * 1000)),
      'FX sales partial UI should credit exchange gain',
    );
    const salesFxPartialRow = documentRow(salesFxDocument.documentNumber);
    assert(salesFxPartialRow?.textContent.includes('invoice'), 'FX sales partial should keep row status as invoice');
    await clickDocumentAction(salesFxDocument.documentNumber, 'receipt');
    const salesFxFinalDialog = await waitFor(() => document.querySelector('.confirmation-dialog'), 'FX sales final remaining dialog should open');
    assert(salesFxFinalDialog.textContent.includes('Remaining balance'), 'FX sales final dialog should show remaining balance');
    assert(salesFxFinalDialog.textContent.includes(salesFxRemainingAmount.toFixed(2)), 'FX sales final dialog should show remaining in document currency');
    const salesFxFinalAmountInput = fieldByLabel('Settlement amount', salesFxFinalDialog).querySelector('input');
    assert(Number(salesFxFinalAmountInput.value) === salesFxRemainingAmount, 'FX sales final settlement amount should default to remaining balance');
    await setField('Settlement account', 'acc-bank-lak', salesFxFinalDialog);
    await setField('Settlement exchange rate', '21000', salesFxFinalDialog);
    await setField('Bank fee amount', String(salesFxFinalBankFee), salesFxFinalDialog);
    await setField('Withholding tax amount', String(salesFxFinalWithholding), salesFxFinalDialog);
    clickButtonByText('Confirm settlement', salesFxFinalDialog);
    const salesFxFinalApiState = await waitFor(async () => {
      const nextApiState = await apiState();
      const nextDocument = nextApiState.documents.find((entry) => entry.id === salesFxDocument.id);
      const nextJournals = nextApiState.journalEntries.filter((entry) => entry.sourceType === 'sales' && entry.sourceId === salesFxDocument.id);
      return nextDocument?.status === 'receipt' && nextJournals.length === 2 ? nextApiState : null;
    }, 'FX sales final remaining receipt should post through UI', 15000);
    const salesFxFinalJournal = salesFxFinalApiState.journalEntries.find(
      (entry) => entry.sourceType === 'sales' && entry.sourceId === salesFxDocument.id && entry.id !== salesFxPartialJournal.id,
    );
    assertJournalBalanced(salesFxFinalJournal, 'FX sales final remaining journal');
    assert(
      salesFxFinalJournal.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === roundedAmount((salesFxRemainingAmount - salesFxFinalBankFee - salesFxFinalWithholding) * 21000) && line.credit === 0),
      'FX sales final UI should debit net LAK bank cash',
    );
    assert(
      salesFxFinalJournal.lines.some((line) => line.accountId === 'acc-bank-fee-expense' && line.debit === roundedAmount(salesFxFinalBankFee * 21000) && line.credit === 0),
      'FX sales final UI should debit bank fee at settlement rate',
    );
    assert(
      salesFxFinalJournal.lines.some((line) => line.accountId === 'acc-wht-receivable' && line.debit === roundedAmount(salesFxFinalWithholding * 21000) && line.credit === 0),
      'FX sales final UI should debit withholding receivable at settlement rate',
    );
    assert(
      salesFxFinalJournal.lines.some((line) => line.accountId === 'acc-exchange-loss' && line.debit === roundedAmount(salesFxRemainingAmount * 1000) && line.credit === 0),
      'FX sales final UI should debit exchange loss',
    );

    clickNav('Bills');
    await waitFor(() => document.querySelector('h1')?.textContent.includes('Bills'), 'bill module should open for FX purchase');
    await openCreateForm('Create bill');
    const purchasePartialReference = 'CODEX_UI_PURCHASE_PARTIAL_' + String(Date.now()).slice(-6);
    await setField('Reference', purchasePartialReference);
    await setField('Title', 'CODEX_UI same-currency purchase partial');
    await setField('Exchange rate', '1');
    clickButtonByText('Save', document.querySelector('.form-panel'));
    await waitForLocalhostDatabase('storage mode should remain localhost database after same-currency purchase document create');
    const purchasePartialDocument = await waitFor(async () => {
      const nextState = await state();
      return nextState.documents.find((entry) => entry.reference === purchasePartialReference);
    }, 'same-currency purchase partial document should be created', 15000);
    await clickDocumentAction(purchasePartialDocument.documentNumber, 'bill');
    await waitFor(async () => {
      const nextDocument = (await state()).documents.find((entry) => entry.id === purchasePartialDocument.id);
      return nextDocument?.status === 'bill';
    }, 'same-currency purchase document should move to bill');
    await clickDocumentAction(purchasePartialDocument.documentNumber, 'paid');
    const purchasePartialDialog = await waitFor(() => document.querySelector('.confirmation-dialog'), 'same-currency purchase partial dialog should open');
    const purchasePartialAmount = roundedAmount(documentAmount(purchasePartialDocument) / 2);
    await setField('Settlement amount', String(purchasePartialAmount), purchasePartialDialog);
    clickButtonByText('Confirm settlement', purchasePartialDialog);
    const purchasePartialApiState = await waitFor(async () => {
      const nextApiState = await apiState();
      const nextDocument = nextApiState.documents.find((entry) => entry.id === purchasePartialDocument.id);
      const nextJournal = nextApiState.journalEntries.find((entry) => entry.sourceType === 'purchase' && entry.sourceId === purchasePartialDocument.id);
      return nextDocument?.status === 'bill' && nextJournal ? nextApiState : null;
    }, 'same-currency purchase partial payment should post through UI', 15000);
    const purchasePartialJournal = purchasePartialApiState.journalEntries.find((entry) => entry.sourceType === 'purchase' && entry.sourceId === purchasePartialDocument.id);
    assertJournalBalanced(purchasePartialJournal, 'same-currency purchase partial journal');
    assert(
      purchasePartialJournal.lines.some((line) => line.accountId === 'acc-expense-admin' && line.debit === purchasePartialAmount && line.credit === 0),
      'same-currency purchase partial UI should debit expense for partial amount',
    );
    assert(
      purchasePartialJournal.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 0 && line.credit === purchasePartialAmount),
      'same-currency purchase partial UI should credit LAK bank for partial amount',
    );

    const purchaseFxReference = 'CODEX_UI_FX_PURCHASE_' + String(Date.now()).slice(-6);
    const vendorBlock = await inlineBlock('New vendor');
    await setField('Name', 'CODEX_UI FX Vendor', vendorBlock);
    await setField('Currency', 'USD', vendorBlock);
    clickButtonByText('Create', vendorBlock);
    await waitForLocalhostDatabase('storage mode should remain localhost database after FX vendor create');
    await waitFor(() => fieldByLabel('Contact').querySelector('select').selectedOptions[0]?.textContent.includes('CODEX_UI FX Vendor'), 'FX vendor should be selected');
    assert(fieldByLabel('Currency').querySelector('select').value === 'USD', 'purchase document currency selector should default to selected vendor currency');
    await setField('Reference', purchaseFxReference);
    await setField('Title', 'CODEX_UI FX purchase settlement');
    await setField('Exchange rate', '22000');
    clickButtonByText('Save', document.querySelector('.form-panel'));
    await waitForLocalhostDatabase('storage mode should remain localhost database after FX purchase document create');
    const purchaseFxDocument = await waitFor(async () => {
      const nextState = await state();
      return nextState.documents.find((entry) => entry.reference === purchaseFxReference);
    }, 'FX purchase document should be created', 15000);
    assert(purchaseFxDocument.currency === 'USD', 'FX purchase document should persist selected document currency');
    await waitFor(() => documentRow(purchaseFxDocument.documentNumber), `FX purchase row should render: ${purchaseFxDocument.documentNumber}`);
    await clickDocumentAction(purchaseFxDocument.documentNumber, 'bill');
    await waitFor(async () => {
      const nextDocument = (await state()).documents.find((entry) => entry.id === purchaseFxDocument.id);
      return nextDocument?.status === 'bill';
    }, 'FX purchase document should move to bill');
    await clickDocumentAction(purchaseFxDocument.documentNumber, 'paid');
    const purchaseFxDialog = await waitFor(() => document.querySelector('.confirmation-dialog'), 'FX purchase settlement dialog should open');
    const purchaseFxSettlementSelect = fieldByLabel('Settlement account', purchaseFxDialog).querySelector('select');
    const purchaseFxSettlementOptions = Array.from(purchaseFxSettlementSelect.options).map((option) => option.textContent);
    assert(purchaseFxSettlementOptions.some((label) => label.includes('(USD)')), 'FX purchase settlement should offer same-currency USD account');
    assert(purchaseFxSettlementOptions.some((label) => label.includes('(LAK)')), 'FX purchase settlement should offer base-currency LAK account');
    assert(!purchaseFxSettlementOptions.some((label) => label.includes('(THB)')), 'FX purchase settlement should not offer unsupported THB account');
    await setField('Settlement account', 'acc-bank-lak', purchaseFxDialog);
    await waitFor(() => fieldByLabel('Settlement exchange rate', purchaseFxDialog), 'FX purchase exchange rate field should appear');
    assert(purchaseFxDialog.textContent.includes('Net cash'), 'FX purchase dialog should show net cash preview');
    assert(fieldByLabel('Bank fee amount', purchaseFxDialog).querySelector('input').disabled === false, 'FX purchase bank fee amount should be enabled');
    assert(fieldByLabel('Bank fee account', purchaseFxDialog).querySelector('select').selectedOptions[0]?.textContent.includes('Bank fees (LAK)'), 'FX purchase bank fee account should use base-currency Bank fees');
    assert(fieldByLabel('Withholding tax amount', purchaseFxDialog).querySelector('input').disabled === false, 'FX purchase withholding amount should be enabled');
    assert(fieldByLabel('Withholding tax account', purchaseFxDialog).querySelector('select').selectedOptions[0]?.textContent.includes('Withholding tax payable (LAK)'), 'FX purchase withholding account should use base-currency payable');
    clickButtonByText('Confirm settlement', purchaseFxDialog);
    await waitFor(() => purchaseFxDialog.textContent.includes('exchange rate'), 'FX purchase missing exchange rate should show dialog validation');
    const purchaseFxTotal = documentAmount(purchaseFxDocument);
    const purchaseFxPartialAmount = roundedAmount(purchaseFxTotal / 2);
    const purchaseFxRemainingAmount = roundedAmount(purchaseFxTotal - purchaseFxPartialAmount);
    const purchaseFxPartialBankFee = 2;
    const purchaseFxPartialWithholding = 3;
    const purchaseFxFinalBankFee = 1;
    const purchaseFxFinalWithholding = 2;
    await setField('Settlement exchange rate', '23000', purchaseFxDialog);
    await setField('Settlement amount', String(roundedAmount(purchaseFxTotal + 1)), purchaseFxDialog);
    clickButtonByText('Confirm settlement', purchaseFxDialog);
    await waitFor(() => purchaseFxDialog.textContent.includes('remaining balance'), 'FX purchase overpayment should show dialog validation');
    await setField('Settlement amount', String(purchaseFxPartialAmount), purchaseFxDialog);
    await setField('Withholding tax amount', String(roundedAmount(purchaseFxPartialAmount + 1)), purchaseFxDialog);
    clickButtonByText('Confirm settlement', purchaseFxDialog);
    await waitFor(() => purchaseFxDialog.textContent.includes('Withholding tax'), 'FX purchase excessive withholding should show dialog validation');
    await setField('Withholding tax amount', String(purchaseFxPartialAmount), purchaseFxDialog);
    await setField('Bank fee amount', '0', purchaseFxDialog);
    clickButtonByText('Confirm settlement', purchaseFxDialog);
    await waitFor(() => purchaseFxDialog.textContent.includes('Net cash'), 'FX purchase net cash invalid should show dialog validation');
    await setField('Bank fee amount', String(purchaseFxPartialBankFee), purchaseFxDialog);
    await setField('Withholding tax amount', String(purchaseFxPartialWithholding), purchaseFxDialog);
    clickButtonByText('Confirm settlement', purchaseFxDialog);
    const purchaseFxPartialApiState = await waitFor(async () => {
      const nextApiState = await apiState();
      const nextDocument = nextApiState.documents.find((entry) => entry.id === purchaseFxDocument.id);
      const nextJournal = nextApiState.journalEntries.find((entry) => entry.sourceType === 'purchase' && entry.sourceId === purchaseFxDocument.id);
      return nextDocument?.status === 'bill' && nextJournal ? nextApiState : null;
    }, 'FX purchase partial payment should post through UI', 15000);
    const purchaseFxPartialDocument = purchaseFxPartialApiState.documents.find((entry) => entry.id === purchaseFxDocument.id);
    const purchaseFxPartialJournal = purchaseFxPartialApiState.journalEntries.find((entry) => entry.sourceType === 'purchase' && entry.sourceId === purchaseFxDocument.id);
    assert(roundedAmount(documentAmount(purchaseFxPartialDocument) - purchaseFxPartialAmount) === purchaseFxRemainingAmount, 'FX purchase partial should leave expected document-currency balance');
    assertJournalBalanced(purchaseFxPartialJournal, 'FX purchase partial journal');
    assert(
      purchaseFxPartialJournal.lines.some((line) => line.accountId === 'acc-expense-admin' && line.debit === roundedAmount(purchaseFxPartialAmount * 22000) && line.credit === 0),
      'FX purchase partial UI should debit expense at document rate',
    );
    assert(
      purchaseFxPartialJournal.lines.some((line) => line.accountId === 'acc-bank-fee-expense' && line.debit === roundedAmount(purchaseFxPartialBankFee * 23000) && line.credit === 0),
      'FX purchase partial UI should debit bank fee at settlement rate',
    );
    assert(
      purchaseFxPartialJournal.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 0 && line.credit === roundedAmount((purchaseFxPartialAmount - purchaseFxPartialWithholding + purchaseFxPartialBankFee) * 23000)),
      'FX purchase partial UI should credit net LAK bank cash',
    );
    assert(
      purchaseFxPartialJournal.lines.some((line) => line.accountId === 'acc-wht-payable' && line.debit === 0 && line.credit === roundedAmount(purchaseFxPartialWithholding * 23000)),
      'FX purchase partial UI should credit withholding payable at settlement rate',
    );
    assert(
      purchaseFxPartialJournal.lines.some((line) => line.accountId === 'acc-exchange-loss' && line.debit === roundedAmount(purchaseFxPartialAmount * 1000) && line.credit === 0),
      'FX purchase partial UI should debit exchange loss',
    );
    const purchaseFxPartialRow = documentRow(purchaseFxDocument.documentNumber);
    assert(purchaseFxPartialRow?.textContent.includes('bill'), 'FX purchase partial should keep row status as bill');
    await clickDocumentAction(purchaseFxDocument.documentNumber, 'paid');
    const purchaseFxFinalDialog = await waitFor(() => document.querySelector('.confirmation-dialog'), 'FX purchase final remaining dialog should open');
    assert(purchaseFxFinalDialog.textContent.includes('Remaining balance'), 'FX purchase final dialog should show remaining balance');
    assert(purchaseFxFinalDialog.textContent.includes(purchaseFxRemainingAmount.toFixed(2)), 'FX purchase final dialog should show remaining in document currency');
    const purchaseFxFinalAmountInput = fieldByLabel('Settlement amount', purchaseFxFinalDialog).querySelector('input');
    assert(Number(purchaseFxFinalAmountInput.value) === purchaseFxRemainingAmount, 'FX purchase final settlement amount should default to remaining balance');
    await setField('Settlement account', 'acc-bank-lak', purchaseFxFinalDialog);
    await setField('Settlement exchange rate', '21000', purchaseFxFinalDialog);
    await setField('Bank fee amount', String(purchaseFxFinalBankFee), purchaseFxFinalDialog);
    await setField('Withholding tax amount', String(purchaseFxFinalWithholding), purchaseFxFinalDialog);
    clickButtonByText('Confirm settlement', purchaseFxFinalDialog);
    const purchaseFxFinalApiState = await waitFor(async () => {
      const nextApiState = await apiState();
      const nextDocument = nextApiState.documents.find((entry) => entry.id === purchaseFxDocument.id);
      const nextJournals = nextApiState.journalEntries.filter((entry) => entry.sourceType === 'purchase' && entry.sourceId === purchaseFxDocument.id);
      return nextDocument?.status === 'paid' && nextJournals.length === 2 ? nextApiState : null;
    }, 'FX purchase final remaining payment should post through UI', 15000);
    const purchaseFxFinalJournal = purchaseFxFinalApiState.journalEntries.find(
      (entry) => entry.sourceType === 'purchase' && entry.sourceId === purchaseFxDocument.id && entry.id !== purchaseFxPartialJournal.id,
    );
    assertJournalBalanced(purchaseFxFinalJournal, 'FX purchase final remaining journal');
    assert(
      purchaseFxFinalJournal.lines.some((line) => line.accountId === 'acc-expense-admin' && line.debit === roundedAmount(purchaseFxRemainingAmount * 22000) && line.credit === 0),
      'FX purchase final UI should debit expense at document rate',
    );
    assert(
      purchaseFxFinalJournal.lines.some((line) => line.accountId === 'acc-bank-fee-expense' && line.debit === roundedAmount(purchaseFxFinalBankFee * 21000) && line.credit === 0),
      'FX purchase final UI should debit bank fee at settlement rate',
    );
    assert(
      purchaseFxFinalJournal.lines.some((line) => line.accountId === 'acc-bank-lak' && line.debit === 0 && line.credit === roundedAmount((purchaseFxRemainingAmount - purchaseFxFinalWithholding + purchaseFxFinalBankFee) * 21000)),
      'FX purchase final UI should credit net LAK bank cash',
    );
    assert(
      purchaseFxFinalJournal.lines.some((line) => line.accountId === 'acc-wht-payable' && line.debit === 0 && line.credit === roundedAmount(purchaseFxFinalWithholding * 21000)),
      'FX purchase final UI should credit withholding payable at settlement rate',
    );
    assert(
      purchaseFxFinalJournal.lines.some((line) => line.accountId === 'acc-exchange-gain' && line.debit === 0 && line.credit === roundedAmount(purchaseFxRemainingAmount * 1000)),
      'FX purchase final UI should credit exchange gain',
    );

    clickNav('Invoices');
    await waitFor(() => document.querySelector('h1')?.textContent.includes('Invoices'), 'invoice module should reopen after FX purchase');

    await clickDocumentAction(createdDocument.documentNumber, 'Lock');
    await waitFor(() => document.body.textContent.includes('Confirm document lock'), 'lock confirmation should open');
    clickButtonByText('Confirm lock');
    await waitForLocalhostDatabase('storage mode should remain localhost database after document lock');
    await waitFor(async () => {
      const nextDocument = (await state()).documents.find((entry) => entry.id === createdDocument.id);
      return nextDocument?.locked === true;
    }, 'document should lock', 15000);
    const lockedRow = await waitFor(() => {
      const row = documentRow(createdDocument.documentNumber);
      return row?.textContent.includes('(locked)') ? row : null;
    }, `locked document row should render locked status: ${createdDocument.documentNumber}`);
    assert(!Array.from(lockedRow.querySelectorAll('.table-action')).some((button) => button.textContent.trim() === 'receipt'), 'receipt action should hide after lock');
    const lockButton = Array.from(lockedRow.querySelectorAll('.table-action')).find((button) => button.textContent.trim() === 'Lock');
    assert(lockButton?.disabled === true, 'lock button should disable after lock');

    clickNav('Dashboard');
    await waitFor(() => document.querySelector('h1')?.textContent.includes('Dashboard'), 'dashboard should open');
    const dashboardLockedRow = await waitFor(() => {
      return Array.from(document.querySelectorAll('tbody tr')).find((row) => {
        const text = row.textContent.replace(/\s+/g, ' ').trim();
        return text.includes('CODEX_TEST_INVOICE_PHASE1') && text.includes('invoice (locked)');
      });
    }, 'dashboard recent activity should show locked document status');
    assert(dashboardLockedRow, 'dashboard recent activity should show locked document status');
    clickNav('Reports');
    await waitFor(() => document.querySelector('h1')?.textContent.includes('Reports'), 'reports module should open');
    await waitFor(() => document.body.textContent.includes('Trial balance'), 'trial balance report should render');
    await waitFor(() => document.body.textContent.includes('VAT summary'), 'VAT summary report should render');
    await waitFor(() => document.body.textContent.includes('Source trace'), 'source trace report should render');
    await waitFor(() => document.body.textContent.includes('Report snapshot'), 'report snapshot should render');
    const trialBalancePanel = panelByHeading('Trial balance');
    assert(trialBalancePanel?.textContent.includes('Bank fees'), 'trial balance should include bank fee account');
    const sourceTracePanel = panelByHeading('Source trace');
    assert(sourceTracePanel?.textContent.includes('CODEX_TEST_INVOICE_PHASE1'), 'source trace should include invoice reference');
    const originalCsvCreateObjectUrl = URL.createObjectURL;
    const originalCsvRevokeObjectUrl = URL.revokeObjectURL;
    const originalCsvAnchorClick = HTMLAnchorElement.prototype.click;
    window.__codexCsvDownloads = [];
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob && blob.type.includes('text/csv')) {
        const entry = {
          text: '',
          type: blob.type,
          pending: true,
        };
        window.__codexCsvDownloads.push(entry);
        blob.text().then((text) => {
          entry.text = text;
        });
      }
      return 'blob:codex-report-csv-' + window.__codexCsvDownloads.length;
    };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () {
      const pending = window.__codexCsvDownloads.find((entry) => entry.pending);
      if (pending) {
        pending.filename = this.download;
        pending.href = this.href;
        pending.pending = false;
      }
    };
    const ledgerPanel = panelByHeading('Ledger by account');
    clickButtonByText('Download CSV', ledgerPanel);
    const ledgerCsv = await waitFor(
      () => window.__codexCsvDownloads.find((entry) => entry.filename?.startsWith('ledger-') && entry.text),
      'ledger CSV download should be captured',
    );
    assert(ledgerCsv.text.startsWith('Date,Reference,Source,Account,Debit,Credit,Balance'), 'ledger CSV should include expected header');
    clickButtonByText('Download CSV', sourceTracePanel);
    const sourceTraceCsv = await waitFor(
      () => window.__codexCsvDownloads.find((entry) => entry.filename?.startsWith('source-trace-') && entry.text),
      'source trace CSV download should be captured',
    );
    assert(
      sourceTraceCsv.text.startsWith('Date,Source,Type,Status,Amount,Currency,Reference,Journals,Debit,Credit,Balance,Files'),
      'source trace CSV should include expected header',
    );
    assert(sourceTraceCsv.text.includes('CODEX_TEST_INVOICE_PHASE1'), 'source trace CSV should include invoice reference');
    clickButtonByText('Download CSV', trialBalancePanel);
    const trialCsv = await waitFor(
      () => window.__codexCsvDownloads.find((entry) => entry.filename?.startsWith('trial-balance-') && entry.text),
      'trial balance CSV download should be captured',
    );
    assert(trialCsv.text.startsWith('Account,Currency,Opening balance,Debit,Credit,Ending balance'), 'trial balance CSV should include expected header');
    assert(trialCsv.text.includes('Bank fees'), 'trial balance CSV should include bank fee row');
    const vatSummaryPanel = panelByHeading('VAT summary');
    assert(vatSummaryPanel?.textContent.includes('CODEX_TEST_INVOICE_PHASE1'), 'VAT summary should include invoice reference');
    const cashMovementPanel = panelByHeading('Cash/bank movement');
    clickButtonByText('Download CSV', cashMovementPanel);
    const cashCsv = await waitFor(
      () => window.__codexCsvDownloads.find((entry) => entry.filename?.startsWith('cash-bank-movement-') && entry.text),
      'cash movement CSV download should be captured',
    );
    assert(cashCsv.text.startsWith('Account,Currency,Opening balance,Money in,Money out,Ending balance'), 'cash movement CSV should include expected header');
    assert(cashCsv.text.includes('LAK'), 'cash movement CSV should include currency rows');
    const settlementHistoryPanel = panelByHeading('Document settlement history');
    clickButtonByText('Download CSV', settlementHistoryPanel);
    const settlementCsv = await waitFor(
      () => window.__codexCsvDownloads.find((entry) => entry.filename?.startsWith('settlement-history-') && entry.text),
      'settlement history CSV download should be captured',
    );
    assert(
      settlementCsv.text.startsWith('Date,Document,Reference,Status,Cash/bank account,Document amount settled,Cash/bank amount'),
      'settlement history CSV should include expected header',
    );
    clickButtonByText('Download CSV', vatSummaryPanel);
    const vatCsv = await waitFor(
      () => window.__codexCsvDownloads.find((entry) => entry.filename?.startsWith('vat-summary-') && entry.text),
      'VAT summary CSV download should be captured',
    );
    assert(vatCsv.text.startsWith('Date,Source,Type,Status,Contact,Direction,Tax,Tax rate,Net amount,Tax amount,Gross amount'), 'VAT CSV should include expected header');
    assert(vatCsv.text.includes('CODEX_TEST_INVOICE_PHASE1'), 'VAT CSV should include invoice reference');
    URL.createObjectURL = originalCsvCreateObjectUrl;
    URL.revokeObjectURL = originalCsvRevokeObjectUrl;
    HTMLAnchorElement.prototype.click = originalCsvAnchorClick;
    assert(settlementHistoryPanel?.textContent.includes('Document amount settled'), 'settlement history should show document settlement amount column');
    assert(settlementHistoryPanel?.textContent.includes('Cash/bank amount'), 'settlement history should show cash amount disclosure column');
    const reportSnapshotPanel = panelByHeading('Report snapshot');
    assert(reportSnapshotPanel?.textContent.includes('Journal count'), 'report snapshot should include journal count');
    assert(reportSnapshotPanel?.textContent.includes('Localhost database'), 'report snapshot should show local data source');
    assert(reportSnapshotPanel?.textContent.includes('Download snapshot'), 'report snapshot should expose local download action');
    assert(reportSnapshotPanel?.textContent.includes('Print snapshot'), 'report snapshot should expose print action');
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    window.__codexSnapshotDownload = null;
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob && blob.type === 'application/json') {
        blob.text().then((text) => {
          window.__codexSnapshotDownload = {
            ...(window.__codexSnapshotDownload ?? {}),
            text,
            type: blob.type,
          };
        });
      }
      return 'blob:codex-report-snapshot';
    };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () {
      window.__codexSnapshotDownload = {
        ...(window.__codexSnapshotDownload ?? {}),
        filename: this.download,
        href: this.href,
      };
    };
    clickButtonByText('Download snapshot', reportSnapshotPanel);
    const snapshotDownload = await waitFor(
      () => (window.__codexSnapshotDownload?.text ? window.__codexSnapshotDownload : null),
      'snapshot JSON download should be captured',
    );
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    const snapshotPayload = JSON.parse(snapshotDownload.text);
    assert(snapshotDownload.filename?.startsWith('accounting-report-snapshot-'), 'snapshot download should use report snapshot filename');
    assert(snapshotPayload.generatedAt && !Number.isNaN(Date.parse(snapshotPayload.generatedAt)), 'snapshot JSON should include generatedAt');
    assert(snapshotPayload.dataSource?.type === 'shared-report-models', 'snapshot JSON should declare shared report helper data source');
    assert(snapshotPayload.dataSource?.version === 'phase-1', 'snapshot JSON should declare report model version');
    assert(snapshotPayload.dataSource?.mode === 'localhost-api', 'snapshot JSON should declare localhost API data source mode');
    assert(snapshotPayload.report?.key === 'snapshot', 'snapshot JSON should include report key metadata');
    assert(snapshotPayload.filters?.reportKey === 'ledger', 'snapshot JSON should include active report filter info');
    assert(snapshotPayload.trialBalance?.some((row) => row.accountId === 'acc-bank-fee-expense'), 'snapshot JSON should include trial balance helper rows');
    assert(snapshotPayload.vatSummary?.some((row) => row.source.includes('CODEX_TEST_INVOICE_PHASE1')), 'snapshot JSON should include VAT helper rows');
    const reportActor = { actorType: 'user', actorId: 'ui-smoke-report-reader', roleKey: 'owner', permissions: [] };
    const backendTrialBalance = await fetch(`${apiBaseUrl}/api/reports/trial_balance/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: reportActor, filters: snapshotPayload.filters }),
    }).then((response) => response.json());
    assert(backendTrialBalance.ok === true, 'backend trial balance report should read during snapshot QA');
    assert(
      snapshotPayload.trialBalance.length === backendTrialBalance.data.rows.length,
      'snapshot trial balance should match backend report row count',
    );
    const backendVatSummary = await fetch(`${apiBaseUrl}/api/reports/vat_summary/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor: reportActor, filters: snapshotPayload.filters }),
    }).then((response) => response.json());
    assert(backendVatSummary.ok === true, 'backend VAT summary report should read during snapshot QA');
    assert(snapshotPayload.vatSummary.length === backendVatSummary.data.rows.length, 'snapshot VAT summary should match backend report row count');
    const originalPrint = window.print;
    window.__codexPrintCalls = 0;
    window.print = () => {
      window.__codexPrintCalls += 1;
    };
    clickButtonByText('Print snapshot', reportSnapshotPanel);
    assert(window.__codexPrintCalls === 1, 'print snapshot should call window.print once');
    window.print = originalPrint;
    const savedFiltersPanel = panelByHeading('Saved report filters');
    assert(savedFiltersPanel, 'saved report filters panel should render');
    await setField('Filter name', 'CODEX_UI Report Filter', savedFiltersPanel);
    await setField('Report', 'vat_summary', savedFiltersPanel);
    await setField('Date from', '2020-01-01', savedFiltersPanel);
    await setField('Date to', '2099-12-31', savedFiltersPanel);
    await setField('Report status', 'invoice', savedFiltersPanel);
    clickButtonByText('Save filter', savedFiltersPanel);
    await waitForLocalhostDatabase('storage mode should remain localhost database after saved report filter create');
    const savedReportFilter = await waitFor(async () => {
      const nextApiState = await apiState();
      return nextApiState.savedReportFilters.find((entry) => entry.name === 'CODEX_UI Report Filter');
    }, 'saved report filter should persist through API state', 15000);
    debugContext.savedReportFilter = savedReportFilter;
    await waitFor(() => savedFilterRow('CODEX_UI Report Filter'), 'saved report filter row should render', 15000);
    clickButtonByText('Apply', panelByHeading('Saved report filters'));
    await waitFor(() => fieldByLabel('Report', panelByHeading('Saved report filters')).querySelector('select').value === 'vat_summary', 'saved report filter apply should keep report key');
    await waitFor(() => fieldByLabel('Report status', panelByHeading('Saved report filters')).querySelector('select').value === 'invoice', 'saved report filter apply should keep status');
    clickButtonByText('Delete filter', panelByHeading('Saved report filters'));
    await waitFor(() => document.body.textContent.includes('Confirm saved filter deletion'), 'saved report filter delete confirmation should open');
    clickButtonByText('Confirm delete');
    await waitForLocalhostDatabase('storage mode should remain localhost database after saved report filter delete');
    await waitFor(async () => {
      const nextApiState = await apiState();
      return !nextApiState.savedReportFilters.some((entry) => entry.id === savedReportFilter.id);
    }, 'saved report filter should delete through API state', 15000);
    await waitFor(() => !savedFilterRow('CODEX_UI Report Filter'), 'saved report filter row should disappear after delete', 15000);
    await waitFor(() => document.body.textContent.includes('Customer aging'), 'customer aging report should render');
    const customerAgingPanel = panelByHeading('Customer aging');
    assert(customerAgingPanel, 'customer aging panel should exist');
    const agingRow = await waitFor(() => {
      return Array.from(customerAgingPanel.querySelectorAll('tbody tr')).find((row) => row.textContent.includes(createdDocument.documentNumber));
    }, 'customer aging should show open invoice');
    assert(agingRow.cells[3]?.textContent.includes('222.00'), 'customer aging should show open invoice in current bucket');
    assert(agingRow.cells[8]?.textContent.includes('222.00'), 'customer aging should show open invoice balance');
    clickNav('Invoices');
    await waitFor(() => document.querySelector('h1')?.textContent.includes('Invoices'), 'invoice module should reopen');
    await openCreateForm('Create invoice');

    const documentCountBeforeDeleteTest = (await state()).documents.length;
    clickButtonByText('Save', document.querySelector('.form-panel'));
    await waitForLocalhostDatabase('storage mode should remain localhost database after deletable document create');
    const deletableDocument = await waitFor(async () => {
      const nextState = await state();
      return nextState.documents.find(
        (entry) =>
          entry.id !== createdDocument.id &&
          entry.status === 'quotation' &&
          entry.locked === false &&
          nextState.documents.length > documentCountBeforeDeleteTest,
      );
    }, 'deletable document should be created', 15000);
    debugContext.deletableDocument = {
      id: deletableDocument.id,
      documentNumber: deletableDocument.documentNumber,
      reference: deletableDocument.reference,
      status: deletableDocument.status,
      locked: deletableDocument.locked,
    };
    await waitFor(() => documentRow(deletableDocument.documentNumber), `deletable document row should render: ${deletableDocument.documentNumber}`);
    await clickDocumentAction(deletableDocument.documentNumber, 'Delete');
    await waitFor(() => document.body.textContent.includes('Confirm document deletion'), 'delete confirmation should open');
    clickButtonByText('Confirm delete');
    await waitForLocalhostDatabase('storage mode should remain localhost database after document delete');
    const stateAfterDelete = await waitFor(async () => {
      const nextState = await state();
      return !nextState.documents.some((entry) => entry.id === deletableDocument.id) ? nextState : null;
    }, 'document should delete', 15000);
    debugContext.afterDeleteApiDocuments = stateAfterDelete.documents.map((entry) => ({
      id: entry.id,
      documentNumber: entry.documentNumber,
      reference: entry.reference,
      status: entry.status,
      locked: entry.locked,
    }));
    await waitFor(() => {
      const rows = documentRows(deletableDocument.documentNumber).map((row) => row.textContent.replace(/\s+/g, ' ').trim());
      debugContext.afterDeleteDomRows = rows;
      return rows.every((text) => !text.includes('quotation') && !text.includes('Delete'));
    }, 'deleted draft document row should disappear from DOM', 15000);

    const finalApiState = await waitFor(async () => {
      const nextApiState = await apiState();
      const apiDocument = nextApiState.documents.find((entry) => entry.id === createdDocument.id);
      const apiCategory = nextApiState.categories.find((entry) => entry.accountingCode === categoryCode && entry.name === categoryName);
      const apiProduct = nextApiState.products.find((entry) => entry.code === productCode && entry.name === productName);
      const apiAdjustedJournal = nextApiState.journalEntries.find((entry) => entry.sourceType === 'sales' && entry.sourceId === adjustedSettlementDocument.id);
      const deletedDocumentGone = !nextApiState.documents.some((entry) => entry.id === deletableDocument.id);
      const savedReportFilterGone = !nextApiState.savedReportFilters.some((entry) => entry.id === savedReportFilter.id);
      return apiDocument?.locked === true &&
        apiDocument?.status === 'invoice' &&
        apiCategory &&
        apiProduct &&
        apiAdjustedJournal &&
        deletedDocumentGone &&
        savedReportFilterGone
        ? nextApiState
        : null;
    }, 'API state should persist inline entities and document lock', 15000);
    assert(
      finalApiState.categories.some((entry) => entry.accountingCode === categoryCode && entry.name === categoryName),
      'API state should persist inline category',
    );
    assert(
      finalApiState.products.some((entry) => entry.code === productCode && entry.name === productName),
      'API state should persist inline product',
    );
    assert(
      finalApiState.documents.some((entry) => entry.id === createdDocument.id && entry.locked === true && entry.status === 'invoice'),
      'API state should persist locked document',
    );
    assert(
      finalApiState.documents.some((entry) => entry.id === createdDocument.id && entry.status === 'invoice'),
      'API state should persist customer aging source document',
    );
    assert(
      finalApiState.journalEntries.some(
        (entry) =>
          entry.sourceType === 'sales' &&
          entry.sourceId === adjustedSettlementDocument.id &&
          entry.lines.some((line) => line.accountId === 'acc-bank-fee-expense' && line.debit === 10 && line.credit === 0),
      ),
      'API state should persist UI bank fee journal line',
    );
    assert(
      !finalApiState.documents.some((entry) => entry.id === deletableDocument.id),
      'API state should persist document deletion',
    );
    assert(
      !finalApiState.savedReportFilters.some((entry) => entry.id === savedReportFilter.id),
      'API state should persist saved report filter deletion',
    );

    result.ok = true;
    return result;
  } catch (error) {
    return diagnostics(error);
  }
})()
'@

  $TempScript = New-TemporaryFile
  $BrowserFlow = $BrowserFlow.Replace('__API_BASE_URL__', $ApiUrl)
  $BrowserFlow = $BrowserFlow.Replace('__RUN_ID__', $RunId)
  $BrowserFlow = $BrowserFlow.Replace('__SESSION_ID__', $Session)
  Set-Content -LiteralPath $TempScript -Value $BrowserFlow -Encoding UTF8
  $Output = Invoke-Agent -Arguments @('eval', '--stdin') -InputText (Get-Content -Raw -LiteralPath $TempScript) -TimeoutSeconds 60
  Remove-Item -LiteralPath $TempScript -Force -ErrorAction SilentlyContinue
  if (($Output -join "`n") -notmatch '"ok": true') {
    throw "UI smoke assertions did not run as expected`n$($Output -join "`n")"
  }

  Write-Host 'UI smoke test passed.'
  $Output
} finally {
  Invoke-RestMethod -Uri "$ApiUrl/api/reset" -Method Post -Headers @{
    Accept = 'application/json'
    'X-Codex-Reset-Source' = 'ui-smoke-test'
    'X-Codex-Run-Id' = $RunId
    'X-Codex-Session-Id' = $Session
    'X-Codex-Reset-Reason' = 'final-cleanup'
  } -ErrorAction SilentlyContinue | Out-Null
  try {
    Invoke-Agent @('close') | Out-Null
  } catch {
  }
}
