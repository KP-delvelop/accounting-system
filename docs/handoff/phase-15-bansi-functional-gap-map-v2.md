# Phase 15 Bansi Functional Gap Map v2

Date: 2026-06-26

Scope: build a prioritized, testable functional gap map for moving the local accounting prototype closer to real Bansi behavior. This phase is documentation and planning only. It does not add a broad runtime feature and does not change production infrastructure.

Real Bansi safety boundary: read-only only. No real create, edit, delete, save, approve, post, settle, pay, import, upload, send, invite, settings, permission, or service-connection action was performed. Credentials, OTP, tokens, secrets, real contact details, tax ids, addresses, bank/account identifiers, invoice ids, customer/vendor ids, and company/person names are intentionally omitted or redacted.

## Executive Summary

Phase 15 confirms the same direction as Phase 14: the local system is strong for the implemented accounting prototype scope, but the full Bansi product surface is broader. The next work should not chase pixel-perfect UI. It should close functional parity gaps in the order that improves accounting usefulness and testability:

1. Document lifecycle, numbering, and action availability.
2. Transaction detail pages with movement, journal voucher, ledger drilldown, and audit history.
3. Report/export/PDF/Excel/import parity.
4. Settings/accounting policy surfaces for tax, currency, chart of accounts, numbering, company profile, and users.
5. Banking/assets, product/inventory, and later payroll/import modules.

Recommended next module: **Phase 16A Document Lifecycle + Numbering Parity**.

## Revised Functional Parity Estimate

This estimate excludes pixel-perfect visual cloning. UI can remain intentionally different and better for this product as long as function, output, workflow, and accounting behavior are comparable.

| Area | Estimate | Reasoning |
| --- | ---: | --- |
| Implemented-scope utility/function parity | 83% | Core dashboard, sales/purchase/cash flows, attachments, auth stub, conflict guard, reports, exports, localization, and dark mode are usable. |
| Accounting behavior parity | 86% | Balanced journals, VAT/WHT, FX gain/loss, partial/final settlements, and settlement cash disclosure are strong. Needs manual accounting sign-off for tax policy and Bansi-specific posting rules. |
| Workflow parity | 76% | Main invoice/bill/revenue/payment paths work. Draft/cancel/void, recurring, detail/voucher/ledger links, and action availability are not yet Bansi-level. |
| Report/export parity | 68% | Local reports, snapshot JSON, print, and selected CSV work. Bansi exposes broader PDF/Excel/import/export and report families. |
| Full Bansi function/product-surface parity | 60% | Payroll, inventory/warehouse, banking transfers/assets, settings/admin, import/export breadth, and advanced reports remain missing or partial. |
| UI/UX parity | Not primary score | Local intentionally differs: compact dropdown navigation, hidden dev controls, dark mode, EN/TH/LO localization, and simplified layout. Functional clarity is preferred over visual cloning. |

## Sanitized Bansi Reference Map

Reference data comes from read-only dashboard/list/detail inspection. Real identifiers are redacted and the map records only structure, labels, statuses, controls, and workflow shape.

### 1. Document Lifecycle Parity

