# Ultimate Bansi Functional Parity + Golden Recreation Closure Pass

Date: 2026-06-26

Scope: final local Builder pass for Bansi-like functional parity, focused on utility, workflow, accounting behavior, report/export output, and golden document recreation readiness. Pixel-perfect Bansi UI cloning is intentionally out of scope.

## Safety Boundary

- Real Bansi was not mutated.
- No new real-site actions were performed in this pass; the pass used prior sanitized read-only reference packs.
- No credentials, OTPs, tokens, secrets, real contact data, real tax ids, real addresses, bank identifiers, or real document/customer/vendor identifiers were stored.
- Local demo data was reset/generated only through local tests and returned to seed.
- No external service, deploy, commit, push, cloud resource, or paid resource was used.

## Real Bansi Read-only Reference Summary

Sanitized references used:

- `docs/handoff/bansi-real-readonly-comparison-report.md`
- `docs/handoff/phase-14-bansi-functional-parity-golden-output.md`
- `docs/handoff/phase-15-bansi-functional-gap-map-v2.md`
- `docs/handoff/phase-16a-document-lifecycle-numbering-parity.md`
- `docs/handoff/final-functional-parity-closure-pass.md`

Observed Bansi functional patterns relevant to this pass:

- Transaction/detail surfaces expose movement, journal entries, voucher-like links, ledger links, summaries, attachments, and audit-style context.
- Accounting report pages expose export-like controls and source-reference columns.
- Trial balance, ledger, tax summary, settlement/payment outputs, and document list/detail pages are useful because they let a reviewer trace an accounting result back to the source document or transaction.
- Native PDF/Excel/import breadth is broader in Bansi, but exact file generation is a larger output-format project and remains backlog.

## Triage

| Gap area | Decision | Rationale |
| --- | --- | --- |
| Detail / voucher / ledger trace | Fixed with read-only source trace report | High impact for golden recreation, low risk because it uses existing state/journal data and does not change posting. |
| Report CSV breadth | Preserved/extended from prior pass | Ledger, settlement history, VAT summary, trial balance, and cash/bank movement CSV are now available. |
| Native PDF/Excel | Backlog | Requires output library/policy/visual QA. CSV remains safer for final local parity. |
| Import/migration UI | Backlog | Needs template design and validation UX. Existing scripts cover fake data generation. |
| Settings/accounting policy | Documented backlog | Needs product/accounting sign-off before changing tax/currency/numbering rules. |
| Banking/assets/inventory/payroll | Backlog | Separate modules and not safe to compress into final pass. |

## Functional Parity Improvements Made

Retest addendum: Tester found that unposted/no-journal source trace rows were labeled as balanced because debit and credit were both zero. This has been fixed. Rows without a journal now return `balanced: null` and `postingStatus: "unposted"`; UI/CSV display `No journal` instead of `Balanced`.

### 1. Source Trace / Voucher Summary Report

Added a new read-only report key:

- `source_trace`

It is available through:

- Backend report query: `POST /api/reports/source_trace/query`
- Reports UI panel: `Source trace`
- CSV export: `source-trace-YYYY-MM-DD.csv`
- Saved report filter dropdown

The source trace report shows one row per source journal, or one unposted row for non-posting sources such as drafts:

- source date
- source reference / document number
- source type
- source status
- source amount and currency
- journal reference
- journal line count
- debit total
- credit total
- balanced / not balanced
- no journal for unposted/non-posting sources
- attachment count
- ledger account line summary in backend/golden output

This gives Tester a direct bridge from recreated Bansi-like documents to local journal/ledger impact without requiring a full detail-page route yet.

### 2. Backend Read Model

`shared/report-models.mjs` now exposes:

- `sourceTraceRows(state)`
- backend report builder for `source_trace`

`source_trace` is included in:

- `reportKeys`
- `backendReportKeys`
- action/report filter validation allow-list

### 3. Frontend/UI Output

