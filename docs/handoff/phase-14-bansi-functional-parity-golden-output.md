# Phase 14 Bansi Functional Parity + Golden Output Comparison

Date: 2026-06-26

Scope: compare the local accounting demo against the real Bansi site for utility, functional workflow, accounting behavior, reports, exports, and output completeness. Pixel-perfect UI cloning is intentionally out of scope. The product direction is: clone the useful accounting behavior closely, while keeping our own clearer UI, dark mode, localization, and local-first engineering improvements.

Real Bansi safety boundary: read-only only. No real create, edit, delete, save, approve, post, settle, pay, import, upload, send, invite, settings, permission, or service-connection action was performed. Credentials, OTP, tokens, and secrets are not recorded here. Real account/company context and record identifiers are redacted.

## Overall Status

Status: PASS for builder-side Phase 14.

Runtime code change: none to accounting behavior.

Local additions:

- Added a reusable golden-output parity test: `npm run test:golden`.
- Added this Phase 14 handoff report.

The local demo is close for the core accounting flows that are already in scope. The biggest gaps versus full Bansi are product-surface breadth and output/detail parity, not the core journal math that we have implemented.

## Functional Parity Scores

| Area | Score | Assessment |
| --- | ---: | --- |
| Utility / function parity for implemented scope | 82% | Strong for dashboard, cash revenue/payment, invoice/bill, contacts, categories, products, attachments, reports, auth stub, conflict guard. Missing large Bansi modules lower the full-product score. |
| Accounting behavior parity | 86% | Strong for balanced journals, document statuses, partial/final settlement, FX gain/loss, bank fee, WHT, settlement-history cash disclosure. Needs manual policy review for tax rates, draft state, detail/voucher behavior. |
| Workflow parity | 76% | Core sales/purchase/cash flows are covered. Bansi has draft statuses, richer detail pages, recurring, lock/voucher/ledger actions, import/export settings, and more module-specific workflows. |
| Report/export parity | 68% | Local has backend reports, snapshot JSON, print QA, and CSV for key reports. Bansi exposes PDF/Excel/import/export across more pages and many more reports. |
| UI/UX parity | 72% | Local intentionally differs: compact dropdown navigation, hidden dev controls, dark mode, TH/LO/EN localization. This is acceptable and in several places better for this prototype, but not a Bansi visual clone. |
| Full Bansi product-surface parity | 58-63% | Payroll, inventory/warehousing, banking transfers/assets, settings/users, advanced imports/exports, and broader report family are not implemented. |

## Real Bansi Functional Reference Pack

All items below are observed through read-only GET/page inspection. Real row data, company names, account identifiers, tax ids, contact info, and document ids are sanitized or omitted.

### Navigation / Module Surface

| Real Bansi area | Observed utility | Local demo status |
| --- | --- | --- |
| Dashboard | Year/month filters, summary cards for money in/out, account balances by currency, recent revenue/expense, company context, subscription/help/NPS prompts. | Partially implemented: summary cards, balances, recent activity, brand context. Local hides dev controls and omits subscription/NPS/help prompts by design. |
| Incomes | Invoices, cash revenues, sales, customers, income reports, receivable reports, product/customer income summaries. | Partially implemented: invoices, revenue, customers, reports. Sales list/report family is narrower. |
| Expenses | Bills, payments, vendors, expense reports, product/vendor summaries. | Partially implemented: bills, payments, vendors, reports. |
| Payroll | Departments, employees, payrolls, benefits, payroll reports. | Not implemented. Backlog if full Bansi parity is required. |
| Inventory / items | Warehouses, products/services, units, stock, movements, transfers, production, product/expired/movement reports. | Product/service basics implemented. Warehouses, stock, movement, transfer, production are backlog. |
| Banking / assets | Cash/bank accounts, transfers, fixed assets, current asset transaction report, banking report. | Accounts are modeled for posting/reporting. Transfer/fixed-asset workflows are backlog. |
| Accounting | Chart of accounts, opening balances, general journals, journal books, general ledgers, trial balance, income statement, balance sheet, cashflow, equity changes, tax summary, adjustments, close accounts, accounting settings. | Core journal/report pieces implemented: chart-like accounts, journals, ledger, trial balance, cash movement, VAT summary. Opening balances, statements, adjustments, closing are backlog. |
| Settings | Company/display settings, users, categories, tags, currencies, taxes. | Categories/tags/currencies/taxes exist in seed/data model. User/settings UI is not production parity. |

### List / Table Field Reference

