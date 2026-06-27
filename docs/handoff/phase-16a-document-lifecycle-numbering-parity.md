# Phase 16A Document Lifecycle + Numbering Parity

Date: 2026-06-26

Scope: narrow functional parity work for sales/purchase document lifecycle and deterministic numbering. This phase focuses on backend/API behavior and targeted tests. It does not attempt full cancel/void/reversal accounting, detail/voucher pages, or broad UI redesign.

Real Bansi safety boundary: no additional real-site mutation was performed. Phase 16A used the sanitized Phase 15 gap map as its source.

## Overall Status

Builder status: ready for module-only Tester review.

Retest addendum: Tester found one closure defect after the first handoff: draft documents were non-posting but still appeared in VAT Summary. This has been fixed in the shared report model and covered by `npm run test:lifecycle`.

Implemented safe subset:

- API can now create sales/purchase documents as `draft`.
- Draft documents do not post journals, AR/AP, VAT, or settlement entries.
- Default UI-compatible creation remains unchanged:
  - sales document create without `status` starts as `quotation`;
  - purchase document create without `status` starts as `purchase_order`.
- Drafts advance one step:
  - sales `draft -> quotation -> invoice -> receipt`;
  - purchase `draft -> purchase_order -> bill -> paid`.
- Invalid direct settlement transitions from draft are rejected.
- Deterministic counter-backed document numbers were added:
  - sales draft: `SD#####`;
  - purchase draft: `PD#####`;
  - quotation: `QT#####`;
  - purchase order: `PO#####`.
- Draft-to-posted transition issues a new posted number (`QT` / `PO`) and does not reuse numbers already issued in the same local state.
- Existing settlement behavior is preserved, including same-currency settlement and one FX partial settlement with fee/WHT.
- VAT Summary now excludes non-posting document statuses:
  - sales `draft` and `quotation`;
  - purchase `draft` and `purchase_order`.
- VAT Summary continues to include posted/open tax-impact document statuses:
  - sales `invoice` and `receipt`;
  - purchase `bill` and `paid`.

Deferred by design:

- Cancel/void/reversal for posted or settled documents.
- Draft UI creation selector.
- Full Bansi detail/voucher/ledger pages.
- Numbering policy for production reset periods, branch prefixes, fiscal-year prefixes, and legal void/skip retention.

## Status Graph

### Sales

```mermaid
flowchart LR
  draft["draft\nnon-posting"] --> quotation["quotation\nnon-posting"]
  quotation --> invoice["invoice\nopen receivable state"]
  invoice --> receipt["receipt\nsettlement journal posted"]
```

Rules:

- `draft` creation is API-supported and non-posting.
- `quotation` remains the default local UI-compatible creation status.
- `quotation -> invoice` does not post a settlement journal.
- `invoice -> receipt` posts settlement journal lines.
- Partial receipt keeps status at `invoice`; final remaining receipt moves status to `receipt`.
- `draft -> receipt` is rejected.

### Purchase

```mermaid
flowchart LR
  draft["draft\nnon-posting"] --> purchase_order["purchase_order\nnon-posting"]
  purchase_order --> bill["bill\nopen payable state"]
  bill --> paid["paid\nsettlement journal posted"]
```

Rules:

- `draft` creation is API-supported and non-posting.
- `purchase_order` remains the default local UI-compatible creation status.
- `purchase_order -> bill` does not post a settlement journal.
- `bill -> paid` posts settlement journal lines.
- Partial payment keeps status at `bill`; final remaining payment moves status to `paid`.
- `draft -> paid` is rejected.

## Numbering Policy

| Document kind | Status when number issued | Prefix | Example | Notes |
| --- | --- | --- | --- | --- |
| Sales | `draft` | `SD` | `SD00001` | Internal/local draft number. |
| Sales | `quotation` | `QT` | `QT00001` | Default existing behavior preserved. |
| Purchase | `draft` | `PD` | `PD00001` | Internal/local draft number. |
| Purchase | `purchase_order` | `PO` | `PO00001` | Default existing behavior preserved. |

Implementation details:

- Counters are stored in optional `state.documentNumberCounters`.
- Seed files do not need counters; counters are initialized lazily when documents are created or drafts are promoted.
- The local API remains backward-compatible with existing seed/state shapes.
- User-entered `reference` is preserved separately and still flows into settlement journal references where the previous behavior did.
- Draft-to-quotation / draft-to-purchase-order receives a new `QT` / `PO` number. The original draft number is retired in audit/history but the document's active number becomes the posted number.

Production/legal policy still needed:

- Whether cancelled/voided numbers must remain visibly reserved forever.
- Whether number sequences reset by fiscal year, organization, document type, or branch.
- Whether invoice and receipt should have separate legal numbers.

## Files Changed

| File | Change |
| --- | --- |
| `shared/accounting-engine.mjs` | Added initial draft status support, deterministic document-number counters, draft promotion renumbering, and clearer audit summaries. |
| `shared/report-models.mjs` | Fixed VAT Summary so non-posting document statuses do not create VAT report impact. |
| `src/types.ts` | Added optional `DocumentInput.status` and optional `AppState.documentNumberCounters`. |
| `scripts/document-lifecycle-numbering-test.mjs` | Added targeted Phase 16A lifecycle/numbering regression, including VAT Summary exclusion/inclusion checks. |
| `package.json` | Added `npm run test:lifecycle`. |
| `docs/local-first-hostinger-plan.md` | Documented lifecycle, numbering, and deferred cancel/void/reversal policy. |
| `docs/handoff/phase-16a-document-lifecycle-numbering-parity.md` | This handoff. |

