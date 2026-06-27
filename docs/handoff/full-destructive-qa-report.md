# Full Destructive QA + Prototype/Expected Comparison Report

Date: 2026-06-26

Scope: final builder-side destructive QA and comparison pass for the local-first accounting demo after the Phase 13 roadmap batch. The user explicitly allowed destructive demo-data testing, resets, fake data generation, repairs to code/tests/docs/fixtures, and cleanup. No commit, push, deploy, cloud provider, or external paid service changes were performed.

## Overall Status

Status: PASS for local-first prototype / demo / targeted UAT readiness.

One real cleanup defect was found and fixed: `/api/reset` restored the JSON state to seed but could leave orphaned local attachment files if an upload succeeded and the process/test failed before deletion. Reset now clears the configured local attachment storage directory. The existing regression suite passed, and an additional destructive fake-data scenario passed after correcting test-harness assumptions about API response shapes.

Production readiness remains intentionally limited. The system is best described as demo-ready / targeted-UAT-ready, approximately 85-90%, not production-ready.

## Prototype / Expected Similarity Assessment

| Area | Similarity estimate | Evidence | Remaining differences |
| --- | ---: | --- | --- |
| Core accounting workflow | 90% | Cash revenue/payment post journals immediately; invoice/bill start as quotation/purchase-order without journal; status transitions post settlement journals; lock/delete guards work; partial/final settlement behavior matches documented expected workflow. | Some Bansi modules remain out of scope: payroll, deeper inventory, banking transfers/assets, import flows. |
| FX settlement and adjustments | 95% | Sales and purchase final/partial cross-currency settlement, realized gain/loss, bank fee, WHT, remaining balance, and report disclosure are covered by API/UI smoke plus destructive QA. | Non-base settlement accounts intentionally unsupported. Accounting policy still needs human UAT sign-off before production use. |
| Reports/export/print | 85% | Backend read endpoints exist for key reports; UI snapshot JSON, print snapshot, trial balance CSV, cash/bank CSV, settlement-history cash disclosure all pass. | No PDF/email/import; backend CSV endpoint not added; customer/vendor aging remains frontend read model in current phase. |
| UI/UX/navigation | 80% | User-requested polish is applied: dev/API controls hidden behind system menu, navigation moved into dropdown, brand/customer block retained, dark mode works, active navigation states are usable. | Not a pixel-perfect Bansi clone. Sidebar tree was intentionally replaced with a dropdown per user request. Dense-table visual QA remains useful before production demos. |
| Localization/i18n | 85% | EN/TH/LO UI smoke passes, session/auth/conflict copy is localized, master account/category/tax names display localized by known ids, technical terms are allowed exceptions. | Raw seed/API master data remains Lao in some records by design; UI display maps known master ids. Bansi has additional language switches such as Vietnamese/Chinese that are not in this clone. CNY/yuan was deferred by user. |
| Attachments | 80% | Local backend storage and document-row UI upload/list/download/delete pass; custom storage dir contract works; storagePath is not exposed. | No OCR, virus scanning, preview/thumbnails, cloud storage, batch upload, or cash transaction attachment UI. |
| Auth/session/security | 70% | Local bearer-token auth boundary, server-derived actor in required mode, admin endpoint guard, and frontend session stub work. | Still a local stub, not a production auth provider. Provider/session architecture is a decision needed. |
| Concurrency/conflict | 80% | State revision headers, expected revision writes, 409 conflict, UI refresh-latest flow pass. | No merge/diff/presence UX. File-backed state is not a durable multi-user database. |
| Deployment/readiness | 65% | `check:readiness` validates build, health, app reachability, logs, seed hash, diagnostics. Docs warn about dev auth and file-backed data. | No real deployment, hosted database, production secrets management, retention/privacy policy, or production infra review. |

## Finding Log

