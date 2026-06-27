# Local-First To Hostinger Plan

## Current Phase

- Run the app on localhost with Vite.
- Persist demo accounting data through a localhost API backed by `data/local-db.json`.
- Keep browser `localStorage` as a fallback if the local API is not running.
- Keep seed data in one source of truth: `data/local-db.seed.json`. Frontend fallback imports this same file through `src/seed.ts`.
- Keep all accounting operations in pure domain functions so the same behavior can move behind an API later.
- Do not commit, push, deploy, or apply cloud database migrations until explicitly ordered.

## Hostinger-Ready Shape

- Frontend: React/Vite can be built with `npm run build` and hosted as static assets.
- Data layer: current local store is isolated in `src/store.ts` and talks to `/api/state`; replace the local API with the hosted API when moving to hosting.
- Database: `database/schema.postgres.sql` captures the target tables for organizations, users, permissions, accounts, categories, contacts, cash transactions, documents, journal entries, saved report filters, action contracts, and audit logs.
- AI Agent: actions in `src/domain.ts` are declared as contracts and should be exposed through the same API endpoints used by normal users. Role checks, validation, confirmation gates, and audit logs must run for both human and AI actors.
- Documents: invoice and bill creation currently mirrors the observed source behavior by creating quotation / purchase-order records without posting journal entries immediately. Settlement journal posting happens only when sales reaches `receipt` or purchase reaches `paid`.
- Form parity: revenue, payment, invoice, and bill actions now carry due date where relevant, VAT/tax number fields, exchange rates, product/unit line items, discount type, tax snapshots, tags, and attachment references.
- Attachment storage Phase 10B: the local API supports real attachment upload/list/download/delete using local project-controlled storage at `data/attachments` by default, and invoice/bill document rows can upload, list, download, and delete files. Upload payloads are JSON/base64 in the API layer. Cash transaction attachment UI, previews, and advanced file management are deferred.
- Product management: `product.create` is available through the same action contract layer used by UI and future AI Agent calls. Products provide reusable line-item defaults for unit, price, and tax.
- Category management: `category.create` is available through the shared action contract layer for revenue, payment, sales, and purchase categories.
- Inline master data: revenue/payment/invoice/bill forms can create categories in-flow, and line-item editing can create product/service records in-flow. These UI shortcuts still call the same action contract endpoints as normal master-data screens and future AI Agent calls.
- Guarded documents: `document.lock` is implemented through the shared action contract layer, requires UI confirmation, writes a high-risk audit log, rejects duplicate locks, and blocks later status changes.
- Reports: the Accounting reports view and local API now share report read-model helpers derived from `journalEntries`, `accounts`, `documents`, and `cashTransactions`. `report.view` remains the read permission contract for future AI Agent callers. Saved report filters are stored through `report.filter.save` and `report.filter.delete` action contracts.
- Settlement-history disclosure: report rows keep `amount` as the document-currency amount settled and also expose `cashAmount` / `cashCurrency` for the actual cash or bank movement. This helps UAT reconcile fee, withholding-tax, and FX settlements without changing journal posting behavior.
- Report exports: snapshot JSON download uses the shared report-model helper and includes metadata for generated time, active filters, report identity, data source type/mode, and report model version. Print snapshot QA is covered by browser smoke tests. Phase 11 adds Reports UI CSV export for Trial Balance and Cash/bank movement. PDF/email/import remain out of scope.
- UI readiness: Phase 12A adds a local-first light/dark mode toggle persisted in `localStorage`, keeps print output on light variables, and localizes frontend session/auth/conflict copy for English, Thai, and Lao. Technical terms and codes such as CSV, API, LAK, USD, document ids, and action keys intentionally remain code-like for traceability.

## Local API Contract