| Real Bansi page | Filters observed | Table columns observed | Local status |
| --- | --- | --- | --- |
| Revenues | date range, number, category, tag, customer, account | number, category/tag, customer, amount, date, account, created by, status, actions | Local cash revenue has core fields; no created-by table column in current UI. |
| Invoices | date range, number, category, customer, invoice status, overdue | number, category/tag, customer, amount, date, created by, status, actions | Local has invoice rows/status/actions; overdue and created-by are not prominent. |
| Payments | date range, number, category, vendor, account | number, category/tag, vendor, amount, date, account, created by, status, actions | Local supports payment core fields; no full Bansi-style list controls. |
| Bills | date range, number, category, vendor, bill status, overdue | number, category/tag, vendor, amount, date, created by, status, actions | Local has bill rows/status/actions; overdue and created-by are limited. |
| Customers / vendors | query, status | number, name, phone/email, address, tax number, accounting code, status, actions | Local contact fields exist; full list/editor parity is backlog. |
| Products/services | type, query/code/name, category, accounting code, status | type, name/product code, category, purchase price, sale price, accounting code, status, actions | Local product has code/name/unit/unitPrice/tax. Purchase vs sale price and status are backlog. |
| Bank accounts | list view | name, tracking start date, opening balance, current balance, money account type, user, accounting code, status, actions | Local accounts are posting/reporting entities; management UI is backlog. |
| Accounting codes | code, name, type, group | accounting code, name, type, group, status, actions | Local seed accounts cover posting; full chart management UI is backlog. |

### Status / Workflow Reference

| Real Bansi status/workflow | Local behavior |
| --- | --- |
| Invoice statuses include draft, quotation, invoice, receipt. | Local starts sales document as `quotation`, then `invoice`, then `receipt`. Explicit draft is missing/backlog. |
| Bill statuses include draft, purchase order, bill, paid. | Local starts purchase document as purchase order, then `bill`, then `paid`. Explicit draft is missing/backlog. |
| Cash revenue/payment detail opens view page with movement, journal entries, summary, attachments, voucher/ledger links. | Local posts cash revenue/payment journals and reports correctly, but detail-page/voucher/ledger drilldown UX is not equivalent. |
| Detail pages expose edit, recurring, print/PDF, lock/delete, tags, journal voucher, ledger links. | Local supports lock/delete on documents and print/export reports. Recurring, voucher pages, and ledger links from every detail page are backlog. |
| Reports expose PDF/Excel on trial balance and Excel on invoice/bill lists. | Local has CSV for Trial Balance and Cash/bank movement, snapshot JSON, and print snapshot. PDF/Excel/import are backlog. |

### Tax / Currency / Rounding Reference

Observed Bansi settings and pages:

- Currencies observed: LAK, THB, USD.
- Tax settings page includes multiple tax rows such as VAT, VAT 7%, salary tax, and tax-exempt entries.
- Trial balance separates debit/credit and supports PDF/Excel.
- Detail pages show currency and exchange rate fields in journal/detail sections.

Local behavior:

- Currencies: LAK, THB, USD. CNY/yuan remains deferred by user.
- Seed VAT is currently 10%. This is a policy/configuration difference versus the observed account's VAT options and should not be changed without accounting sign-off.
- FX settlement into LAK base account is covered for sales/purchase partial/final, fee/WHT, gain/loss, and reports.
- Non-base settlement accounts intentionally remain unsupported.

## Golden-output Fixture Plan