| ID | Severity | Finding | Expected / prototype basis | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| F-001 | Info | Baseline regression suite is green. | Phase 13 expected no-new-feature full regression before final tester handoff. | `typecheck`, `build`, `test:api`, `test:attachments`, `test:ui`, `check:readiness` all passed. | Confirmed |
| F-002 | Info | Destructive fake data scenario passed across representative workflows. | Bansi mapping expects realistic test records and side-effect validation, not only static checks. | Created `CODEX_DESTRUCTIVE_*` customer/vendor/revenue/payment/sales/purchase/attachment records, verified journals/reports/conflict, then reset to seed. | Confirmed |
| F-003 | Medium | `/api/reset` could leave orphaned files in local attachment storage after interrupted upload flows. | Demo reset should restore clean demo state, and final QA expects attachment storage cleanup. | Destructive QA failed mid-run after uploading `CODEX_DESTRUCTIVE_ATTACHMENT.txt`; final reset restored DB hash but `data/attachments` still had one orphan file. | Fixed now |
| F-004 | Info | Additional test harness needed to use actual contracts: `GET /api/state` returns raw state, and report query rows are in `data.rows`. | API contract differs by endpoint. | First two destructive inline attempts failed from harness assumptions, not runtime behavior. Corrected harness and scenario passed. | No runtime fix needed |
| F-005 | Low | Raw seed/master names are Lao in state/API, while UI localizes known master names by id. | User expects TH/LO/EN UI not to mix languages. | UI smoke passes localized display; raw `data/local-db.seed.json` contains Lao master labels. | Intentional/localized UI layer; monitor exports/API consumers |
| F-006 | Medium | Production auth/storage are not final. | Production readiness requires real auth provider and durable database. | Docs and readiness warn `LOCAL_API_AUTH_MODE=dev` is local-only; state is file-backed. | Backlog/decision needed |
| F-007 | Medium | Several Bansi modules remain unimplemented or shallow compared with source system. | Clone mapping checklist includes user roles, report deep dive, inventory/product deep dive, banking transfers/assets, import forms, HAR-level API errors. | `docs/clone-mapping/bansi-la/checklist.md` still has unchecked areas. | Backlog |
| F-008 | Low | Attachment UI is document-scoped only. | Phase 10B intentionally opened document owner first. | Attachment tests cover document rows; docs state cash transaction attachment UI deferred. | Backlog |
| F-009 | Low | Visual parity is intentionally not exact. | Original mapping prioritized logic/workflow/data flow first, UI visual later. | Current UI has dropdown nav and hidden dev controls per user request, not original Bansi sidebar. | Design decision |

## Fix Log

Runtime fix applied in this destructive pass:

| Change | Files | Before | After |
| --- | --- | --- | --- |
| Reset now clears configured local attachment storage. | `scripts/local-api.mjs`, `scripts/attachment-storage-dir-test.mjs` | `/api/reset` wrote seed state but did not remove physical files in `LOCAL_ATTACHMENT_STORAGE_DIR`, so interrupted attachment uploads could leave orphan files. | `/api/reset` clears the configured attachment storage root and records `attachmentFilesRemoved` in reset diagnostics; attachment storage test uploads a reset-cleanup file and asserts reset removes it. |

Recent pre-pass UI fixes already present and verified:

| Change | Files | Before | After |
| --- | --- | --- | --- |
| Hide noisy local API/session/reset controls from main header. | `src/App.tsx`, `src/styles.css` | Local API token, storage mode, and reset controls were visible in the primary dashboard header. | Controls are tucked behind a system/settings menu; main header is cleaner. |
| Move navigation into a dropdown and place it left near brand/customer block. | `src/App.tsx`, `src/styles.css` | Large left sidebar consumed space and did not match the user's requested compact navigation. | Current section is selectable from a dropdown; brand block remains visible for future customer logo/name branding. |
| Localize built-in master display names by id. | `src/App.tsx`, `src/i18n.ts` | Thai/English modes could still show Lao account/category names from seed data. | Known master data ids render localized names in UI while raw seed remains stable. |
| Keep CNY/yuan deferred. | No code change | User briefly requested CNY. | User later deferred yuan, so no currency was added. |

## Difference Matrix

