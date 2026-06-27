# Codex Reviewer Handoff Pack

## Purpose

This project is a localhost-first accounting system prototype inspired by the observed Bansi.la demo workflows. The goal is not a pixel-perfect clone yet; the current focus is cloning the business flows, data behavior, validation, permissions, auditability, and future AI Agent action surface.

The system must stay local-first for now. Previous cloud database integration was intentionally removed. The code should remain Hostinger-ready so the local API and file-backed state can later move to a hosted API/database.

## Current Architecture

- Frontend: React + Vite + TypeScript.
- Local API: `scripts/local-api.mjs`, listening at `http://127.0.0.1:8787`.
- Frontend dev server: `http://127.0.0.1:5173`.
- Runtime state: `data/local-db.json`, reset from `data/local-db.seed.json`.
- Reset diagnostics: `.reset-diagnostics.jsonl`, also readable through `GET /api/reset-diagnostics`.
- Shared business engine: `shared/accounting-engine.mjs`.
- Action contracts: `data/action-contracts.json`.
- Frontend state layer: `src/store.ts`.
- UI modules: `src/App.tsx`.
- Type model: `src/types.ts`.
- Host-ready schema: `database/schema.postgres.sql`.

Important design rule: `shared/accounting-engine.mjs` is the source of truth for mutations used by UI fallback, local API, and future AI Agent calls.

Phase 7B security baseline: the local API now has an auth boundary switch. Default `LOCAL_API_AUTH_MODE=dev` preserves the existing localhost smoke-test flow. `LOCAL_API_AUTH_MODE=required` requires bearer-token authentication, derives the action actor from server-side environment settings, ignores client-supplied `body.actor`, and requires a separate admin token for reset/state-diagnostics/state-replacement surfaces.

Phase 7C UI/session baseline: the frontend now has a local-only session stub for the Phase 7B local API boundary. The token is stored in browser `sessionStorage`, sent as `Authorization: Bearer <token>` on local API calls, and can be set or cleared from the topbar. The UI surfaces `401` as an auth-required message and `403` as a permission-denied message. This remains a testing stub, not a production auth provider or session UX.

Phase 8A concurrency baseline: the local API now exposes a file-state revision header and supports compare-and-swap write guards. `GET /api/state`, successful `POST /api/actions/:key`, `PUT /api/state`, and `POST /api/reset` return `X-Codex-State-Revision`. Writers can send `X-Codex-Expected-State-Revision`; if the current file revision differs, the API returns `409 STATE_REVISION_CONFLICT` with `currentRevision`. The header is optional for backward compatibility in dev/test mode. UI conflict resolution is intentionally deferred to Phase 8B.

Phase 8B UI conflict handling: the browser app stores the latest local API state revision after state reads, reset, whole-state writes, and action writes. Frontend writes now send `X-Codex-Expected-State-Revision` when a revision is known. If the API returns `409 STATE_REVISION_CONFLICT`, the app shows a conflict banner/message and offers a refresh-latest-state action that reloads `/api/state` and the current revision. This preserves dev/auth/session behavior and avoids silent browser-local fallback after the API is ready.

Phase 9 deployment-readiness hardening: no deployment is performed. The repo now has a local-only readiness check (`npm run check:readiness`) and a production-like local runbook in `docs/local-runtime.md`. The check verifies build artifacts, API health/auth mode, app reachability, dev-server error log size, seed/current DB hash, and reset diagnostics health. `.env.example` documents local auth/admin/readiness variables and warns that `LOCAL_API_AUTH_MODE=dev` is development-only.

Phase 10A attachment backend/storage: the local API now supports real local attachment files without opening UI upload. Files are stored under `LOCAL_ATTACHMENT_STORAGE_DIR` (default `data/attachments`) with metadata in `state.attachments` and owner links on documents/cash transactions. Metadata stores a `storageKey` resolved inside the configured storage root, so custom storage directories do not rely on hardcoded `data/attachments` paths. Supported endpoints are `POST /api/attachments`, `GET /api/attachments`, `GET /api/attachments/:id/download`, and `DELETE /api/attachments/:id`. Upload uses JSON/base64 in this backend-only phase, enforces filename/path/type/size validation, and supports Phase 8 expected-revision headers for metadata writes.