Reports UI now includes:

- Source trace panel
- Source trace CSV button
- localized EN/TH/LO label keys for `sourceTrace`, `balanced`, and `notBalanced`

### 4. Golden Output Test Expansion

`npm run test:golden` now validates source trace output:

- sales source trace exposes balanced journal totals
- purchase source trace exposes ledger line summaries
- cash revenue source trace exposes source amount/currency

Golden output now includes `sourceTraceRows`.

## Exact Files Changed

| File | Purpose |
| --- | --- |
| `shared/report-models.mjs` | Added source trace read model and backend report response. |
| `shared/accounting-engine.mjs` | Added `source_trace` to report filter allow-list. |
| `src/types.ts` | Added `source_trace` to `ReportKey`. |
| `src/domain.ts` | Added typed UI source trace row helper/wrapper. |
| `src/App.tsx` | Added Source trace Reports panel and CSV export. |
| `src/i18n.ts` | Added EN/TH/LO labels for source trace and balance status. |
| `scripts/golden-output-parity-test.mjs` | Added backend source trace assertions, no-journal regression, and output count. |
| `scripts/ui-smoke-test.ps1` | Added source trace panel and CSV assertions. |
| `docs/handoff/ultimate-bansi-functional-parity-golden-recreation-closure.md` | This handoff. |

## Golden Recreation Dataset / Instructions

Tester can recreate Bansi-like local outputs using existing local UI flows or the golden script. All sample identifiers are fake.

Recommended local fake scenario:

1. Create customer/vendor/product/service records using `CODEX_GOLDEN_*` or `CODEX_FINAL_*` prefixes.
2. Create a LAK cash revenue with VAT.
3. Create a LAK cash payment with VAT.
4. Create a USD sales document, promote to invoice, partially settle into LAK with bank fee/WHT and settlement FX rate.
5. Create a USD purchase document, promote to bill, partially pay into LAK with bank fee/WHT and settlement FX rate.
6. Upload a dummy text attachment to a document and verify download/delete.
7. Open Reports and compare:
   - Source trace
   - Ledger by account
   - Trial balance
   - Cash/bank movement
   - Document settlement history
   - VAT summary
   - Snapshot JSON / print snapshot
8. Export CSVs and compare headers, source references, totals, VAT/net/gross, statuses, and journal balance.

Current golden script output after this pass:

- VAT rate: `10`
- revenue gross: `110000 LAK`
- payment gross: `110000 LAK`
- sales partial: `40 USD`, cash `805000 LAK`, remaining `60 USD`
- purchase partial: `40 USD`, cash `897000 LAK`, remaining `60 USD`
- settlement history rows: `2`
- source trace rows: `4`
- after no-journal regression: `7` rows, including draft/quotation/purchase-order unposted rows
- trial balance rows: `12`
- cash movement rows: `4`

## Verification Results

Commands run:

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run test:api` | PASS |
| `npm run test:attachments` | PASS |
| `npm run test:lifecycle` | PASS |
| `npm run test:golden` | PASS |
| `npm run test:ui` | PASS |
| `npm run check:readiness` | PASS with intended dev-auth warning |

Readiness warning retained by design:

- `LOCAL_API_AUTH_MODE=dev is acceptable for local development only, not production-like readiness.`

## Final Cleanup Status

Post-test checks:

- `/api/health`: ok, `authMode:"dev"`
- App: `http://127.0.0.1:5173/` responds `200`
- `.dev-server.err.log`: empty
- DB hash: `B3AF110B2DD92E98D030576DDA5688E1CB75D1EAE96FDC2750D85FE8CC0F8C30`
- reset diagnostics latest entries: no `api.ensure_data_file.read_failed` and no `api.ensure_data_file.seed_created`
- attachment storage: no leftover files observed

## Updated Functional Parity Estimate

These scores measure function/output parity, not pixel-perfect UI parity.

