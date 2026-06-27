import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { executeAccountingAction } from './actions';
import { initialState } from './seed';
import { useHostedAuth } from './hostedAuth';
import { getSupabaseClient, isSupabaseMode } from './supabaseClient';
import type { AccountingActionRequest, AccountingActionResult } from './actions';
import type { AppState, AttachmentOwnerType, AttachmentReference } from './types';

const storageKey = 'accounting-system-phase-1-state';
const diagnosticsSourceKey = 'accounting-system-diagnostics-source';
const diagnosticsRunIdKey = 'accounting-system-diagnostics-run-id';
const diagnosticsSessionIdKey = 'accounting-system-diagnostics-session-id';
const authTokenKey = 'accounting-system-local-api-token';
type StorageMode = 'localhost-api' | 'browser-local';
type AuthMode = 'dev' | 'required';

class ApiRequestError extends Error {
  status: number;
  code?: string;
  currentRevision?: string;

  constructor(message: string, status: number, code?: string, currentRevision?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.currentRevision = currentRevision;
  }
}

function storedDiagnosticValue(key: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  window.sessionStorage.setItem(key, fallback);
  return fallback;
}

function diagnosticHeaders(reason: string) {
  const source = storedDiagnosticValue(diagnosticsSourceKey, 'browser-app');
  const runId = storedDiagnosticValue(diagnosticsRunIdKey, `browser-run-${Date.now().toString(36)}`);
  const sessionId = storedDiagnosticValue(diagnosticsSessionIdKey, `browser-session-${Math.random().toString(36).slice(2, 10)}`);

  return {
    'X-Codex-State-Write-Source': source,
    'X-Codex-Run-Id': runId,
    'X-Codex-Session-Id': sessionId,
    'X-Codex-State-Write-Reason': reason,
  };
}

function storedAuthToken() {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem(authTokenKey) ?? '';
}

function authHeaders(token = storedAuthToken()): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function authMessage(status: number, code?: string, fallback?: string) {
  if (status === 401 || code === 'UNAUTHENTICATED') return 'Authentication is required for the local API session.';
  if (status === 403 || code === 'ADMIN_REQUIRED' || code === 'PERMISSION_DENIED') return 'Permission denied for this local API session.';
  if (status === 409 || code === 'STATE_REVISION_CONFLICT') {
    return 'Local data changed in another session. Refresh the latest state before trying again.';
  }
  return fallback ?? `Local API returned ${status}`;
}

async function parseApiError(response: Response, fallback: string) {
  let body: { code?: string; error?: string; currentRevision?: string } | null = null;
  try {
    body = (await response.json()) as { code?: string; error?: string; currentRevision?: string };
  } catch {
    body = null;
  }
  throw new ApiRequestError(
    authMessage(response.status, body?.code, body?.error ?? fallback),
    response.status,
    body?.code,
    body?.currentRevision ?? response.headers.get('X-Codex-State-Revision') ?? undefined,
  );
}

function stateRevisionHeader(response: Response) {
  return response.headers.get('X-Codex-State-Revision') ?? undefined;
}