| Real Bansi surface | Observed behavior / controls | Local coverage | Gap |
| --- | --- | --- | --- |
| Revenue records | List filters by date, number, category, tag, customer, account. Detail has movement, journal entries, summary, attachment, print, recurring, lock/delete/edit-like controls, tags, voucher/ledger links. | Cash revenue creation/posting, balanced journals, VAT, reports, and local-first state are implemented. | Detail page, voucher links, recurring, list filter breadth, created-by/status columns, and cash attachment UI are partial/missing. |
| Payment records | Similar to revenue: date/category/vendor/account filters, detail movement/journal/summary/attachment/voucher/ledger controls. | Cash payment creation/posting, balanced journals, VAT, reports. | Same detail/voucher/list/action parity gaps as revenue. |
| Invoices | Status filter includes draft, quotation, invoice, receipt, all statuses; also overdue filter. Columns include number, category/tag, customer, amount, date, created by, status, actions. | Sales document flow supports quotation -> invoice -> receipt, partial/final settlement, FX, fee/WHT, lock/delete, attachments. | Explicit draft, overdue, cancel/void, numbering policy, detail page, created-by/action parity are missing/partial. |
| Bills | Status filter includes draft, purchase order, bill, paid, all statuses; also overdue filter. | Purchase flow supports purchase order -> bill -> paid, partial/final settlement, FX, fee/WHT, lock/delete, attachments. | Explicit draft, overdue, cancel/void, numbering policy, detail page, created-by/action parity are missing/partial. |
| Numbering/reference fields | Real pages expose number/reference filters and document identifiers in list/detail surfaces. | Local creates generated ids/references and supports report/export identity enough for tests. | Human-facing numbering rules, prefixes, reset periods, editability, and import/export numbering behavior need product decisions. |

### 2. Detail / Voucher / Ledger Parity

| Real Bansi surface | Observed behavior | Local coverage | Gap |
| --- | --- | --- | --- |
| Transaction detail pages | Sections for movement, journal entries, summary, attachments, product/line detail, audit rows, and links/actions around journal voucher and ledger. | Local has state, journal lines, reports, settlement history, and row-level UI for key flows. | No full read-only detail page template for each record type. |
| Journal voucher | Detail pages expose voucher-like controls/links. General journal list exists. | Local journals exist and report calculations use them. | Voucher page/printable voucher output is missing. |
| Ledger drilldown | Bansi detail pages expose ledger/account-code links. | Local ledger backend/UI report exists. | Cross-linking from transaction/document/detail to ledger rows is missing. |
| Audit trail | Real detail pages show action/user/date style audit surfaces. | Local diagnostics and action contracts exist; UI audit trail is not equivalent. | User-facing audit history should be added after lifecycle/detail surfaces. |

### 3. Export / PDF / Excel / Print Parity

| Real Bansi surface | Observed controls | Local coverage | Gap |
| --- | --- | --- | --- |
| Invoice/bill lists | Excel export and import/settings controls visible. | Local CSV exists for selected reports; no list-level Excel/PDF/import. | Export/import breadth gap. |
| Trial balance | PDF and Excel controls visible. | Local trial balance has UI rows, backend query, CSV export, snapshot JSON, print snapshot. | PDF/Excel output parity missing. |
| Revenue/payment/general journal | Import controls visible on some pages. | Local test fixtures/scripts exist; no user import workflow. | Import template/validation UX missing. |
| Print outputs | Real detail/report pages expose print/PDF-style controls. | Local report print snapshot is tested. | Document/detail printable output missing. |

### 4. Settings / Accounting Policy Parity

| Real Bansi surface | Observed behavior | Local coverage | Gap |
| --- | --- | --- | --- |
| Currencies | Currency rows include name, code, exchange rate, example, status, actions. LAK/THB/USD observed. | Local supports LAK/THB/USD and FX settlement to LAK base account. | Currency management UI, CNY/yuan deferred by user, exchange-rate management policy missing. |
| Taxes | Tax rows include name, rate %, included/calculated flags, exempt, status, actions. Multiple tax policies visible. | Local seed VAT is 10%, WHT supported in settlement flows. | Account-specific tax policy, VAT 7% sign-off, tax settings UI, and tax disclosure parity need UAT. |
| Chart of accounts | Filters by code/name/type/group; rows include type/group/status/action. | Local seed accounts and posting engine exist. | Chart management UI, opening balances, account grouping/status parity missing. |
| Company/display/users/admin | Real settings menu includes company edit, display/input, users, categories, tags, currencies, taxes. | Local has brand surface, local auth stub, categories, currency/tax seed. | Production user/admin/settings are missing; auth provider decision needed. |

### 5. Banking / Assets / Reconciliation Parity

