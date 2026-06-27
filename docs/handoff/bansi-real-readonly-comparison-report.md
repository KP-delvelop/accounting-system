# Real Bansi Read-only Extraction + Local Demo Comparison Report

Date: 2026-06-26

Scope: read-only exploration of the real Bansi account plus sanitized local demo comparison and destructive fake-data verification. The real Bansi site was treated as live production data: no create, update, delete, save, approve, post, settle, upload, import, send, invite, settings, or permission-changing actions were performed. Credentials and OTP are intentionally omitted.

## Overall Status

Status: PASS for this builder-side comparison pass.

The local demo remains a strong local-first prototype / demo / targeted-UAT candidate. Compared with the real Bansi account observed in read-only mode, the local system is close for the core accounting flows that have already been built: cash revenue/payment, invoices/bills, document status transitions, journals, FX settlement, fee/WHT, attachments, report snapshots, CSV exports, localization, dark mode, auth stub, and conflict handling.

It is not a full production Bansi replacement. The real site has a broader module surface: payroll, deeper inventory/warehousing, banking transfers/assets, import/export/PDF flows, detail pages with journal voucher and ledger links, settings/user management, and more reporting surfaces. These are listed below as backlog or intentional limitations rather than bugs in the implemented scope.

## Real Bansi Extraction Log

Session status:

- Logged into the real Bansi site and reached `https://bansi.la/dashboard`.
- Real account/company context visible: `[real account context redacted]`.
- Subscription/read-only condition was visible: the account appeared able to view old records but not add/change new records.
- Exploration was read-only. Risky or ambiguous actions were not clicked.

Pages and modules observed:

| Area | Pages / sections viewed | Read-only observations |
| --- | --- | --- |
| Dashboard | `/dashboard` | Cards/widgets for income, income/out, expenses, account balances, recent revenue/expense, company context, notifications/subscription prompt, NPS prompt. Year/month/quarter filters appear in URL query shape. |
| Main navigation | Dashboard DOM/nav tree | Large module tree: incomes, expenses, payroll, inventory/items, banking/assets, accounting, settings, reports, help/profile/language controls. |
| Incomes / revenues | `/incomes/revenues`, existing revenue detail | Revenue list has filters for date range, number, category, customer, account; columns include number, category/tag, customer, amount, date, account, created by, status, actions. Detail page has movement, journal entries, summary, journal voucher / ledger links, print/lock/delete/edit/recurring/tag controls visible but not clicked. |
| Invoices | `/incomes/invoices` | Invoice list has filters for date, number, category, customer, status, overdue; status options include draft, quotation, invoice, receipt, all statuses. Columns include number, category/tag, customer, amount, date, created by, status, actions. |
| Customers | `/incomes/customers` | Customer list has query/status filters and table columns: number, name, phone/email, address, tax number, accounting code, status, actions. Sample names were viewed but not copied into this report. |
| Expenses / payments | `/expenses/payments`, existing payment detail | Payment list has date, number, category, vendor, account filters; columns include number, category/tag, vendor, amount, date, account, created by, status, actions. Detail page shows movement, journal entries, summary, attachment section, journal voucher / ledger links, print/PDF/delete/edit/recurring/tag controls visible but not clicked. |
| Bills | `/expenses/bills` | Bill list has date, number, category, vendor, status, overdue filters; status options include draft, purchase order, bill, paid, all statuses. Columns mirror invoice list with vendor. |
| Vendors | `/expenses/vendors` | Vendor list has query/status filters and table columns: number, name, phone/email, address, tax number, accounting code, status, actions. Real contact details were not copied into this report. |
| Products/services | `/items/products` | Product/service list has filters for type, query/product code/name, category, accounting code, status. Columns include type, name/product code, category, purchase price, sale price, accounting code, status, actions. |
| Banking accounts | `/banking/accounts` | Account list has name, tracking start date, opening balance, current balance, money account type, user, accounting code, status, actions. LAK, THB, and USD accounts were visible. |
| Accounting codes | `/accountings/accounting-codes` | Chart of accounts has filters for code/name/type/group and columns for code, name, type, group, status, actions. Account types include asset, liability, equity, expense, income. |
| General journals | `/accountings/general-journals` | Journal list has filters for date range, journal book, reference; columns include number, date, journal book, amount, reference, created by, status, actions. |
| Trial balance | `/accountings/trial-balances` | Report supports date/report-date/journal-book/tag/sub-account filters and PDF/Excel export controls. Columns separate opening balance, movement, ending balance, debit, and credit. |
| Settings categories | `/settings/categories` | Category list has type/name/accounting-code/status filters; category types include revenue, expense, asset, liability, equity. |
| Settings currencies | `/settings/currencies` | Currency list has name, code, exchange rate, example, status, actions. LAK/THB/USD were observed across account/currency surfaces. |
| Settings taxes | `/settings/taxes` | Tax list has name, rate %, tax included/calculated, exempt, status, actions. VAT configuration was visible in this account. |