Phase 10B attachment UI: invoice/bill document rows now include a real attachment manager for document owners. The UI uploads files through `POST /api/attachments`, lists safe metadata through `GET /api/attachments`, downloads through `GET /api/attachments/:id/download`, and deletes through `DELETE /api/attachments/:id`. Upload/delete use the Phase 8 expected-revision flow, conflict errors reuse the existing refresh-latest-state UX, and the UI does not expose internal `storagePath`.

Phase 11 reports/export slice: Trial Balance and Cash/bank movement panels now have CSV export buttons. The CSV payload is generated from the same in-memory report rows used by the visible tables, with translated headers, deterministic filenames, and browser smoke assertions for captured `text/csv` downloads. This phase does not add PDF export, backend CSV endpoints, or new report architecture.

Phase 12A UI polish slice: the frontend now has a local-first dark mode toggle in the top bar, persisted with `localStorage` key `accounting-system-theme`, and applied through `data-theme` on the app/root element. User-facing session/auth/conflict strings and the primary navigation label are localized through `src/i18n.ts`; technical terms such as CSV, API, Local API, token, LAK, THB, USD, document ids, and action contract keys intentionally remain English or code-like. Navigation polish is limited to visual theming and active/readability states, with no workflow or backend changes.

Phase 12B accounting/UAT slice: Document settlement history now discloses both the document-currency amount settled and the actual cash/bank amount posted. The existing `amount` field remains the document amount for compatibility; backend report rows additionally expose `cashAmount` and `cashCurrency`, and the Reports UI shows separate `Document amount settled` and `Cash/bank amount` columns. This is a disclosure/read-model fix only and does not change journals, settlement math, FX policy, or document status behavior.

Currency/language separation slice: money formatting now receives UI locale separately from stored currency, so Thai UI shows LAK as `กีบ` instead of Lao `ກີບ`, Lao keeps Lao labels, and English uses currency codes. Cash revenue/payment forms expose a currency selector that filters cash/bank accounts, while invoice/bill forms expose a document currency selector and send optional `currency` to the create action. CNY/yuan and product per-currency price lists remain deferred until allowed-currency/profile/accounting policy is defined.

## Current Constraints

- Do not reintroduce cloud database code.
- Do not commit, push, deploy, or connect external services unless the user explicitly orders it.
- Phase 9 readiness checks are local-only and must not create external resources or imply the app is production-ready.
- Keep tests resetting `data/local-db.json` back to seed state.
- All user-visible app work should stay local-first and Hostinger-ready.
- AI Agent must use the same actions as a normal user and pass the same permission, validation, and audit checks.

## Implemented Features

- Dashboard with cash summary and recent activity.
- Revenue/payment creation with journal entries.
- Invoice/bill document creation without immediate journal posting.
- Sales document status workflow: `quotation -> invoice -> receipt`, with settlement journal posting on `invoice -> receipt`.
- Purchase document status workflow: `purchase_order -> bill -> paid`, with settlement journal posting on `bill -> paid`.
- Settlement dialogs collect cash/bank account, payment date, settlement amount, optional bank fee, and optional withholding tax before invoice/bill settlement transitions.
- Partial settlement posts a journal while keeping the document in `invoice` / `bill`; the final remaining settlement moves it to `receipt` / `paid`.
- Sales settlement can debit net cash, bank fee expense, and withholding tax receivable while crediting the gross sales amount. Purchase settlement can debit gross purchase amount plus bank fee expense while crediting net cash and withholding tax payable.
- Reports page under Accounting with ledger by account, trial balance, cash/bank movement, document settlement history, VAT summary, report snapshot download/print controls, customer aging, and vendor aging derived from journal entries and current local state.
- Backend report/query endpoints Phase 1 expose read-only local API reports for `ledger`, `trial_balance`, `cash_movement`, `settlement_history`, and `vat_summary` through `POST /api/reports/:reportKey/query` and `GET /api/reports/:reportKey`.
- Report snapshot JSON download now uses the shared report-model helper and includes explicit metadata for `generatedAt`, active filters, snapshot report identity, data source type, data source mode, and report model version.
- Trial Balance and Cash/bank movement now include Phase 11 CSV exports from the Reports UI.
- Phase 12A adds a persisted light/dark theme toggle and localized session/auth/conflict UI copy across English, Thai, and Lao.
- Phase 12B adds settlement-history disclosure for document amount versus actual cash/bank amount, useful for fee/WHT and FX UAT tracing.
- Print snapshot QA is covered in UI smoke by stubbing `window.print()` and confirming the print action is called without runtime errors.
- `report.view` is available as a low-risk read action contract so future AI Agent callers must pass `report:view` permission before reading report data.
- Saved report filters are stored in local state through `report.filter.save` and `report.filter.delete`, including permission checks, validation, audit logs, UI apply/save/delete controls, and delete confirmation.
- Document locking through `document.lock`, including UI confirmation, permission checks, duplicate-lock rejection, high-risk audit log, and blocked status changes after lock.
- Guarded document deletion through `record.delete`, including UI confirmation, permission checks, high-risk audit log, attachment-reference cleanup, and backend rejection for locked or journal-posted documents.
- Contact creation through `customer.create` and `vendor.create`.
- Inline contact creation in invoice/bill forms with optional fields:
  - email
  - phone
  - tax number
  - currency
  - address