| Real Bansi surface | Observed behavior | Local coverage | Gap |
| --- | --- | --- | --- |
| Bank accounts | Rows include name, tracking start date, opening balance, current balance, type, user, accounting code, status. | Local dashboard/account balances and cash/bank movement report exist. | Account-management page parity missing. |
| Transfers | Banking transfer menu exists. | No dedicated transfer workflow. | Bank transfer action/reporting needed. |
| Fixed assets | Fixed asset menu/report surface exists. | Not implemented. | Fixed asset acquisition/depreciation/disposal module missing. |
| Reconciliation-like reporting | Current asset transaction and banking report surfaces visible. | Cash movement report exists. | Reconciliation/banking report parity missing. |

### 6. Inventory / Product Parity

| Real Bansi surface | Observed behavior | Local coverage | Gap |
| --- | --- | --- | --- |
| Products/services | Filters by type, query/code/name, category, accounting code, status. Rows include type, product code/name, category, purchase price, sale price, accounting code, status. | Local product/service supports code/name/unit/unit price/tax/category for document lines. | Purchase vs sale price, status, richer product detail, import/export missing. |
| Units | Units menu exists. | Local unit is simple field/string. | Unit master missing. |
| Warehouses/stocks/movements/transfers/production | Menus exist for warehouse and stock movement workflows. | Not implemented. | Inventory module missing. |
| Expiry/product movement reports | Report surfaces visible. | Not implemented. | Inventory reports missing. |

### 7. Import / Migration Parity

| Real Bansi surface | Observed behavior | Local coverage | Gap |
| --- | --- | --- | --- |
| Revenue/payment/invoice/bill/general journal import | Import routes/buttons visible on selected pages. | Local scripts create fixtures for tests, but no user import surface. | User-facing import templates and validation are missing. |
| Excel exports | Controls visible on document/report pages. | CSV selected reports only. | Excel format parity missing. |
| Migration templates | Not downloaded due read-only/PII safety. | No migration template support. | Needs safe template design from metadata, not real data. |

## Local Coverage Map

| Local module | Status | Evidence / notes |
| --- | --- | --- |
| Dashboard | Implemented | Summary cards, balances, recent activity, localized/dark UI. |
| Cash revenue/payment | Implemented | Actions `cash_revenue.create`, `cash_payment.create`; journal/report coverage. |
| Customers/vendors/categories/products | Partial | Create and use in flows; full Bansi master-data UI/status/import/export missing. |
| Sales documents | Strong partial | Quotation -> invoice -> receipt, partial/final settlement, FX, fee/WHT, attachments. Missing draft/cancel/void/detail parity. |
| Purchase documents | Strong partial | Purchase order -> bill -> paid, partial/final settlement, FX, fee/WHT, attachments. Missing draft/cancel/void/detail parity. |
| Reports | Partial | Ledger, trial balance, cash movement, settlement history, VAT summary, customer/vendor aging UI; backend Phase 1 reports for core set. |
| Export/print | Partial | Snapshot JSON, print snapshot, CSV for trial balance and cash/bank movement. No PDF/Excel/import. |
| Attachments | Partial | Backend and document UI upload/list/download/delete. Cash transaction attachment UI and previews missing. |
| Auth/session | Prototype baseline | Local bearer-token stub and UI token panel; no real provider/session architecture. |
| Concurrency | Prototype baseline | Revision header and conflict UX; no merge/diff/presence. |
| Deployment readiness | Prototype baseline | Local readiness script/runbook; no real deployment/cloud integration. |
| Settings/admin | Partial/missing | Categories/currencies/taxes exist in data; full settings/company/users/admin not implemented. |
| Banking/assets | Missing/partial | Posting accounts and cash movement exist; transfers/fixed assets/reconciliation missing. |
| Inventory/payroll | Missing | Product basics only; inventory/warehouse/payroll module surfaces missing. |

## Prioritized Gap Matrix