Unsafe / intentionally not clicked:

- Create/add buttons, edit/delete/duplicate/lock/save/import/upload/send/email/invite/settings controls.
- NPS score links because they likely write feedback.
- Print/PDF/Excel/download actions on the real account, even though they are probably read-only, because they could export real data.
- Journal add/save/toggle controls in detail pages.
- Edit links hidden behind contact/product/account names.

## Prototype / Expected Similarity Assessment

| Area | Similarity estimate | What matches | Important gaps / differences |
| --- | ---: | --- | --- |
| Dashboard / account overview | 70% | Local demo has dashboard cards, recent activity, account balances, brand/company context, language/theme controls. | Real Bansi has more widgets, company selector/subscription/NPS/help prompts, and deeper filters. Local intentionally hides dev controls and uses a compact dropdown menu per user request. |
| Main navigation | 55% | Local demo covers core income, expense, accounting, reports, AI/actions surfaces. | Real Bansi has a much larger module tree: payroll, inventory/warehousing, banking transfers/assets, settings submodules, many report links. Local dropdown is intentionally simpler. |
| Customers/vendors/products/categories | 75% | Local supports create/list-style master data and accounting category links; product/service basics exist. | Real product list has purchase price, sale price, product code, status, categories, imports/exports. Customer/vendor detail management is deeper in real Bansi. |
| Revenue/payment cash workflow | 80% | Local cash revenue/payment posts balanced journals, supports category/contact/account/date/reference/items/tax/attachments and report visibility. | Real payment detail can show multi-line journal splits and richer voucher/ledger links. Local cash transaction UI is simpler and cash transaction attachment UI is still deferred. |
| Invoice/bill workflow | 85% | Local supports sales quotation -> invoice -> receipt and purchase order -> bill -> paid, partial/final settlement, locked/delete guards, attachments, reports. | Real Bansi also exposes draft states, print/PDF/Excel/settings/import flows, detail pages, and journal voucher/ledger links. |
| FX settlement + fee/WHT | 90% | Local has strong backend/UI support for sales/purchase, partial/final, bank fee, WHT, realized gain/loss, and cash disclosure. | Real Bansi policy still needs manual accounting UAT against live accounting rules. Non-base settlement account remains intentionally unsupported. |
| Reports/export/print | 75% | Local has backend reports, snapshot JSON, print snapshot QA, CSV for trial balance and cash/bank movement, settlement-history cash disclosure. | Real Bansi has many more report pages and PDF/Excel export controls across lists/reports. Local does not yet have PDF/email/import or backend CSV endpoints. |
| Attachments | 70% | Local document attachments upload/list/download/delete with safe storage and no `storagePath` leak. | Real detail pages show attachment areas across revenue/payment/document flows; local cash transaction attachment UI is not opened yet. No preview/OCR/virus scan/cloud storage. |
| Localization | 70% | Local supports EN/TH/LO and localized system UI; known master display names are localized. | Real Bansi has Lao-first UI plus additional language switches such as English, Vietnamese, and Chinese. Thai is local-project specific. |
| Auth/session/security | 55% | Local has bearer-token stub, server-derived actor in required mode, admin endpoint guards, UI token panel. | Real production auth/session/provider behavior is not cloned. Local auth remains a test stub and requires provider decision before production. |
| Concurrency/readiness | 70% | Local has revision conflict guard and readiness check. | Real Bansi likely uses server/database concurrency and production infrastructure; local remains file-backed. |

Overall similarity estimate: 75-80% for the implemented local-first accounting prototype scope, 55-65% against the full real Bansi product surface.

## Difference Matrix