function expectedRevisionHeaders(revision?: string | null): Record<string, string> {
  return revision ? { 'X-Codex-Expected-State-Revision': revision } : {};
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function stateForHostedOrganization(state: AppState, organizationId: string, organizationName?: string, baseCurrency?: string): AppState {
  return {
    ...state,
    organization: {
      ...state.organization,
      id: organizationId,
      name: organizationName || state.organization.name,
      baseCurrency: (baseCurrency as AppState['organization']['baseCurrency']) || state.organization.baseCurrency,
    },
  };
}

async function loadSupabaseState(organizationId: string) {
  const client = getSupabaseClient();
  if (!client) throw new ApiRequestError('Supabase is not configured.', 500, 'SUPABASE_NOT_CONFIGURED');
  const { data, error } = await client
    .from('app_states')
    .select('state, revision')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new ApiRequestError(error.message, 500, 'SUPABASE_STATE_READ_FAILED');
  if (!data?.state) return { state: null, revision: undefined };
  return { state: data.state as AppState, revision: data.revision as string | undefined };
}

async function persistSupabaseState(state: AppState, organizationId: string, userId?: string | null) {
  const client = getSupabaseClient();
  if (!client) throw new ApiRequestError('Supabase is not configured.', 500, 'SUPABASE_NOT_CONFIGURED');
  const revision = await sha256Hex(JSON.stringify(state));
  const { error } = await client
    .from('app_states')
    .upsert({
      organization_id: organizationId,
      state,
      revision,
      updated_by: userId ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' });
  if (error) {
    const status = error.code === '42501' ? 403 : 500;
    throw new ApiRequestError(authMessage(status, status === 403 ? 'PERMISSION_DENIED' : 'SUPABASE_STATE_WRITE_FAILED', error.message), status, error.code);
  }
  return { ok: true, revision };
}

function hostedStoragePath(organizationId: string, ownerType: AttachmentOwnerType, ownerId: string, attachmentId: string, fileName: string) {
  const safeName = fileName.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'attachment';
  return `${organizationId}/${ownerType}/${ownerId}/${attachmentId}-${safeName}`;
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function loadState(): AppState {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return initialState;

  try {
    return JSON.parse(raw) as AppState;
  } catch {
    return initialState;
  }
}

function persistBrowserState(state: AppState) {
  window.localStorage.setItem(storageKey, JSON.stringify(state));
}

async function loadApiState() {
  const response = await fetch('/api/state', { headers: { Accept: 'application/json', ...authHeaders() } });
  if (!response.ok) await parseApiError(response, `Local API returned ${response.status}`);
  return { state: (await response.json()) as AppState, revision: stateRevisionHeader(response) };
}

async function persistApiState(state: AppState, expectedRevision?: string | null) {
  const response = await fetch('/api/state', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...expectedRevisionHeaders(expectedRevision),
      ...diagnosticHeaders('browser-put-state'),
    },
    body: JSON.stringify(state),
  });

  if (!response.ok) await parseApiError(response, `Local API state write returned ${response.status}`);
  return { ok: true, revision: stateRevisionHeader(response) };
}

async function resetApiState() {
  const response = await fetch('/api/reset', {
    method: 'POST',
    headers: { Accept: 'application/json', ...authHeaders(), ...diagnosticHeaders('browser-reset') },
  });
  if (!response.ok) await parseApiError(response, `Local API reset returned ${response.status}`);

  const body = (await response.json()) as { state?: AppState };
  if (!body.state) throw new Error('Local API reset did not return state.');
  return { state: body.state, revision: stateRevisionHeader(response) };
}

async function runApiAction(request: AccountingActionRequest, expectedRevision?: string | null) {
  const response = await fetch(`/api/actions/${encodeURIComponent(request.key)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeaders(),
      ...expectedRevisionHeaders(expectedRevision),
      ...diagnosticHeaders(`browser-action:${request.key}`),
    },
    body: JSON.stringify({
      actor: request.actor,
      payload: request.payload,
    }),
  });

  const body = (await response.json()) as { state?: AppState; error?: string; code?: string };
  if (!response.ok || !body.state) {
    throw new ApiRequestError(authMessage(response.status, body.code, body.error), response.status, body.code);
  }

  return { state: body.state, revision: stateRevisionHeader(response) };
}

interface AttachmentUploadRequest {
  ownerType: AttachmentOwnerType;
  ownerId: string;
  fileName: string;
  contentType: string;
  contentBase64: string;
}

async function uploadApiAttachment(request: AttachmentUploadRequest, expectedRevision?: string | null) {
  const response = await fetch('/api/attachments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeaders(),
      ...expectedRevisionHeaders(expectedRevision),
      ...diagnosticHeaders(`browser-attachment-upload:${request.ownerType}:${request.ownerId}`),
    },
    body: JSON.stringify({
      actor: { actorType: 'user', roleKey: 'owner' },
      ...request,
    }),
  });

  const body = (await response.json()) as { state?: AppState; attachment?: AttachmentReference; error?: string; code?: string };
  if (!response.ok || !body.state || !body.attachment) {
    throw new ApiRequestError(authMessage(response.status, body.code, body.error), response.status, body.code);
  }
  return { state: body.state, attachment: body.attachment, revision: stateRevisionHeader(response) };
}

async function listApiAttachments(ownerType: AttachmentOwnerType, ownerId: string) {
  const response = await fetch(`/api/attachments?ownerType=${encodeURIComponent(ownerType)}&ownerId=${encodeURIComponent(ownerId)}`, {
    headers: { Accept: 'application/json', ...authHeaders() },
  });
  if (!response.ok) await parseApiError(response, `Local API attachment list returned ${response.status}`);
  return (await response.json()) as { ok: true; attachments: AttachmentReference[] };
}

async function downloadApiAttachment(attachmentId: string) {
  const response = await fetch(`/api/attachments/${encodeURIComponent(attachmentId)}/download`, {
    headers: { Accept: '*/*', ...authHeaders() },
  });
  if (!response.ok) await parseApiError(response, `Local API attachment download returned ${response.status}`);
  return response.blob();
}

async function deleteApiAttachment(attachmentId: string, expectedRevision?: string | null) {
  const response = await fetch(`/api/attachments/${encodeURIComponent(attachmentId)}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeaders(),
      ...expectedRevisionHeaders(expectedRevision),
      ...diagnosticHeaders(`browser-attachment-delete:${attachmentId}`),
    },
    body: JSON.stringify({ actor: { actorType: 'user', roleKey: 'owner' } }),
  });

  const body = (await response.json()) as { state?: AppState; attachment?: AttachmentReference; error?: string; code?: string };
  if (!response.ok || !body.state) {
    throw new ApiRequestError(authMessage(response.status, body.code, body.error), response.status, body.code);
  }
  return { state: body.state, revision: stateRevisionHeader(response) };
}

