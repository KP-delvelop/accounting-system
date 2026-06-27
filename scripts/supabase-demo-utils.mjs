import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

export const demoUsersPath = 'supabase-demo-users.generated.json';

function loadOneEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!process.env[key]) process.env[key] = rawValue.replace(/^["']|["']$/g, '');
  }
}

export function loadEnvFile(path = '.env.supabase.local') {
  loadOneEnvFile('.env.local');
  loadOneEnvFile(path);
}

export function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function adminClient() {
  loadEnvFile();
  return createClient(requiredEnv('VITE_SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function publicClient() {
  loadEnvFile();
  return createClient(requiredEnv('VITE_SUPABASE_URL'), requiredEnv('VITE_SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function randomPassword() {
  return `Tmp-${randomBytes(9).toString('base64url')}!7a`;
}

export function readOrCreateDemoCredentials(users) {
  if (existsSync(demoUsersPath)) return JSON.parse(readFileSync(demoUsersPath, 'utf8'));
  const credentials = {
    generatedAt: new Date().toISOString(),
    users: users.map((user) => ({ ...user, password: randomPassword() })),
  };
  writeFileSync(demoUsersPath, `${JSON.stringify(credentials, null, 2)}\n`, 'utf8');
  return credentials;
}

export async function findUserByEmail(client, email) {
  let page = 1;
  for (;;) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const user = data.users.find((item) => item.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < 100) return null;
    page += 1;
  }
}
