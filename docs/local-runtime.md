# Local Runtime

## Recommended Commands

Use npm for this repo. On this Windows machine, the reliable command path is:

```powershell
$env:Path='C:\Program Files\nodejs;C:\Users\Rabbi\AppData\Roaming\npm;' + $env:Path
& 'C:\Program Files\nodejs\npm.cmd' install
& 'C:\Program Files\nodejs\npm.cmd' run dev
& 'C:\Program Files\nodejs\npm.cmd' run test:api
& 'C:\Program Files\nodejs\npm.cmd' run build
& 'C:\Program Files\nodejs\npm.cmd' run check:readiness
```

## Local Services

- Frontend: `http://127.0.0.1:5173`
- Local API: `http://127.0.0.1:8787`
- Action contracts: `GET /api/actions`
- Execute action: `POST /api/actions/:key`
- State-write diagnostics: `GET /api/reset-diagnostics?limit=50` or `.reset-diagnostics.jsonl`
- API smoke test: `npm run test:api` after the local API is running.
- Readiness check: `npm run check:readiness` after `npm run build` and with the local API/frontend running.

## Production-Like Local Readiness

This project is not deployed by this runbook. Use it only to check whether a local instance is shaped safely enough for a later hosted deployment review.

1. Build the frontend artifact:

   ```powershell
   & 'C:\Program Files\nodejs\npm.cmd' run build
   ```

2. Start the local API/frontend. Development mode remains:

   ```powershell
   & 'C:\Program Files\nodejs\npm.cmd' run dev
   ```

3. For production-like auth boundary checks, start the API with required auth mode and non-empty local-only tokens before running the frontend:

   ```powershell
   $env:LOCAL_API_AUTH_MODE='required'
   $env:LOCAL_API_AUTH_TOKEN='<local-test-owner-token>'
   $env:LOCAL_API_ADMIN_TOKEN='<local-test-admin-token>'
   $env:READINESS_EXPECT_AUTH_MODE='required'
   $env:READINESS_ADMIN_TOKEN=$env:LOCAL_API_ADMIN_TOKEN
   & 'C:\Program Files\nodejs\npm.cmd' run local-api
   ```

4. Run readiness checks:

   ```powershell
   & 'C:\Program Files\nodejs\npm.cmd' run check:readiness
   ```

The readiness check verifies the build artifact exists, `/api/health` responds, auth mode matches `READINESS_EXPECT_AUTH_MODE` when set, the app responds, `.dev-server.err.log` is empty, `data/local-db.json` matches the seed hash, and recent diagnostics have no data-file read failure or unexpected seed creation events.

## Guardrails

- `LOCAL_API_AUTH_MODE=dev` is for local development and smoke tests only. Do not treat it as a production boundary.
- `PUT /api/state`, `POST /api/reset`, and `GET /api/reset-diagnostics` are admin/dev surfaces. In `required` mode they must be protected by the admin token.
- Runtime state is file-backed at `data/local-db.json`; it is suitable for the local prototype, not a durable multi-user production database.
- Browser-local fallback exists for local-first resilience. A hosted deployment should keep API-backed state as the source of truth and make fallback behavior explicit.
- Reset diagnostics may include caller metadata such as source/run/session IDs. Keep them local or apply production log retention/privacy policy before hosting.

## Package Manager Hygiene

- Do not use `pnpm` or `yarn` in this repo unless the team intentionally migrates package managers.
- Runtime state lives in `data/local-db.json` and is intentionally ignored.
- Runtime attachment files live in `data/attachments` by default and are intentionally local prototype storage.
- `data/local-db.seed.json` and `data/action-contracts.json` are source files and should remain tracked when the team commits.

## Attachment Storage

Phase 10A backend/API attachment uploads use local project-controlled storage only.

- `LOCAL_ATTACHMENT_STORAGE_DIR`: defaults to `data/attachments`.
- `LOCAL_ATTACHMENT_MAX_BYTES`: defaults to `5000000`.
- `LOCAL_ATTACHMENT_ALLOWED_EXTENSIONS`: defaults to `.pdf,.png,.jpg,.jpeg,.txt,.csv,.xlsx,.docx`.
- Upload API shape: `POST /api/attachments` with JSON `{ actor, ownerType, ownerId, fileName, contentType, contentBase64 }`.
- Metadata is stored in `state.attachments`; the API response does not expose the internal `storagePath`.
- Stored metadata uses a `storageKey` resolved inside `LOCAL_ATTACHMENT_STORAGE_DIR`; custom storage directories must not change the public API shape.
- UI upload/preview/management remains deferred to Phase 10B.
