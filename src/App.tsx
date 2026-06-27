import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Bot,
  Building2,
  ChevronLeft,
  FileDown,
  FileText,
  Download,
  Landmark,
  Languages,
  ListTree,
  LayoutDashboard,
  Lock,
  Menu,
  Moon,
  Package,
  Plus,
  Printer,
  Receipt,
  RefreshCcw,
  Save,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
import {
  accountBalance,
  buildReportSnapshotPayload,
  calculateItemsTotal,
  cashMovementRows,
  createDefaultLineItem,
  dashboardSummary,
  documentAgingRows,
  documentRemainingAmount,
  documentSettlementRows,
  formatMoney,
  getActionCatalog,
  journalSourceTarget,
  ledgerRowsForAccount,
  snapshotMetricRows,
  sourceTraceRows,
  stateWithReportFilters,
  todayIsoDate,
  trialBalanceRows,
  vatSummaryRows,
} from './domain';
import { humanOwnerActor } from './actions';
import { locales, makeTranslator } from './i18n';
import { useAccountingState } from './store';
import type { AccountingActionRequest, AccountingActionResult } from './actions';
import type {
  AccountKind,
  AppState,
  CashTransactionKind,
  CurrencyCode,
  DocumentKind,
  DocumentStatus,
  LineItem,
  Locale,
  ReportFilterSettings,
  ReportKey,
  SavedReportFilter,
  AttachmentReference,
} from './types';