Implemented as executable local script:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test:golden
```

Script: `scripts/golden-output-parity-test.mjs`

Package script: `test:golden`

The fixture creates sanitized local records, verifies output, and always resets back to seed in `finally`.

Fake data generated:

| Fixture | Purpose |
| --- | --- |
| `CODEX_GOLDEN_CUSTOMER_LAK` | LAK cash revenue contact. |
| `CODEX_GOLDEN_CUSTOMER_USD` | USD sales invoice/receipt contact. |
| `CODEX_GOLDEN_VENDOR_USD` | USD purchase bill/payment vendor. |
| `CODEX_GOLDEN_SERVICE` | Product/service fixture with VAT. |
| `CODEX_GOLDEN_OTHER_INCOME` | Revenue category fixture. |
| `CODEX_GOLDEN_UTILITY_EXPENSE` | Payment category fixture. |
| `CODEX_GOLDEN_REVENUE_REF` | Cash revenue with VAT. |
| `CODEX_GOLDEN_PAYMENT_REF` | Cash payment with VAT. |
| `CODEX_GOLDEN_SALES_FX_REF` | USD sales invoice, partial LAK receipt, fee/WHT, FX gain. |
| `CODEX_GOLDEN_PURCHASE_FX_REF` | USD purchase bill, partial LAK payment, fee/WHT, FX loss. |
| `CODEX_GOLDEN_REFERENCE.txt` | Attachment upload/download safety check. |
| `CODEX_GOLDEN_CONFLICT_WINNER` / `CODEX_GOLDEN_STALE_WRITE` | Revision conflict check. |

Golden outputs asserted:

| Output | Expected |
| --- | --- |
| Cash revenue gross | 110,000 LAK using local VAT configuration. |
| Cash payment gross | 110,000 LAK using local VAT configuration. |
| Sales FX partial | 40 USD document settlement, 805,000 LAK net cash, 60 USD remaining, exchange gain line. |
| Purchase FX partial | 40 USD document settlement, 897,000 LAK net cash out, 60 USD remaining, exchange loss line. |
| Settlement history | Both document-currency amount and cash/bank amount/currency present. |
| Trial balance | Bank fee account appears after settlements. |
| Cash movement | LAK bank row appears after cash and FX movement. |
| Attachment | Upload/download works and response does not expose `storagePath`. |
| Conflict | Stale write returns `409 STATE_REVISION_CONFLICT`. |
| Cleanup | Final reset restores seed. |

## Fix Log

| Change | Files | Reason |
| --- | --- | --- |
| Added executable golden-output parity fixture. | `scripts/golden-output-parity-test.mjs` | Gives Tester and future builders a repeatable local comparison scenario instead of relying only on prose. |
| Added `npm run test:golden`. | `package.json` | Makes the Phase 14 parity fixture discoverable with existing test scripts. |
| Added Phase 14 report. | `docs/handoff/phase-14-bansi-functional-parity-golden-output.md` | Documents Bansi functional reference, parity scores, differences, golden outputs, risks, and Tester scope. |

No accounting engine, UI workflow, auth/session, storage architecture, deployment, or external service behavior was changed.

## Difference Matrix

| Bansi expected/reference | Local actual | Difference | Severity | Action |
| --- | --- | --- | --- | --- |
| Explicit draft statuses for invoice/bill flows. | Local starts at quotation/purchase-order. | Missing draft stage. | Medium | Backlog / product decision. |
| PDF/Excel/import/export controls across many list/report pages. | Local has snapshot JSON, print snapshot, CSV for selected reports. | Export/import surface smaller. | Medium | Backlog. |
| Cash/payment/revenue detail pages with movement, journal entries, summary, voucher and ledger links. | Local has reports and rows but not full detail/voucher UX. | Output/detail parity gap. | Medium | Backlog. |
| Payroll module. | Not implemented. | Missing module. | High for full Bansi clone, low for current accounting prototype. | Backlog. |
| Inventory/warehouse/stock movement module. | Product/service basics only. | Missing module depth. | High for full Bansi clone. | Backlog. |
| Banking transfers and fixed assets. | Accounts exist for posting; transfer/fixed asset flows absent. | Missing workflow. | Medium/High | Backlog. |
| User/settings/admin management. | Local auth stub and seed settings only. | Not production parity. | High before production. | Decision needed. |
| Tax settings include account-specific VAT options such as VAT 7%. | Local seed VAT is 10%. | Policy/config difference. | Medium | Do not change without UAT/accounting sign-off. |
| Product list separates purchase price and sale price. | Local product has one unit price. | Product master parity gap. | Medium | Backlog. |
| Real production infrastructure. | Local file-backed API. | Architecture gap. | High before production. | Decision needed. |

## Verification Log

Commands run by Builder:

| Command | Result |
| --- | --- |
| `npm run typecheck` via `npm.cmd` | PASS |
| `npm run build` via `npm.cmd` | PASS |
| `npm run test:api` via `npm.cmd` | PASS |
| `npm run test:attachments` via `npm.cmd` | PASS |
| `npm run test:golden` via `npm.cmd` | PASS |
| `npm run test:ui` via `npm.cmd` | PASS |
| `npm run check:readiness` via `npm.cmd` | PASS with intended local-dev auth warning |

Final health / cleanup:

| Check | Result |
| --- | --- |
| `/api/health` | PASS: `ok:true`, `authMode:"dev"` |
| app `http://127.0.0.1:5173/` | PASS through readiness check |
| `.dev-server.err.log` | PASS: 0 bytes |
| DB hash | PASS: current hash matches seed `B3AF110B2DD92E98D030576DDA5688E1CB75D1EAE96FDC2750D85FE8CC0F8C30` |
| `data/attachments` | PASS: 0 files |
| reset diagnostics | PASS: no `api.ensure_data_file.read_failed` / `api.ensure_data_file.seed_created` in the latest check |

## Risks / Backlog

1. Full Bansi module parity: payroll, inventory/warehouses, stock movement, banking transfers, fixed assets, broader settings/users.
2. Export parity: Bansi exposes many PDF/Excel/import flows; local currently exposes selected CSV/snapshot/print flows.
3. Detail output parity: voucher, ledger links, detail-page movement/journal/summary UX.
4. Draft status policy and numbering parity.
5. Tax policy sign-off: observed Bansi account has VAT 7% options; local seed VAT is 10%.
6. Production architecture: real auth provider, hosted DB/storage, secrets management, retention/privacy policy.
7. Attachment breadth: cash transaction UI, preview/OCR/virus scan/cloud storage.
8. Product master parity: purchase price, sale price, stock fields, status.

## Tester Scope Recommendation

Recommended Tester scope for Phase 14:

1. Review this report for secret/PII safety.
2. Run local golden fixture:
   - `npm run test:golden`
3. Run standard local gates:
   - `typecheck`, `build`, `test:api`, `test:attachments`, `test:ui`, `check:readiness`.
4. Verify golden-output assertions:
   - cash revenue/payment VAT totals,
   - sales/purchase FX partial settlement with fee/WHT,
   - settlement-history document amount vs cash amount,
   - attachment upload/download no `storagePath`,
   - stale revision conflict,
   - final reset cleanup.
5. Confirm no broad runtime/accounting behavior changed outside the new golden fixture.