| Expected / real Bansi behavior | Local demo behavior | Gap / difference | Severity / impact | Status |
| --- | --- | --- | --- | --- |
| Real navigation contains incomes, expenses, payroll, inventory/items, banking/assets, accounting, settings, and many reports. | Local navigation is compact and focused on core accounting prototype modules. | Payroll, deep inventory, banking transfers/assets, settings/user management are missing. | High if cloning full product; low for current prototype. | Backlog |
| Real list pages expose import, Excel, PDF, print, duplicate, delete, settings actions. | Local supports selected CSV/snapshot/print and no broad import/PDF/email. | Export/import/action surface is smaller. | Medium | Backlog |
| Real invoice status filter includes draft/quotation/invoice/receipt. Real bill status filter includes draft/purchase-order/bill/paid. | Local starts sales at quotation and purchase at purchase order; no explicit draft workflow. | Draft state differs. | Medium | Backlog / decision needed |
| Real payment detail can show multi-line journal splits and tax-related lines in richer detail pages. | Local cash payments post balanced journal lines but UI/detail and split-voucher behavior are simpler. | Multi-line voucher UX and detailed ledger drilldowns are not equivalent. | Medium | Backlog / accounting UAT |
| Real detail pages include movement, journal entries, summary, journal voucher, ledger links, tags, recurring, lock/delete/edit/print controls. | Local row/detail behavior is simpler; no recurring documents or ledger drilldown pages. | Workflow/detail parity gap. | Medium | Backlog |
| Real products/services list tracks purchase price and sale price columns. | Local product/service supports unit price, tax, category, and line item use. | Purchase/sale price distinction and richer product management are missing. | Medium | Backlog |
| Real account list shows tracking start date, opening/current balance, money account type, user, accounting code. | Local accounts show balances and currencies in dashboard/reports but less account management UI. | Account management detail gap. | Medium | Backlog |
| Real Bansi supports language switches beyond EN/LO. | Local supports EN/TH/LO per user request. | Vietnamese/Chinese switches absent; CNY/yuan deferred by user. | Low | Intentional |
| Real site stores live production data server-side. | Local demo uses file-backed DB with readiness guardrails. | Not production architecture. | High before production | Backlog / decision needed |
| Real site attachment areas exist on details. | Local document attachment UI exists; cash transaction attachment UI deferred. | Attachment owner coverage gap. | Low/Medium | Backlog |

## Local Fake Data / Test Log

Sanitized fake-equivalent scenario created and reset:

| Fake data | Purpose |
| --- | --- |
| `CODEX_REAL_EQ_CUSTOMER_A` | LAK customer for real-like cash revenue. |
| `CODEX_REAL_EQ_CUSTOMER_USD` | USD customer for FX invoice test. |
| `CODEX_REAL_EQ_VENDOR_USD` | USD vendor for FX bill test. |
| `CODEX_REAL_EQ_OTHER_INCOME` | Revenue category reflecting real Bansi other-income category style. |
| `CODEX_REAL_EQ_ELECTRICITY_EXPENSE` | Payment category reflecting real Bansi electricity/utility expense style. |
| `CODEX_REAL_EQ_REVENUE_REF` | Cash revenue with VAT and attachment reference. |
| `CODEX_REAL_EQ_PAYMENT_REF` | Cash payment with VAT and attachment reference. |
| `CODEX_REAL_EQ_SALES_FX_REF` | USD sales invoice, partial LAK receipt, fee/WHT, FX gain. |
| `CODEX_REAL_EQ_PURCHASE_FX_REF` | USD purchase bill, partial LAK payment, fee/WHT, FX loss. |
| `CODEX_REAL_EQ_ATTACHMENT.txt` | Real attachment API upload/download/delete against document owner. |
| `CODEX_REAL_EQ_CONFLICT_WINNER` / `CODEX_REAL_EQ_STALE_WRITE` | Revision conflict scenario. |

Verified local behaviors:

- Cash revenue/payment journals are balanced.
- Cash transaction amount includes VAT according to local model.
- Category contract rejects using a cash revenue category for a sales document; scenario was corrected to use `cat-sales-document` and `cat-purchase-document`.
- Sales FX partial receipt keeps document status as `invoice` and leaves 60 USD remaining.
- Purchase FX partial payment keeps document status as `bill` and leaves 60 USD remaining.
- Settlement-history report discloses document amount and actual LAK cash/bank amount.
- Attachment response does not expose `storagePath`.
- Attachment upload/download/delete works.
- Stale expected revision is rejected with `409 STATE_REVISION_CONFLICT`.
- Final reset restores documents, cash transactions, and attachments to zero.

