import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseMode, supabaseConfigStatus } from './supabaseClient';

export type HostedRoleKey = 'owner' | 'accountant' | 'viewer' | 'sales' | 'purchase';

export interface HostedOrganization {
  id: string;
  name: string;
  baseCurrency: string;
}

export interface HostedAuthContextValue {
  enabled: boolean;
  ready: boolean;
  session: Session | null;
  user: User | null;
  organization: HostedOrganization | null;
  roleKey: HostedRoleKey | null;
  displayName: string;
  permissions: string[];
  signOut: () => Promise<void>;
}

const localContext: HostedAuthContextValue = {
  enabled: false,
  ready: true,
  session: null,
  user: null,
  organization: null,
  roleKey: null,
  displayName: '',
  permissions: [],
  signOut: async () => {},
};

const HostedAuthContext = createContext<HostedAuthContextValue>(localContext);

const rolePermissions: Record<HostedRoleKey, string[]> = {
  owner: [],
  accountant: [
    'cash_revenue:create',
    'cash_payment:create',
    'customer:create',
    'vendor:create',
    'product:create',
    'category:create',
    'invoice:create',
    'bill:create',
    'invoice:update_status',
    'bill:update_status',
    'document:lock',
    'record:delete',
    'report:view',
    'report_filter:save',
    'report_filter:delete',
  ],
  viewer: ['report:view'],
  sales: ['cash_revenue:create', 'customer:create', 'product:create', 'category:create', 'invoice:create', 'invoice:update_status', 'report:view'],
  purchase: ['cash_payment:create', 'vendor:create', 'product:create', 'category:create', 'bill:create', 'bill:update_status', 'report:view'],
};

function LoginScreen({ onLogin, error, loading }: { onLogin: (email: string, password: string) => Promise<void>; error: string | null; loading: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onLogin(email, password);
  }

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div>
          <p className="eyebrow">Hosted tester demo</p>
          <h1>Sign in</h1>
          <p>Use the Supabase demo account provided by the project owner.</p>
        </div>
        <label>
          Email
          <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        {error ? <div className="auth-error">{error}</div> : null}
        <button type="submit" disabled={loading}>{loading ? 'Signing in...' : 'Sign in'}</button>
      </form>
    </main>
  );
}

function AuthMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Hosted tester demo</p>
        <h1>{title}</h1>
        <p>{body}</p>
      </section>
    </main>
  );
}

export function HostedAuthProvider({ children }: { children: ReactNode }) {
  const client = getSupabaseClient();
  const config = supabaseConfigStatus();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseMode);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [organization, setOrganization] = useState<HostedOrganization | null>(null);
  const [roleKey, setRoleKey] = useState<HostedRoleKey | null>(null);
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    if (!isSupabaseMode || !client) return;
    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: subscription } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setOrganization(null);
      setRoleKey(null);
      setDisplayName('');
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    if (!isSupabaseMode || !client || !session?.user) return;
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const { data, error: membershipError } = await client
          .from('organization_members')
          .select('organization_id, role_key, organizations(id, name, base_currency), profiles(display_name, email)')
          .eq('user_id', session.user.id)
          .limit(1)
          .maybeSingle();
        if (!active) return;
        if (membershipError) throw membershipError;
        if (!data) {
          setError('This user is not assigned to an organization.');
          return;
        }
        const org = Array.isArray(data.organizations) ? data.organizations[0] : data.organizations;
        const profile = Array.isArray(data.profiles) ? data.profiles[0] : data.profiles;
        setOrganization({
          id: org.id,
          name: org.name,
          baseCurrency: org.base_currency,
        });
        setRoleKey(data.role_key as HostedRoleKey);
        setDisplayName(profile?.display_name || profile?.email || session.user.email || 'User');
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load organization.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [client, session]);

  const login = useCallback(async (email: string, password: string) => {
    if (!client) return;
    setLoginLoading(true);
    setError(null);
    try {
      const { error: loginError } = await client.auth.signInWithPassword({ email, password });
      if (loginError) throw loginError;
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Sign in failed.');
    } finally {
      setLoginLoading(false);
    }
  }, [client]);

  const signOut = useCallback(async () => {
    if (!client) return;
    await client.auth.signOut();
  }, [client]);

  const value = useMemo<HostedAuthContextValue>(() => ({
    enabled: isSupabaseMode,
    ready: !isSupabaseMode || Boolean(session && organization && roleKey && !loading),
    session,
    user: session?.user ?? null,
    organization,
    roleKey,
    displayName,
    permissions: roleKey ? rolePermissions[roleKey] : [],
    signOut,
  }), [displayName, loading, organization, roleKey, session, signOut]);

  if (!isSupabaseMode) {
    return <HostedAuthContext.Provider value={localContext}>{children}</HostedAuthContext.Provider>;
  }

  if (!config.configured || !client) {
    return <AuthMessage title="Service is not configured" body="Please contact the system administrator before signing in." />;
  }

  if (loading && !session) {
    return <AuthMessage title="Loading session" body="Checking your session." />;
  }

  if (!session) {
    return <LoginScreen onLogin={login} error={error} loading={loginLoading} />;
  }

  if (loading) {
    return <AuthMessage title="Loading organization" body="Checking your organization membership." />;
  }

  if (!organization || !roleKey) {
    return <AuthMessage title="Access denied" body={error ?? 'This user is not assigned to an organization.'} />;
  }

  return <HostedAuthContext.Provider value={value}>{children}</HostedAuthContext.Provider>;
}

export function useHostedAuth() {
  return useContext(HostedAuthContext);
}
