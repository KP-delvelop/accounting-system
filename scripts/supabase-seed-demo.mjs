import { readFileSync } from 'node:fs';
import {
  adminClient,
  demoUsersPath,
  findUserByEmail,
  readOrCreateDemoCredentials,
  sha256Hex,
} from './supabase-demo-utils.mjs';

const organizationId = '00000000-0000-4000-8000-000000000001';
const organizationName = 'Account for you';

const demoUsers = [
  { roleKey: 'owner', email: 'demo.owner.01@example.invalid', displayName: 'Demo Owner' },
  { roleKey: 'accountant', email: 'demo.accountant.01@example.invalid', displayName: 'Demo Accountant' },
  { roleKey: 'viewer', email: 'demo.viewer.01@example.invalid', displayName: 'Demo Viewer' },
  { roleKey: 'sales', email: 'demo.sales.01@example.invalid', displayName: 'Demo Sales' },
  { roleKey: 'purchase', email: 'demo.purchase.01@example.invalid', displayName: 'Demo Purchase' },
];

function withOrganization(value) {
  if (Array.isArray(value)) return value.map(withOrganization);
  if (!value || typeof value !== 'object') return value;
  const next = { ...value };
  if ('organizationId' in next) next.organizationId = organizationId;
  for (const [key, child] of Object.entries(next)) next[key] = withOrganization(child);
  return next;
}

async function upsertUser(client, user) {
  const existing = await findUserByEmail(client, user.email);
  if (existing) {
    const { data, error } = await client.auth.admin.updateUserById(existing.id, {
      password: user.password,
      email_confirm: true,
      user_metadata: { display_name: user.displayName },
    });
    if (error) throw error;
    return data.user;
  }
  const { data, error } = await client.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: { display_name: user.displayName },
  });
  if (error) throw error;
  return data.user;
}

async function main() {
  const client = adminClient();
  const credentials = readOrCreateDemoCredentials(demoUsers);
  const seed = JSON.parse(readFileSync('data/local-db.seed.json', 'utf8'));
  const hostedState = withOrganization({
    ...seed,
    organization: {
      ...seed.organization,
      id: organizationId,
      name: organizationName,
      baseCurrency: seed.organization.baseCurrency ?? 'LAK',
    },
  });
  const revision = sha256Hex(JSON.stringify(hostedState));

  const { error: orgError } = await client.from('organizations').upsert({
    id: organizationId,
    name: organizationName,
    base_currency: hostedState.organization.baseCurrency,
  });
  if (orgError) throw orgError;

  for (const credential of credentials.users) {
    const authUser = await upsertUser(client, credential);
    const { error: profileError } = await client.from('profiles').upsert({
      id: authUser.id,
      email: credential.email,
      display_name: credential.displayName,
      updated_at: new Date().toISOString(),
    });
    if (profileError) throw profileError;
    const { error: memberError } = await client.from('organization_members').upsert({
      organization_id: organizationId,
      user_id: authUser.id,
      role_key: credential.roleKey,
    });
    if (memberError) throw memberError;
  }

  const owner = await findUserByEmail(client, credentials.users[0].email);
  const { error: stateError } = await client.from('app_states').upsert({
    organization_id: organizationId,
    state: hostedState,
    revision,
    updated_by: owner?.id ?? null,
    updated_at: new Date().toISOString(),
  });
  if (stateError) throw stateError;

  console.log(`Supabase demo organization seeded: ${organizationName}`);
  console.log(`Demo credentials written locally to ${demoUsersPath} (ignored by git).`);
  console.log(`Demo users created or updated: ${credentials.users.map((user) => `${user.roleKey}:${user.email}`).join(', ')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
