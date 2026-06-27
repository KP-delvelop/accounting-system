# Next Execution Plan

## Phase 1 Hardening

1. Keep `shared/accounting-engine.mjs` and `shared/report-models.mjs` as the source of truth for UI fallback, local API action behavior, and report read models.
2. Preserve the current regression gates: `npm run test:api` for action/report contracts and `npm run test:ui` for browser-level workflows.
3. Expand inline master-data creation with edit/update support and duplicate-resolution UX for contacts, categories, and products.
4. Expand reports beyond the current saved-filter UI with CSV/PDF exports and later direct Reports UI reads from backend report endpoints.
5. Add actual attachment upload/storage instead of reference-only attachment names.
6. Keep non-base cross-currency settlement out of scope until accounting policy is confirmed.

## Phase 2 Local Backend

1. Reduce direct whole-state `PUT /api/state` usage to fallback/admin-only paths.
2. Preserve the Phase 7B auth boundary: dev mode remains smoke-test compatible, while auth-required mode derives actors on the server and guards admin endpoints.
3. Expand local role/permission checks to cover all action keys and keep client-supplied actors out of production-like mode.
4. Add audit logs for before/after diffs and request IDs.
5. Add import/export fixtures for repeatable QA.

## Phase 3 Hostinger Preparation

1. Confirm Hostinger target: VPS/Node/Postgres is preferred for the current architecture.
2. Convert `scripts/local-api.mjs` into a hosted API service.
3. Apply `database/schema.postgres.sql` to the hosted database target.
4. Decide the production auth/session provider, then replace the local Phase 7B bearer-token stub with that provider.
5. Run security review before deployment.