type View = 'dashboard' | 'revenue' | 'payment' | 'invoices' | 'bills' | 'categories' | 'products' | 'journals' | 'reports' | 'actions';
type Translator = ReturnType<typeof makeTranslator>;
type AppStateShape = AppState;
type AttachmentApi = ReturnType<typeof useAccountingState>['attachmentApi'];
type ActivityEntry = AppState['cashTransactions'][number] | AppState['documents'][number];
type ThemeMode = 'light' | 'dark';
type FormNavigationProps = {
  backRequest: number;
  formView: View;
  onFormVisibilityChange: (view: View, isOpen: boolean) => void;
};
const currencies: CurrencyCode[] = ['LAK', 'THB', 'USD'];
const categoryKinds: Array<CashTransactionKind | DocumentKind> = ['revenue', 'payment', 'sales', 'purchase'];
const reportKeys: ReportKey[] = [
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
const reportStatusOptions: Array<DocumentStatus | 'all'> = ['all', 'draft', 'quotation', 'invoice', 'receipt', 'purchase_order', 'bill', 'paid'];

const navGroups: Array<{ labelKey: string; items: Array<{ view: View; icon: typeof LayoutDashboard; labelKey: string }> }> = [
  {
    labelKey: 'workspaceGroup',
    items: [{ view: 'dashboard', icon: LayoutDashboard, labelKey: 'dashboard' }],
  },
  {
    labelKey: 'incomeGroup',
    items: [
      { view: 'invoices', icon: FileText, labelKey: 'invoices' },
      { view: 'revenue', icon: Wallet, labelKey: 'revenue' },
    ],
  },
  {
    labelKey: 'expenseGroup',
    items: [
      { view: 'bills', icon: FileDown, labelKey: 'bills' },
      { view: 'payment', icon: Receipt, labelKey: 'payment' },
    ],
  },
  {
    labelKey: 'accountingGroup',
    items: [
      { view: 'categories', icon: ListTree, labelKey: 'categories' },
      { view: 'products', icon: Package, labelKey: 'products' },
      { view: 'journals', icon: Landmark, labelKey: 'journals' },
      { view: 'reports', icon: BarChart3, labelKey: 'reports' },
    ],
  },
  {
    labelKey: 'automationGroup',
    items: [{ view: 'actions', icon: Bot, labelKey: 'actions' }],
  },
];

const navItems = navGroups.flatMap((group) => group.items);

type LocalizedMasterKind = 'account' | 'category' | 'tax';

const localizedMasterNames: Record<Locale, Record<string, string>> = {
  en: {
    'account:acc-bank-lak': 'Commercial bank (LAK)',
    'account:acc-cash-lak': 'Cash in LAK',
    'account:acc-bank-thb': 'Joint Development Bank (THB)',
    'account:acc-bank-usd': 'Lao Development Bank (USD)',
    'account:acc-income-service': 'Other service sales',
    'account:acc-income-product': 'Product sales',
    'account:acc-exchange-gain': 'Exchange gain',
    'account:acc-expense-admin': 'General and administrative expenses',
    'account:acc-exchange-loss': 'Exchange loss',
    'account:acc-bank-fee-expense': 'Bank fees',
    'account:acc-wht-receivable': 'Withholding tax receivable',
    'account:acc-wht-payable': 'Withholding tax payable',
    'category:cat-service-revenue': 'Other service sales',
    'category:cat-product-revenue': 'Product sales',
    'category:cat-admin-expense': 'General and administrative expenses',
    'category:cat-sales-document': 'Other service sales',
    'category:cat-purchase-document': 'General and administrative expenses',
    'tax:tax-exempt': 'Tax exempt',
    'tax:tax-vat': 'VAT',
    'tax:tax-none': 'No tax',
  },
  th: {
    'account:acc-bank-lak': 'ธนาคารพาณิชย์ (LAK)',
    'account:acc-cash-lak': 'เงินสดกีบ',
    'account:acc-bank-thb': 'ธนาคารร่วมพัฒนา (THB)',
    'account:acc-bank-usd': 'ธนาคารพัฒนาลาว (USD)',
    'account:acc-income-service': 'รายได้จากบริการอื่น',
    'account:acc-income-product': 'รายได้จากการขายสินค้า',
    'account:acc-exchange-gain': 'กำไรจากอัตราแลกเปลี่ยน',
    'account:acc-expense-admin': 'ค่าใช้จ่ายทั่วไปและบริหาร',
    'account:acc-exchange-loss': 'ขาดทุนจากอัตราแลกเปลี่ยน',
    'account:acc-bank-fee-expense': 'ค่าธรรมเนียมธนาคาร',
    'account:acc-wht-receivable': 'ภาษีหัก ณ ที่จ่ายรอรับ',
    'account:acc-wht-payable': 'ภาษีหัก ณ ที่จ่ายค้างจ่าย',
    'category:cat-service-revenue': 'รายได้จากบริการอื่น',
    'category:cat-product-revenue': 'รายได้จากการขายสินค้า',
    'category:cat-admin-expense': 'ค่าใช้จ่ายทั่วไปและบริหาร',
    'category:cat-sales-document': 'รายได้จากบริการอื่น',
    'category:cat-purchase-document': 'ค่าใช้จ่ายทั่วไปและบริหาร',
    'tax:tax-exempt': 'ยกเว้นภาษี',
    'tax:tax-vat': 'VAT',
    'tax:tax-none': 'ไม่มีภาษี',
  },
  lo: {
    'account:acc-bank-lak': 'ທະນາຄານການຄ້າ (LAK)',
    'account:acc-cash-lak': 'ເງິນສົດເປັນເງິນກີບ',
    'account:acc-bank-thb': 'ທະນາຄານຮ່ວມພັດທະນາ (THB)',
    'account:acc-bank-usd': 'ທະນາຄານພັດທະນາລາວ (USD)',
    'account:acc-income-service': 'ຂາຍການບໍລິການອື່ນໆ',
    'account:acc-income-product': 'ຂາຍສິນຄ້າ',
    'account:acc-exchange-gain': 'ກຳໄລຈາກອັດຕາແລກປ່ຽນ',
    'account:acc-expense-admin': 'ຄ່າໃຊ້ຈ່າຍທົ່ວໄປແລະການບໍລິຫານ',
    'account:acc-exchange-loss': 'ຂາດທຶນຈາກອັດຕາແລກປ່ຽນ',
    'account:acc-bank-fee-expense': 'ຄ່າທໍານຽມທະນາຄານ',
    'account:acc-wht-receivable': 'ອາກອນຫັກໄວ້ລໍຖ້າຮັບ',
    'account:acc-wht-payable': 'ອາກອນຫັກໄວ້ຄ້າງຈ່າຍ',
    'category:cat-service-revenue': 'ຂາຍການບໍລິການອື່ນໆ',
    'category:cat-product-revenue': 'ຂາຍສິນຄ້າ',
    'category:cat-admin-expense': 'ຄ່າໃຊ້ຈ່າຍທົ່ວໄປແລະການບໍລິຫານ',
    'category:cat-sales-document': 'ຂາຍການບໍລິການອື່ນໆ',
    'category:cat-purchase-document': 'ຄ່າໃຊ້ຈ່າຍທົ່ວໄປແລະການບໍລິຫານ',
    'tax:tax-exempt': 'ຍົກເວັ້ນອາກອນ',
    'tax:tax-vat': 'VAT',
    'tax:tax-none': 'ບໍ່ມີອາກອນ',
  },
};

function masterName(locale: Locale, kind: LocalizedMasterKind, entry: { id: string; name: string }) {
  return localizedMasterNames[locale][`${kind}:${entry.id}`] ?? entry.name;
}

function accountName(locale: Locale, account: AppStateShape['accounts'][number]) {
  return masterName(locale, 'account', account);
}

function accountLabel(locale: Locale, account: AppStateShape['accounts'][number], format: 'name' | 'code-name' | 'name-currency' = 'name') {
  const name = accountName(locale, account);
  if (format === 'code-name') return `${account.code} ${name}`;
  if (format === 'name-currency') return `${name} (${account.currency})`;
  return name;
}

function categoryName(locale: Locale, category: AppStateShape['categories'][number]) {
  return masterName(locale, 'category', category);
}

function taxName(locale: Locale, tax: AppStateShape['taxes'][number]) {
  return masterName(locale, 'tax', tax);
}

function initialThemeMode(): ThemeMode {
  const stored = window.localStorage.getItem('accounting-system-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function cloneItem(item: LineItem): LineItem {
  return { ...item };
}

function isCashActivity(entry: ActivityEntry): entry is AppState['cashTransactions'][number] {
  return entry.kind === 'revenue' || entry.kind === 'payment';
}

function nextDocumentStatus(kind: DocumentKind, status: DocumentStatus): DocumentStatus | null {
  const salesFlow: DocumentStatus[] = ['quotation', 'invoice', 'receipt'];
  const purchaseFlow: DocumentStatus[] = ['purchase_order', 'bill', 'paid'];
  const flow = kind === 'sales' ? salesFlow : purchaseFlow;
  const index = flow.indexOf(status);
  return index >= 0 && index < flow.length - 1 ? flow[index + 1] : null;
}

function isSettlementStatus(kind: DocumentKind, status: DocumentStatus) {
  return (kind === 'sales' && status === 'receipt') || (kind === 'purchase' && status === 'paid');
}

function addDaysIsoDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function useCloseOnBackRequest(backRequest: number, isOpen: boolean, onClose: () => void) {
  const lastHandledBackRequestRef = useRef(backRequest);

  useEffect(() => {
    if (backRequest === lastHandledBackRequestRef.current) return;
    lastHandledBackRequestRef.current = backRequest;
    if (isOpen) onClose();
  }, [backRequest, isOpen, onClose]);
}

function tagNames(state: AppStateShape, tagIds: string[] = []) {
  if (!tagIds.length) return '-';
  return tagIds.map((tagId) => (state.tags ?? []).find((tag) => tag.id === tagId)?.name ?? tagId).join(', ');
}

function attachmentCount(state: AppStateShape, attachmentIds: string[] = []) {
  return attachmentIds.filter((attachmentId) => (state.attachments ?? []).some((attachment) => attachment.id === attachmentId)).length;
}

function formatFileSize(sizeBytes = 0) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? '');
      resolve(value.includes(',') ? value.slice(value.indexOf(',') + 1) : value);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([`${lines}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function sourceTracePostingLabel(t: Translator, row: { entryId: string | null; balanced: boolean | null }) {
  if (!row.entryId || row.balanced === null) return t('noJournal');
  return row.balanced ? t('balanced') : t('notBalanced');
}

function money(locale: Locale, value: number, currency: string = 'LAK') {
  return formatMoney(value, currency, locale);
}

function currencyTotals<T>(items: T[], amountFor: (item: T) => number, currencyFor: (item: T) => CurrencyCode) {
  return items.reduce(
    (totals, item) => ({
      ...totals,
      [currencyFor(item)]: (totals[currencyFor(item)] ?? 0) + amountFor(item),
    }),
    {} as Partial<Record<CurrencyCode, number>>,
  );
}

function moneyTotals(locale: Locale, totals: Partial<Record<CurrencyCode, number>>, fallbackCurrency: CurrencyCode = 'LAK') {
  const rows = currencies
    .map((currency) => ({ currency, amount: totals[currency] ?? 0 }))
    .filter((row) => Math.round(Math.abs(row.amount) * 100) > 0);
  if (!rows.length) return money(locale, 0, fallbackCurrency);
  return rows.map((row) => money(locale, row.amount, row.currency)).join(' / ');
}

function currencyOptions() {
  return currencies.map((currency) => ({ value: currency, label: currency }));
}

function lineFromProduct(state: AppStateShape, fallbackName: string, fallbackPrice: number): LineItem {
  const product = (state.products ?? []).find((entry) => entry.enabled);
  const tax = product?.taxId ? (state.taxes ?? []).find((entry) => entry.id === product.taxId) : undefined;

  return createDefaultLineItem(product?.name ?? fallbackName, product?.unitPrice ?? fallbackPrice, {
    productId: product?.id,
    unit: product?.unit ?? 'unit',
    taxId: tax?.id ?? 'tax-none',
    taxName: tax?.name,
    taxRate: tax?.rate ?? 0,
  });
}

function accountsForCategoryKind(state: AppStateShape, categoryKind: CashTransactionKind | DocumentKind) {
  const preferredKinds =
    categoryKind === 'revenue' || categoryKind === 'sales'
      ? ['income']
      : categoryKind === 'payment' || categoryKind === 'purchase'
        ? ['expense']
        : [];
  const preferred = state.accounts.filter((account) => preferredKinds.includes(account.kind));
  return preferred.length ? preferred : state.accounts;
}

function accountOptionsForCategoryKind(state: AppStateShape, categoryKind: CashTransactionKind | DocumentKind, locale: Locale) {
  return accountsForCategoryKind(state, categoryKind).map((account) => ({ value: account.id, label: accountLabel(locale, account, 'code-name') }));
}

function defaultCategoryAccountId(state: AppStateShape, categoryKind: CashTransactionKind | DocumentKind) {
  return accountsForCategoryKind(state, categoryKind)[0]?.id ?? '';
}

function defaultCategoryName(_categoryKind: CashTransactionKind | DocumentKind) {
  return '';
}

function defaultCategoryCode(_categoryKind: CashTransactionKind | DocumentKind) {
  return '';
}

function defaultProductCode() {
  return '';
}

function generatedContactCode(contactType: 'customer' | 'vendor') {
  const prefix = contactType === 'customer' ? 'CUST' : 'VEN';
  return `${prefix}-${Date.now().toString().slice(-5)}`;
}

function reportKeyLabel(t: Translator, reportKey: ReportKey) {
  const labels: Record<ReportKey, string> = {
    ledger: t('ledgerByAccount'),
    source_trace: t('sourceTrace'),
    trial_balance: t('trialBalance'),
    cash_movement: t('cashBankMovement'),
    settlement_history: t('documentSettlementHistory'),
    vat_summary: t('vatSummary'),
    customer_aging: t('customerAging'),
    vendor_aging: t('vendorAging'),
    snapshot: t('reportSnapshot'),
  };
  return labels[reportKey];
}

function sessionErrorLabel(t: Translator, code?: string, fallback?: string | null) {
  if (code === 'UNAUTHENTICATED') return t('authErrorRequired');
  if (code === 'ADMIN_REQUIRED' || code === 'PERMISSION_DENIED') return t('permissionDenied');
  if (code === 'STATE_REVISION_CONFLICT') return t('stateConflict');
  return fallback ?? t('saveFailed');
}

export function App() {
  const { state, runAction, reset, authSession, attachmentApi } = useAccountingState();
  const [locale, setLocale] = useState<Locale>('th');
  const [view, setView] = useState<View>('dashboard');
  const [sessionTokenDraft, setSessionTokenDraft] = useState(authSession.token);
  const [theme, setTheme] = useState<ThemeMode>(initialThemeMode);
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [isSystemOpen, setIsSystemOpen] = useState(false);
  const [viewHistory, setViewHistory] = useState<View[]>([]);
  const [activeFormView, setActiveFormView] = useState<View | null>(null);
  const [backRequest, setBackRequest] = useState(0);
  const navMenuRef = useRef<HTMLDetailsElement>(null);
  const systemMenuRef = useRef<HTMLDetailsElement>(null);
  const t = useMemo(() => makeTranslator(locale), [locale]);
  const summary = dashboardSummary(state);
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const authErrorLabel = authSession.error ? sessionErrorLabel(t, authSession.errorCode ?? undefined, authSession.error ?? undefined) : null;
  const isHostedSession = authSession.mode === 'supabase';
  const currentNavItem = navItems.find((item) => item.view === view) ?? { view: 'dashboard' as View, icon: LayoutDashboard, labelKey: 'dashboard' };
  const CurrentNavIcon = currentNavItem.icon;
  const canGoBack = activeFormView === view || view !== 'dashboard' || viewHistory.length > 0;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('accounting-system-theme', theme);
  }, [theme]);

  useEffect(() => {
    function closeFloatingMenus(event: PointerEvent | WheelEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (isNavOpen && navMenuRef.current && !navMenuRef.current.contains(target)) setIsNavOpen(false);
      if (isSystemOpen && systemMenuRef.current && !systemMenuRef.current.contains(target)) setIsSystemOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setIsNavOpen(false);
      setIsSystemOpen(false);
    }

    document.addEventListener('pointerdown', closeFloatingMenus);
    document.addEventListener('wheel', closeFloatingMenus, { passive: true });
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeFloatingMenus);
      document.removeEventListener('wheel', closeFloatingMenus);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isNavOpen, isSystemOpen]);

  const handleFormVisibilityChange = useCallback((formView: View, isOpen: boolean) => {
    setActiveFormView((current) => {
      if (isOpen) return formView;
      return current === formView ? null : current;
    });
  }, []);

  function navigateToView(nextView: View) {
    setIsNavOpen(false);
    setIsSystemOpen(false);
    if (nextView === view) return;
    setActiveFormView(null);
    setViewHistory((history) => [...history, view].slice(-12));
    setView(nextView);
  }

  function goBack() {
    setIsNavOpen(false);
    setIsSystemOpen(false);
    if (activeFormView === view) {
      setBackRequest((request) => request + 1);
      return;
    }

    const previousView = viewHistory[viewHistory.length - 1] ?? 'dashboard';
    setViewHistory((history) => history.slice(0, -1));
    setView(previousView);
  }

  return (
    <div className="app-shell" data-locale={locale} data-theme={theme} lang={locale}>
      <main className="workspace">
        <header className="topbar">
          <div className="topbar-primary">
            <details ref={navMenuRef} className="nav-dropdown" open={isNavOpen} onToggle={(event) => setIsNavOpen(event.currentTarget.open)}>
              <summary className="nav-menu-trigger" aria-label={t('primaryNavigation')} onClick={() => setIsSystemOpen(false)}>
                <Menu size={18} />
                <span>{t(currentNavItem.labelKey)}</span>
              </summary>
              <nav className="nav-menu" aria-label={t('primaryNavigation')}>
                {navGroups.map((group) => (
                  <div className="nav-group" key={group.labelKey}>
                    <span className="nav-group-label">{t(group.labelKey)}</span>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.view}
                          className={view === item.view ? 'nav-item active' : 'nav-item'}
                          onClick={() => {
                            navigateToView(item.view);
                            setIsNavOpen(false);
                          }}
                          type="button"
                        >
                          <Icon size={18} />
                          {t(item.labelKey)}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </nav>
            </details>

            <div className="brand">
              <Building2 size={22} />
              <div>
                <strong>{t('appName')}</strong>
                <span>{state.organization.name}</span>
              </div>
            </div>

            <div className="page-heading">
              {canGoBack ? (
                <button className="icon-button back-button" type="button" onClick={goBack} title={t('goBack')} aria-label={t('goBack')}>
                  <ChevronLeft size={19} />
                </button>
              ) : null}
              <h1>
                <CurrentNavIcon size={22} />
                {t(currentNavItem.labelKey)}
              </h1>
            </div>
          </div>
          <div className="topbar-actions">
            <details ref={systemMenuRef} className="system-menu" open={isSystemOpen} onToggle={(event) => setIsSystemOpen(event.currentTarget.open)}>
              <summary
                className={authSession.isRequired ? 'icon-button system-trigger required' : 'icon-button system-trigger'}
                title={t('settings')}
                aria-label={t('settings')}
                onClick={() => setIsNavOpen(false)}
              >
                <Settings size={18} />
              </summary>
              <div className="system-menu-panel">
                <div className="settings-row">
                  <div className="settings-row-label">
                    <Languages size={17} />
                    <span>{t('language')}</span>
                  </div>
                  <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
                    {locales.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">
                    {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
                    <span>{t('appearance')}</span>
                  </div>
                  <button
                    className="secondary-action compact"
                    type="button"
                    onClick={() => setTheme(nextTheme)}
                    title={nextTheme === 'dark' ? t('switchToDarkMode') : t('switchToLightMode')}
                    aria-label={nextTheme === 'dark' ? t('switchToDarkMode') : t('switchToLightMode')}
                  >
                    {nextTheme === 'dark' ? t('switchToDarkMode') : t('switchToLightMode')}
                  </button>
                </div>
                {isHostedSession ? (
                  <button
                    className="secondary-action compact"
                    type="button"
                    onClick={() => void authSession.logout()}
                  >
                    {t('logout')}
                  </button>
                ) : (
                  <>
                    <div className="system-menu-header">
                      <ShieldCheck size={18} />
                      <div>
                        <strong>{authSession.isRequired ? t('authRequired') : t('localSessionStub')}</strong>
                        <span>{authSession.isRequired ? t('authRequiredHint') : t('localSessionStubHint')}</span>
                      </div>
                    </div>
                    <div className={authSession.isRequired ? 'session-panel required' : 'session-panel'}>
                      <input
                        aria-label={t('localApiToken')}
                        placeholder={t('localApiToken')}
                        type="password"
                        value={sessionTokenDraft}
                        onChange={(event) => setSessionTokenDraft(event.target.value)}
                      />
                      <button className="secondary-action compact" type="button" onClick={() => authSession.setToken(sessionTokenDraft)}>
                        {t('useToken')}
                      </button>
                      <button
                        className="secondary-action compact"
                        type="button"
                        onClick={() => {
                          setSessionTokenDraft('');
                          authSession.clearToken();
                        }}
                      >
                        {t('clearToken')}
                      </button>
                    </div>
                    <button className="secondary-action compact reset-action" type="button" onClick={reset} title={t('resetDemo')}>
                      <RefreshCcw size={16} />
                      {t('resetDemo')}
                    </button>
                  </>
                )}
              </div>
            </details>
          </div>
        </header>
        {authErrorLabel ? (
          <div className="auth-banner" role="alert">
            <Lock size={16} />
            <span>{authErrorLabel}</span>
            {authSession.errorCode === 'STATE_REVISION_CONFLICT' ? (
              <button className="secondary-action compact" type="button" onClick={authSession.refreshLatest}>
                {t('refreshLatestState')}
              </button>
            ) : null}
          </div>
        ) : null}

        {view === 'dashboard' && <Dashboard locale={locale} t={t} summary={summary} state={state} setView={navigateToView} />}
        {view === 'revenue' && (
          <CashModule
            locale={locale}
            kind="revenue"
            t={t}
            state={state}
            onAction={runAction}
            formView="revenue"
            backRequest={backRequest}
            onFormVisibilityChange={handleFormVisibilityChange}
          />
        )}
        {view === 'payment' && (
          <CashModule
            locale={locale}
            kind="payment"
            t={t}
            state={state}
            onAction={runAction}
            formView="payment"
            backRequest={backRequest}
            onFormVisibilityChange={handleFormVisibilityChange}
          />
        )}
        {view === 'invoices' && (
          <DocumentModule
            locale={locale}
            kind="sales"
            t={t}
            state={state}
            onAction={runAction}
            attachmentApi={attachmentApi}
            formView="invoices"
            backRequest={backRequest}
            onFormVisibilityChange={handleFormVisibilityChange}
          />
        )}
        {view === 'bills' && (
          <DocumentModule
            locale={locale}
            kind="purchase"
            t={t}
            state={state}
            onAction={runAction}
            attachmentApi={attachmentApi}
            formView="bills"
            backRequest={backRequest}
            onFormVisibilityChange={handleFormVisibilityChange}
          />
        )}
        {view === 'categories' && (
          <CategoryModule
            locale={locale}
            t={t}
            state={state}
            onAction={runAction}
            formView="categories"
            backRequest={backRequest}
            onFormVisibilityChange={handleFormVisibilityChange}
          />
        )}
        {view === 'products' && (
          <ProductModule
            locale={locale}
            t={t}
            state={state}
            onAction={runAction}
            formView="products"
            backRequest={backRequest}
            onFormVisibilityChange={handleFormVisibilityChange}
          />
        )}
        {view === 'journals' && <Journals locale={locale} t={t} state={state} />}
        {view === 'reports' && <Reports locale={locale} t={t} state={state} onAction={runAction} />}
        {view === 'actions' && <ActionContracts t={t} />}
      </main>
    </div>
  );
}

function AttachmentManager({
  t,
  state,
  document,
  attachmentApi,
}: {
  t: Translator;
  state: AppStateShape;
  document: AppStateShape['documents'][number];
  attachmentApi: AttachmentApi;
}) {
  const stateAttachments = document.attachmentIds
    .map((attachmentId) => state.attachments.find((attachment) => attachment.id === attachmentId))
    .filter((attachment): attachment is AttachmentReference => Boolean(attachment));
  const [listedAttachments, setListedAttachments] = useState<AttachmentReference[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const attachments = listedAttachments ?? stateAttachments;

  async function refreshList() {
    const result = await attachmentApi.list('document', document.id);
    if (result.ok && result.attachments) {
      setListedAttachments(result.attachments);
      setError(null);
    } else if (!result.ok) {
      setError(result.error ?? t('saveFailed'));
    }
  }

  useEffect(() => {
    let active = true;
    void attachmentApi.list('document', document.id).then((result) => {
      if (!active) return;
      if (result.ok && result.attachments) setListedAttachments(result.attachments);
    });
    return () => {
      active = false;
    };
  }, [attachmentApi, document.id, document.attachmentIds.join('|')]);

  async function uploadFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const contentBase64 = await fileToBase64(file);
      const result = await attachmentApi.upload({
        ownerType: 'document',
        ownerId: document.id,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        contentBase64,
      });
      if (!result.ok) {
        setError(result.error ?? t('saveFailed'));
        return;
      }
      await refreshList();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function downloadAttachment(attachment: AttachmentReference) {
    setBusy(true);
    setError(null);
    const result = await attachmentApi.download(attachment);
    if (!result.ok) setError(result.error ?? t('saveFailed'));
    setBusy(false);
  }

  async function deleteAttachment(attachmentId: string) {
    setBusy(true);
    setError(null);
    const result = await attachmentApi.delete(attachmentId);
    if (!result.ok) {
      setError(result.error ?? t('saveFailed'));
      setBusy(false);
      return;
    }
    await refreshList();
    setBusy(false);
  }

  return (
    <div className="attachment-manager">
      <label className="attachment-upload">
        <Plus size={14} />
        <span>{busy ? t('uploadingAttachment') : t('uploadAttachment')}</span>
        <input
          aria-label={t('uploadAttachment')}
          disabled={busy}
          type="file"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            void uploadFile(file);
          }}
        />
      </label>
      <div className="attachment-list">
        {attachments.length ? (
          attachments.map((attachment) => (
            <div className="attachment-row" key={attachment.id}>
              <div>
                <strong>{attachment.name}</strong>
                <span>
                  {formatFileSize(attachment.sizeBytes)} ? {attachment.mimeType ?? 'file'} ? {attachment.createdAt.slice(0, 10)}
                </span>
              </div>
              <button className="table-action icon-only" type="button" disabled={busy} onClick={() => void downloadAttachment(attachment)} title={t('downloadAttachment')}>
                <Download size={14} />
              </button>
              <button className="table-action danger-inline icon-only" type="button" disabled={busy} onClick={() => void deleteAttachment(attachment.id)} title={t('deleteAttachment')}>
                <Trash2 size={14} />
              </button>
            </div>
          ))
        ) : (
          <span className="attachment-empty">{t('noAttachments')}</span>
        )}
      </div>
      {error ? (
        <div className="form-error attachment-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function Dashboard({
  locale,
  t,
  summary,
  state,
  setView,
}: {
  locale: Locale;
  t: Translator;
  summary: ReturnType<typeof dashboardSummary>;
  state: AppStateShape;
  setView: (view: View) => void;
}) {
  const latest = [...state.cashTransactions, ...state.documents]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
  const revenueTotals = currencyTotals(
    state.cashTransactions.filter((entry) => entry.kind === 'revenue'),
    (entry) => entry.amount,
    (entry) => entry.currency,
  );
  const paymentTotals = currencyTotals(
    state.cashTransactions.filter((entry) => entry.kind === 'payment'),
    (entry) => entry.amount,
    (entry) => entry.currency,
  );
  const netTotals = currencies.reduce(
    (totals, currency) => ({
      ...totals,
      [currency]: (revenueTotals[currency] ?? 0) - (paymentTotals[currency] ?? 0),
    }),
    {} as Partial<Record<CurrencyCode, number>>,
  );
  const hasNegativeNet = Object.values(netTotals).some((amount) => (amount ?? 0) < 0);

  return (
    <section className="page-grid">
      <div className="metrics">
        <Metric label={t('incomeTotal')} value={`+${moneyTotals(locale, revenueTotals, state.organization.baseCurrency)}`} tone="positive" />
        <Metric label={t('expenseTotal')} value={`-${moneyTotals(locale, paymentTotals, state.organization.baseCurrency)}`} tone="negative" />
        <Metric label={t('netCash')} value={moneyTotals(locale, netTotals, state.organization.baseCurrency)} tone={hasNegativeNet ? 'negative' : 'positive'} />
      </div>

      <div className="quick-actions">
        <button type="button" onClick={() => setView('revenue')}>
          <Plus size={18} />
          {t('createRevenue')}
        </button>
        <button type="button" onClick={() => setView('payment')}>
          <Plus size={18} />
          {t('createPayment')}
        </button>
        <button type="button" onClick={() => setView('invoices')}>
          <Plus size={18} />
          {t('createInvoice')}
        </button>
        <button type="button" onClick={() => setView('bills')}>
          <Plus size={18} />
          {t('createBill')}
        </button>
      </div>

      <section className="panel">
        <h2>{t('accounts')}</h2>
        <div className="account-list">
          {summary.cashAccounts.map(({ account, balance }) => (
            <div className="account-row" key={account.id}>
              <div>
                <strong>{accountName(locale, account)}</strong>
                <span>{account.code}</span>
              </div>
              <b>{money(locale, balance, account.currency)}</b>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>{t('recentActivity')}</h2>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[t('type'), t('reference'), t('amount'), t('documentStatus')]}
          rows={latest.map((entry) => {
            if (isCashActivity(entry)) {
              return [
                entry.kind,
                entry.reference || entry.id,
                money(locale, entry.amount, entry.currency),
                entry.locked ? t('locked') : t('posted'),
              ];
            }

            return [
              entry.kind,
              entry.reference || entry.documentNumber,
              money(locale, calculateItemsTotal(entry.items), entry.currency),
              entry.locked ? `${entry.status} (${t('locked')})` : entry.status,
            ];
          })}
        />
      </section>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'positive' | 'negative' }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ModuleOverview({
  title,
  actionLabel,
  stats,
  onCreate,
}: {
  title: string;
  actionLabel: string;
  stats: Array<{ label: string; value: string; tone?: 'positive' | 'negative' }>;
  onCreate: () => void;
}) {
  return (
    <section className="panel module-overview-panel">
      <div className="module-overview-header">
        <h2>{title}</h2>
        <button className="secondary-action" type="button" onClick={onCreate}>
          <Plus size={18} />
          {actionLabel}
        </button>
      </div>
      <div className="module-stats">
        {stats.map((stat) => (
          <div className={`module-stat ${stat.tone ?? ''}`} key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function CashModule({
  locale,
  kind,
  t,
  state,
  onAction,
  backRequest,
  formView,
  onFormVisibilityChange,
}: {
  locale: Locale;
  kind: CashTransactionKind;
  t: Translator;
  state: AppStateShape;
  onAction: (request: AccountingActionRequest) => Promise<AccountingActionResult>;
} & FormNavigationProps) {
  const defaultCategory = state.categories.find((category) => category.kind === kind)?.id ?? '';
  const defaultAccount = state.accounts.find((account) => account.id === 'acc-cash-lak')?.id ?? state.accounts[0]?.id ?? '';
  const defaultContact = state.contacts.find((contact) => contact.type === (kind === 'revenue' ? 'customer' : 'vendor'))?.id ?? '';
  const defaultTag = (state.tags ?? []).find((tag) => tag.enabled)?.id ?? '';
  const [accountId, setAccountId] = useState(defaultAccount);
  const [cashCurrency, setCashCurrency] = useState<CurrencyCode>(
    state.accounts.find((account) => account.id === defaultAccount)?.currency ?? state.organization.baseCurrency,
  );
  const [categoryId, setCategoryId] = useState(defaultCategory);
  const [contactId, setContactId] = useState(defaultContact);
  const [exchangeRate, setExchangeRate] = useState(1);
  const [tagId, setTagId] = useState(defaultTag);
  const [attachmentName, setAttachmentName] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<LineItem[]>(() => [lineFromProduct(state, '', 0)]);
  const [formError, setFormError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const rows = state.cashTransactions.filter((entry) => entry.kind === kind);
  const title = kind === 'revenue' ? t('revenue') : t('payment');
  const createLabel = kind === 'revenue' ? t('createRevenue') : t('createPayment');
  const amountTotals = currencyTotals(rows, (entry) => entry.amount, (entry) => entry.currency);
  const attachmentTotal = rows.reduce((total, entry) => total + attachmentCount(state, entry.attachmentIds), 0);
  const taggedCount = rows.filter((entry) => entry.tagIds.length > 0).length;
  const cashAccounts = state.accounts.filter((account) => account.kind === 'cash' || account.kind === 'bank');
  const cashAccountOptions = cashAccounts.filter((account) => account.currency === cashCurrency);

  useEffect(() => {
    onFormVisibilityChange(formView, showCreate);
    return () => onFormVisibilityChange(formView, false);
  }, [formView, onFormVisibilityChange, showCreate]);

  useCloseOnBackRequest(backRequest, showCreate, () => setShowCreate(false));

  function handleCashCurrencyChange(value: string) {
    const currency = value as CurrencyCode;
    setCashCurrency(currency);
    const nextAccountId = cashAccounts.find((account) => account.currency === currency)?.id ?? '';
    setAccountId(nextAccountId);
  }

  function handleCashAccountChange(value: string) {
    setAccountId(value);
    const account = cashAccounts.find((entry) => entry.id === value);
    if (account) setCashCurrency(account.currency);
  }

  async function submit() {
    const result = await onAction({
      key: kind === 'revenue' ? 'cash_revenue.create' : 'cash_payment.create',
      actor: humanOwnerActor,
      payload: {
        kind,
        transactionDate: todayIsoDate(),
        accountId,
        categoryId,
        contactId: contactId || undefined,
        exchangeRate,
        amount: calculateItemsTotal(items),
        reference,
        description,
        tagIds: tagId ? [tagId] : [],
        attachmentNames: attachmentName.trim() ? [attachmentName] : [],
        items: items.map(cloneItem),
      },
    });

    setFormError(result.ok ? null : result.error ?? t('saveFailed'));
  }

  return (
    <section className="module-layout list-first">
      <ModuleOverview
        title={title}
        actionLabel={createLabel}
        onCreate={() => setShowCreate(true)}
        stats={[
          { label: t('total'), value: String(rows.length) },
          { label: t('amount'), value: moneyTotals(locale, amountTotals, state.organization.baseCurrency), tone: kind === 'revenue' ? 'positive' : 'negative' },
          { label: t('tag'), value: String(taggedCount) },
          { label: t('attachments'), value: String(attachmentTotal) },
        ]}
      />

      {showCreate ? (
        <FormPanel title={createLabel} onSubmit={submit} onCancel={() => setShowCreate(false)} t={t} error={formError}>
          <SelectField label={t('currency')} value={cashCurrency} onChange={handleCashCurrencyChange} options={currencyOptions()} />
          <SelectField
            label={t('account')}
            value={accountId}
            onChange={handleCashAccountChange}
            options={cashAccountOptions.map((account) => ({ value: account.id, label: accountName(locale, account) }))}
          />
          <SelectField
            label={t('category')}
            value={categoryId}
            onChange={setCategoryId}
            options={state.categories
              .filter((category) => category.kind === kind)
              .map((category) => ({ value: category.id, label: `${categoryName(locale, category)} (${category.accountingCode})` }))}
          />
          <InlineCategoryCreate
            locale={locale}
            t={t}
            state={state}
            kind={kind}
            onAction={onAction}
            onCreated={setCategoryId}
            onError={setFormError}
          />
          <SelectField
            label={t('contact')}
            value={contactId}
            onChange={setContactId}
            options={[
              { value: '', label: t('none') },
              ...state.contacts
                .filter((contact) => contact.type === (kind === 'revenue' ? 'customer' : 'vendor'))
                .map((contact) => ({ value: contact.id, label: contact.name })),
            ]}
          />
          <NumberField label={t('exchangeRate')} value={exchangeRate} min={0.000001} step={0.000001} onChange={setExchangeRate} />
          <SelectField
            label={t('tag')}
            value={tagId}
            onChange={setTagId}
            options={[{ value: '', label: t('none') }, ...(state.tags ?? []).filter((tag) => tag.enabled).map((tag) => ({ value: tag.id, label: tag.name }))]}
          />
          <TextField label={t('reference')} value={reference} onChange={setReference} placeholder={t('referencePlaceholder')} />
          <TextField label={t('description')} value={description} onChange={setDescription} placeholder={t('descriptionPlaceholder')} />
          <TextField label={t('attachment')} value={attachmentName} onChange={setAttachmentName} placeholder={t('attachmentPlaceholder')} />
          <LineItemsEditor locale={locale} t={t} state={state} currency={cashCurrency} items={items} onChange={setItems} onAction={onAction} onError={setFormError} />
        </FormPanel>
      ) : null}

      <section className="panel">
        <h2>{title}</h2>
        <DataTable
          emptyLabel={t('noRows')}
          columns={['ID', t('reference'), t('category'), t('tag'), t('amount'), t('account'), t('attachments')]}
          rows={rows.map((entry) => {
            const category = state.categories.find((item) => item.id === entry.categoryId);
            const account = state.accounts.find((item) => item.id === entry.accountId);
            return [
              entry.id,
              entry.reference || '-',
              category ? categoryName(locale, category) : '-',
              tagNames(state, entry.tagIds),
              money(locale, entry.amount, entry.currency),
              account ? accountName(locale, account) : '-',
              String(attachmentCount(state, entry.attachmentIds)),
            ];
          })}
        />
      </section>
    </section>
  );
}

function DocumentModule({
  locale,
  kind,
  t,
  state,
  onAction,
  attachmentApi,
  backRequest,
  formView,
  onFormVisibilityChange,
}: {
  locale: Locale;
  kind: DocumentKind;
  t: Translator;
  state: AppStateShape;
  onAction: (request: AccountingActionRequest) => Promise<AccountingActionResult>;
  attachmentApi: AttachmentApi;
} & FormNavigationProps) {
  const contactType = kind === 'sales' ? 'customer' : 'vendor';
  const defaultContact = state.contacts.find((contact) => contact.type === contactType)?.id ?? '';
  const defaultDocumentCurrency = state.contacts.find((contact) => contact.id === defaultContact)?.currency ?? state.organization.baseCurrency;
  const defaultCategory = state.categories.find((category) => category.kind === kind)?.id ?? '';
  const defaultTag = (state.tags ?? []).find((tag) => tag.enabled)?.id ?? '';
  const [contactId, setContactId] = useState(defaultContact);
  const [documentCurrency, setDocumentCurrency] = useState<CurrencyCode>(defaultDocumentCurrency);
  const [categoryId, setCategoryId] = useState(defaultCategory);
  const [reference, setReference] = useState('');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState(addDaysIsoDate(kind === 'sales' ? 14 : 30));
  const [vatNumber, setVatNumber] = useState('');
  const [exchangeRate, setExchangeRate] = useState(1);
  const [tagId, setTagId] = useState(defaultTag);
  const [attachmentName, setAttachmentName] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactTaxNumber, setNewContactTaxNumber] = useState('');
  const [newContactCurrency, setNewContactCurrency] = useState<CurrencyCode>(state.organization.baseCurrency);
  const [newContactAddress, setNewContactAddress] = useState('');
  const [items, setItems] = useState<LineItem[]>(() => [lineFromProduct(state, '', 0)]);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingLockId, setPendingLockId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingSettlement, setPendingSettlement] = useState<{ documentId: string; status: DocumentStatus } | null>(null);
  const [settlementAccountId, setSettlementAccountId] = useState('');
  const [settlementDate, setSettlementDate] = useState(todayIsoDate());
  const [settlementAmount, setSettlementAmount] = useState(0);
  const [settlementBankFeeAccountId, setSettlementBankFeeAccountId] = useState('');
  const [settlementBankFeeAmount, setSettlementBankFeeAmount] = useState(0);
  const [settlementWithholdingTaxAccountId, setSettlementWithholdingTaxAccountId] = useState('');
  const [settlementWithholdingTaxAmount, setSettlementWithholdingTaxAmount] = useState(0);
  const [settlementExchangeRate, setSettlementExchangeRate] = useState(0);
  const [settlementExchangeGainAccountId, setSettlementExchangeGainAccountId] = useState('');
  const [settlementExchangeLossAccountId, setSettlementExchangeLossAccountId] = useState('');
  const [settlementError, setSettlementError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const rows = state.documents.filter((entry) => entry.kind === kind);
  const pendingLockDocument = pendingLockId ? rows.find((entry) => entry.id === pendingLockId) : undefined;
  const pendingDeleteDocument = pendingDeleteId ? rows.find((entry) => entry.id === pendingDeleteId) : undefined;
  const pendingSettlementDocument = pendingSettlement ? rows.find((entry) => entry.id === pendingSettlement.documentId) : undefined;
  const titleLabel = kind === 'sales' ? t('invoices') : t('bills');
  const createLabel = kind === 'sales' ? t('createInvoice') : t('createBill');
  const openCount = rows.filter((entry) => !entry.locked && entry.status !== 'receipt' && entry.status !== 'paid').length;
  const lockedCount = rows.filter((entry) => entry.locked).length;
  const amountTotals = currencyTotals(rows, (entry) => calculateItemsTotal(entry.items), (entry) => entry.currency);

  useEffect(() => {
    onFormVisibilityChange(formView, showCreate);
    return () => onFormVisibilityChange(formView, false);
  }, [formView, onFormVisibilityChange, showCreate]);

  useCloseOnBackRequest(backRequest, showCreate, () => setShowCreate(false));

  function handleDocumentContactChange(value: string) {
    setContactId(value);
    const contact = state.contacts.find((entry) => entry.id === value);
    if (contact) setDocumentCurrency(contact.currency);
  }

  function documentHasJournal(document: AppStateShape['documents'][number]) {
    return state.journalEntries.some((entry) => entry.sourceType === document.kind && entry.sourceId === document.id);
  }

  function settlementAccountsFor(document?: AppStateShape['documents'][number]) {
    const cashBankAccounts = state.accounts.filter((account) => account.kind === 'cash' || account.kind === 'bank');
    if (!document) return cashBankAccounts;
    const sameCurrency = cashBankAccounts.filter((account) => account.currency === document.currency);
    if (document.currency === state.organization.baseCurrency) return sameCurrency;
    const baseCurrency = cashBankAccounts.filter((account) => account.currency === state.organization.baseCurrency);
    return [...sameCurrency, ...baseCurrency];
  }

  function defaultSettlementAccountId(document?: AppStateShape['documents'][number]) {
    return settlementAccountsFor(document)[0]?.id ?? '';
  }

  function selectedSettlementAccount(accountId = settlementAccountId) {
    return state.accounts.find((account) => account.id === accountId);
  }

  function isCrossCurrencySettlement(document?: AppStateShape['documents'][number], accountId = settlementAccountId) {
    const account = selectedSettlementAccount(accountId);
    return Boolean(document && account && account.currency !== document.currency);
  }

  function settlementComponentCurrencyFor(document: AppStateShape['documents'][number] | undefined, accountId = settlementAccountId) {
    if (!document) return undefined;
    return isCrossCurrencySettlement(document, accountId) ? state.organization.baseCurrency : document.currency;
  }

  function settlementAdjustmentAccountsFor(document: AppStateShape['documents'][number] | undefined, expectedKinds: AccountKind[], accountId = settlementAccountId) {
    const componentCurrency = settlementComponentCurrencyFor(document, accountId);
    return state.accounts.filter((account) => {
      if (!expectedKinds.includes(account.kind)) return false;
      return componentCurrency ? account.currency === componentCurrency : true;
    });
  }

  function defaultSettlementAdjustmentAccountId(document: AppStateShape['documents'][number] | undefined, expectedKinds: AccountKind[], accountId = settlementAccountId) {
    return settlementAdjustmentAccountsFor(document, expectedKinds, accountId)[0]?.id ?? '';
  }

  function isBankFeeAccount(account: AppStateShape['accounts'][number]) {
    return account.id === 'acc-bank-fee-expense' || account.name.toLowerCase().includes('bank fee');
  }

  function settlementBankFeeAccountsFor(document?: AppStateShape['documents'][number], accountId = settlementAccountId) {
    return [...settlementAdjustmentAccountsFor(document, ['expense'], accountId)].sort((a, b) => Number(isBankFeeAccount(b)) - Number(isBankFeeAccount(a)));
  }

  function defaultSettlementBankFeeAccountId(document?: AppStateShape['documents'][number], accountId = settlementAccountId) {
    const accounts = settlementBankFeeAccountsFor(document, accountId);
    return accounts.find(isBankFeeAccount)?.id ?? accounts[0]?.id ?? '';
  }

  function exchangeDifferenceAccountsFor(expectedKind: AccountKind) {
    const accounts = state.accounts.filter((account) => account.kind === expectedKind && account.currency === state.organization.baseCurrency);
    const exchangeAccounts = accounts.filter((account) => account.id.includes('exchange') || account.name.toLowerCase().includes('exchange'));
    return exchangeAccounts.length ? exchangeAccounts : accounts;
  }

  function defaultExchangeGainAccountId() {
    return exchangeDifferenceAccountsFor('income').find((account) => account.id === 'acc-exchange-gain')?.id ?? exchangeDifferenceAccountsFor('income')[0]?.id ?? '';
  }

  function defaultExchangeLossAccountId() {
    return exchangeDifferenceAccountsFor('expense').find((account) => account.id === 'acc-exchange-loss')?.id ?? exchangeDifferenceAccountsFor('expense')[0]?.id ?? '';
  }

  function pendingSettlementRemainingAmount(document?: AppStateShape['documents'][number]) {
    return document ? documentRemainingAmount(state, document) : 0;
  }

  function pendingSettlementRemainingAfterAmount(document?: AppStateShape['documents'][number]) {
    return Math.max(0, pendingSettlementRemainingAmount(document) - settlementAmount);
  }

  function pendingSettlementNetCashAmount(document?: AppStateShape['documents'][number]) {
    if (!document) return 0;
    return document.kind === 'sales'
      ? settlementAmount - settlementBankFeeAmount - settlementWithholdingTaxAmount
      : settlementAmount - settlementWithholdingTaxAmount + settlementBankFeeAmount;
  }

  function handleSettlementAccountChange(accountId: string) {
    setSettlementAccountId(accountId);
    const document = pendingSettlementDocument;
    if (document) {
      setSettlementBankFeeAccountId(defaultSettlementBankFeeAccountId(document, accountId));
      setSettlementWithholdingTaxAccountId(defaultSettlementAdjustmentAccountId(document, kind === 'sales' ? ['asset'] : ['liability'], accountId));
    }
    setSettlementError(null);
  }

  async function submit() {
    const result = await onAction({
      key: kind === 'sales' ? 'sales_document.create' : 'purchase_document.create',
      actor: humanOwnerActor,
      payload: {
        kind,
        contactId,
        currency: documentCurrency,
        documentDate: todayIsoDate(),
        dueDate,
        orderNumber: '',
        reference,
        vatNumber,
        title,
        categoryId,
        exchangeRate,
        tagIds: tagId ? [tagId] : [],
        attachmentNames: attachmentName.trim() ? [attachmentName] : [],
        items: items.map(cloneItem),
      },
    });

    setFormError(result.ok ? null : result.error ?? t('saveFailed'));
  }

  async function createContact() {
    const trimmedName = newContactName.trim();
    const result = await onAction({
      key: contactType === 'customer' ? 'customer.create' : 'vendor.create',
      actor: humanOwnerActor,
      payload: {
        type: contactType,
        name: trimmedName,
        code: generatedContactCode(contactType),
        email: newContactEmail,
        phone: newContactPhone,
        taxNumber: newContactTaxNumber,
        currency: newContactCurrency,
        address: newContactAddress,
      },
    });

    if (!result.ok || !result.state) {
      setFormError(result.error ?? t('saveFailed'));
      return;
    }

    const created = result.state.contacts.find((contact) => contact.type === contactType && contact.name === trimmedName);
    if (created) {
      setContactId(created.id);
      setDocumentCurrency(created.currency);
    }
    setNewContactName('');
    setNewContactEmail('');
    setNewContactPhone('');
    setNewContactTaxNumber('');
    setNewContactCurrency(state.organization.baseCurrency);
    setNewContactAddress('');
    setFormError(null);
  }

  async function updateStatus(
    documentId: string,
    status: DocumentStatus,
    settlement?: {
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
    },
  ) {
    const result = await onAction({
      key: kind === 'sales' ? 'sales_document.status.update' : 'purchase_document.status.update',
      actor: humanOwnerActor,
      payload: {
        kind,
        documentId,
        status,
        ...settlement,
      },
    });

    setFormError(result.ok ? null : result.error ?? t('saveFailed'));
    return result;
  }

  function beginStatusUpdate(documentId: string, status: DocumentStatus) {
    if (!isSettlementStatus(kind, status)) {
      void updateStatus(documentId, status);
      return;
    }

    const document = rows.find((entry) => entry.id === documentId);
    const defaultAccountId = defaultSettlementAccountId(document);
    setSettlementAccountId(defaultAccountId);
    setSettlementDate(todayIsoDate());
    setSettlementAmount(document ? documentRemainingAmount(state, document) : 0);
    setSettlementBankFeeAccountId(defaultSettlementBankFeeAccountId(document, defaultAccountId));
    setSettlementBankFeeAmount(0);
    setSettlementWithholdingTaxAccountId(defaultSettlementAdjustmentAccountId(document, kind === 'sales' ? ['asset'] : ['liability'], defaultAccountId));
    setSettlementWithholdingTaxAmount(0);
    setSettlementExchangeRate(0);
    setSettlementExchangeGainAccountId(defaultExchangeGainAccountId());
    setSettlementExchangeLossAccountId(defaultExchangeLossAccountId());
    setSettlementError(null);
    setPendingSettlement({ documentId, status });
    setFormError(null);
  }

  async function confirmSettlement() {
    if (!pendingSettlement) return;
    const document = rows.find((entry) => entry.id === pendingSettlement.documentId);
    const account = selectedSettlementAccount();
    const crossCurrency = isCrossCurrencySettlement(document);
    const remainingAmount = pendingSettlementRemainingAmount(document);
    if (!document || settlementAmount <= 0) {
      setSettlementError(t('settlementAmountRequired'));
      return;
    }
    if (Math.round(settlementAmount * 100) > Math.round(remainingAmount * 100)) {
      setSettlementError(t('settlementOverpayment'));
      return;
    }
    if (settlementBankFeeAmount < 0 || settlementWithholdingTaxAmount < 0) {
      setSettlementError(t('settlementAdjustmentNegative'));
      return;
    }
    if (settlementBankFeeAmount > settlementAmount) {
      setSettlementError(t('settlementBankFeeTooHigh'));
      return;
    }
    if (settlementWithholdingTaxAmount > settlementAmount) {
      setSettlementError(t('settlementWithholdingTaxTooHigh'));
      return;
    }
    if (pendingSettlementNetCashAmount(document) <= 0) {
      setSettlementError(t('settlementNetCashInvalid'));
      return;
    }
    if (crossCurrency) {
      if (account?.currency !== state.organization.baseCurrency) {
        setSettlementError(t('crossCurrencyAccountUnsupported'));
        return;
      }
      if (settlementExchangeRate <= 0) {
        setSettlementError(t('settlementExchangeRateRequired'));
        return;
      }
    }
    const result = await updateStatus(pendingSettlement.documentId, pendingSettlement.status, {
      settlementAccountId,
      settlementDate,
      settlementAmount,
      settlementBankFeeAccountId: settlementBankFeeAmount > 0 ? settlementBankFeeAccountId : undefined,
      settlementBankFeeAmount,
      settlementWithholdingTaxAccountId: settlementWithholdingTaxAmount > 0 ? settlementWithholdingTaxAccountId : undefined,
      settlementWithholdingTaxAmount,
      settlementExchangeRate: crossCurrency ? settlementExchangeRate : undefined,
      settlementExchangeGainAccountId: crossCurrency ? settlementExchangeGainAccountId : undefined,
      settlementExchangeLossAccountId: crossCurrency ? settlementExchangeLossAccountId : undefined,
    });
    setSettlementError(result.ok ? null : result.error ?? t('saveFailed'));
    if (result.ok) setPendingSettlement(null);
  }

  async function lockDocument(documentId: string) {
    const result = await onAction({
      key: 'document.lock',
      actor: humanOwnerActor,
      payload: {
        kind,
        documentId,
      },
    });

    setFormError(result.ok ? null : result.error ?? t('saveFailed'));
  }

  async function confirmLockDocument() {
    if (!pendingLockId) return;
    const documentId = pendingLockId;
    setPendingLockId(null);
    await lockDocument(documentId);
  }

  async function deleteDocument(documentId: string) {
    const result = await onAction({
      key: 'record.delete',
      actor: humanOwnerActor,
      payload: {
        recordType: 'document',
        kind,
        documentId,
      },
    });

    setFormError(result.ok ? null : result.error ?? t('saveFailed'));
  }

  async function confirmDeleteDocument() {
    if (!pendingDeleteId) return;
    const documentId = pendingDeleteId;
    setPendingDeleteId(null);
    await deleteDocument(documentId);
  }

  return (
    <section className="module-layout list-first">
      <ModuleOverview
        title={titleLabel}
        actionLabel={createLabel}
        onCreate={() => setShowCreate(true)}
        stats={[
          { label: t('total'), value: String(rows.length) },
          { label: kind === 'sales' ? t('openInvoices') : t('openBills'), value: String(openCount) },
          { label: t('locked'), value: String(lockedCount) },
          { label: t('amount'), value: moneyTotals(locale, amountTotals, state.organization.baseCurrency) },
        ]}
      />

      {showCreate ? (
        <FormPanel title={createLabel} onSubmit={submit} onCancel={() => setShowCreate(false)} t={t} error={formError}>
          <SelectField
            label={t('contact')}
            value={contactId}
            onChange={handleDocumentContactChange}
            options={[
              { value: '', label: t('none') },
              ...state.contacts.filter((contact) => contact.type === contactType).map((contact) => ({ value: contact.id, label: contact.name })),
            ]}
          />
          <SelectField label={t('currency')} value={documentCurrency} onChange={(value) => setDocumentCurrency(value as CurrencyCode)} options={currencyOptions()} />
          <div className="inline-create">
            <div className="inline-create-heading">
              <Users size={16} />
              <span>{contactType === 'customer' ? t('newCustomer') : t('newVendor')}</span>
            </div>
            <div className="inline-create-row">
              <TextField label={t('name')} value={newContactName} onChange={setNewContactName} placeholder={t('contactNamePlaceholder')} />
              <TextField label={t('email')} value={newContactEmail} onChange={setNewContactEmail} placeholder={t('emailPlaceholder')} />
              <TextField label={t('phone')} value={newContactPhone} onChange={setNewContactPhone} placeholder={t('phonePlaceholder')} />
              <TextField label={t('taxNumber')} value={newContactTaxNumber} onChange={setNewContactTaxNumber} placeholder={t('taxNumberPlaceholder')} />
              <SelectField
                label={t('currency')}
                value={newContactCurrency}
                onChange={(value) => setNewContactCurrency(value as CurrencyCode)}
                options={currencyOptions()}
              />
              <TextField label={t('address')} value={newContactAddress} onChange={setNewContactAddress} placeholder={t('addressPlaceholder')} />
              <button className="secondary-action compact" type="button" onClick={() => void createContact()}>
                <Plus size={16} />
                {t('create')}
              </button>
            </div>
          </div>
          <SelectField
            label={t('category')}
            value={categoryId}
            onChange={setCategoryId}
            options={state.categories
              .filter((category) => category.kind === kind)
              .map((category) => ({ value: category.id, label: `${categoryName(locale, category)} (${category.accountingCode})` }))}
          />
          <InlineCategoryCreate
            locale={locale}
            t={t}
            state={state}
            kind={kind}
            onAction={onAction}
            onCreated={setCategoryId}
            onError={setFormError}
          />
          <TextField label={t('reference')} value={reference} onChange={setReference} placeholder={t('referencePlaceholder')} />
          <TextField label={t('title')} value={title} onChange={setTitle} placeholder={t('titlePlaceholder')} />
          <DateField label={t('dueDate')} value={dueDate} onChange={setDueDate} />
          <TextField label={t('vatNumber')} value={vatNumber} onChange={setVatNumber} placeholder={t('vatNumberPlaceholder')} />
          <NumberField label={t('exchangeRate')} value={exchangeRate} min={0.000001} step={0.000001} onChange={setExchangeRate} />
          <SelectField
            label={t('tag')}
            value={tagId}
            onChange={setTagId}
            options={[{ value: '', label: t('none') }, ...(state.tags ?? []).filter((tag) => tag.enabled).map((tag) => ({ value: tag.id, label: tag.name }))]}
          />
          <TextField label={t('attachment')} value={attachmentName} onChange={setAttachmentName} placeholder={t('attachmentPlaceholder')} />
          <LineItemsEditor locale={locale} t={t} state={state} currency={documentCurrency} items={items} onChange={setItems} onAction={onAction} onError={setFormError} />
        </FormPanel>
      ) : null}

      <section className="panel">
        <h2>{titleLabel}</h2>
        <DataTable
          emptyLabel={t('noRows')}
          columns={['No.', t('reference'), t('contact'), t('dueDate'), t('tag'), t('amount'), t('documentStatus'), t('attachments'), t('action')]}
          rows={rows.map((entry) => {
            const contact = state.contacts.find((item) => item.id === entry.contactId);
            const nextStatus = entry.locked ? null : nextDocumentStatus(kind, entry.status);
            const deleteDisabled = entry.locked || documentHasJournal(entry);
            return [
              entry.documentNumber,
              entry.reference ?? '-',
              contact?.name ?? '-',
              entry.dueDate ?? '-',
              tagNames(state, entry.tagIds),
              money(locale, calculateItemsTotal(entry.items), entry.currency),
              entry.locked ? `${entry.status} (${t('locked')})` : entry.status,
              <AttachmentManager t={t} state={state} document={entry} attachmentApi={attachmentApi} />,
              (
                <div className="table-actions">
                  {nextStatus ? (
                    <button className="table-action" type="button" onClick={() => beginStatusUpdate(entry.id, nextStatus)}>
                      {nextStatus}
                    </button>
                  ) : null}
                  <button className="table-action" type="button" disabled={entry.locked} onClick={() => setPendingLockId(entry.id)}>
                    {t('lock')}
                  </button>
                  <button className="table-action danger-inline" type="button" disabled={deleteDisabled} onClick={() => setPendingDeleteId(entry.id)}>
                    <Trash2 size={14} />
                    {t('delete')}
                  </button>
                </div>
              ),
            ];
          })}
        />
      </section>
      {pendingDeleteDocument ? (
        <div className="confirmation-backdrop" role="presentation" onClick={() => setPendingDeleteId(null)}>
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-confirmation-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirmation-heading">
              <Trash2 size={18} />
              <h2 id="delete-confirmation-title">{t('deleteConfirmationTitle')}</h2>
            </div>
            <p className="confirmation-target">{pendingDeleteDocument.documentNumber}</p>
            <p>{t('deleteConfirmationBody')}</p>
            <div className="dialog-actions">
              <button className="secondary-action" type="button" onClick={() => setPendingDeleteId(null)}>
                {t('cancel')}
              </button>
              <button className="danger-action" type="button" onClick={() => void confirmDeleteDocument()}>
                <Trash2 size={16} />
                {t('confirmDelete')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {pendingLockDocument ? (
        <div className="confirmation-backdrop" role="presentation" onClick={() => setPendingLockId(null)}>
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lock-confirmation-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirmation-heading">
              <Lock size={18} />
              <h2 id="lock-confirmation-title">{t('lockConfirmationTitle')}</h2>
            </div>
            <p className="confirmation-target">{pendingLockDocument.documentNumber}</p>
            <p>{t('lockConfirmationBody')}</p>
            <div className="dialog-actions">
              <button className="secondary-action" type="button" onClick={() => setPendingLockId(null)}>
                {t('cancel')}
              </button>
              <button className="danger-action" type="button" onClick={() => void confirmLockDocument()}>
                <Lock size={16} />
                {t('confirmLock')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {pendingSettlementDocument && pendingSettlement ? (
        <div className="confirmation-backdrop" role="presentation" onClick={() => setPendingSettlement(null)}>
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settlement-confirmation-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirmation-heading">
              <Landmark size={18} />
              <h2 id="settlement-confirmation-title">{t('settlementConfirmationTitle')}</h2>
            </div>
            <p className="confirmation-target">{pendingSettlementDocument.documentNumber}</p>
            <p>{t('settlementConfirmationBody')}</p>
            <div className="settlement-summary">
              <span>
                {t('remainingBalance')}: {money(locale, pendingSettlementRemainingAmount(pendingSettlementDocument), pendingSettlementDocument.currency)}
              </span>
              <span>
                {t('remainingAfterSettlement')}: {money(locale, pendingSettlementRemainingAfterAmount(pendingSettlementDocument), pendingSettlementDocument.currency)}
              </span>
              <span>
                {t('netSettlementCash')}: {money(locale, pendingSettlementNetCashAmount(pendingSettlementDocument), pendingSettlementDocument.currency)}
              </span>
            </div>
            {isCrossCurrencySettlement(pendingSettlementDocument) ? <p className="dialog-note">{t('crossCurrencySettlementNote')}</p> : null}
            {settlementError ? <p className="form-error dialog-error">{settlementError}</p> : null}
            <div className="dialog-fields">
              <SelectField
                label={t('settlementAccount')}
                value={settlementAccountId}
                onChange={handleSettlementAccountChange}
                options={settlementAccountsFor(pendingSettlementDocument).map((account) => ({
                  value: account.id,
                  label: accountLabel(locale, account, 'name-currency'),
                }))}
              />
              <DateField label={t('settlementDate')} value={settlementDate} onChange={setSettlementDate} />
              <NumberField label={t('settlementAmount')} value={settlementAmount} min={0.01} onChange={setSettlementAmount} />
              {isCrossCurrencySettlement(pendingSettlementDocument) ? (
                <>
                  <NumberField
                    label={t('settlementExchangeRate')}
                    value={settlementExchangeRate}
                    min={0}
                    step={0.000001}
                    onChange={setSettlementExchangeRate}
                  />
                  <SelectField
                    label={t('settlementExchangeGainAccount')}
                    value={settlementExchangeGainAccountId}
                    onChange={setSettlementExchangeGainAccountId}
                    options={exchangeDifferenceAccountsFor('income').map((account) => ({
                      value: account.id,
                      label: accountLabel(locale, account, 'name-currency'),
                    }))}
                  />
                  <SelectField
                    label={t('settlementExchangeLossAccount')}
                    value={settlementExchangeLossAccountId}
                    onChange={setSettlementExchangeLossAccountId}
                    options={exchangeDifferenceAccountsFor('expense').map((account) => ({
                      value: account.id,
                      label: accountLabel(locale, account, 'name-currency'),
                    }))}
                  />
                </>
              ) : null}
              <NumberField
                label={t('settlementBankFeeAmount')}
                value={settlementBankFeeAmount}
                min={0}
                onChange={setSettlementBankFeeAmount}
              />
              <SelectField
                label={t('settlementBankFeeAccount')}
                value={settlementBankFeeAccountId}
                onChange={setSettlementBankFeeAccountId}
                options={settlementBankFeeAccountsFor(pendingSettlementDocument).map((account) => ({
                  value: account.id,
                  label: accountLabel(locale, account, 'name-currency'),
                }))}
              />
              <NumberField
                label={t('settlementWithholdingTaxAmount')}
                value={settlementWithholdingTaxAmount}
                min={0}
                onChange={setSettlementWithholdingTaxAmount}
              />
              <SelectField
                label={t('settlementWithholdingTaxAccount')}
                value={settlementWithholdingTaxAccountId}
                onChange={setSettlementWithholdingTaxAccountId}
                options={settlementAdjustmentAccountsFor(pendingSettlementDocument, kind === 'sales' ? ['asset'] : ['liability']).map((account) => ({
                  value: account.id,
                  label: accountLabel(locale, account, 'name-currency'),
                }))}
              />
            </div>
            <div className="dialog-actions">
              <button className="secondary-action" type="button" onClick={() => setPendingSettlement(null)}>
                {t('cancel')}
              </button>
              <button className="dialog-primary-action" type="button" onClick={() => void confirmSettlement()}>
                <Save size={16} />
                {t('confirmSettlement')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function InlineCategoryCreate({
  locale,
  t,
  state,
  kind,
  onAction,
  onCreated,
  onError,
}: {
  locale: Locale;
  t: Translator;
  state: AppStateShape;
  kind: CashTransactionKind | DocumentKind;
  onAction: (request: AccountingActionRequest) => Promise<AccountingActionResult>;
  onCreated: (categoryId: string) => void;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState(defaultCategoryName(kind));
  const [accountingCode, setAccountingCode] = useState(defaultCategoryCode(kind));
  const [accountId, setAccountId] = useState(defaultCategoryAccountId(state, kind));
  const accountOptions = accountOptionsForCategoryKind(state, kind, locale);
  const selectedAccountId = accountId || accountOptions[0]?.value || '';

  async function createCategoryInline() {
    const trimmedName = name.trim();
    const trimmedCode = accountingCode.trim();
    const result = await onAction({
      key: 'category.create',
      actor: humanOwnerActor,
      payload: {
        kind,
        name: trimmedName,
        accountingCode: trimmedCode,
        accountId: selectedAccountId,
      },
    });

    if (!result.ok || !result.state) {
      onError(result.error ?? t('saveFailed'));
      return;
    }

    const created = result.state.categories.find(
      (category) => category.kind === kind && category.accountingCode === trimmedCode && category.name === trimmedName,
    );
    if (created) onCreated(created.id);
    setName(defaultCategoryName(kind));
    setAccountingCode(defaultCategoryCode(kind));
    setAccountId(defaultCategoryAccountId(result.state, kind));
    onError(null);
  }

  return (
    <div className="inline-create">
      <div className="inline-create-heading">
        <ListTree size={16} />
        <span>{t('newCategory')}</span>
      </div>
      <div className="inline-create-row">
        <TextField label={t('name')} value={name} onChange={setName} placeholder={t('categoryNamePlaceholder')} />
        <TextField label={t('accountingCode')} value={accountingCode} onChange={setAccountingCode} placeholder={t('accountingCodePlaceholder')} />
        <SelectField label={t('account')} value={selectedAccountId} onChange={setAccountId} options={accountOptions} />
        <button className="secondary-action compact" type="button" onClick={() => void createCategoryInline()}>
          <Plus size={16} />
          {t('createAndUse')}
        </button>
      </div>
    </div>
  );
}

function CategoryModule({
  locale,
  t,
  state,
  onAction,
  backRequest,
  formView,
  onFormVisibilityChange,
}: {
  locale: Locale;
  t: Translator;
  state: AppStateShape;
  onAction: (request: AccountingActionRequest) => Promise<AccountingActionResult>;
} & FormNavigationProps) {
  const [kind, setKind] = useState<CashTransactionKind | DocumentKind>('revenue');
  const [name, setName] = useState('');
  const [accountingCode, setAccountingCode] = useState('');
  const [accountId, setAccountId] = useState(defaultCategoryAccountId(state, 'revenue'));
  const [formError, setFormError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const revenueCategoryCount = state.categories.filter((category) => category.kind === 'revenue' || category.kind === 'sales').length;
  const paymentCategoryCount = state.categories.filter((category) => category.kind === 'payment' || category.kind === 'purchase').length;
  const categoryAccountCount = new Set(state.categories.map((category) => category.accountId)).size;

  useEffect(() => {
    onFormVisibilityChange(formView, showCreate);
    return () => onFormVisibilityChange(formView, false);
  }, [formView, onFormVisibilityChange, showCreate]);

  useCloseOnBackRequest(backRequest, showCreate, () => setShowCreate(false));

  function changeKind(nextKind: string) {
    const categoryKind = nextKind as CashTransactionKind | DocumentKind;
    setKind(categoryKind);
    setAccountId(defaultCategoryAccountId(state, categoryKind));
  }

  async function submit() {
    const result = await onAction({
      key: 'category.create',
      actor: humanOwnerActor,
      payload: {
        kind,
        name,
        accountingCode,
        accountId,
      },
    });

    if (!result.ok) {
      setFormError(result.error ?? t('saveFailed'));
      return;
    }

    setName('');
    setAccountingCode('');
    setFormError(null);
  }

  return (
    <section className="module-layout list-first">
      <ModuleOverview
        title={t('categories')}
        actionLabel={t('createCategory')}
        onCreate={() => setShowCreate(true)}
        stats={[
          { label: t('total'), value: String(state.categories.length) },
          { label: t('revenue'), value: String(revenueCategoryCount), tone: 'positive' },
          { label: t('payment'), value: String(paymentCategoryCount), tone: 'negative' },
          { label: t('account'), value: String(categoryAccountCount) },
        ]}
      />

      {showCreate ? (
        <FormPanel title={t('createCategory')} onSubmit={submit} onCancel={() => setShowCreate(false)} t={t} error={formError}>
          <SelectField
            label={t('type')}
            value={kind}
            onChange={changeKind}
            options={categoryKinds.map((categoryKind) => ({ value: categoryKind, label: t(categoryKind) }))}
          />
          <TextField label={t('name')} value={name} onChange={setName} placeholder={t('categoryNamePlaceholder')} />
          <TextField label={t('accountingCode')} value={accountingCode} onChange={setAccountingCode} placeholder={t('accountingCodePlaceholder')} />
          <SelectField label={t('account')} value={accountId} onChange={setAccountId} options={accountOptionsForCategoryKind(state, kind, locale)} />
        </FormPanel>
      ) : null}

      <section className="panel">
        <h2>{t('categories')}</h2>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[t('type'), t('accountingCode'), t('name'), t('account')]}
          rows={state.categories.map((category) => {
            const account = state.accounts.find((entry) => entry.id === category.accountId);
            return [t(category.kind), category.accountingCode, categoryName(locale, category), account ? accountLabel(locale, account, 'code-name') : '-'];
          })}
        />
      </section>
    </section>
  );
}

function ProductModule({
  locale,
  t,
  state,
  onAction,
  backRequest,
  formView,
  onFormVisibilityChange,
}: {
  locale: Locale;
  t: Translator;
  state: AppStateShape;
  onAction: (request: AccountingActionRequest) => Promise<AccountingActionResult>;
} & FormNavigationProps) {
  const defaultTaxId = (state.taxes ?? []).find((tax) => tax.id === 'tax-none')?.id ?? state.taxes[0]?.id ?? '';
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [unitPrice, setUnitPrice] = useState(0);
  const [taxId, setTaxId] = useState(defaultTaxId);
  const [formError, setFormError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const products = state.products ?? [];
  const taxedCount = products.filter((product) => product.taxId && product.taxId !== 'tax-none').length;
  const productUnitCount = new Set(products.map((product) => product.unit)).size;
  const averagePrice = products.length ? products.reduce((total, product) => total + product.unitPrice, 0) / products.length : 0;

  useEffect(() => {
    onFormVisibilityChange(formView, showCreate);
    return () => onFormVisibilityChange(formView, false);
  }, [formView, onFormVisibilityChange, showCreate]);

  useCloseOnBackRequest(backRequest, showCreate, () => setShowCreate(false));

  async function submit() {
    const result = await onAction({
      key: 'product.create',
      actor: humanOwnerActor,
      payload: {
        code,
        name,
        unit,
        unitPrice,
        taxId,
      },
    });

    if (!result.ok) {
      setFormError(result.error ?? t('saveFailed'));
      return;
    }

    setCode('');
    setName('');
    setUnit('');
    setUnitPrice(0);
    setTaxId(defaultTaxId);
    setFormError(null);
  }

  return (
    <section className="module-layout list-first">
      <ModuleOverview
        title={t('products')}
        actionLabel={t('createProduct')}
        onCreate={() => setShowCreate(true)}
        stats={[
          { label: t('total'), value: String(products.length) },
          { label: t('unit'), value: String(productUnitCount) },
          { label: t('tax'), value: String(taxedCount) },
          { label: t('price'), value: money(locale, averagePrice, state.organization.baseCurrency) },
        ]}
      />

      {showCreate ? (
        <FormPanel title={t('createProduct')} onSubmit={submit} onCancel={() => setShowCreate(false)} t={t} error={formError}>
          <TextField label={t('code')} value={code} onChange={setCode} placeholder={t('productCodePlaceholder')} />
          <TextField label={t('name')} value={name} onChange={setName} placeholder={t('productNamePlaceholder')} />
          <TextField label={t('unit')} value={unit} onChange={setUnit} placeholder={t('unitPlaceholder')} />
          <NumberField label={t('price')} value={unitPrice} onChange={setUnitPrice} />
          <SelectField
            label={t('tax')}
            value={taxId}
            onChange={setTaxId}
            options={(state.taxes ?? []).filter((tax) => tax.enabled).map((tax) => ({ value: tax.id, label: `${taxName(locale, tax)} (${tax.rate}%)` }))}
          />
        </FormPanel>
      ) : null}

      <section className="panel">
        <h2>{t('products')}</h2>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[t('code'), t('name'), t('unit'), t('price'), t('tax')]}
          rows={products.map((product) => {
            const tax = (state.taxes ?? []).find((entry) => entry.id === product.taxId);
            return [product.code, product.name, product.unit, money(locale, product.unitPrice, state.organization.baseCurrency), tax ? `${taxName(locale, tax)} (${tax.rate}%)` : '-'];
          })}
        />
      </section>
    </section>
  );
}

function FormPanel({
  title,
  children,
  onSubmit,
  onCancel,
  t,
  error,
}: {
  title: string;
  children: React.ReactNode;
  onSubmit: () => void;
  onCancel?: () => void;
  t: Translator;
  error?: string | null;
}) {
  return (
    <section className="panel form-panel">
      <div className="form-panel-header">
        <h2>{title}</h2>
        {onCancel ? (
          <button className="secondary-action compact" type="button" onClick={onCancel}>
            {t('cancel')}
          </button>
        ) : null}
      </div>
      <div className="form-grid">{children}</div>
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <button className="primary-action" type="button" onClick={onSubmit}>
        <Save size={18} />
        {t('save')}
      </button>
    </section>
  );
}

function LineItemsEditor({
  locale,
  t,
  state,
  currency,
  items,
  onChange,
  onAction,
  onError,
}: {
  locale: Locale;
  t: Translator;
  state: AppStateShape;
  currency?: CurrencyCode;
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  onAction: (request: AccountingActionRequest) => Promise<AccountingActionResult>;
  onError: (message: string | null) => void;
}) {
  const total = calculateItemsTotal(items);
  const products = (state.products ?? []).filter((product) => product.enabled);
  const taxes = (state.taxes ?? []).filter((tax) => tax.enabled);
  const defaultTaxId = taxes.find((tax) => tax.id === 'tax-none')?.id ?? taxes[0]?.id ?? '';
  const [newProductCode, setNewProductCode] = useState(defaultProductCode());
  const [newProductName, setNewProductName] = useState('');
  const [newProductUnit, setNewProductUnit] = useState('');
  const [newProductPrice, setNewProductPrice] = useState(0);
  const [newProductTaxId, setNewProductTaxId] = useState(defaultTaxId);

  function updateItem(id: string, patch: Partial<LineItem>) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function productPatch(product: AppStateShape['products'][number], taxList = taxes) {
    const tax = product.taxId ? taxList.find((entry) => entry.id === product.taxId) : undefined;
    return {
      productId: product.id,
      name: product.name,
      unit: product.unit,
      unitPrice: product.unitPrice,
      taxId: tax?.id ?? 'tax-none',
      taxName: tax?.name,
      taxRate: tax?.rate ?? 0,
    };
  }

  function selectProduct(item: LineItem, productId: string) {
    const product = products.find((entry) => entry.id === productId);

    updateItem(
      item.id,
      product
        ? productPatch(product)
        : {
            productId: undefined,
            name: item.name,
            unit: item.unit,
            unitPrice: item.unitPrice,
          },
    );
  }

  function selectTax(item: LineItem, taxId: string) {
    const selectedTaxId = taxId || 'tax-none';
    const tax = taxes.find((entry) => entry.id === selectedTaxId);
    updateItem(item.id, {
      taxId: tax?.id ?? 'tax-none',
      taxName: tax?.name,
      taxRate: tax?.rate ?? 0,
    });
  }

  function addLine() {
    onChange([...items, lineFromProduct(state, '', 0)]);
  }

  function removeLine(id: string) {
    if (items.length === 1) return;
    onChange(items.filter((item) => item.id !== id));
  }

  async function createProductInline() {
    const trimmedCode = newProductCode.trim();
    const trimmedName = newProductName.trim();
    const result = await onAction({
      key: 'product.create',
      actor: humanOwnerActor,
      payload: {
        code: trimmedCode,
        name: trimmedName,
        unit: newProductUnit,
        unitPrice: newProductPrice,
        taxId: newProductTaxId,
      },
    });

    if (!result.ok || !result.state) {
      onError(result.error ?? t('saveFailed'));
      return;
    }

    const created = result.state.products.find((product) => product.code === trimmedCode && product.name === trimmedName);
    const targetItem = items.find((item) => !item.productId) ?? items[0];
    if (created && targetItem) {
      const resultTaxes = (result.state.taxes ?? []).filter((tax) => tax.enabled);
      updateItem(targetItem.id, productPatch(created, resultTaxes));
    }
    setNewProductCode(defaultProductCode());
    setNewProductName('');
    setNewProductUnit('');
    setNewProductPrice(0);
    setNewProductTaxId(defaultTaxId);
    onError(null);
  }

  return (
    <div className="line-items-block">
      <div className="inline-create">
        <div className="inline-create-heading">
          <Package size={16} />
          <span>{t('newProduct')}</span>
        </div>
        <div className="inline-create-row">
          <TextField label={t('code')} value={newProductCode} onChange={setNewProductCode} placeholder={t('productCodePlaceholder')} />
          <TextField label={t('name')} value={newProductName} onChange={setNewProductName} placeholder={t('productNamePlaceholder')} />
          <TextField label={t('unit')} value={newProductUnit} onChange={setNewProductUnit} placeholder={t('unitPlaceholder')} />
          <NumberField label={t('price')} value={newProductPrice} onChange={setNewProductPrice} />
          <SelectField
            label={t('tax')}
            value={newProductTaxId}
            onChange={setNewProductTaxId}
            options={taxes.map((tax) => ({ value: tax.id, label: tax.id === 'tax-none' ? t('none') : `${taxName(locale, tax)} (${tax.rate}%)` }))}
          />
          <button className="secondary-action compact" type="button" onClick={() => void createProductInline()}>
            <Plus size={16} />
            {t('createAndUse')}
          </button>
        </div>
      </div>
      {items.map((item, index) => (
        <div className="line-item-editor" key={item.id}>
          <SelectField
            label={t('product')}
            value={item.productId ?? ''}
            onChange={(productId) => selectProduct(item, productId)}
            options={[{ value: '', label: t('none') }, ...products.map((product) => ({ value: product.id, label: product.name }))]}
          />
          <TextField label={`${t('item')} ${index + 1}`} value={item.name} onChange={(name) => updateItem(item.id, { name })} placeholder={t('lineItemPlaceholder')} />
          <TextField label={t('unit')} value={item.unit} onChange={(unit) => updateItem(item.id, { unit })} placeholder={t('unitPlaceholder')} />
          <NumberField label={t('quantity')} value={item.quantity} onChange={(quantity) => updateItem(item.id, { quantity })} />
          <NumberField label={t('price')} value={item.unitPrice} onChange={(unitPrice) => updateItem(item.id, { unitPrice })} />
          <NumberField label={t('discount')} value={item.discount} onChange={(discount) => updateItem(item.id, { discount })} />
          <SelectField
            label={t('discountType')}
            value={item.discountType}
            onChange={(discountType) => updateItem(item.id, { discountType: discountType as LineItem['discountType'] })}
            options={[
              { value: 'percentage', label: t('percentage') },
              { value: 'amount', label: t('amountDiscount') },
            ]}
          />
          <SelectField
            label={t('tax')}
            value={item.taxId ?? 'tax-none'}
            onChange={(taxId) => selectTax(item, taxId)}
            options={[
              { value: 'tax-none', label: t('none') },
              ...taxes.filter((tax) => tax.id !== 'tax-none').map((tax) => ({ value: tax.id, label: `${taxName(locale, tax)} (${tax.rate}%)` })),
            ]}
          />
          <button
            className="icon-button danger"
            disabled={items.length === 1}
            onClick={() => removeLine(item.id)}
            title={t('removeLine')}
            type="button"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <div className="line-items-footer">
        <button className="secondary-action" onClick={addLine} type="button">
          <Plus size={16} />
          {t('addLine')}
        </button>
        <div className="computed-total">
          <span>{t('total')}</span>
          <strong>{money(locale, total, currency ?? state.organization.baseCurrency)}</strong>
        </div>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 0.01,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min={min} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DataTable({ columns, rows, emptyLabel }: { columns: string[]; rows: Array<Array<React.ReactNode>>; emptyLabel: string }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>{emptyLabel}</td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, index) => (
                  <td key={index}>{cell}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function Journals({ locale, t, state }: { locale: Locale; t: Translator; state: AppStateShape }) {
  return (
    <section className="panel">
      <h2>{t('journals')}</h2>
      <DataTable
        emptyLabel={t('noRows')}
        columns={[t('reference'), t('date'), t('lines')]}
        rows={state.journalEntries.map((entry) => [
          entry.reference,
          entry.entryDate,
          entry.lines
            .map((line) => {
              const account = state.accounts.find((item) => item.id === line.accountId);
              return `${account ? accountLabel(locale, account, 'code-name') : '-'} D:${line.debit} C:${line.credit}`;
            })
            .join(' | '),
        ])}
      />
    </section>
  );
}

function Reports({
  locale,
  t,
  state,
  onAction,
}: {
  locale: Locale;
  t: Translator;
  state: AppStateShape;
  onAction: (request: AccountingActionRequest) => Promise<AccountingActionResult>;
}) {
  const [selectedReportKey, setSelectedReportKey] = useState<ReportKey>('ledger');
  const [selectedAccountId, setSelectedAccountId] = useState(state.accounts[0]?.id ?? '');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [status, setStatus] = useState<DocumentStatus | 'all'>('all');
  const [filterName, setFilterName] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const [pendingDeleteFilterId, setPendingDeleteFilterId] = useState<string | null>(null);
  const filterSettings: ReportFilterSettings = {
    reportKey: selectedReportKey,
    ...(selectedAccountId ? { accountId: selectedAccountId } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    status,
  };
  const reportState = stateWithReportFilters(state, filterSettings);
  const selectedAccount = reportState.accounts.find((account) => account.id === selectedAccountId) ?? reportState.accounts[0];
  const ledgerRows = selectedAccount ? ledgerRowsForAccount(reportState, selectedAccount.id) : [];
  const traceRows = sourceTraceRows(reportState);
  const ledgerCurrency = selectedAccount?.currency ?? reportState.organization.baseCurrency;
  const endingBalance = selectedAccount ? accountBalance(reportState, selectedAccount.id) : 0;
  const trialRows = trialBalanceRows(reportState);
  const cashRows = cashMovementRows(reportState);
  const vatRows = vatSummaryRows(reportState);
  const snapshotRows = snapshotMetricRows(reportState);
  const customerAgingRows = documentAgingRows(reportState, 'sales');
  const vendorAgingRows = documentAgingRows(reportState, 'purchase');
  const pendingDeleteFilter = pendingDeleteFilterId
    ? (state.savedReportFilters ?? []).find((filter) => filter.id === pendingDeleteFilterId)
    : undefined;

  function applySavedFilter(filter: SavedReportFilter) {
    setSelectedReportKey(filter.settings.reportKey);
    setSelectedAccountId(filter.settings.accountId || state.accounts[0]?.id || '');
    setDateFrom(filter.settings.dateFrom || '');
    setDateTo(filter.settings.dateTo || '');
    setStatus(filter.settings.status || 'all');
    setFilterName(filter.name);
    setFilterError(null);
  }

  async function saveFilter() {
    const result = await onAction({
      key: 'report.filter.save',
      actor: humanOwnerActor,
      payload: {
        name: filterName,
        settings: filterSettings,
      },
    });
    setFilterError(result.ok ? null : result.error ?? t('saveFailed'));
  }

  async function confirmDeleteFilter() {
    if (!pendingDeleteFilterId) return;
    const filterId = pendingDeleteFilterId;
    setPendingDeleteFilterId(null);
    const result = await onAction({
      key: 'report.filter.delete',
      actor: humanOwnerActor,
      payload: { filterId },
    });
    setFilterError(result.ok ? null : result.error ?? t('saveFailed'));
  }

  function downloadSnapshot() {
    const payload = buildReportSnapshotPayload(state, filterSettings, {
      dataSourceMode: 'localhost-api',
      dataSourceLabel: t('localhostDatabase'),
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `accounting-report-snapshot-${todayIsoDate()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadTrialBalanceCsv() {
    downloadCsv(
      `trial-balance-${todayIsoDate()}.csv`,
      [t('account'), t('currency'), t('openingBalance'), t('debit'), t('credit'), t('endingBalance')],
      trialRows.map((row) => [
        accountLabel(locale, row.account, 'code-name'),
        row.account.currency,
        row.account.openingBalance,
        row.debit,
        row.credit,
        row.endingBalance,
      ]),
    );
  }

  function downloadCashMovementCsv() {
    downloadCsv(
      `cash-bank-movement-${todayIsoDate()}.csv`,
      [t('account'), t('currency'), t('openingBalance'), t('moneyIn'), t('moneyOut'), t('endingBalance')],
      cashRows.map(({ account, moneyIn, moneyOut, balance }) => [
        accountLabel(locale, account, 'code-name'),
        account.currency,
        account.openingBalance,
        moneyIn,
        moneyOut,
        balance,
      ]),
    );
  }

  function downloadLedgerCsv() {
    downloadCsv(
      `ledger-${selectedAccount?.code ?? 'account'}-${todayIsoDate()}.csv`,
      [t('date'), t('reference'), t('source'), t('account'), t('debit'), t('credit'), t('balance')],
      ledgerRows.map((row) => [
        row.entry.entryDate,
        row.entry.reference,
        `${t(row.entry.sourceType)} - ${journalSourceTarget(reportState, row.entry)}`,
        selectedAccount ? accountLabel(locale, selectedAccount, 'code-name') : '-',
        row.line.debit,
        row.line.credit,
        row.balance,
      ]),
    );
  }

  function downloadSourceTraceCsv() {
    downloadCsv(
      `source-trace-${todayIsoDate()}.csv`,
      [t('date'), t('source'), t('type'), t('documentStatus'), t('amount'), t('currency'), t('reference'), t('journals'), t('debit'), t('credit'), t('balance'), t('attachments')],
      traceRows.map((row) => [
        row.journalDate ?? row.sourceDate,
        row.sourceReference,
        t(row.sourceType),
        row.sourceStatus,
        row.sourceAmount,
        row.sourceCurrency,
        row.journalReference ?? '-',
        row.journalLineCount,
        row.debitTotal,
        row.creditTotal,
        sourceTracePostingLabel(t, row),
        row.attachmentCount,
      ]),
    );
  }

  function downloadSettlementHistoryCsv() {
    downloadCsv(
      `settlement-history-${todayIsoDate()}.csv`,
      [t('date'), t('document'), t('reference'), t('documentStatus'), t('cashAccount'), t('documentSettlementAmount'), t('cashSettlementAmount')],
      documentSettlementRows(reportState).map(({ entry, document, cashAccount, amount, cashAmount, cashCurrency }) => [
        entry.entryDate,
        `${document.documentNumber} - ${t(document.kind)}`,
        entry.reference,
        document.status,
        cashAccount ? accountLabel(locale, cashAccount, 'code-name') : '-',
        `${amount} ${document.currency}`,
        `${cashAmount} ${cashCurrency}`,
      ]),
    );
  }

  function downloadVatSummaryCsv() {
    downloadCsv(
      `vat-summary-${todayIsoDate()}.csv`,
      [t('date'), t('source'), t('type'), t('documentStatus'), t('contact'), t('direction'), t('tax'), t('taxRate'), t('netAmount'), t('taxAmount'), t('grossAmount')],
      vatRows.map((row) => [
        row.date,
        row.source,
        t(row.type),
        row.status,
        row.contactName,
        t(row.direction),
        row.taxName,
        row.taxRate,
        row.netAmount,
        row.taxAmount,
        row.grossAmount,
      ]),
    );
  }

  return (
    <section className="reports-layout">
      <section className="panel saved-report-panel">
        <div className="report-panel-header">
          <h2>{t('savedReportFilters')}</h2>
          <button className="secondary-action compact" type="button" onClick={saveFilter}>
            <Save size={16} />
            {t('saveFilter')}
          </button>
        </div>
        <div className="report-filter-grid">
          <TextField label={t('reportFilterName')} value={filterName} onChange={setFilterName} placeholder={t('reportFilterPlaceholder')} />
          <SelectField
            label={t('reportType')}
            value={selectedReportKey}
            onChange={(value) => setSelectedReportKey(value as ReportKey)}
            options={reportKeys.map((reportKey) => ({ value: reportKey, label: reportKeyLabel(t, reportKey) }))}
          />
          <SelectField
            label={t('account')}
            value={selectedAccountId}
            onChange={setSelectedAccountId}
            options={state.accounts.map((account) => ({ value: account.id, label: accountLabel(locale, account, 'code-name') }))}
          />
          <DateField label={t('dateFrom')} value={dateFrom} onChange={setDateFrom} />
          <DateField label={t('dateTo')} value={dateTo} onChange={setDateTo} />
          <SelectField
            label={t('reportStatus')}
            value={status}
            onChange={(value) => setStatus(value as DocumentStatus | 'all')}
            options={reportStatusOptions.map((entry) => ({ value: entry, label: entry === 'all' ? t('allStatuses') : entry }))}
          />
        </div>
        {filterError ? (
          <div className="form-error" role="alert">
            {filterError}
          </div>
        ) : null}
        <DataTable
          emptyLabel={t('noRows')}
          columns={[t('name'), t('reportType'), t('account'), t('date'), t('documentStatus'), t('action')]}
          rows={(state.savedReportFilters ?? []).map((filter) => {
            const account = filter.settings.accountId ? state.accounts.find((entry) => entry.id === filter.settings.accountId) : undefined;
            return [
              filter.name,
              reportKeyLabel(t, filter.settings.reportKey),
              account ? accountLabel(locale, account, 'code-name') : '-',
              `${filter.settings.dateFrom || '-'} - ${filter.settings.dateTo || '-'}`,
              filter.settings.status && filter.settings.status !== 'all' ? filter.settings.status : t('allStatuses'),
              <div className="table-actions" key={filter.id}>
                <button className="table-action" type="button" onClick={() => applySavedFilter(filter)}>
                  {t('applyFilter')}
                </button>
                <button className="table-action danger-inline" type="button" onClick={() => setPendingDeleteFilterId(filter.id)}>
                  <Trash2 size={14} />
                  {t('deleteFilter')}
                </button>
              </div>,
            ];
          })}
        />
      </section>

      <section className="panel">
        <div className="report-panel-header">
          <h2>{t('ledgerByAccount')}</h2>
          <button className="secondary-action compact" type="button" onClick={downloadLedgerCsv}>
            <FileDown size={16} />
            {t('downloadCsv')}
          </button>
        </div>
        <div className="report-toolbar">
          <SelectField
            label={t('account')}
            value={selectedAccount?.id ?? ''}
            onChange={setSelectedAccountId}
            options={state.accounts.map((account) => ({ value: account.id, label: accountLabel(locale, account, 'code-name') }))}
          />
          <div className="report-summary">
            <span>{t('openingBalance')}</span>
            <strong>{money(locale, selectedAccount?.openingBalance ?? 0, ledgerCurrency)}</strong>
          </div>
          <div className="report-summary">
            <span>{t('endingBalance')}</span>
            <strong>{money(locale, endingBalance, ledgerCurrency)}</strong>
          </div>
        </div>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[t('date'), t('reference'), t('source'), t('debit'), t('credit'), t('balance')]}
          rows={ledgerRows.map((row) => [
            row.entry.entryDate,
            row.entry.reference,
            `${t(row.entry.sourceType)} - ${journalSourceTarget(reportState, row.entry)}`,
            money(locale, row.line.debit, ledgerCurrency),
            money(locale, row.line.credit, ledgerCurrency),
            money(locale, row.balance, ledgerCurrency),
          ])}
        />
      </section>

      <section className="panel">
        <div className="report-panel-header">
          <h2>{t('sourceTrace')}</h2>
          <button className="secondary-action compact" type="button" onClick={downloadSourceTraceCsv}>
            <FileDown size={16} />
            {t('downloadCsv')}
          </button>
        </div>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[t('date'), t('source'), t('type'), t('documentStatus'), t('amount'), t('reference'), t('journals'), t('balance'), t('attachments')]}
          rows={traceRows.map((row) => [
            row.journalDate ?? row.sourceDate,
            row.sourceReference,
            t(row.sourceType),
            row.sourceStatus,
            money(locale, row.sourceAmount, row.sourceCurrency),
            row.journalReference ?? '-',
            row.journalLineCount,
            sourceTracePostingLabel(t, row),
            String(row.attachmentCount),
          ])}
        />
      </section>

      <section className="panel">
        <div className="report-panel-header">
          <h2>{t('trialBalance')}</h2>
          <button className="secondary-action compact" type="button" onClick={downloadTrialBalanceCsv}>
            <FileDown size={16} />
            {t('downloadCsv')}
          </button>
        </div>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[t('account'), t('currency'), t('openingBalance'), t('debit'), t('credit'), t('endingBalance')]}
          rows={trialRows.map((row) => [
            accountLabel(locale, row.account, 'code-name'),
            row.account.currency,
            money(locale, row.account.openingBalance, row.account.currency),
            money(locale, row.debit, row.account.currency),
            money(locale, row.credit, row.account.currency),
            money(locale, row.endingBalance, row.account.currency),
          ])}
        />
      </section>

      <section className="panel">
        <div className="report-panel-header">
          <h2>{t('cashBankMovement')}</h2>
          <button className="secondary-action compact" type="button" onClick={downloadCashMovementCsv}>
            <FileDown size={16} />
            {t('downloadCsv')}
          </button>
        </div>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[t('account'), t('currency'), t('openingBalance'), t('moneyIn'), t('moneyOut'), t('endingBalance')]}
          rows={cashRows.map(({ account, moneyIn, moneyOut, balance }) => [
            accountLabel(locale, account, 'code-name'),
            account.currency,
            money(locale, account.openingBalance, account.currency),
            money(locale, moneyIn, account.currency),
            money(locale, moneyOut, account.currency),
            money(locale, balance, account.currency),
          ])}
        />
      </section>

      <section className="panel">
        <div className="report-panel-header">
          <h2>{t('documentSettlementHistory')}</h2>
          <button className="secondary-action compact" type="button" onClick={downloadSettlementHistoryCsv}>
            <FileDown size={16} />
            {t('downloadCsv')}
          </button>
        </div>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[t('date'), t('document'), t('reference'), t('documentStatus'), t('cashAccount'), t('documentSettlementAmount'), t('cashSettlementAmount')]}
          rows={documentSettlementRows(reportState).map(({ entry, document, cashAccount, amount, cashAmount, cashCurrency }) => [
            entry.entryDate,
            `${document.documentNumber} - ${t(document.kind)}`,
            entry.reference,
            document.status,
            cashAccount ? accountLabel(locale, cashAccount, 'code-name') : '-',
            money(locale, amount, document.currency),
            money(locale, cashAmount, cashCurrency),
          ])}
        />
      </section>

      <section className="panel">
        <div className="report-panel-header">
          <h2>{t('vatSummary')}</h2>
          <button className="secondary-action compact" type="button" onClick={downloadVatSummaryCsv}>
            <FileDown size={16} />
            {t('downloadCsv')}
          </button>
        </div>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[
            t('date'),
            t('source'),
            t('type'),
            t('documentStatus'),
            t('contact'),
            t('direction'),
            t('tax'),
            t('taxRate'),
            t('netAmount'),
            t('taxAmount'),
            t('grossAmount'),
          ]}
          rows={vatRows.map((row) => [
            row.date,
            row.source,
            t(row.type),
            row.status,
            row.contactName,
            t(row.direction),
            row.taxName,
            `${row.taxRate}%`,
            money(locale, row.netAmount, row.currency),
            money(locale, row.taxAmount, row.currency),
            money(locale, row.grossAmount, row.currency),
          ])}
        />
      </section>

      <section className="panel print-snapshot">
        <div className="report-panel-header">
          <h2>{t('reportSnapshot')}</h2>
          <div className="report-actions">
            <button className="secondary-action compact" type="button" onClick={downloadSnapshot}>
              <FileDown size={16} />
              {t('downloadSnapshot')}
            </button>
            <button className="secondary-action compact" type="button" onClick={() => window.print()}>
              <Printer size={16} />
              {t('printSnapshot')}
            </button>
          </div>
        </div>
        <DataTable emptyLabel={t('noRows')} columns={[t('reportType'), t('value')]} rows={snapshotRows.map((row) => [t(row.key), row.value])} />
      </section>

      <section className="panel">
        <h2>{t('customerAging')}</h2>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[
            t('contact'),
            t('document'),
            t('dueDate'),
            t('current'),
            t('days1To30'),
            t('days31To60'),
            t('days61To90'),
            t('daysOver90'),
            t('balance'),
          ]}
          rows={customerAgingRows.map((row) => [
            row.contactName,
            row.document.documentNumber,
            row.document.dueDate ?? '-',
            money(locale, row.current, row.document.currency),
            money(locale, row.days1To30, row.document.currency),
            money(locale, row.days31To60, row.document.currency),
            money(locale, row.days61To90, row.document.currency),
            money(locale, row.daysOver90, row.document.currency),
            money(locale, row.remainingAmount, row.document.currency),
          ])}
        />
      </section>

      <section className="panel">
        <h2>{t('vendorAging')}</h2>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[
            t('contact'),
            t('document'),
            t('dueDate'),
            t('current'),
            t('days1To30'),
            t('days31To60'),
            t('days61To90'),
            t('daysOver90'),
            t('balance'),
          ]}
          rows={vendorAgingRows.map((row) => [
            row.contactName,
            row.document.documentNumber,
            row.document.dueDate ?? '-',
            money(locale, row.current, row.document.currency),
            money(locale, row.days1To30, row.document.currency),
            money(locale, row.days31To60, row.document.currency),
            money(locale, row.days61To90, row.document.currency),
            money(locale, row.daysOver90, row.document.currency),
            money(locale, row.remainingAmount, row.document.currency),
          ])}
        />
      </section>
      {pendingDeleteFilter ? (
        <div className="confirmation-backdrop" role="presentation" onClick={() => setPendingDeleteFilterId(null)}>
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-filter-delete-confirmation-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirmation-heading">
              <Trash2 size={18} />
              <h2 id="report-filter-delete-confirmation-title">{t('deleteFilterConfirmationTitle')}</h2>
            </div>
            <p className="confirmation-target">{pendingDeleteFilter.name}</p>
            <p>{t('deleteFilterConfirmationBody')}</p>
            <div className="dialog-actions">
              <button className="secondary-action" type="button" onClick={() => setPendingDeleteFilterId(null)}>
                {t('cancel')}
              </button>
              <button className="danger-action" type="button" onClick={() => void confirmDeleteFilter()}>
                <Trash2 size={16} />
                {t('confirmDelete')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function LegacyReports({ t, state }: { t: Translator; state: AppStateShape }) {
  const locale: Locale = 'en';
  const [selectedAccountId, setSelectedAccountId] = useState(state.accounts[0]?.id ?? '');
  const selectedAccount = state.accounts.find((account) => account.id === selectedAccountId) ?? state.accounts[0];
  const ledgerRows = selectedAccount ? ledgerRowsForAccount(state, selectedAccount.id) : [];
  const ledgerCurrency = selectedAccount?.currency ?? state.organization.baseCurrency;
  const endingBalance = selectedAccount ? accountBalance(state, selectedAccount.id) : 0;
  const trialRows = trialBalanceRows(state);
  const vatRows = vatSummaryRows(state);
  const snapshotRows = snapshotMetricRows(state);
  const customerAgingRows = documentAgingRows(state, 'sales');
  const vendorAgingRows = documentAgingRows(state, 'purchase');

  function downloadSnapshot() {
    const payload = buildReportSnapshotPayload(state, { reportKey: 'snapshot', status: 'all' }, {
      dataSourceMode: 'localhost-api',
      dataSourceLabel: t('localhostDatabase'),
    });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `accounting-report-snapshot-${todayIsoDate()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="reports-layout">
      <section className="panel">
        <h2>{t('ledgerByAccount')}</h2>
        <div className="report-toolbar">
          <SelectField
            label={t('account')}
            value={selectedAccount?.id ?? ''}
            onChange={setSelectedAccountId}
            options={state.accounts.map((account) => ({ value: account.id, label: `${account.code} ${account.name}` }))}
          />
          <div className="report-summary">
            <span>{t('openingBalance')}</span>
            <strong>{money(locale, selectedAccount?.openingBalance ?? 0, ledgerCurrency)}</strong>
          </div>
          <div className="report-summary">
            <span>{t('endingBalance')}</span>
            <strong>{money(locale, endingBalance, ledgerCurrency)}</strong>
          </div>
        </div>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[t('date'), t('reference'), t('source'), t('debit'), t('credit'), t('balance')]}
          rows={ledgerRows.map((row) => [
            row.entry.entryDate,
            row.entry.reference,
            `${t(row.entry.sourceType)} ? ${journalSourceTarget(state, row.entry)}`,
            money(locale, row.line.debit, ledgerCurrency),
            money(locale, row.line.credit, ledgerCurrency),
            money(locale, row.balance, ledgerCurrency),
          ])}
        />
      </section>

      <section className="panel">
        <h2>{t('trialBalance')}</h2>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[t('account'), t('currency'), t('openingBalance'), t('debit'), t('credit'), t('endingBalance')]}
          rows={trialRows.map((row) => [
            `${row.account.code} ${row.account.name}`,
            row.account.currency,
            money(locale, row.account.openingBalance, row.account.currency),
            money(locale, row.debit, row.account.currency),
            money(locale, row.credit, row.account.currency),
            money(locale, row.endingBalance, row.account.currency),
          ])}
        />
      </section>

      <section className="panel">
        <h2>{t('cashBankMovement')}</h2>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[t('account'), t('currency'), t('openingBalance'), t('moneyIn'), t('moneyOut'), t('endingBalance')]}
          rows={cashMovementRows(state).map(({ account, moneyIn, moneyOut, balance }) => [
            `${account.code} ${account.name}`,
            account.currency,
            money(locale, account.openingBalance, account.currency),
            money(locale, moneyIn, account.currency),
            money(locale, moneyOut, account.currency),
            money(locale, balance, account.currency),
          ])}
        />
      </section>

      <section className="panel">
        <h2>{t('documentSettlementHistory')}</h2>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[t('date'), t('document'), t('reference'), t('documentStatus'), t('cashAccount'), t('documentSettlementAmount'), t('cashSettlementAmount')]}
          rows={documentSettlementRows(state).map(({ entry, document, cashAccount, amount, cashAmount, cashCurrency }) => [
            entry.entryDate,
            `${document.documentNumber} ? ${t(document.kind)}`,
            entry.reference,
            document.status,
            cashAccount ? `${cashAccount.code} ${cashAccount.name}` : '-',
            money(locale, amount, document.currency),
            money(locale, cashAmount, cashCurrency),
          ])}
        />
      </section>

      <section className="panel">
        <h2>{t('vatSummary')}</h2>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[
            t('date'),
            t('source'),
            t('type'),
            t('documentStatus'),
            t('contact'),
            t('direction'),
            t('tax'),
            t('taxRate'),
            t('netAmount'),
            t('taxAmount'),
            t('grossAmount'),
          ]}
          rows={vatRows.map((row) => [
            row.date,
            row.source,
            t(row.type),
            row.status,
            row.contactName,
            t(row.direction),
            row.taxName,
            `${row.taxRate}%`,
            money(locale, row.netAmount, row.currency),
            money(locale, row.taxAmount, row.currency),
            money(locale, row.grossAmount, row.currency),
          ])}
        />
      </section>

      <section className="panel print-snapshot">
        <div className="report-panel-header">
          <h2>{t('reportSnapshot')}</h2>
          <div className="report-actions">
            <button className="secondary-action compact" type="button" onClick={downloadSnapshot}>
              <FileDown size={16} />
              {t('downloadSnapshot')}
            </button>
            <button className="secondary-action compact" type="button" onClick={() => window.print()}>
              <Printer size={16} />
              {t('printSnapshot')}
            </button>
          </div>
        </div>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[t('reportType'), t('value')]}
          rows={snapshotRows.map((row) => [t(row.key), row.value])}
        />
      </section>

      <section className="panel">
        <h2>{t('customerAging')}</h2>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[
            t('contact'),
            t('document'),
            t('dueDate'),
            t('current'),
            t('days1To30'),
            t('days31To60'),
            t('days61To90'),
            t('daysOver90'),
            t('balance'),
          ]}
          rows={customerAgingRows.map((row) => [
            row.contactName,
            row.document.documentNumber,
            row.document.dueDate ?? '-',
            money(locale, row.current, row.document.currency),
            money(locale, row.days1To30, row.document.currency),
            money(locale, row.days31To60, row.document.currency),
            money(locale, row.days61To90, row.document.currency),
            money(locale, row.daysOver90, row.document.currency),
            money(locale, row.remainingAmount, row.document.currency),
          ])}
        />
      </section>

      <section className="panel">
        <h2>{t('vendorAging')}</h2>
        <DataTable
          emptyLabel={t('noRows')}
          columns={[
            t('contact'),
            t('document'),
            t('dueDate'),
            t('current'),
            t('days1To30'),
            t('days31To60'),
            t('days61To90'),
            t('daysOver90'),
            t('balance'),
          ]}
          rows={vendorAgingRows.map((row) => [
            row.contactName,
            row.document.documentNumber,
            row.document.dueDate ?? '-',
            money(locale, row.current, row.document.currency),
            money(locale, row.days1To30, row.document.currency),
            money(locale, row.days31To60, row.document.currency),
            money(locale, row.days61To90, row.document.currency),
            money(locale, row.daysOver90, row.document.currency),
            money(locale, row.remainingAmount, row.document.currency),
          ])}
        />
      </section>
    </section>
  );
}

function ActionContracts({ t }: { t: Translator }) {
  return (
    <section className="panel">
      <h2>{t('actions')}</h2>
      <DataTable
        emptyLabel={t('noRows')}
        columns={[t('action'), t('permission'), t('risk'), t('confirmation')]}
        rows={getActionCatalog().map((action) => [
          action.key,
          action.permission,
          action.risk,
          action.requiresConfirmation ? t('required') : t('notRequired'),
        ])}
      />
      <div className="note-row">
        <ShieldCheck size={18} />
        <span>{t('aiActionNote')}</span>
      </div>
      <div className="note-row">
        <Lock size={18} />
        <span>{t('highRiskNote')}</span>
      </div>
    </section>
  );
}
