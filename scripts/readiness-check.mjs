import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const apiBaseUrl = process.env.READINESS_API_BASE_URL ?? 'http://127.0.0.1:8787';
const appUrl = process.env.READINESS_APP_URL ?? 'http://127.0.0.1:5173/';
const expectedAuthMode = process.env.READINESS_EXPECT_AUTH_MODE ?? '';
const adminToken = process.env.READINESS_ADMIN_TOKEN ?? process.env.LOCAL_API_ADMIN_TOKEN ?? '';

function filePath(path) {
  return resolve(projectRoot, path);
}

function check(condition, message, details = undefined) {
  if (!condition) {
    const suffix = details ? ` ${details}` : '';
    throw new Error(`${message}${suffix}`);
  }
  console.log(`ok: ${message}`);
}

async function sha256(path) {
  const raw = await readFile(filePath(path));
  return createHash('sha256').update(raw).digest('hex').toUpperCase();
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

async function main() {
  check(existsSync(filePath('dist/index.html')), 'build artifact exists at dist/index.html');
  check(existsSync(filePath('dist/assets')), 'build assets directory exists');

  const { response: healthResponse, body: health } = await getJson(`${apiBaseUrl}/api/health`);
  check(healthResponse.status === 200 && health?.ok === true, 'local API health responds ok');
  check(Boolean(health.authMode), 'local API health exposes authMode');
  if (expectedAuthMode) {
    check(
      health.authMode === expectedAuthMode,
      `local API authMode matches READINESS_EXPECT_AUTH_MODE=${expectedAuthMode}`,
      `(actual: ${health.authMode})`,
    );
  } else if (health.authMode === 'dev') {
    console.warn('warn: LOCAL_API_AUTH_MODE=dev is acceptable for local development only, not production-like readiness.');
  }

  const appResponse = await fetch(appUrl, { headers: { Accept: 'text/html' } });
  check(appResponse.status === 200, 'frontend app responds 200');

  const devLogPath = filePath('.dev-server.err.log');
  if (existsSync(devLogPath)) {
    const devLog = await stat(devLogPath);
    check(devLog.size === 0, '.dev-server.err.log is empty', `(bytes: ${devLog.size})`);
  } else {
    console.warn('warn: .dev-server.err.log does not exist; skipping log-size check.');
  }

  const seedHash = await sha256('data/local-db.seed.json');
  const currentHash = await sha256('data/local-db.json');
  check(seedHash === currentHash, 'local DB hash matches seed after readiness checks');
  console.log(`info: local-db hash ${currentHash}`);

  const diagnosticsHeaders = adminToken ? { Authorization: `Bearer ${adminToken}` } : {};
  const { response: diagnosticsResponse, body: diagnosticsBody } = await getJson(
    `${apiBaseUrl}/api/reset-diagnostics?limit=200`,
    diagnosticsHeaders,
  );
  check(diagnosticsResponse.status === 200 && diagnosticsBody?.ok === true, 'reset diagnostics endpoint responds ok');
  const diagnostics = Array.isArray(diagnosticsBody.diagnostics) ? diagnosticsBody.diagnostics : [];
  const badDiagnostics = diagnostics.filter(
    (entry) => entry?.event === 'api.ensure_data_file.read_failed' || entry?.event === 'api.ensure_data_file.seed_created',
  );
  check(badDiagnostics.length === 0, 'reset diagnostics contain no read_failed or seed_created events');

  console.log('Readiness check passed.');
}

main().catch((error) => {
  console.error(`Readiness check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
