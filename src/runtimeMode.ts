export const dataMode = import.meta.env.VITE_DATA_MODE === 'supabase' ? 'supabase' : 'local-first';
export const persistenceLayer = dataMode === 'supabase' ? 'supabase-auth-postgres-storage' : 'browser-local-storage';