| Area | Estimate | Notes |
| --- | ---: | --- |
| Document lifecycle / numbering | 85% | Draft/non-posting, quotation/invoice/receipt, purchase_order/bill/paid, deterministic numbering, and invalid transitions are covered. Cancel/void/reversal remains backlog. |
| Detail / voucher / ledger / source trace | 74% | New source trace report closes the biggest read-only traceability gap. Full detail/voucher pages and printable voucher remain backlog. |
| Reports / export / PDF / Excel / print | 79% | Backend reports, UI reports, snapshot JSON, print snapshot, and CSVs for ledger/source trace/trial/cash/settlement/VAT are covered. Native PDF/Excel/email/import remain backlog. |
| Settings / accounting policy | 48% | Policy caveats are documented and seed defaults are explicit. Full settings UI and accounting sign-off remain required. |
| Banking / reconciliation / assets | 40% | Cash/bank movement and settlement cash disclosure are strong. Dedicated bank transfers, reconciliation, and fixed assets remain missing. |
| Inventory / product | 42% | Product/service basics support Bansi-like documents. Warehouse, stock movement, unit master, costing, and inventory reports remain missing. |
| Import / migration | 34% | Fake data scripts and golden fixtures support migration-style testing. User-facing import templates are missing. |
| Overall implemented-scope function parity | 88% | Core local accounting workflows are coherent and covered by API/UI/golden/lifecycle tests. |
| Full Bansi product-surface parity | 66-70% | Broad Bansi modules still remain outside this local prototype surface. |

## Remaining Differences / Backlog

| Gap | Blocker for local demo/UAT? | Blocker for production/full Bansi replacement? | Recommendation |
| --- | --- | --- | --- |
| Cancel/void/reversal policy | No | Yes | Define reversal and numbering reserve/skip policy with accounting owner. |
| Full detail/voucher pages | No | Partial | Add read-only detail routes and printable voucher after source trace stabilizes. |
| Native PDF/Excel/email output | No | Partial | Add one output format at a time with visual/file QA. |
| Import templates/UI | No | Partial | Build sanitized template workflow with validation and dry-run import. |
| Production auth/provider | No for local demo | Yes | Choose provider/session architecture. |
| Hosted DB/storage/backups | No for local demo | Yes | Replace file-backed prototype storage for production. |
| Bank transfers/reconciliation/assets | No | Yes for full Bansi parity | Split into separate banking phases. |
| Inventory/warehouse/payroll | No | Yes for full product surface | Separate domain roadmaps. |
| Accounting UAT/sign-off | Partial | Yes | Human accountant/product-owner sign-off required for VAT/WHT/FX/numbering. |
| Attachment preview/OCR/virus scan/cloud storage | No | Yes for production-grade documents | Requires security/storage provider decisions. |

## Tester Golden Recreation Scope

Recommended final Tester pass:

1. Verify no credential/OTP/token/real PII appears in this report or generated local fixtures.
2. Recreate the fake Bansi-like dataset in local UI or run `npm run test:golden`.
3. Validate Source trace UI and backend `source_trace` report:
   - source refs
   - source status
   - journal references
   - debit/credit totals
   - balance status
   - no-journal/unposted status for draft, quotation, and purchase order rows
   - attachment count
4. Validate CSV exports:
   - `source-trace-...`
   - `ledger-...`
   - `trial-balance-...`
   - `cash-bank-movement-...`
   - `settlement-history-...`
   - `vat-summary-...`
5. Compare recreated document totals:
   - net/tax/gross
   - VAT rows
   - settlement document amount vs cash/bank amount
   - FX gain/loss direction
   - remaining balances/statuses
   - ledger/journal balance
6. Run the full local gates listed above.

Recommendation: ready for Tester final Golden Document Recreation + 0-to-100 local regression as a local-first demo / targeted-UAT prototype. Still not production-ready until production foundation and accounting policy backlog are closed.
