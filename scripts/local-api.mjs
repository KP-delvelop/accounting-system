import { createServer } from 'node:http';
import { appendFile, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isActionError } from '../shared/accounting-engine.mjs';
import { buildReportResponse } from '../shared/report-models.mjs';
import { actionCatalog, executeLocalAction } from './local-actions.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = resolve(projectRoot, 'data', 'local-db.json');
const seedPath = resolve(projectRoot, 'data', 'local-db.seed.json');
const attachmentStorageRoot = resolve(projectRoot, process.env.LOCAL_ATTACHMENT_STORAGE_DIR ?? 'data/attachments');
const resetDiagnosticsPath = resolve(projectRoot, '.reset-diagnostics.jsonl');
const port = Number(process.env.LOCAL_API_PORT ?? 8787);
const attachmentMaxBytes = Math.max(1, Number(process.env.LOCAL_ATTACHMENT_MAX_BYTES ?? 5_000_000) || 5_000_000);
const allowedAttachmentExtensions = new Set(
  String(process.env.LOCAL_ATTACHMENT_ALLOWED_EXTENSIONS ?? '.pdf,.png,.jpg,.jpeg,.txt,.csv,.xlsx,.docx')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
);
const allowedAttachmentContentTypes = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const authMode = process.env.LOCAL_API_AUTH_MODE === 'required' ? 'required' : 'dev';
const localApiAuthToken = process.env.LOCAL_API_AUTH_TOKEN ?? '';
const localApiAdminToken = process.env.LOCAL_API_ADMIN_TOKEN ?? localApiAuthToken;
const defaultServerActor = {
  actorType: 'user',
  actorId: process.env.LOCAL_API_ACTOR_ID ?? 'local-api-owner',
  roleKey: process.env.LOCAL_API_ROLE_KEY ?? 'owner',
  permissions: String(process.env.LOCAL_API_PERMISSIONS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
};
let dataFileQueue = Promise.resolve();

class ApiAuthError extends Error {
  constructor(message, status = 401, code = 'UNAUTHENTICATED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class ApiConflictError extends Error {
  constructor(message, currentRevision) {
    super(message);
    this.status = 409;
    this.code = 'STATE_REVISION_CONFLICT';
    this.currentRevision = currentRevision;
  }
}

class ApiValidationError extends Error {
  constructor(message, status = 400, code = 'VALIDATION_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function withDataFileLock(task) {
  const next = dataFileQueue.then(task, task);
  dataFileQueue = next.catch(() => {});
  return next;
}

function stateCounts(state) {
  if (!state || typeof state !== 'object') return null;
  return {
    contacts: Array.isArray(state.contacts) ? state.contacts.length : null,
    products: Array.isArray(state.products) ? state.products.length : null,
    cashTransactions: Array.isArray(state.cashTransactions) ? state.cashTransactions.length : null,
    documents: Array.isArray(state.documents) ? state.documents.length : null,
    journalEntries: Array.isArray(state.journalEntries) ? state.journalEntries.length : null,
    savedReportFilters: Array.isArray(state.savedReportFilters) ? state.savedReportFilters.length : null,
    auditLogs: Array.isArray(state.auditLogs) ? state.auditLogs.length : null,
  };
}

function compactText(value, fallback = 'unknown') {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, 160) : fallback;
}

function callerDetails(request, url) {
  return {
    source: compactText(request.headers['x-codex-state-write-source'] ?? request.headers['x-codex-reset-source'] ?? url.searchParams.get('source')),
    runId: compactText(request.headers['x-codex-run-id'] ?? url.searchParams.get('runId')),
    sessionId: compactText(request.headers['x-codex-session-id'] ?? url.searchParams.get('sessionId')),
    reason: compactText(request.headers['x-codex-reset-reason'] ?? request.headers['x-codex-state-write-reason'] ?? url.searchParams.get('reason')),
    userAgent: compactText(request.headers['user-agent']),
    origin: compactText(request.headers.origin, ''),
    referer: compactText(request.headers.referer, ''),
    remoteAddress: compactText(request.socket.remoteAddress),
  };
}

function bearerToken(request) {
  const authorization = String(request.headers.authorization ?? '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function requireValidToken(request) {
  if (authMode !== 'required') return;
  if (!localApiAuthToken) {
    throw new ApiAuthError('Local API auth token is not configured.', 500, 'AUTH_NOT_CONFIGURED');
  }
  if (bearerToken(request) !== localApiAuthToken) {
    throw new ApiAuthError('Authentication is required.', 401, 'UNAUTHENTICATED');
  }
}

function requireAdminToken(request) {
  if (authMode !== 'required') return;
  if (!localApiAdminToken) {
    throw new ApiAuthError('Local API admin token is not configured.', 500, 'AUTH_NOT_CONFIGURED');
  }
  if (bearerToken(request) !== localApiAdminToken) {
    throw new ApiAuthError('Admin access is required.', 403, 'ADMIN_REQUIRED');
  }
}

function actorFromRequest(request, fallbackActor) {
  if (authMode === 'required') {
    requireValidToken(request);
    return { ...defaultServerActor };
  }
  return fallbackActor ?? { actorType: 'user', roleKey: 'owner' };
}

function requireActorPermission(permission, actor = {}) {
  if (actor.roleKey === 'owner') return;
  if (actor.permissions?.includes(permission)) return;
  throw new ApiAuthError(`Permission denied: ${permission}`, 403, 'PERMISSION_DENIED');
}

function stateRevision(state) {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

function expectedRevision(request) {
  return String(request.headers['x-codex-expected-state-revision'] ?? '').trim();
}

function assertExpectedRevision(request, state) {
  const expected = expectedRevision(request);
  if (!expected) return stateRevision(state);
  const current = stateRevision(state);
  if (expected !== current) {
    throw new ApiConflictError('State revision conflict. Refresh the local state and retry the write.', current);
  }
  return current;
}

async function appendStateDiagnostic(entry) {
  try {
    await appendFile(resetDiagnosticsPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.warn(`State diagnostics write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readResetDiagnostics(limit = 50) {
  try {
    const raw = await readFile(resetDiagnosticsPath, 'utf8');
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { parseError: true, raw: line };
      }
    });
  } catch {
    return [];
  }
}

async function ensureDataFileUnlocked() {
  try {
    return await readJson(dataPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      const timestamp = new Date();
      await appendStateDiagnostic({
        id: `state-read-failed-${timestamp.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        event: 'api.ensure_data_file.read_failed',
        startedAt: timestamp.toISOString(),
        completedAt: timestamp.toISOString(),
        durationMs: 0,
        pid: process.pid,
        path: dataPath,
        caller: {
          source: 'local-api',
          runId: process.env.CODEX_TEST_RUN_ID ?? 'unknown',
          sessionId: process.env.CODEX_TEST_SESSION_ID ?? 'unknown',
          reason: 'data-file-read-failed',
        },
        beforeCounts: null,
        beforeStateError: error instanceof Error ? error.message : String(error),
        afterCounts: null,
      });
      throw error;
    }

    const startedAt = new Date();
    const seed = await readJson(seedPath);
    await writeJson(dataPath, seed);
    const completedAt = new Date();
    await appendStateDiagnostic({
      id: `state-ensure-${startedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      event: 'api.ensure_data_file.seed_created',
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      pid: process.pid,
      path: dataPath,
      caller: {
        source: 'local-api',
        runId: process.env.CODEX_TEST_RUN_ID ?? 'unknown',
        sessionId: process.env.CODEX_TEST_SESSION_ID ?? 'unknown',
        reason: 'data-file-missing',
      },
      beforeCounts: null,
      beforeStateError: error instanceof Error ? error.message : String(error),
      afterCounts: stateCounts(seed),
    });
    return seed;
  }
}

async function ensureDataFile() {
  return withDataFileLock(() => ensureDataFileUnlocked());
}

async function readBody(request, maxBytes = 2_000_000) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new ApiValidationError('Request body is too large.', 413, 'REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

function send(response, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Access-Control-Allow-Origin': 'http://127.0.0.1:5173',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type,Accept,Authorization,X-Codex-Expected-State-Revision,X-Codex-Reset-Source,X-Codex-State-Write-Source,X-Codex-Run-Id,X-Codex-Session-Id,X-Codex-Reset-Reason,X-Codex-State-Write-Reason',
    'Access-Control-Expose-Headers': 'X-Codex-State-Revision',
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  response.end(payload);
}

function sendBuffer(response, status, buffer, headers = {}) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': 'http://127.0.0.1:5173',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type,Accept,Authorization,X-Codex-Expected-State-Revision,X-Codex-Reset-Source,X-Codex-State-Write-Source,X-Codex-Run-Id,X-Codex-Session-Id,X-Codex-Reset-Reason,X-Codex-State-Write-Reason',
    ...headers,
  });
  response.end(buffer);
}

function errorResponse(error) {
  if (error instanceof ApiConflictError) {
    return {
      status: error.status,
      body: { ok: false, code: error.code, error: error.message, currentRevision: error.currentRevision },
      headers: { 'X-Codex-State-Revision': error.currentRevision },
    };
  }

  if (error instanceof ApiAuthError) {
    return {
      status: error.status,
      body: { ok: false, code: error.code, error: error.message },
    };
  }

  if (error instanceof ApiValidationError) {
    return {
      status: error.status,
      body: { ok: false, code: error.code, error: error.message },
    };
  }

  if (isActionError(error)) {
    return {
      status: error.status,
      body: { ok: false, code: error.code, error: error.message },
    };
  }

  if (error instanceof SyntaxError) {
    return {
      status: 400,
      body: { ok: false, code: 'INVALID_JSON', error: 'Invalid JSON request body.' },
    };
  }

  return {
    status: 500,
    body: { ok: false, code: 'INTERNAL_ERROR', error: error instanceof Error ? error.message : 'Unknown error.' },
  };
}

function isAppState(value) {
  return (
    value &&
    typeof value === 'object' &&
    value.organization &&
    Array.isArray(value.accounts) &&
    Array.isArray(value.categories) &&
    Array.isArray(value.taxes) &&
    Array.isArray(value.products) &&
    Array.isArray(value.tags) &&
    Array.isArray(value.attachments) &&
    Array.isArray(value.contacts) &&
    Array.isArray(value.cashTransactions) &&
    Array.isArray(value.documents) &&
    Array.isArray(value.journalEntries) &&
    Array.isArray(value.savedReportFilters) &&
    Array.isArray(value.auditLogs)
  );
}

function reportKeyFromPath(pathname) {
  const match = pathname.match(/^\/api\/reports\/([^/]+)(?:\/query)?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function actorFromQuery(url) {
  const permissions = String(url.searchParams.get('permissions') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return {
    actorType: url.searchParams.get('actorType') ?? 'user',
    actorId: url.searchParams.get('actorId') ?? undefined,
    roleKey: url.searchParams.get('roleKey') ?? 'owner',
    ...(permissions.length ? { permissions } : {}),
  };
}

function reportFiltersFromQuery(url) {
  return {
    ...(url.searchParams.has('accountId') ? { accountId: url.searchParams.get('accountId') } : {}),
    ...(url.searchParams.has('dateFrom') ? { dateFrom: url.searchParams.get('dateFrom') } : {}),
    ...(url.searchParams.has('dateTo') ? { dateTo: url.searchParams.get('dateTo') } : {}),
    ...(url.searchParams.has('status') ? { status: url.searchParams.get('status') } : {}),
  };
}

async function readReportRequest(request, url, reportKey) {
  if (request.method === 'GET') {
    return {
      actor: actorFromRequest(request, actorFromQuery(url)),
      filters: reportFiltersFromQuery(url),
    };
  }

  const body = JSON.parse(await readBody(request));
  return {
    actor: actorFromRequest(request, body.actor),
    filters: {
      ...(body.filters && typeof body.filters === 'object' ? body.filters : {}),
      ...(body.payload && typeof body.payload === 'object' ? body.payload : {}),
      reportKey,
    },
  };
}

function attachmentIdFromPath(pathname, suffix = '') {
  const escapedSuffix = suffix ? suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
  const match = pathname.match(new RegExp(`^/api/attachments/([^/]+)${escapedSuffix}$`));
  return match ? decodeURIComponent(match[1]) : null;
}

function sanitizeFileName(fileName) {
  const original = String(fileName ?? '').trim();
  if (!original) throw new ApiValidationError('Attachment fileName is required.');
  if (original.includes('/') || original.includes('\\') || original.includes('..')) {
    throw new ApiValidationError('Attachment filename cannot contain path segments.', 400, 'INVALID_ATTACHMENT_NAME');
  }
  const base = basename(original).replace(/[^\w .()_-]/g, '_').replace(/\s+/g, ' ').trim();
  if (!base || base === '.' || base === '..') throw new ApiValidationError('Attachment filename is invalid.', 400, 'INVALID_ATTACHMENT_NAME');
  const extension = extname(base).toLowerCase();
  if (!extension || !allowedAttachmentExtensions.has(extension)) {
    throw new ApiValidationError(`Attachment file extension is not allowed: ${extension || '(none)'}`, 400, 'INVALID_ATTACHMENT_TYPE');
  }
  return base.slice(0, 160);
}

function validateContentType(contentType) {
  const normalized = String(contentType ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (!allowedAttachmentContentTypes.has(normalized)) {
    throw new ApiValidationError(`Attachment content type is not allowed: ${normalized}`, 400, 'INVALID_ATTACHMENT_TYPE');
  }
  return normalized;
}

function decodeAttachmentContent(contentBase64) {
  const text = String(contentBase64 ?? '');
  if (!text) throw new ApiValidationError('Attachment contentBase64 is required.');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(text)) throw new ApiValidationError('Attachment content must be base64.', 400, 'INVALID_ATTACHMENT_CONTENT');
  const buffer = Buffer.from(text.replace(/\s+/g, ''), 'base64');
  if (!buffer.length) throw new ApiValidationError('Attachment content is empty.', 400, 'INVALID_ATTACHMENT_CONTENT');
  if (buffer.length > attachmentMaxBytes) {
    throw new ApiValidationError(`Attachment exceeds max size of ${attachmentMaxBytes} bytes.`, 413, 'ATTACHMENT_TOO_LARGE');
  }
  return buffer;
}

function findAttachmentOwner(state, ownerType, ownerId) {
  if (ownerType === 'document') return (state.documents ?? []).find((entry) => entry.id === ownerId);
  if (ownerType === 'cash_transaction') return (state.cashTransactions ?? []).find((entry) => entry.id === ownerId);
  throw new ApiValidationError('Attachment ownerType must be document or cash_transaction.');
}

function ensureStoragePath(storageKey) {
  const key = basename(String(storageKey ?? '').trim());
  if (!key || key !== String(storageKey ?? '').trim() || key.includes('..') || key.includes('/') || key.includes('\\')) {
    throw new ApiValidationError('Attachment storage key is invalid.', 400, 'INVALID_ATTACHMENT_PATH');
  }
  const absolute = resolve(attachmentStorageRoot, key);
  const rootWithSeparator = `${attachmentStorageRoot}${attachmentStorageRoot.endsWith('\\') ? '' : '\\'}`;
  if (absolute !== attachmentStorageRoot && !absolute.startsWith(rootWithSeparator)) {
    throw new ApiValidationError('Attachment storage path is invalid.', 400, 'INVALID_ATTACHMENT_PATH');
  }
  return absolute;
}

function attachmentStorageKey(attachment) {
  if (attachment.storageKey) return attachment.storageKey;
  if (attachment.storagePath) return basename(attachment.storagePath);
  return '';
}

async function clearAttachmentStorageRoot() {
  await mkdir(attachmentStorageRoot, { recursive: true });
  const entries = await readdir(attachmentStorageRoot, { withFileTypes: true });
  let removedCount = 0;

  for (const entry of entries) {
    const absolutePath = resolve(attachmentStorageRoot, entry.name);
    const rootWithSeparator = `${attachmentStorageRoot}${attachmentStorageRoot.endsWith('\\') ? '' : '\\'}`;
    if (absolutePath !== attachmentStorageRoot && !absolutePath.startsWith(rootWithSeparator)) {
      throw new ApiValidationError('Attachment storage cleanup path is invalid.', 500, 'INVALID_ATTACHMENT_PATH');
    }

    await rm(absolutePath, { recursive: true, force: true });
    removedCount += 1;
  }

  return removedCount;
}

function publicAttachmentMeta(attachment) {
  const { storagePath, ...safeAttachment } = attachment;
  return {
    ...safeAttachment,
    storageKey: attachmentStorageKey(attachment) || undefined,
  };
}

function nextAttachmentState(state, ownerType, ownerId, attachment) {
  const attachments = [attachment, ...(state.attachments ?? [])];
  if (ownerType === 'document') {
    return {
      ...state,
      attachments,
      documents: state.documents.map((document) =>
        document.id === ownerId
          ? { ...document, attachmentIds: [...new Set([...(document.attachmentIds ?? []), attachment.id])], updatedAt: attachment.createdAt }
          : document,
      ),
    };
  }
  return {
    ...state,
    attachments,
    cashTransactions: state.cashTransactions.map((transaction) =>
      transaction.id === ownerId
        ? { ...transaction, attachmentIds: [...new Set([...(transaction.attachmentIds ?? []), attachment.id])], updatedAt: attachment.createdAt }
        : transaction,
    ),
  };
}

function deleteAttachmentState(state, attachment) {
  const attachmentId = attachment.id;
  return {
    ...state,
    attachments: (state.attachments ?? []).filter((entry) => entry.id !== attachmentId),
    documents: (state.documents ?? []).map((document) => ({
      ...document,
      attachmentIds: (document.attachmentIds ?? []).filter((entry) => entry !== attachmentId),
    })),
    cashTransactions: (state.cashTransactions ?? []).map((transaction) => ({
      ...transaction,
      attachmentIds: (transaction.attachmentIds ?? []).filter((entry) => entry !== attachmentId),
    })),
  };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

    if (request.method === 'OPTIONS') {
      send(response, 204, {});
      return;
    }

    if (url.pathname === '/api/health' && request.method === 'GET') {
      send(response, 200, { ok: true, mode: 'localhost-api', authMode, dataPath, resetDiagnosticsPath });
      return;
    }

    if (url.pathname === '/api/reset-diagnostics' && request.method === 'GET') {
      requireAdminToken(request);
      const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 200));
      send(response, 200, { ok: true, diagnostics: await readResetDiagnostics(limit), resetDiagnosticsPath });
      return;
    }

    if (url.pathname === '/api/state' && request.method === 'GET') {
      requireValidToken(request);
      const state = await ensureDataFile();
      send(response, 200, state, { 'X-Codex-State-Revision': stateRevision(state) });
      return;
    }

    if (url.pathname === '/api/actions' && request.method === 'GET') {
      requireValidToken(request);
      send(response, 200, { ok: true, actions: actionCatalog });
      return;
    }

    if (url.pathname === '/api/attachments' && request.method === 'GET') {
      const actor = actorFromRequest(request, actorFromQuery(url));
      requireActorPermission('attachment:read', actor);
      const ownerType = url.searchParams.get('ownerType');
      const ownerId = url.searchParams.get('ownerId');
      const state = await ensureDataFile();
      const attachments = (state.attachments ?? [])
        .filter((attachment) => (!ownerType || attachment.ownerType === ownerType) && (!ownerId || attachment.ownerId === ownerId))
        .map(publicAttachmentMeta);
      send(response, 200, { ok: true, attachments });
      return;
    }

    if (url.pathname === '/api/attachments' && request.method === 'POST') {
      const startedAt = new Date();
      const maxRequestBytes = Math.ceil(attachmentMaxBytes * 1.4) + 10_000;
      const body = JSON.parse(await readBody(request, maxRequestBytes));
      const actor = actorFromRequest(request, body.actor);
      requireActorPermission('attachment:upload', actor);
      const ownerType = body.ownerType;
      const ownerId = String(body.ownerId ?? '').trim();
      if (!ownerId) throw new ApiValidationError('Attachment ownerId is required.');
      const safeName = sanitizeFileName(body.fileName);
      const mimeType = validateContentType(body.contentType);
      const content = decodeAttachmentContent(body.contentBase64);
      const timestamp = new Date().toISOString();
      const attachmentId = `attachment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const storageFileName = `${attachmentId}-${safeName}`;
      const absoluteStoragePath = ensureStoragePath(storageFileName);

      const { state, nextState, attachment } = await withDataFileLock(async () => {
        const currentState = await ensureDataFileUnlocked();
        assertExpectedRevision(request, currentState);
        if (!findAttachmentOwner(currentState, ownerType, ownerId)) {
          throw new ApiValidationError('Attachment owner record was not found.', 404, 'ATTACHMENT_OWNER_NOT_FOUND');
        }
        const nextAttachment = {
          id: attachmentId,
          organizationId: currentState.organization.id,
          ownerType,
          ownerId,
          name: safeName,
          mimeType,
          sizeBytes: content.length,
          storageKey: storageFileName,
          contentHash: createHash('sha256').update(content).digest('hex'),
          createdAt: timestamp,
        };
        const updatedState = nextAttachmentState(currentState, ownerType, ownerId, nextAttachment);
        await mkdir(dirname(absoluteStoragePath), { recursive: true });
        await writeFile(absoluteStoragePath, content, { flag: 'wx' });
        await writeJson(dataPath, updatedState);
        return { state: currentState, nextState: updatedState, attachment: nextAttachment };
      });

      const completedAt = new Date();
      await appendStateDiagnostic({
        id: `attachment-upload-${startedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        event: 'api.attachment.upload',
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        pid: process.pid,
        method: request.method,
        path: url.pathname,
        caller: callerDetails(request, url),
        actor: {
          actorType: actor.actorType,
          actorId: actor.actorId,
          roleKey: actor.roleKey,
        },
        attachmentId: attachment.id,
        beforeCounts: stateCounts(state),
        afterCounts: stateCounts(nextState),
      });
      send(
        response,
        201,
        { ok: true, attachment: publicAttachmentMeta(attachment), state: nextState },
        { 'X-Codex-State-Revision': stateRevision(nextState) },
      );
      return;
    }

    const downloadAttachmentId = attachmentIdFromPath(url.pathname, '/download');
    if (downloadAttachmentId && request.method === 'GET') {
      const actor = actorFromRequest(request, actorFromQuery(url));
      requireActorPermission('attachment:read', actor);
      const state = await ensureDataFile();
      const attachment = (state.attachments ?? []).find((entry) => entry.id === downloadAttachmentId);
      if (!attachment) throw new ApiValidationError('Attachment was not found.', 404, 'ATTACHMENT_NOT_FOUND');
      const storageKey = attachmentStorageKey(attachment);
      if (!storageKey) throw new ApiValidationError('Attachment has no stored file.', 404, 'ATTACHMENT_FILE_NOT_FOUND');
      const absoluteStoragePath = ensureStoragePath(storageKey);
      const content = await readFile(absoluteStoragePath).catch(() => {
        throw new ApiValidationError('Attachment file was not found.', 404, 'ATTACHMENT_FILE_NOT_FOUND');
      });
      sendBuffer(response, 200, content, {
        'Content-Type': attachment.mimeType ?? 'application/octet-stream',
        'Content-Length': String(content.length),
        'Content-Disposition': `attachment; filename="${String(attachment.name).replace(/"/g, '')}"`,
      });
      return;
    }

    const deleteAttachmentId = attachmentIdFromPath(url.pathname);
    if (deleteAttachmentId && request.method === 'DELETE') {
      const startedAt = new Date();
      const bodyText = await readBody(request).catch(() => '{}');
      const body = bodyText.trim() ? JSON.parse(bodyText) : {};
      const actor = actorFromRequest(request, body.actor);
      requireActorPermission('attachment:delete', actor);
      const { state, nextState, attachment } = await withDataFileLock(async () => {
        const currentState = await ensureDataFileUnlocked();
        assertExpectedRevision(request, currentState);
        const currentAttachment = (currentState.attachments ?? []).find((entry) => entry.id === deleteAttachmentId);
        if (!currentAttachment) throw new ApiValidationError('Attachment was not found.', 404, 'ATTACHMENT_NOT_FOUND');
        const updatedState = deleteAttachmentState(currentState, currentAttachment);
        await writeJson(dataPath, updatedState);
        return { state: currentState, nextState: updatedState, attachment: currentAttachment };
      });
      const storageKey = attachmentStorageKey(attachment);
      if (storageKey) {
        await unlink(ensureStoragePath(storageKey)).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        });
      }
      const completedAt = new Date();
      await appendStateDiagnostic({
        id: `attachment-delete-${startedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        event: 'api.attachment.delete',
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        pid: process.pid,
        method: request.method,
        path: url.pathname,
        caller: callerDetails(request, url),
        actor: {
          actorType: actor.actorType,
          actorId: actor.actorId,
          roleKey: actor.roleKey,
        },
        attachmentId: attachment.id,
        beforeCounts: stateCounts(state),
        afterCounts: stateCounts(nextState),
      });
      send(response, 200, { ok: true, attachment: publicAttachmentMeta(attachment), state: nextState }, { 'X-Codex-State-Revision': stateRevision(nextState) });
      return;
    }

    const reportKey = reportKeyFromPath(url.pathname);
    if (reportKey && (request.method === 'GET' || request.method === 'POST')) {
      const reportRequest = await readReportRequest(request, url, reportKey);
      const state = await ensureDataFile();
      executeLocalAction(state, {
        key: 'report.view',
        actor: reportRequest.actor,
        payload: { reportKey },
      });
      send(response, 200, buildReportResponse(state, reportKey, reportRequest.filters));
      return;
    }

    if (url.pathname.startsWith('/api/actions/') && request.method === 'POST') {
      const startedAt = new Date();
      const key = decodeURIComponent(url.pathname.replace('/api/actions/', ''));
      const body = JSON.parse(await readBody(request));
      const actor = actorFromRequest(request, body.actor);
      const { state, nextState } = await withDataFileLock(async () => {
        const currentState = await ensureDataFileUnlocked();
        assertExpectedRevision(request, currentState);
        const updatedState = executeLocalAction(currentState, {
          key,
          actor,
          payload: body.payload,
        });
        await writeJson(dataPath, updatedState);
        return { state: currentState, nextState: updatedState };
      });
      const completedAt = new Date();
      await appendStateDiagnostic({
        id: `state-action-${startedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        event: 'api.action.write',
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        pid: process.pid,
        method: request.method,
        path: url.pathname,
        actionKey: key,
        caller: callerDetails(request, url),
        actor: {
          actorType: actor.actorType,
          actorId: actor.actorId,
          roleKey: actor.roleKey,
        },
        beforeCounts: stateCounts(state),
        afterCounts: stateCounts(nextState),
      });
      send(response, 200, { ok: true, state: nextState }, { 'X-Codex-State-Revision': stateRevision(nextState) });
      return;
    }

    if (url.pathname === '/api/state' && request.method === 'PUT') {
      requireAdminToken(request);
      const startedAt = new Date();
      const nextState = JSON.parse(await readBody(request));
      if (!isAppState(nextState)) {
        send(response, 400, { ok: false, code: 'INVALID_STATE_SHAPE', error: 'Invalid accounting state shape.' });
        return;
      }

      const beforeState = await withDataFileLock(async () => {
        const currentState = await readJson(dataPath).catch((error) => ({ stateReadError: error instanceof Error ? error.message : String(error) }));
        if (!currentState.stateReadError) assertExpectedRevision(request, currentState);
        await writeJson(dataPath, nextState);
        return currentState;
      });
      const completedAt = new Date();
      await appendStateDiagnostic({
        id: `state-put-${startedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        event: 'api.state.put',
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        pid: process.pid,
        method: request.method,
        path: url.pathname,
        caller: callerDetails(request, url),
        beforeCounts: stateCounts(beforeState),
        beforeStateError: beforeState.stateReadError,
        afterCounts: stateCounts(nextState),
      });
      send(response, 200, { ok: true }, { 'X-Codex-State-Revision': stateRevision(nextState) });
      return;
    }

    if (url.pathname === '/api/reset' && request.method === 'POST') {
      requireAdminToken(request);
      const startedAt = new Date();
      const seed = await readJson(seedPath);
      const { beforeState, attachmentFilesRemoved } = await withDataFileLock(async () => {
        const currentState = await readJson(dataPath).catch((error) => ({ stateReadError: error instanceof Error ? error.message : String(error) }));
        await writeJson(dataPath, seed);
        const removedCount = await clearAttachmentStorageRoot();
        return { beforeState: currentState, attachmentFilesRemoved: removedCount };
      });
      const completedAt = new Date();
      await appendStateDiagnostic({
        id: `reset-${startedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        event: 'api.reset',
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        pid: process.pid,
        method: request.method,
        path: url.pathname,
        caller: callerDetails(request, url),
        beforeCounts: stateCounts(beforeState),
        beforeStateError: beforeState.stateReadError,
        afterCounts: stateCounts(seed),
        attachmentFilesRemoved,
      });
      send(response, 200, { ok: true, state: seed }, { 'X-Codex-State-Revision': stateRevision(seed) });
      return;
    }

    send(response, 404, { ok: false, error: 'Not found.' });
  } catch (error) {
    const mapped = errorResponse(error);
    send(response, mapped.status, mapped.body, mapped.headers);
  }
});

async function appendStartupDiagnostic() {
  const startedAt = new Date();
  const currentState = await withDataFileLock(() =>
    readJson(dataPath).catch((error) => ({ stateReadError: error instanceof Error ? error.message : String(error) })),
  );
  const completedAt = new Date();
  await appendStateDiagnostic({
    id: `api-startup-${startedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    event: 'api.startup',
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    pid: process.pid,
    port,
    path: dataPath,
    caller: {
      source: 'local-api',
      runId: process.env.CODEX_TEST_RUN_ID ?? 'unknown',
      sessionId: process.env.CODEX_TEST_SESSION_ID ?? 'unknown',
      reason: 'startup',
    },
    beforeCounts: stateCounts(currentState),
    beforeStateError: currentState.stateReadError,
    afterCounts: stateCounts(currentState),
  });
}

server.listen(port, '127.0.0.1', () => {
  console.log(`Local accounting API listening on http://127.0.0.1:${port}`);
  void appendStartupDiagnostic();
});