| Expected / prototype behavior | Actual current behavior | Gap / difference | Severity / impact | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| Cash revenue/payment should immediately affect journals/dashboard balances. | Implemented and verified through API/UI/destructive QA. | None found. | Low | Fixed/covered | `cash_revenue.create`, `cash_payment.create`, UI smoke, destructive QA. |
| Invoice/bill create draft documents first and should not post settlement journal until status transition. | Implemented: sales starts `quotation`, purchase starts purchase-order flow; transition to invoice/bill does not post settlement journal; receipt/paid posts journal. | None found. | Low | Fixed/covered | API smoke and destructive QA. |
| Inline customer/vendor/category/product creation should update parent form selection. | Implemented and UI smoke-covered. | None found. | Low | Fixed/covered | `scripts/ui-smoke-test.ps1`. |
| FX final/partial sales and purchase settlement should be balanced and disclose gain/loss. | Implemented for base-currency LAK settlement, including fee/WHT. | Non-base settlement accounts are blocked. | Medium | Intentional limitation | API/UI smoke, destructive QA. |
| Reports should reconcile document amount and actual cash/bank amount. | Settlement history now exposes `amount/currency` and `cashAmount/cashCurrency`. | None found in tested scope. | Low | Fixed/covered | Phase 12B tests, destructive settlement-history query. |
| UI should not expose dev/API internals prominently. | Header dev controls are hidden behind system menu. | Dev/system controls still exist for local prototype operation. | Low | Design decision | UI smoke and manual screenshot-driven request. |
| UI language switch should not mix Lao/Thai/English unnecessarily. | User-facing UI copy and known master names are localized; technical terms remain exceptions. | Raw state/API seed names remain Lao; unsupported language switches from Bansi are not implemented. | Low/Medium | Partially covered | UI smoke localization assertions. |
| Attachment upload should store files safely and not expose internal paths. | Implemented locally for document owner; path traversal/type/size/custom dir/reset cleanup covered. | No cash transaction UI, preview, OCR, virus scan, or cloud storage. | Medium | Runtime cleanup fixed; feature backlog remains | `test:attachments`, UI smoke, destructive QA. |
| Auth should prevent client-supplied owner spoofing in production-like mode. | Required mode derives actor server-side and ignores body actor. | Still local bearer-token stub, no real provider/session lifecycle. | Critical for production | Backlog/decision needed | Phase 7B/7C tests/docs. |
| Concurrent writes should not silently overwrite newer state. | Revision contract rejects stale writes with 409 and UI can refresh latest. | No merge/diff/presence. | Medium | Baseline fixed; advanced backlog | API/UI conflict tests, destructive stale revision check. |
| Production deployment should have clear readiness gates. | Local readiness script and docs exist. | No actual deployment, no hosted DB/provider/security review. | High before production | Backlog | `npm run check:readiness`, docs. |

## Fake Data Coverage

The destructive QA scenario created and then removed data with the prefix `CODEX_DESTRUCTIVE_`.

| Fake data | Purpose | Cleanup |
| --- | --- | --- |
| `CODEX_DESTRUCTIVE_CUSTOMER_LAK` | Same-currency cash revenue contact. | Final `/api/reset`. |
| `CODEX_DESTRUCTIVE_CUSTOMER_USD` | USD sales invoice and FX settlement flow. | Final `/api/reset`. |
| `CODEX_DESTRUCTIVE_VENDOR_USD` | USD purchase bill and FX payment flow. | Final `/api/reset`. |
| `CODEX_DESTRUCTIVE_REVENUE` | Verify cash revenue VAT and immediate cash debit / revenue credit behavior. | Final `/api/reset`. |
| `CODEX_DESTRUCTIVE_PAYMENT` | Verify cash payment immediate expense debit / cash credit behavior. | Final `/api/reset`. |
| `CODEX_DESTRUCTIVE_SALES_FX` | Verify quotation -> invoice -> partial receipt -> final receipt, FX gain/loss, fee/WHT, remaining balance, settlement-history disclosure. | Final `/api/reset`. |
| `CODEX_DESTRUCTIVE_PURCHASE_FX` | Verify purchase document -> bill -> partial payment, FX loss, fee/WHT, remaining balance. | Final `/api/reset`. |
| `CODEX_DESTRUCTIVE_ATTACHMENT.txt` | Verify document attachment upload/download/delete, metadata safety, no `storagePath` exposure. | Deleted before final reset. |
| `CODEX_DESTRUCTIVE_CONFLICT_WINNER` | Create real state change after capturing stale revision. | Final `/api/reset`. |
| `CODEX_DESTRUCTIVE_STALE_WRITE` | Confirm stale write is rejected with `409 STATE_REVISION_CONFLICT`. | Rejected; no persisted record. |

## Verification Log

Baseline full local regression/readiness:

| Command/check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run test:api` | PASS |
| `npm run test:attachments` | PASS |
| `npm run test:ui` | PASS |
| `npm run check:readiness` | PASS with intended local-dev warning for `LOCAL_API_AUTH_MODE=dev` |

Additional destructive fake-data QA:

| Scenario | Result |
| --- | --- |
| Reset to seed before destructive test | PASS |
| Cash revenue/payment immediate journal posting | PASS |
| Sales quotation no journal before settlement | PASS |
| Sales FX partial receipt with bank fee/WHT and gain | PASS |
| Sales FX final remaining settlement with loss | PASS |
| Purchase FX partial payment with bank fee/WHT and loss | PASS |
| Document attachment upload/download/delete | PASS |
| Settlement-history document amount vs cash amount disclosure | PASS |
| Stale revision write rejection | PASS |
| Final reset to seed | PASS |
| Reset removes orphaned local attachment files | PASS after fix |

Test-harness corrections during QA:

| Harness issue | Runtime impact | Resolution |
| --- | --- | --- |
| Assumed `GET /api/state` was wrapped as `{ ok, state }`. | None. Endpoint correctly returns raw state. | Adjusted destructive check to read raw state and revision header. |
| Assumed report query rows were at `report.rows`. | None. Endpoint correctly returns `data.rows`. | Adjusted destructive check to read `data.rows`. |
| Initially hand-calculated document remaining from journal entries. | None. Runtime/report helper was correct. | Switched destructive check to `documentRemainingAmount` from `shared/report-models.mjs`. |

## Health / Cleanup Status

After baseline and destructive QA, the local system was reset to seed by the destructive scenario and verified after the attachment reset-cleanup fix.

Final post-fix checks:

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run test:api` | PASS |
| `npm run test:attachments` | PASS |
| `npm run test:ui` | PASS |
| `npm run check:readiness` | PASS with intended local-dev warning |
| `/api/health` | PASS, `authMode:"dev"` |
| app `http://127.0.0.1:5173/` | PASS, HTTP 200 |
| `.dev-server.err.log` | PASS, 0 bytes |
| DB hash | PASS, `B3AF110B2DD92E98D030576DDA5688E1CB75D1EAE96FDC2750D85FE8CC0F8C30` |
| diagnostics latest 200 | PASS, no `api.ensure_data_file.read_failed` / `api.ensure_data_file.seed_created` |
| default attachment storage | PASS, 0 files |
| custom attachment storage | PASS, removed by test cleanup |

Tester can independently verify:

- `/api/health`
- app reachability at `http://127.0.0.1:5173/`
- `.dev-server.err.log`
- `data/local-db.json` hash compared with `data/local-db.seed.json`
- `GET /api/reset-diagnostics?limit=200`
- `data/attachments` and custom attachment directories for leftover files

Builder final readiness confirmed seed hash `B3AF110B2DD92E98D030576DDA5688E1CB75D1EAE96FDC2750D85FE8CC0F8C30`, and attachment storage was clean after reset.

## Remaining Backlog / Decisions Needed

1. Production auth provider and session architecture: replace local bearer-token stub.
2. Hosted durable database/storage architecture: replace file-backed local DB before real production.
3. Production security review: admin/reset/diagnostics endpoint policy, retention/privacy policy, secrets management, CORS, headers, audit log retention.
4. Accounting UAT sign-off: human accounting review of VAT, WHT, FX gain/loss, and settlement policies.
5. Non-base settlement account policy: intentionally unsupported until accounting policy is decided.
6. Additional Bansi modules: payroll, full inventory, banking transfer/assets, imports, email/PDF/export extensions.
7. Attachment enhancements: cash transaction attachment UI, preview/thumbnails, OCR, virus scan, cloud/object storage.
8. Conflict UX enhancements: merge/diff/presence beyond refresh-latest.
9. Visual QA: dark mode dense tables, print preview, and exact branding/logo customerization before polished demo.
10. Optional CNY/yuan: user deferred; add only when requested and accounting policy is clear.

## Tester Handoff Recommendation

Recommended status for Tester: ready for final verification of the builder destructive pass.

Suggested Tester scope:

1. Re-run the standard local gates: `typecheck`, `build`, `test:api`, `test:attachments`, `test:ui`, `check:readiness`.
2. Re-run or reproduce a subset of the destructive fake-data scenario with `CODEX_DESTRUCTIVE_*` records:
   - sales FX partial/final with fee/WHT,
   - purchase FX partial with fee/WHT,
   - attachment upload/download/delete,
   - settlement-history `amount/currency` vs `cashAmount/cashCurrency`,
   - stale revision conflict.
3. Inspect UI language modes for the recent localization fix: EN/TH/LO should not show unexpected Lao/English for known master account/category names, except technical terms and codes.
4. Confirm hidden dev controls and dropdown navigation remain usable:
   - system menu contains local API/reset/session controls,
   - section dropdown is on the left near the brand/customer block,
   - customer brand block is preserved for future customer logo/name.
5. Confirm final cleanup:
   - DB hash equals seed,
   - diagnostics latest entries have no `api.ensure_data_file.read_failed` or `api.ensure_data_file.seed_created`,
   - attachment directories have no leftover files,
   - `.dev-server.err.log` is empty.

If Tester finds no regression, the current system can be described to the user as a strong local-first demo / targeted-UAT prototype with production blockers clearly documented, not as a production-ready accounting platform.