- Product/service management through `product.create`.
- Category management through `category.create`.
- Inline category quick-create is available in revenue, payment, invoice, and bill forms through the same `category.create` action path.
- Inline product/service quick-create is available inside line-item editing and immediately applies the created product to the first available line.
- Product-backed line items with:
  - product
  - unit
  - unit price
  - discount type
  - tax snapshot
- Form parity fields:
  - due date
  - VAT number
  - exchange rate
  - tags
  - attachment references
- Attachment support has backend/API local file storage and Phase 10B document-row UI upload/list/download/delete for invoices and bills. Cash transaction attachment UI remains deferred.
- Three UI languages are wired: English, Thai, Lao. Lao locale uses self-hosted Noto Sans Lao font files from `public/fonts`.

## Important Fixed Bugs

- Status transitions can no longer skip steps.
- Inline contact creation trims the name and selects the created contact.
- Invalid `PUT /api/state` now returns `INVALID_STATE_SHAPE`.
- Product VAT can be overridden to `tax-none`; it no longer silently falls back to the product tax.
- Invoice/bill settlement journals are posted only on final status transitions and keep the user-entered document reference.
- Settlement account/date are accepted through the status update action payload, with fallback defaults for older API/AI callers.
- `settlementAmount` is accepted through the status update action payload. If omitted, the engine settles the remaining document balance to preserve older API/AI callers.
- `settlementBankFeeAmount`, `settlementBankFeeAccountId`, `settlementWithholdingTaxAmount`, and `settlementWithholdingTaxAccountId` are accepted through the status update action payload. The shared engine validates account kind and currency before journal posting.
- Cross-currency settlement Phase 5B enables backend/API and UI sales invoice receipts and purchase bill payments, including partial settlements, bank fee, and withholding tax, into a base-currency LAK cash/bank account when `settlementExchangeRate` is supplied. Realized exchange gain/loss is calculated only on the settled document-currency amount; sales partial receipts keep the document in `invoice`, purchase partial payments keep the document in `bill`, and final remaining settlements move them to `receipt` / `paid`.
- UI cross-currency settlement now keeps bank fee/withholding fields enabled for supported sales and purchase flows. Adjustment amounts are entered in document currency, the dialog previews net cash, and the action payload posts them through the Phase 5A backend contract. Non-base settlement accounts remain intentionally unsupported and return validation errors.
- Settlement dialog defaults the bank fee account to `Bank fees (LAK)` instead of the general expense account so UI-created journals keep bank charges separate from the gross expense category.
- The frontend action layer no longer silently falls back to browser-local mutations after the localhost API has been confirmed available; API failure is surfaced as an action error instead.
- `npm run test:ui` was stabilized with per-run browser sessions, bounded agent-browser calls, row-scoped document actions, committed field-value waits, API-state-first polling, richer failure diagnostics, and final direct `/api/state` assertions. The test starts from `/api/reset` and only asserts the UI reset control exists, avoiding a second reset click racing against early form actions.
- State writes now append non-business diagnostics to `.reset-diagnostics.jsonl` and expose recent entries via `GET /api/reset-diagnostics`. Covered events include `api.reset`, `api.action.write`, `api.state.put`, `api.startup`, and `api.ensure_data_file.seed_created`. API/UI smoke runners and browser action calls send source, run id, session id, and reason headers so reset/overwrite races can be traced without changing business behavior or response shapes.
- Phase 7B added a local-first auth/security baseline without choosing an external provider. In auth-required mode, `POST /api/actions/:key` and report reads use a server-derived actor from `LOCAL_API_ACTOR_ID`, `LOCAL_API_ROLE_KEY`, and `LOCAL_API_PERMISSIONS`; client-supplied owner actors no longer bypass permissions. `PUT /api/state`, `POST /api/reset`, and `GET /api/reset-diagnostics` require the admin bearer token.
- Phase 7C added frontend support for the Phase 7B boundary. Local API calls include the bearer token when the session stub is populated, dev mode remains compatible with existing smoke tests, and auth/permission failures are shown visibly instead of failing silently.
- Phase 8A added backend/data-file revision guards for stale writes. Current-revision writes succeed, stale `PUT /api/state` and stale action writes return `409 STATE_REVISION_CONFLICT`, and the API smoke test covers the narrow no-lost-update scenario.
- Phase 8B wires the frontend to the revision contract. Browser actions include `X-Codex-Expected-State-Revision`, state conflicts surface as a user-visible message, and the session banner can refresh the latest state/revision instead of silently overwriting newer local API data.
- Phase 9 adds a local readiness check and runbook without deploying. It keeps dev/test behavior intact while documenting production-like auth/admin token expectations, file-backed data limits, browser fallback caveats, and diagnostics/reset guardrails.
- Phase 10A adds real backend/API attachment storage. API smoke covers upload success, metadata persistence, owner linking, list/download, delete/detach, path traversal rejection, executable/type rejection, and max-size rejection.
- Phase 10B adds document attachment UI coverage in `npm run test:ui`: upload through the row control, metadata appears, download/delete controls render, delete detaches metadata, and internal `storagePath` is not shown.
- Phase 11 adds targeted CSV export coverage in `npm run test:ui` for Trial Balance and Cash/bank movement, including filename prefix, CSV content type capture, headers, and representative row content.
- Phase 12A adds targeted UI smoke assertions for dark mode toggle behavior, `localStorage` persistence, and restoration to light mode before the existing accounting workflow assertions continue.
- Phase 12B adds targeted API smoke coverage for adjusted settlement history rows (`amount` versus `cashAmount` / `cashCurrency`) and UI smoke coverage for the new settlement-history columns.