async function isLocalApiAvailable() {
  try {
    const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
    if (!response.ok) return false;
    const body = (await response.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

async function loadApiHealth() {
  const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Local API health returned ${response.status}`);
  return (await response.json()) as { ok?: boolean; authMode?: AuthMode };
}

export function useAccountingState() {
  const hostedAuth = useHostedAuth();
  const [state, setState] = useState<AppState>(() => loadState());
  const [storageMode, setStorageMode] = useState<StorageMode>('browser-local');
  const [authToken, setAuthTokenState] = useState(() => storedAuthToken());
  const [authMode, setAuthMode] = useState<AuthMode>('dev');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authErrorCode, setAuthErrorCode] = useState<string | null>(null);
  const storageModeRef = useRef<StorageMode>('browser-local');
  const localApiReadyRef = useRef(false);
  const browserActionFallbackAllowedRef = useRef(false);
  const stateRevisionRef = useRef<string | null>(null);

  const setMode = useCallback((mode: StorageMode) => {
    storageModeRef.current = mode;
    setStorageMode(mode);
  }, []);

  useEffect(() => {
    if (isSupabaseMode) return;
    let active = true;

    void loadApiHealth()
      .then((health) => {
        if (active && health.authMode) setAuthMode(health.authMode);
        return loadApiState();
      })
      .then(({ state: apiState, revision }) => {
        if (!active) return;
        localApiReadyRef.current = true;
        browserActionFallbackAllowedRef.current = false;
        stateRevisionRef.current = revision ?? null;
        setAuthError(null);
        setAuthErrorCode(null);
        setState(apiState);
        persistBrowserState(apiState);
        setMode('localhost-api');
      })
      .catch((error) => {
        if (active) {
          localApiReadyRef.current = false;
          const isAuthFailure = error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
          browserActionFallbackAllowedRef.current = !isAuthFailure;
          stateRevisionRef.current = null;
          setAuthError(error instanceof Error ? error.message : null);
          setAuthErrorCode(error instanceof ApiRequestError ? error.code ?? null : null);
          setMode(isAuthFailure ? 'localhost-api' : 'browser-local');
        }
      });

    return () => {
      active = false;
    };
  }, [setMode, authToken]);

  useEffect(() => {
    if (!isSupabaseMode || !hostedAuth.ready || !hostedAuth.organization) return;
    let active = true;
    const organization = hostedAuth.organization;
    void loadSupabaseState(organization.id)
      .then(async ({ state: hostedState, revision }) => {
        if (!active) return;
        const nextState = hostedState
          ? stateForHostedOrganization(hostedState, organization.id, organization.name, organization.baseCurrency)
          : stateForHostedOrganization(initialState, organization.id, organization.name, organization.baseCurrency);
        if (!hostedState) {
          const saved = await persistSupabaseState(nextState, organization.id, hostedAuth.user?.id);
          revision = saved.revision;
        }
        localApiReadyRef.current = false;
        browserActionFallbackAllowedRef.current = false;
        stateRevisionRef.current = revision ?? null;
        setAuthError(null);
        setAuthErrorCode(null);
        setState(nextState);
        persistBrowserState(nextState);
        setMode('localhost-api');
      })
      .catch((error) => {
        if (!active) return;
        setAuthError(error instanceof Error ? error.message : 'Could not load Supabase state.');
        setAuthErrorCode(error instanceof ApiRequestError ? error.code ?? null : null);
        setMode('localhost-api');
      });
    return () => {
      active = false;
    };
  }, [hostedAuth.organization, hostedAuth.ready, hostedAuth.user?.id, setMode]);

  const saveState = useCallback((nextState: AppState) => {
    setState(nextState);
    persistBrowserState(nextState);
    if (isSupabaseMode && hostedAuth.organization) {
      void persistSupabaseState(nextState, hostedAuth.organization.id, hostedAuth.user?.id)
        .then(({ revision }) => {
          stateRevisionRef.current = revision;
          setAuthError(null);
          setAuthErrorCode(null);
          setMode('localhost-api');
        })
        .catch((error) => {
          setAuthError(error instanceof Error ? error.message : 'Could not save Supabase state.');
          setAuthErrorCode(error instanceof ApiRequestError ? error.code ?? null : null);
          setMode('localhost-api');
        });
      return;
    }
    const expectedRevision = stateRevisionRef.current;
    void persistApiState(nextState, expectedRevision)
      .then(({ revision }) => {
        localApiReadyRef.current = true;
        browserActionFallbackAllowedRef.current = false;
        stateRevisionRef.current = revision ?? stateRevisionRef.current;
        setAuthError(null);
        setAuthErrorCode(null);
        setMode('localhost-api');
      })
      .catch((error) => {
        const isConflict = error instanceof ApiRequestError && error.code === 'STATE_REVISION_CONFLICT';
        localApiReadyRef.current = !isConflict ? false : localApiReadyRef.current;
        browserActionFallbackAllowedRef.current = !isConflict;
        setAuthError(error instanceof Error ? error.message : null);
        setAuthErrorCode(error instanceof ApiRequestError ? error.code ?? null : null);
        setMode(isConflict ? 'localhost-api' : 'browser-local');
      });
  }, [hostedAuth.organization, hostedAuth.user?.id, setMode]);

  const refreshLatestState = useCallback(async () => {
    if (isSupabaseMode && hostedAuth.organization) {
      const { state: hostedState, revision } = await loadSupabaseState(hostedAuth.organization.id);
      const nextState = hostedState
        ? stateForHostedOrganization(hostedState, hostedAuth.organization.id, hostedAuth.organization.name, hostedAuth.organization.baseCurrency)
        : stateForHostedOrganization(initialState, hostedAuth.organization.id, hostedAuth.organization.name, hostedAuth.organization.baseCurrency);
      stateRevisionRef.current = revision ?? null;
      setAuthError(null);
      setAuthErrorCode(null);
      setState(nextState);
      persistBrowserState(nextState);
      setMode('localhost-api');
      return nextState;
    }
    const { state: apiState, revision } = await loadApiState();
    localApiReadyRef.current = true;
    browserActionFallbackAllowedRef.current = false;
    stateRevisionRef.current = revision ?? null;
    setAuthError(null);
    setAuthErrorCode(null);
    setState(apiState);
    persistBrowserState(apiState);
    setMode('localhost-api');
    return apiState;
  }, [hostedAuth.organization, setMode]);

  const resetState = useCallback(() => {
    if (isSupabaseMode) {
      setAuthError('Reset is disabled in hosted Supabase mode.');
      setAuthErrorCode('ADMIN_REQUIRED');
      return;
    }
    void resetApiState()
      .then(({ state: apiState, revision }) => {
        localApiReadyRef.current = true;
        browserActionFallbackAllowedRef.current = false;
        stateRevisionRef.current = revision ?? null;
        setAuthError(null);
        setAuthErrorCode(null);
        setState(apiState);
        persistBrowserState(apiState);
        setMode('localhost-api');
      })
      .catch((error) => {
        setAuthError(error instanceof Error ? error.message : null);
        setAuthErrorCode(error instanceof ApiRequestError ? error.code ?? null : null);
        saveState(initialState);
      });
  }, [saveState, setMode]);

  const runAction = useCallback(
    async (request: AccountingActionRequest): Promise<AccountingActionResult> => {
      if (isSupabaseMode && hostedAuth.organization) {
        try {
          const hostedRequest = {
            ...request,
            actor: {
              actorType: 'user' as const,
              actorId: hostedAuth.user?.id,
              roleKey: hostedAuth.roleKey ?? 'viewer',
              permissions: hostedAuth.permissions,
            },
          };
          const nextState = executeAccountingAction(state, hostedRequest);
          const scopedState = stateForHostedOrganization(
            nextState,
            hostedAuth.organization.id,
            hostedAuth.organization.name,
            hostedAuth.organization.baseCurrency,
          );
          const { revision } = await persistSupabaseState(scopedState, hostedAuth.organization.id, hostedAuth.user?.id);
          stateRevisionRef.current = revision;
          setAuthError(null);
          setAuthErrorCode(null);
          setState(scopedState);
          persistBrowserState(scopedState);
          setMode('localhost-api');
          return { ok: true, state: scopedState };
        } catch (error) {
          setAuthError(error instanceof Error ? error.message : 'Supabase action failed.');
          setAuthErrorCode(error instanceof ApiRequestError ? error.code ?? null : null);
          return { ok: false, error: error instanceof Error ? error.message : 'Supabase action failed.' };
        }
      }
      try {
        const { state: apiState, revision } = await runApiAction(request, stateRevisionRef.current);
        localApiReadyRef.current = true;
        browserActionFallbackAllowedRef.current = false;
        stateRevisionRef.current = revision ?? stateRevisionRef.current;
        setAuthError(null);
        setAuthErrorCode(null);
        setState(apiState);
        persistBrowserState(apiState);
        setMode('localhost-api');
        return { ok: true, state: apiState };
      } catch (apiError) {
        const fallbackAllowed =
          browserActionFallbackAllowedRef.current &&
          storageModeRef.current === 'browser-local' &&
          !localApiReadyRef.current &&
          !(await isLocalApiAvailable());

        if (!fallbackAllowed) {
          setAuthError(apiError instanceof Error ? apiError.message : null);
          setAuthErrorCode(apiError instanceof ApiRequestError ? apiError.code ?? null : null);
          return {
            ok: false,
            error: apiError instanceof Error ? apiError.message : 'Local API action failed.',
          };
        }

        try {
          const nextState = executeAccountingAction(state, request);
          saveState(nextState);
          return { ok: true, state: nextState };
        } catch (fallbackError) {
          const error =
            fallbackError instanceof Error ? fallbackError.message : apiError instanceof Error ? apiError.message : 'Action failed.';
          return { ok: false, error };
        }
      }
    },
    [hostedAuth.organization, hostedAuth.permissions, hostedAuth.roleKey, hostedAuth.user?.id, saveState, setMode, state],
  );

  const handleApiState = useCallback((apiState: AppState, revision?: string) => {
    localApiReadyRef.current = true;
    browserActionFallbackAllowedRef.current = false;
    stateRevisionRef.current = revision ?? stateRevisionRef.current;
    setAuthError(null);
    setAuthErrorCode(null);
    setState(apiState);
    persistBrowserState(apiState);
    setMode('localhost-api');
  }, [setMode]);

  const uploadAttachment = useCallback(
    async (request: AttachmentUploadRequest) => {
      if (isSupabaseMode && hostedAuth.organization) {
        try {
          const client = getSupabaseClient();
          if (!client) throw new ApiRequestError('Supabase is not configured.', 500, 'SUPABASE_NOT_CONFIGURED');
          const attachmentId = `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
          const storagePath = hostedStoragePath(hostedAuth.organization.id, request.ownerType, request.ownerId, attachmentId, request.fileName);
          const { error: uploadError } = await client.storage
            .from(import.meta.env.VITE_SUPABASE_STORAGE_ATTACHMENT_BUCKET || 'attachments')
            .upload(storagePath, base64ToBytes(request.contentBase64), {
              contentType: request.contentType || 'application/octet-stream',
              upsert: false,
            });
          if (uploadError) throw new ApiRequestError(uploadError.message, 400, 'ATTACHMENT_UPLOAD_FAILED');
          const attachment: AttachmentReference = {
            id: attachmentId,
            organizationId: hostedAuth.organization.id,
            ownerType: request.ownerType,
            ownerId: request.ownerId,
            name: request.fileName,
            mimeType: request.contentType,
            sizeBytes: base64ToBytes(request.contentBase64).byteLength,
            storagePath,
            createdAt: new Date().toISOString(),
          };
          const nextState: AppState = {
            ...state,
            attachments: [...(state.attachments ?? []), attachment],
            cashTransactions: state.cashTransactions.map((item) =>
              request.ownerType === 'cash_transaction' && item.id === request.ownerId
                ? { ...item, attachmentIds: [...new Set([...(item.attachmentIds ?? []), attachment.id])] }
                : item,
            ),
            documents: state.documents.map((item) =>
              request.ownerType === 'document' && item.id === request.ownerId
                ? { ...item, attachmentIds: [...new Set([...(item.attachmentIds ?? []), attachment.id])] }
                : item,
            ),
          };
          const { revision } = await persistSupabaseState(nextState, hostedAuth.organization.id, hostedAuth.user?.id);
          stateRevisionRef.current = revision;
          handleApiState(nextState, revision);
          return { ok: true, attachment, state: nextState };
        } catch (error) {
          setAuthError(error instanceof Error ? error.message : null);
          setAuthErrorCode(error instanceof ApiRequestError ? error.code ?? null : null);
          return { ok: false, error: error instanceof Error ? error.message : 'Attachment upload failed.' };
        }
      }
      try {
        const result = await uploadApiAttachment(request, stateRevisionRef.current);
        handleApiState(result.state, result.revision);
        return { ok: true, attachment: result.attachment, state: result.state };
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : null);
        setAuthErrorCode(error instanceof ApiRequestError ? error.code ?? null : null);
        return { ok: false, error: error instanceof Error ? error.message : 'Attachment upload failed.' };
      }
    },
    [handleApiState, hostedAuth.organization, hostedAuth.user?.id, state],
  );

  const listAttachments = useCallback(async (ownerType: AttachmentOwnerType, ownerId: string) => {
    if (isSupabaseMode) {
      return {
        ok: true,
        attachments: (state.attachments ?? []).filter((attachment) => attachment.ownerType === ownerType && attachment.ownerId === ownerId),
      };
    }
    try {
      const result = await listApiAttachments(ownerType, ownerId);
      return { ok: true, attachments: result.attachments };
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : null);
      setAuthErrorCode(error instanceof ApiRequestError ? error.code ?? null : null);
      return { ok: false, error: error instanceof Error ? error.message : 'Attachment list failed.' };
    }
  }, [state.attachments]);

  const downloadAttachment = useCallback(async (attachment: AttachmentReference) => {
    if (isSupabaseMode) {
      try {
        const client = getSupabaseClient();
        if (!client || !attachment.storagePath) throw new ApiRequestError('Attachment storage path is unavailable.', 404, 'ATTACHMENT_NOT_FOUND');
        const { data, error } = await client.storage
          .from(import.meta.env.VITE_SUPABASE_STORAGE_ATTACHMENT_BUCKET || 'attachments')
          .download(attachment.storagePath);
        if (error) throw new ApiRequestError(error.message, 404, 'ATTACHMENT_DOWNLOAD_FAILED');
        const url = URL.createObjectURL(data);
        const link = document.createElement('a');
        link.href = url;
        link.download = attachment.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setAuthError(null);
        setAuthErrorCode(null);
        return { ok: true };
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : null);
        setAuthErrorCode(error instanceof ApiRequestError ? error.code ?? null : null);
        return { ok: false, error: error instanceof Error ? error.message : 'Attachment download failed.' };
      }
    }
    try {
      const blob = await downloadApiAttachment(attachment.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setAuthError(null);
      setAuthErrorCode(null);
      return { ok: true };
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : null);
      setAuthErrorCode(error instanceof ApiRequestError ? error.code ?? null : null);
      return { ok: false, error: error instanceof Error ? error.message : 'Attachment download failed.' };
    }
  }, []);

  const deleteAttachment = useCallback(
    async (attachmentId: string) => {
      if (isSupabaseMode && hostedAuth.organization) {
        try {
          const client = getSupabaseClient();
          if (!client) throw new ApiRequestError('Supabase is not configured.', 500, 'SUPABASE_NOT_CONFIGURED');
          const attachment = (state.attachments ?? []).find((item) => item.id === attachmentId);
          if (attachment?.storagePath) {
            const { error: removeError } = await client.storage
              .from(import.meta.env.VITE_SUPABASE_STORAGE_ATTACHMENT_BUCKET || 'attachments')
              .remove([attachment.storagePath]);
            if (removeError) throw new ApiRequestError(removeError.message, 400, 'ATTACHMENT_DELETE_FAILED');
          }
          const nextState: AppState = {
            ...state,
            attachments: (state.attachments ?? []).filter((item) => item.id !== attachmentId),
            cashTransactions: state.cashTransactions.map((item) => ({ ...item, attachmentIds: (item.attachmentIds ?? []).filter((id) => id !== attachmentId) })),
            documents: state.documents.map((item) => ({ ...item, attachmentIds: (item.attachmentIds ?? []).filter((id) => id !== attachmentId) })),
          };
          const { revision } = await persistSupabaseState(nextState, hostedAuth.organization.id, hostedAuth.user?.id);
          stateRevisionRef.current = revision;
          handleApiState(nextState, revision);
          return { ok: true, state: nextState };
        } catch (error) {
          setAuthError(error instanceof Error ? error.message : null);
          setAuthErrorCode(error instanceof ApiRequestError ? error.code ?? null : null);
          return { ok: false, error: error instanceof Error ? error.message : 'Attachment delete failed.' };
        }
      }
      try {
        const result = await deleteApiAttachment(attachmentId, stateRevisionRef.current);
        handleApiState(result.state, result.revision);
        return { ok: true, state: result.state };
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : null);
        setAuthErrorCode(error instanceof ApiRequestError ? error.code ?? null : null);
        return { ok: false, error: error instanceof Error ? error.message : 'Attachment delete failed.' };
      }
    },
    [handleApiState, hostedAuth.organization, hostedAuth.user?.id, state],
  );

  return useMemo(
    () => ({
      state,
      setState: saveState,
      runAction,
      reset: resetState,
      storageMode,
      attachmentApi: {
        upload: uploadAttachment,
        list: listAttachments,
        download: downloadAttachment,
        delete: deleteAttachment,
      },
      authSession: {
        mode: isSupabaseMode ? 'supabase' : 'local',
        authMode,
        token: authToken,
        error: authError,
        isRequired: authMode === 'required',
        errorCode: authErrorCode,
        userLabel: isSupabaseMode ? hostedAuth.displayName : '',
        roleKey: isSupabaseMode ? hostedAuth.roleKey ?? '' : '',
        logout: hostedAuth.signOut,
        refreshLatest: async () => {
          try {
            await refreshLatestState();
          } catch (error) {
            setAuthError(error instanceof Error ? error.message : 'Could not refresh the local API state.');
            setAuthErrorCode(error instanceof ApiRequestError ? error.code ?? null : null);
          }
        },
        setToken: (token: string) => {
          const nextToken = token.trim();
          window.sessionStorage.setItem(authTokenKey, nextToken);
          setAuthTokenState(nextToken);
          setAuthError(null);
          setAuthErrorCode(null);
        },
        clearToken: () => {
          window.sessionStorage.removeItem(authTokenKey);
          setAuthTokenState('');
          stateRevisionRef.current = null;
        },
      },
    }),
    [
      authError,
      authErrorCode,
      authMode,
      authToken,
      deleteAttachment,
      downloadAttachment,
      listAttachments,
      refreshLatestState,
      resetState,
      runAction,
      saveState,
      state,
      storageMode,
      uploadAttachment,
    ],
  );
}
