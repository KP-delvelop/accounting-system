import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { executeAccountingAction } from './actions';
import { initialState } from './seed';
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

  const saveState = useCallback((nextState: AppState) => {
    setState(nextState);
    persistBrowserState(nextState);
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
  }, [setMode]);

  const refreshLatestState = useCallback(async () => {
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
  }, [setMode]);

  const resetState = useCallback(() => {
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
    [saveState, setMode, state],
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
    [handleApiState],
  );

  const listAttachments = useCallback(async (ownerType: AttachmentOwnerType, ownerId: string) => {
    try {
      const result = await listApiAttachments(ownerType, ownerId);
      return { ok: true, attachments: result.attachments };
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : null);
      setAuthErrorCode(error instanceof ApiRequestError ? error.code ?? null : null);
      return { ok: false, error: error instanceof Error ? error.message : 'Attachment list failed.' };
    }
  }, []);

  const downloadAttachment = useCallback(async (attachment: AttachmentReference) => {
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
    [handleApiState],
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
        authMode,
        token: authToken,
        error: authError,
        isRequired: authMode === 'required',
        errorCode: authErrorCode,
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