Cleanup:

- Scenario ended with `/api/reset`.
- Final state after the scenario had zero documents, zero cash transactions, and zero attachments.

## Fix Log

No runtime code fix was required in this pass.

One test-scenario correction was made during local destructive verification:

| Issue | Cause | Resolution |
| --- | --- | --- |
| First local scenario attempted to use a cash revenue category for a sales document. | Local action contracts intentionally separate category kinds: `revenue`, `payment`, `sales`, and `purchase`. | Reset local demo data and re-ran scenario with `cat-sales-document` and `cat-purchase-document`. This confirmed the validation guard is working as expected. |

Files changed in this pass:

- `docs/handoff/bansi-real-readonly-comparison-report.md`

Previously relevant local QA report:

- `docs/handoff/full-destructive-qa-report.md`

## Verification Log

Commands/checks run in this pass:

| Check | Result |
| --- | --- |
| Real Bansi read-only login/dashboard reachability | PASS |
| Real Bansi dashboard/list/detail read-only extraction | PASS |
| Local sanitized fake-data scenario | PASS after correcting category-kind test input |
| Local final reset after scenario | PASS |
| `npm run typecheck` via `npm.cmd` | PASS |
| `npm run build` via `npm.cmd` | PASS |
| `npm run test:api` via `npm.cmd` | PASS |
| `npm run test:attachments` via `npm.cmd` | PASS |
| `npm run test:ui` via `npm.cmd` | PASS |
| `npm run check:readiness` via `npm.cmd` | PASS with intended local-dev auth warning |

Note: plain `npm run typecheck` in PowerShell initially hit the machine execution-policy block for `npm.ps1`. This is an environment invocation issue, not a project test failure. All npm verification commands were rerun through `C:\Program Files\nodejs\npm.cmd` and passed.

Final health / cleanup:

| Check | Result |
| --- | --- |
| `/api/health` | PASS: `ok:true`, `authMode:"dev"` |
| app `http://127.0.0.1:5173/` | PASS through readiness check |
| `.dev-server.err.log` | PASS: 0 bytes |
| DB hash | PASS: current hash matches seed `B3AF110B2DD92E98D030576DDA5688E1CB75D1EAE96FDC2750D85FE8CC0F8C30` |
| `data/attachments` | PASS: 0 files |
| reset diagnostics | PASS: no `api.ensure_data_file.read_failed` / `api.ensure_data_file.seed_created` in the latest check |

## Remaining Backlog / Decisions Needed

1. Decide whether full Bansi module parity is required or whether the current product remains a focused accounting prototype.
2. Draft/draft-state workflow decision: real Bansi has explicit draft statuses; local starts at quotation/purchase order.
3. Import/PDF/Excel/email/export policy and priority.
4. Detail page parity: movement, journal entries, summary, ledger links, recurring, tags, voucher view, status action layout.
5. Cash transaction attachment UI.
6. Product/service management parity: product code, purchase price, sale price, status, category, import/export.
7. Banking/assets/inventory/payroll modules.
8. Production auth provider/session architecture.
9. Hosted database/storage architecture.
10. Manual accounting UAT: VAT, WHT, FX, cash/payment journal split policy, tax treatment.
11. Vietnamese/Chinese language support and CNY/yuan only if user reopens that requirement.

## Tester Handoff Recommendation

Suggested module-only Tester scope:

1. Review this report and verify it does not expose credentials/OTP or detailed real PII.
2. Re-run local fake-equivalent data scenario or a subset:
   - cash revenue/payment with VAT,
   - sales FX partial receipt with fee/WHT,
   - purchase FX partial payment with fee/WHT,
   - attachment upload/download/delete,
   - settlement-history `cashAmount/cashCurrency`,
   - stale revision conflict.
3. Verify final cleanup:
   - `/api/health` ok,
   - app responds at `http://127.0.0.1:5173/`,
   - `data/local-db.json` matches seed after reset,
   - `.dev-server.err.log` is empty,
   - diagnostics latest entries have no `api.ensure_data_file.read_failed` or `api.ensure_data_file.seed_created`,
   - attachment storage has no leftover files.
4. Review backlog items against real Bansi extraction and ask the user which missing product surfaces matter before implementing more.