- `GET /api/health`: local API health check.
- `GET /api/state`: read the current local accounting state and return `X-Codex-State-Revision`.
- `PUT /api/state`: replace the current local accounting state after domain validation runs in the UI. Clients can send `X-Codex-Expected-State-Revision`; stale revisions return `409 STATE_REVISION_CONFLICT`.
- `GET /api/actions`: read action contracts available to UI and future AI Agent callers.
- `POST /api/actions/:key`: execute one business action through the same permission, validation, mutation, and audit path used by the UI. Clients can send `X-Codex-Expected-State-Revision`; stale revisions return `409 STATE_REVISION_CONFLICT`.
- `POST /api/attachments`: upload one attachment with `{ actor, ownerType, ownerId, fileName, contentType, contentBase64 }`. The API stores the file locally, writes metadata into `state.attachments`, links the owner record, supports `X-Codex-Expected-State-Revision`, and returns `X-Codex-State-Revision`.
- `GET /api/attachments?ownerType=&ownerId=`: list attachment metadata without exposing the internal storage path.
- `GET /api/attachments/:id/download`: download the stored file for an attachment.
- `DELETE /api/attachments/:id`: remove attachment metadata, detach it from the owner record, and delete the stored local file. It supports `X-Codex-Expected-State-Revision`.
- `POST /api/reports/:reportKey/query`: read a backend report with body `{ actor, filters }`. Phase 1 supports `ledger`, `trial_balance`, `cash_movement`, `settlement_history`, and `vat_summary`.
- `GET /api/reports/:reportKey`: read the same Phase 1 reports with query filters and actor fields for manual/local checks.
- `POST /api/reset`: restore `data/local-db.json` from `data/local-db.seed.json` and return the new `X-Codex-State-Revision`.
- `GET /api/reset-diagnostics`: read recent state-write diagnostics from `.reset-diagnostics.jsonl`. Diagnostics cover `/api/reset`, `/api/actions/:key`, `PUT /api/state`, local API startup, and data-file seed creation. Entries include timestamp, source, run id, session id, reason, process id, path/action key, before/after counts, and caller metadata without changing business state or response shapes.
- Auth/security baseline: default local development uses `LOCAL_API_AUTH_MODE=dev` to preserve existing smoke-test behavior. Production-like hardening can run with `LOCAL_API_AUTH_MODE=required`, `LOCAL_API_AUTH_TOKEN`, and `LOCAL_API_ADMIN_TOKEN`. In required mode the API derives the action actor from server-side environment settings and ignores client-supplied `body.actor`; state replacement, reset, and reset diagnostics require the admin token. This is a local-first boundary only, not a final auth provider choice.
- Frontend session baseline: the browser app has a local-only token panel for testing auth-required mode. The token is kept in `sessionStorage` and sent as `Authorization: Bearer <token>` on local API reads/writes/actions. `401` and `403` responses are displayed as auth-required or permission-denied states. This panel is not a production login flow.
- Concurrency baseline: the local API exposes `X-Codex-State-Revision` on state reads and successful state-changing writes. The browser app stores the latest revision and sends `X-Codex-Expected-State-Revision` with `POST /api/actions/:key` and `PUT /api/state` when a revision is known. Stale revisions return `409 STATE_REVISION_CONFLICT` and include the current revision; the UI displays a conflict message with a refresh-latest-state recovery action. This guards backend writes without changing the state JSON shape. Field-level merge UX is deferred to a later phase.
- Deployment-readiness baseline: Phase 9 does not deploy the app. `npm run check:readiness` verifies local build artifacts, API health/auth mode, app reachability, `.dev-server.err.log`, seed/current DB hash, and diagnostics health. `docs/local-runtime.md` documents production-like local auth mode, admin token expectations, ports, file-backed state limits, browser fallback caveats, and reset/diagnostics guardrails.
- `shared/accounting-engine.mjs`: source of truth for UI fallback and local API accounting/action behavior.
- Contact actions now support creating customers/vendors through the same UI/API/AI action path, matching the source app pattern where contacts can be created from invoice/bill forms.
- Product actions now support creating product/service master data through the same UI/API/AI action path.
- Category actions now support creating category master data through the same UI/API/AI action path.
- Document lifecycle and numbering Phase 16A: the local API supports Bansi-like draft creation through `sales_document.create` / `purchase_document.create` with `status: "draft"`. Draft documents do not post journal entries, AR/AP, VAT, or settlement lines. The default UI-compatible create flow still starts at sales `quotation` and purchase `purchase_order`. Drafts advance one step to `quotation` / `purchase_order`, then continue through sales `quotation -> invoice -> receipt` and purchase `purchase_order -> bill -> paid`.
- Document numbering is deterministic and counter-backed: sales drafts use `SD#####`, purchase drafts use `PD#####`, quotations use `QT#####`, and purchase orders use `PO#####`. Draft-to-posted transitions issue a new `QT` / `PO` number without reusing earlier numbers in the same local state. User-entered `reference` values are preserved separately.
- Settlement journals are posted by the status update action when the user records receipt/payment. Sales receipts debit net cash, optional bank fee expense, optional withholding tax receivable, and credit the gross sales category amount. Paid bills debit the gross purchase category amount plus optional bank fee expense, then credit net cash and optional withholding tax payable. Same-currency settlement and adjustment accounts must match the document currency. If no settlement account/date/amount is sent, the engine keeps backward compatibility by choosing a cash account in the document currency first, then a bank account in the document currency, using the current date, and settling the remaining balance. Partial settlement keeps the document at `invoice` / `bill`; the final remaining settlement moves it to `receipt` / `paid`.
- Cross-currency settlement Phase 5B supports backend/API and UI sales invoice receipts and purchase bill payments, including partial settlements, bank fee, and withholding tax, into the organization base currency. Payload fields: `settlementAccountId`, `settlementDate`, optional `settlementAmount`, optional `settlementBankFeeAmount` / account, optional `settlementWithholdingTaxAmount` / account, required `settlementExchangeRate`, and optional `settlementExchangeGainAccountId` / `settlementExchangeLossAccountId`. Adjustment amounts are entered in document currency and posted to base-currency accounts at the settlement rate. The dialog previews net cash using sales `amount - fee - withholding` and purchase `amount - withholding + fee`. Sales journals debit net base-currency cash, optional bank fee expense, optional withholding receivable, and credit sales at the document exchange rate for the settled amount; purchase journals debit purchase expense plus optional bank fee, then credit net base-currency cash and optional withholding payable. Both flows post the realized difference to Exchange gain/loss accounts. Non-base settlement accounts remain blocked until later phases.
- Document locking is available through `document.lock` for both sales and purchase documents. Locked documents cannot move status, and permission checks apply before mutation.
- Guarded document deletion is available through `record.delete` for unposted, unlocked documents only. The shared engine removes document attachment references and writes a high-risk audit log; posted documents with journal entries are intentionally rejected. Cancel/void/reversal for posted or settled documents remains deferred until a dedicated reversal policy is signed off.
- Ledger, trial-balance, cash/bank movement, settlement-history, and VAT-summary reports are available as read-only local API endpoints. Report snapshot export uses the same shared report helpers from the browser. Customer-aging and vendor-aging remain frontend read views in this phase.
- Saved report filters are available through `report.filter.save` and `report.filter.delete`. The shared engine validates report key, optional account, date range, status, duplicate names, permissions, and audit logs before mutating `savedReportFilters`.
- `products`, `tags`, and `attachments` are seeded local metadata and mirrored in the host-ready Postgres schema. Phase 10A stores uploaded files locally and records metadata in state; hosted storage/provider policy remains a later deployment decision.

## Error Status Policy

- `400`: validation/domain input errors.
- `400 INVALID_STATE_SHAPE`: rejected whole-state replacement payloads.
- `403`: permission denied.
- `404`: unknown action or missing record.
- `500`: unexpected runtime error.

## Migration Steps Later

1. Choose the Hostinger runtime target: VPS/Node with Postgres is the closest fit for the current schema.
2. Replace the local bearer-token auth boundary and session-stub panel with the selected production auth/session provider while preserving server-derived actors and permission checks.
3. Replace `scripts/local-api.mjs` with a hosted API service that uses the same state/action contract.
4. Apply `database/schema.postgres.sql` to the hosted database.
5. Export/import local demo data only if the team wants to preserve prototype records.
6. Build and deploy the frontend after backend health checks pass.
7. Before any deployment, run the Phase 9 readiness checklist in production-like auth mode and replace local file-backed state with the chosen hosted database plan.