| Priority | Gap | Impact | Recommendation | Acceptance criteria | Tester scope |
| --- | --- | --- | --- | --- | --- |
| P0 | Document lifecycle and numbering parity | Bansi-like workflows depend on draft/posted/final/cancel/void states, user-facing numbers, date/reference fields, and allowed actions. | Phase 16A: add/align lifecycle map and minimal implementation for explicit draft/cancel/void/numbering where low-risk. | Sales and purchase support documented status graph; same-currency and FX settlement still pass; invalid transitions clear; numbering visible and deterministic. | Target invoice/bill lifecycle only; no full regression. |
| P0 | Detail/voucher/ledger read parity | Users need to inspect why a transaction posted and where journal lines came from. | Phase 16B: add read-only detail/voucher/ledger drilldown pages for cash revenue/payment and documents. | Detail view shows summary, movement, journal lines, cash/bank lines, attachment list, and links to ledger/report filters. | Verify detail output against seeded fake transactions. |
| P0 | Accounting policy sign-off map | Tax/VAT/WHT/currency treatment may differ by customer/account; wrong policy creates wrong reports. | Phase 16C or 17A: create policy settings map and UAT checklist before changing core math. | VAT/WHT/currency/default accounts are documented; seed defaults remain explicit; no silent policy drift. | Review docs/settings and targeted report output. |
| P1 | PDF/Excel/import/export expansion | Real Bansi exposes export/import controls across lists and reports. | Add selected PDF/Excel/CSV/import template support after detail/lifecycle are stable. | Trial balance/ledger/document list exports have stable filenames, headers, totals, and no PII leaks in tests. | Target chosen export only. |
| P1 | Settings/company/user/admin baseline | Needed before production or hosted customer use. | Keep provider decision separate; add local settings surfaces only after auth/provider direction. | Company/display/user limitations documented; no fake production auth claims. | Security/settings module review. |
| P1 | Banking transfer and fixed assets | Real Bansi has these as visible accounting modules. | Add bank transfer first, fixed asset later. | Transfer posts balanced journal and cash movement report reflects both accounts. | Banking module tests. |
| P1 | Product master parity | Real product/service surface includes purchase price, sale price, accounting code, status. | Extend product model cautiously before inventory. | Existing invoice/bill line behavior preserved; new product fields display and export. | Product UI/API only. |
| P2 | Inventory/warehouse/stock movement | Large product-surface gap. | Build after product master and accounting policy stabilize. | Stock movement posts/updates inventory without breaking accounting reports. | Inventory module tests. |
| P2 | Payroll | Large but separate domain. | Defer until accounting core parity is closer. | Payroll domain requirements signed off. | Payroll module only. |
| P2 | Cash transaction attachment UI | Attachments backend exists; document UI exists. | Add upload/list/download/delete to cash revenue/payment rows/details. | Same storage/revision/conflict behavior as document attachments. | Attachment UI cash-only test. |
| P2 | Advanced report family | Income statement, balance sheet, cashflow, tax summary, journal books, product/customer/vendor reports. | Add reports one at a time using shared report helper. | Each report has backend read model, UI, export, and fixture. | One report per phase. |
| P3 | Visual clone fidelity | User explicitly prefers function over pixel-perfect clone. | Do not chase exact Bansi UI unless it blocks function. | Local UX remains coherent, accessible, localized, dark-mode-safe. | Visual smoke only when relevant. |
| P3 | Non-base settlement accounts | Intentional limitation from FX phases. | Revisit only after accounting sign-off. | New policy/test matrix before implementation. | FX-only tests. |
| P3 | OCR/virus scan/cloud storage | Production-grade attachment hardening. | Requires provider/security decision. | Decision recorded before external service. | Security/storage review. |

## Recommended Phase Sequence

### Phase 16A: Document Lifecycle + Numbering Parity

Narrow goal: align local sales/purchase lifecycle with real Bansi status surfaces without rewriting accounting math.

Suggested scope:

- Add/confirm explicit status graph for sales: draft -> quotation -> invoice -> receipt, plus cancel/void/locked behavior if safe.
- Add/confirm explicit status graph for purchase: draft -> purchase_order -> bill -> paid, plus cancel/void/locked behavior if safe.
- Define human-facing numbering policy for invoice/bill/revenue/payment/reference fields.
- Preserve existing same-currency, FX, partial/final, fee/WHT, attachment, auth, and conflict behavior.

Acceptance criteria:

- Invalid transitions return clear validation.
- Existing Phase 5B and Phase 8B flows still work in targeted tests.
- Documents show stable numbers/references in UI/report/export surfaces.
- Draft/cancel/void behavior is either implemented or explicitly deferred with reason.

Tester scope:

- Invoice and bill lifecycle only.
- Same-currency regression for one sales and one purchase flow.
- One FX final or partial regression if lifecycle touches settlement status.
- No full-system regression.

### Phase 16B: Detail / Voucher / Ledger Drilldown Read Model

Narrow goal: add read-only inspection output for posted transactions.

Suggested scope:

- Create read-only detail view/model for cash revenue/payment and one document type first.
- Show summary, lines, journal entries, cash/bank line, attachment metadata, and linked ledger filter.
- Do not add edit/posting changes.

Tester scope:

- Verify seeded transaction detail output, journal balance, ledger link/filter, and attachment metadata.

### Phase 16C: Export / PDF / Excel / Import Slice

Narrow goal: choose one safe output type and one report/document surface.

Suggested scope:

- Add CSV/Excel-like export parity for ledger or settlement history first, or PDF/print-friendly voucher if detail pages are ready.
- Avoid real Bansi file downloads; derive from sanitized metadata and local golden outputs.

Tester scope:

- Verify filename, headers, totals, row count, no hidden internal fields.

### Phase 17: Settings / Accounting Policy Baseline

Narrow goal: make tax/currency/chart/company policy explicit and testable.

Suggested scope:

- Local settings read/edit for VAT/WHT/currency/numbering only if product owner approves.
- Keep provider/admin/users separate unless requested.

Tester scope:

- Policy settings only; accounting flow targeted regressions.

### Phase 18+: Banking / Assets / Product / Inventory / Import Modules

Recommended order:

1. Bank transfer.
2. Product master parity.
3. Cash transaction attachment UI.
4. Fixed assets.
5. Inventory/warehouse/stock movement.
6. Advanced reports.
7. Import templates.
8. Payroll.

## Risk Notes

- Real Bansi remains production/live data. Future exploration must stay read-only and avoid exporting sensitive files unless explicitly approved and sanitized.
- This report intentionally redacts real company/account/contact/document identifiers.
- The local system is not production-ready until real auth provider, hosted DB/storage, secrets management, operational backups, logging retention, and security review are completed.
- File-backed local data is useful for prototype/demo/UAT, not a hosted production source of truth.
- Tax/VAT/WHT/currency policy needs accounting sign-off before changing seed defaults or posting rules.
- Some Bansi surfaces may be hidden by account subscription, permissions, or read-only expiration; the map should be revisited with a dedicated safe test account if available.

## Phase 15 Verification

Commands/checks performed:

| Check | Result |
| --- | --- |
| Real Bansi session URL check | PASS: dashboard reachable in existing session. |
| Real Bansi read-only snapshot | PASS: dashboard structure visible; no mutation performed. |
| Local package/action/report inspection | PASS: package scripts, action contracts, report keys inspected. |
| Runtime feature implementation | Not performed by design. |

Recommended local verification for Tester:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run check:readiness
```

No destructive local data mutation is required to review Phase 15.

## Module-only Tester Scope

1. Review this file for secret/PII safety.
2. Confirm it is documentation/planning only and does not claim production readiness.
3. Spot-check the gap matrix against current local capabilities:
   - action contracts,
   - report keys,
   - package scripts,
   - prior Phase 14 golden report.
4. Confirm the next recommended module, Phase 16A, is narrow and testable.
5. Optional safe check: run `npm run check:readiness`.
