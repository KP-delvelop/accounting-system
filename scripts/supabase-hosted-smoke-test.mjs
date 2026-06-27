import { readFileSync } from 'node:fs';
import { demoUsersPath, publicClient } from './supabase-demo-utils.mjs';

async function main() {
  const credentials = JSON.parse(readFileSync(demoUsersPath, 'utf8'));
  const owner = credentials.users.find((user) => user.roleKey === 'owner');
  const viewer = credentials.users.find((user) => user.roleKey === 'viewer');
  if (!owner || !viewer) throw new Error('Demo owner/viewer credentials are missing. Run npm run supabase:seed-demo first.');

  const ownerClient = publicClient();
  const { data: ownerLogin, error: ownerLoginError } = await ownerClient.auth.signInWithPassword({
    email: owner.email,
    password: owner.password,
  });
  if (ownerLoginError || !ownerLogin.session) throw ownerLoginError ?? new Error('Owner login failed.');
  const { data: ownerMembership, error: membershipError } = await ownerClient
    .from('organization_members')
    .select('organization_id, role_key')
    .eq('user_id', ownerLogin.user.id)
    .single();
  if (membershipError) throw membershipError;
  if (ownerMembership.role_key !== 'owner') throw new Error('Owner role was not returned through RLS.');
  const { data: ownerState, error: stateReadError } = await ownerClient
    .from('app_states')
    .select('organization_id, revision')
    .eq('organization_id', ownerMembership.organization_id)
    .single();
  if (stateReadError || !ownerState?.revision) throw stateReadError ?? new Error('Owner could not read app state.');

  const viewerClient = publicClient();
  const { data: viewerLogin, error: viewerLoginError } = await viewerClient.auth.signInWithPassword({
    email: viewer.email,
    password: viewer.password,
  });
  if (viewerLoginError || !viewerLogin.session) throw viewerLoginError ?? new Error('Viewer login failed.');
  const { data: viewerState, error: viewerReadError } = await viewerClient
    .from('app_states')
    .select('organization_id, revision')
    .eq('organization_id', ownerMembership.organization_id)
    .single();
  if (viewerReadError || !viewerState?.revision) throw viewerReadError ?? new Error('Viewer could not read app state.');
  const { data: viewerUpdateRows, error: viewerUpdateError } = await viewerClient
    .from('app_states')
    .update({ updated_at: new Date().toISOString() })
    .eq('organization_id', ownerMembership.organization_id)
    .select('organization_id');
  if (!viewerUpdateError && viewerUpdateRows?.length) throw new Error('Viewer update unexpectedly returned rows; RLS write guard failed.');

  console.log(JSON.stringify({
    ok: true,
    ownerCanReadState: true,
    viewerCanReadState: true,
    viewerWriteRejected: true,
    organizationId: ownerMembership.organization_id,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
