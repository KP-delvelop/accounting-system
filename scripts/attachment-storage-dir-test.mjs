import { spawn } from 'node:child_process';
import { rm, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.LOCAL_ATTACHMENT_STORAGE_TEST_PORT ?? 8799);
const baseUrl = `http://127.0.0.1:${port}`;
const storageDir = process.env.LOCAL_ATTACHMENT_STORAGE_TEST_DIR ?? 'data/attachments-custom-review';
const storagePath = resolve(projectRoot, storageDir);

const ownerActor = {
  actorType: 'user',
  actorId: 'storage-dir-test-owner',
  roleKey: 'owner',
  permissions: [],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return {
    status: response.status,
    body,
    headers: {
      stateRevision: response.headers.get('x-codex-state-revision'),
    },
  };
}

function diagnosticHeaders(reason) {
  return {
    'X-Codex-State-Write-Source': 'attachment-storage-dir-test',
    'X-Codex-Run-Id': `attachment-storage-dir-${process.pid}`,
    'X-Codex-Session-Id': `attachment-storage-dir-session-${process.pid}`,
    'X-Codex-State-Write-Reason': reason,
  };
}

async function postJson(path, body, headers = {}) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...diagnosticHeaders(path), ...headers },
    body: JSON.stringify(body),
  });
}

async function deleteJson(path, body, headers = {}) {
  return request(path, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...diagnosticHeaders(path), ...headers },
    body: JSON.stringify(body),
  });
}

async function waitForHealth(child) {
  for (let index = 0; index < 80; index += 1) {
    if (child.exitCode !== null) break;
    try {
      const health = await request('/api/health');
      if (health.status === 200 && health.body?.ok === true) return;
    } catch {
      // Keep waiting while the isolated local API starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('custom storage local API did not become healthy');
}

async function main() {
  await rm(storagePath, { recursive: true, force: true });
  const child = spawn(process.execPath, ['scripts/local-api.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      LOCAL_API_PORT: String(port),
      LOCAL_ATTACHMENT_STORAGE_DIR: storageDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[attachment-storage-api] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[attachment-storage-api:err] ${chunk}`));

  try {
    await waitForHealth(child);
    const reset = await postJson('/api/reset', {}, {
      'X-Codex-Reset-Source': 'attachment-storage-dir-test',
      'X-Codex-Reset-Reason': 'initial-seed',
    });
    assert(reset.status === 200 && reset.body?.ok === true, 'initial reset should pass');

    const customer = await postJson('/api/actions/customer.create', {
      actor: ownerActor,
      payload: { name: 'CODEX_CUSTOM_STORAGE_CUSTOMER', currency: 'LAK' },
    });
    assert(customer.status === 200 && customer.body?.ok === true, 'customer create should pass');
    const contactId = customer.body.state.contacts[0].id;

    const document = await postJson('/api/actions/sales_document.create', {
      actor: ownerActor,
      payload: {
        kind: 'sales',
        contactId,
        documentDate: '2026-06-25',
        reference: 'CODEX_CUSTOM_STORAGE_DOC',
        title: 'Custom storage attachment test',
        categoryId: 'cat-sales-document',
        exchangeRate: 1,
        items: [
          {
            id: 'item-custom-storage',
            name: 'Custom storage line',
            unit: 'service',
            quantity: 1,
            unitPrice: 100,
            discount: 0,
            discountType: 'percentage',
            taxId: 'tax-none',
          },
        ],
      },
    });
    assert(document.status === 200 && document.body?.ok === true, 'document create should pass');
    const documentId = document.body.state.documents[0].id;

    const stateBeforeUpload = await request('/api/state');
    const content = 'custom attachment storage root payload';
    const upload = await postJson(
      '/api/attachments',
      {
        actor: ownerActor,
        ownerType: 'document',
        ownerId: documentId,
        fileName: 'custom-root.txt',
        contentType: 'text/plain',
        contentBase64: Buffer.from(content, 'utf8').toString('base64'),
      },
      { 'X-Codex-Expected-State-Revision': stateBeforeUpload.headers.stateRevision },
    );
    assert(upload.status === 201 && upload.body?.ok === true, `upload should pass, got ${upload.status}`);
    assert(upload.body.attachment.storageKey, 'upload should return a storageKey');
    assert(!upload.body.attachment.storagePath, 'upload response should not expose storagePath');

    const filesAfterUpload = await readdir(storagePath);
    assert(filesAfterUpload.includes(upload.body.attachment.storageKey), 'file should be written in custom storage dir');

    const download = await request(`/api/attachments/${encodeURIComponent(upload.body.attachment.id)}/download`);
    assert(download.status === 200 && download.body === content, 'download should read from custom storage dir');

    const stateBeforeDelete = await request('/api/state');
    const deleted = await deleteJson(
      `/api/attachments/${encodeURIComponent(upload.body.attachment.id)}`,
      { actor: ownerActor },
      { 'X-Codex-Expected-State-Revision': stateBeforeDelete.headers.stateRevision },
    );
    assert(deleted.status === 200 && deleted.body?.ok === true, 'delete should pass');

    const filesAfterDelete = await readdir(storagePath).catch(() => []);
    assert(filesAfterDelete.length === 0, 'custom storage dir should have no files after delete');

    const cleanupState = await request('/api/state');
    const cleanupUpload = await postJson(
      '/api/attachments',
      {
        actor: ownerActor,
        ownerType: 'document',
        ownerId: documentId,
        fileName: 'reset-cleanup.txt',
        contentType: 'text/plain',
        contentBase64: Buffer.from('reset should remove orphaned attachment storage files', 'utf8').toString('base64'),
      },
      { 'X-Codex-Expected-State-Revision': cleanupState.headers.stateRevision },
    );
    assert(cleanupUpload.status === 201 && cleanupUpload.body?.ok === true, 'reset cleanup upload should pass');
    assert((await readdir(storagePath)).includes(cleanupUpload.body.attachment.storageKey), 'reset cleanup file should exist before reset');

    const finalReset = await postJson('/api/reset', {}, {
      'X-Codex-Reset-Source': 'attachment-storage-dir-test',
      'X-Codex-Reset-Reason': 'final-cleanup',
    });
    assert(finalReset.status === 200 && finalReset.body?.ok === true, 'final reset should pass');
    const filesAfterReset = await readdir(storagePath).catch(() => []);
    assert(filesAfterReset.length === 0, 'reset should remove attachment files from the configured storage dir');
    await rm(storagePath, { recursive: true, force: true });
    console.log('Attachment custom storage dir test passed.');
  } finally {
    child.kill('SIGTERM');
  }
}

main().catch(async (error) => {
  await rm(storagePath, { recursive: true, force: true }).catch(() => {});
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