## Current Test Commands

Use the explicit Node/npm PATH on this machine:

```powershell
$env:Path='C:\Program Files\nodejs;C:\Users\Rabbi\AppData\Roaming\npm;' + $env:Path
& 'C:\Program Files\nodejs\npm.cmd' run typecheck
& 'C:\Program Files\nodejs\npm.cmd' run build
& 'C:\Program Files\nodejs\npm.cmd' run test:api
& 'C:\Program Files\nodejs\npm.cmd' run test:attachments
& 'C:\Program Files\nodejs\npm.cmd' run test:ui
& 'C:\Program Files\nodejs\npm.cmd' run check:readiness
```

Expected latest status:

- `npm run typecheck` passes.
- `npm run build` passes.
- `npm run test:api` passes.
- `npm run test:attachments` passes for custom `LOCAL_ATTACHMENT_STORAGE_DIR` contract checks.
- `npm run test:ui` passes when the local dev server is already running.
- `npm run check:readiness` passes after `npm run build` with the local API/frontend running.
- `http://127.0.0.1:5173/` returns 200.
- `http://127.0.0.1:8787/api/health` returns ok.
- `.dev-server.err.log` is empty.
- After API tests, local DB returns to seed:
  - contacts: 2
  - products: 2
  - tags: 2
  - cash/documents/journals/attachments: 0
  - saved report filters: 0

## Reviewer Checklist

When acting as a reviewer pair:

1. Run `typecheck`, `build`, and `test:api`.
2. Run `test:ui` for browser coverage when working on inline forms, settlement dialogs, document lock/delete, or navigation.
3. Confirm `data/local-db.json` returns to seed after tests.
4. Check `.dev-server.err.log`.
5. If a reset race/flaky empty state appears, inspect `GET /api/reset-diagnostics?limit=50` or `.reset-diagnostics.jsonl` for `event`, `path`, `actionKey`, `source`, `runId`, `sessionId`, `reason`, `beforeCounts`, and `afterCounts`.
6. Search for accidental cloud database references outside `node_modules` and `dist`.
7. For every new action, verify:
   - action contract exists
   - shared engine handles it
   - permission denial is tested
   - validation errors are tested
   - audit log is created
   - UI and API use the same action key