## Behavior Before / After

| Area | Before | After |
| --- | --- | --- |
| Sales create default | Always `quotation`, `QT#####` based on document count. | Still `quotation`, now `QT#####` from counter-backed numbering. |
| Purchase create default | Always `purchase_order`, `PO#####` based on document count. | Still `purchase_order`, now `PO#####` from counter-backed numbering. |
| Draft support | Type existed but there was no create path. | API create can pass `status: "draft"`. |
| Draft posting | Not reachable. | Draft does not post journal, AR/AP, VAT, or settlement. |
| VAT Summary for non-posting docs | Non-posting document rows could appear if they had taxable line items. | `draft`, `quotation`, and `purchase_order` are excluded from VAT Summary; `invoice`, `receipt`, `bill`, and `paid` remain included. |
| Draft transition | Status graph existed internally but not reachable. | Draft can move to `quotation` / `purchase_order` and receives posted number. |
| Invalid direct settlement | Existing invalid transitions rejected. | Draft direct settlement is explicitly covered by targeted tests. |
| Number uniqueness | Count-based numbering could reuse numbers after deletion or lifecycle changes. | Counter-backed numbering avoids reuse in the current local state. |

## Targeted Test Coverage

New command:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test:lifecycle
```

Covered scenarios:

- Sales draft create: `SD00001`, status `draft`, no journal.
- Sales draft with VAT is excluded from VAT Summary rows and tax totals.
- Sales default create: `QT00001`, status `quotation`, compatibility preserved.
- Sales quotation with VAT is excluded from VAT Summary until promoted to `invoice`.
- Sales draft -> quotation: new `QT00002`, no journal.
- Sales invoice with VAT appears in VAT Summary with output tax.
- Second sales draft: `SD00002`, no number reuse.
- Sales draft -> receipt rejected.
- Sales quotation -> invoice -> receipt same-currency settlement remains balanced.
- Purchase draft create: `PD00001`, status `draft`, no journal.
- Purchase draft with VAT is excluded from VAT Summary rows and tax totals.
- Purchase default create: `PO00001`, status `purchase_order`, compatibility preserved.
- Purchase order with VAT is excluded from VAT Summary until promoted to `bill`.
- Purchase draft -> purchase_order: new `PO00002`, no journal.
- Purchase bill with VAT appears in VAT Summary with input tax.
- Second purchase draft: `PD00002`, no number reuse.
- Purchase draft -> paid rejected.
- Purchase purchase_order -> bill -> paid same-currency settlement remains balanced.
- Sales FX partial settlement with fee/WHT still posts correctly:
  - remains `invoice`;
  - remaining amount `60 USD`;
  - journal balanced;
  - LAK bank, bank fee, WHT receivable, and exchange gain directions preserved.

## Verification Log

Commands run by Builder:

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run test:lifecycle` | PASS after VAT Summary regression was added |
| `npm run test:api` | PASS |
| `npm run test:golden` | PASS |
| `npm run check:readiness` | PASS with intended local-dev auth warning |

Not run:

- `npm run test:ui`: no UI files or browser workflow were changed in Phase 16A.

Final health / cleanup:

| Check | Result |
| --- | --- |
| `/api/health` | PASS through readiness check, `authMode:"dev"` |
| app `http://127.0.0.1:5173/` | PASS through readiness check |
| `.dev-server.err.log` | PASS: 0 bytes |
| DB hash | PASS: current hash matches seed `B3AF110B2DD92E98D030576DDA5688E1CB75D1EAE96FDC2750D85FE8CC0F8C30` |
| reset diagnostics | PASS: no `api.ensure_data_file.read_failed` / `api.ensure_data_file.seed_created` events in readiness window |

Retest note: `test:lifecycle`, `test:api`, `test:golden`, and `check:readiness` were run sequentially because each script mutates/resets the same local demo state. Running them in parallel can create false failures from state races.

## Residual Risks / Backlog

1. Cancel/void/reversal is intentionally deferred. Reversing posted or settled documents should not be implemented until accounting policy defines reversal journals, settlement reversal, attachment/audit behavior, and legal numbering retention.
2. UI draft creation is deferred. The current UI still creates default `quotation` / `purchase_order` documents; API and tests cover draft for this phase.
3. Production numbering policy is not final. This phase only adds deterministic local counters and no current-state duplicate behavior.
4. Draft numbers are retired when promoted to posted numbers. Legal visibility/history for retired draft numbers should be considered in the future detail/audit phase.
5. Detail/voucher/ledger parity remains Phase 16B+.
6. VAT Summary non-posting policy is now conservative. If the product owner later decides quotation or purchase-order VAT should appear in a pro-forma/tax preview report, that should be a separate preview report, not the official VAT Summary.

## Module-only Tester Scope

Recommended Tester review:

1. Inspect the changed lifecycle/numbering code in `shared/accounting-engine.mjs` and `src/types.ts`.
2. Run:
   - `npm run test:lifecycle`
   - `npm run test:api`
   - `npm run test:golden`
   - `npm run check:readiness`
3. Verify:
   - draft create is non-posting;
   - draft/quotation/purchase-order taxable lines do not appear in VAT Summary rows/tax totals;
   - invoice/bill taxable lines still appear in VAT Summary;
   - default create remains `quotation` / `purchase_order`;
   - draft promotion issues `QT` / `PO` numbers;
   - direct draft settlement rejects;
   - same-currency and FX partial settlement regressions pass;
   - reset cleanup returns DB to seed and diagnostics stay clean.
4. Do not run full-system regression unless coordinator/user explicitly requests it.