8. Pay special attention to accounting totals, tax behavior, and document status transitions.
9. For auth/security work, run `npm run test:api` and confirm the Phase 7B auth-required checks cover unauthenticated rejection, client owner spoofing, and admin endpoint guard behavior.
10. For Phase 7C UI/session work, do module-only browser checks in `LOCAL_API_AUTH_MODE=required`: no token should show auth required, a valid owner token should load the app, and a valid viewer token should show permission denied on a mutation.
11. For Phase 8A concurrency work, keep review scoped to the local API revision contract: state revision headers, stale write conflict responses, current revision success, and diagnostics cleanliness. Do not require UI conflict handling until Phase 8B.
12. For Phase 8B UI conflict work, keep review scoped to frontend revision storage, expected-revision headers on UI writes, `409 STATE_REVISION_CONFLICT` display, refresh-latest-state recovery, and preservation of existing dev/auth session behavior.
13. For Phase 9 readiness work, keep review scoped to `package.json`, `.env.example`, `scripts/readiness-check.mjs`, `docs/local-runtime.md`, and readiness notes. Do not require deployment, cloud resources, or full-system regression.
14. For Phase 10A attachment backend work, keep review scoped to local API attachment endpoints, local storage path, metadata/revision behavior, validation guardrails, and API smoke coverage. Do not require UI upload/preview until Phase 10B.
15. For Phase 10B attachment UI work, keep review scoped to invoice/bill document-row upload/list/download/delete, backend validation messages, revision/conflict behavior, and storage cleanup. Do not require cash transaction upload UI, previews, thumbnails, batch upload, OCR, or cloud storage.
16. For Phase 11 report/export work, keep review scoped to Trial Balance and Cash/bank movement CSV exports and their UI smoke assertions. Do not require PDF export, backend CSV endpoints, or broad report redesign.
17. For Phase 12A UI localization/dark mode work, review only frontend strings, theme persistence, contrast/readability, menu polish, and the targeted UI smoke assertions. Keep technical identifiers such as CSV/API/LAK/USD/action keys as allowed exceptions.
18. For Phase 12B accounting/UAT work, keep review scoped to settlement-history disclosure fields and table columns. Confirm journals/statuses are unchanged and do not request broader accounting policy fixes in this phase.

## Next Planned Work

Immediate next step: wait for coordinator-selected scope after Phase 12B review. Candidate later modules include non-base settlement policy, connecting the Reports UI directly to backend report endpoints, and later PDF/email/import work.

## Known Gaps

- Cash transaction attachment upload UI is not implemented yet. Phase 10B opens attachment UI only for invoice/bill document rows. There is no thumbnail/preview/OCR/virus-scan integration.
- No category editor/update/delete yet.
- No product editor/update/delete yet.
- No PDF/email/import flow yet. CSV export is currently limited to Trial Balance and Cash/bank movement in the Reports UI.
- Reports use a shared read-model helper between the frontend and local API for Phase 1 backend endpoints. Snapshot JSON download now uses the shared helper and has UI smoke coverage. Customer aging and vendor aging are still browser-side read views until later backend phases.
- No recurring documents yet.
- Browser automation regression currently covers Lao font selection, inline category/product creation, settlement account currency filtering, settlement amount defaults, bank fee default selection, UI-posted bank fee/withholding journal lines, trial balance/VAT/snapshot report display, saved report filter save/apply/delete, customer aging report display, document lock behavior, guarded delete behavior, and API persistence through `npm run test:ui`.
- Permission model is still basic and local.
- Auth provider/session UX is intentionally not implemented yet. Phase 7B provides only a backend/API boundary and local auth-required mode for production-readiness hardening; provider choice remains a decision needed for later phases.
- The Phase 7C session panel is a local testing stub. Production login, refresh tokens, password reset, SSO/OAuth, secure cookies, CSRF policy, and provider-backed session persistence remain decision-needed work for later phases.
- Phase 8B adds basic UI conflict handling, but it is still a local-first prototype flow. It does not include merge tools, field-level conflict resolution, or multi-user presence indicators.
- Settlement supports multiple partial journals, rejects overpayment, and supports bank fee plus withholding tax adjustments for same-currency settlements.
- Cross-currency settlement supports final sales invoice receipts and final purchase bill payments into the organization base currency with realized exchange gain/loss. Backend/API and UI support sales invoice partial receipts, purchase bill partial payments, and cross-currency bank fee/withholding adjustments. Non-base settlement accounts are not supported yet.
