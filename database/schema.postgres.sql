-- Phase 1 host-ready Postgres schema.
-- Localhost prototype persistence lives in browser localStorage; this file is the migration target
-- for a future hosted API/database layer on Hostinger or another Postgres-capable host.

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_currency text not null default 'LAK',
  created_at timestamptz not null default now()
);

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  display_name text not null,
  role_key text not null default 'owner',
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table if not exists role_permissions (
  organization_id uuid not null references organizations(id) on delete cascade,
  role_key text not null,
  permission text not null,
  primary key (organization_id, role_key, permission)
);

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code text not null,
  name text not null,
  currency text not null default 'LAK',
  kind text not null,
  normal_balance text not null check (normal_balance in ('debit', 'credit')),
  opening_balance numeric(18, 2) not null default 0,
  enabled boolean not null default true,
  unique (organization_id, code)
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null,
  name text not null,
  accounting_code text not null,
  account_id uuid not null references accounts(id),
  enabled boolean not null default true
);

create table if not exists taxes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  rate numeric(9, 4) not null default 0,
  enabled boolean not null default true
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code text not null,
  name text not null,
  unit text not null default 'unit',
  unit_price numeric(18, 2) not null default 0 check (unit_price >= 0),
  tax_id uuid references taxes(id),
  enabled boolean not null default true,
  unique (organization_id, code)
);

create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  color text not null default '#24745a',
  enabled boolean not null default true,
  unique (organization_id, name)
);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  type text not null check (type in ('customer', 'vendor')),
  name text not null,
  code text,
  email text,
  phone text,
  tax_number text,
  currency text not null default 'LAK',
  address text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists cash_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('revenue', 'payment')),
  transaction_date date not null,
  account_id uuid not null references accounts(id),
  category_id uuid not null references categories(id),
  contact_id uuid references contacts(id),
  currency text not null default 'LAK',
  exchange_rate numeric(18, 8) not null default 1,
  amount numeric(18, 2) not null check (amount >= 0),
  reference text,
  description text,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cash_transaction_items (
  id uuid primary key default gen_random_uuid(),
  cash_transaction_id uuid not null references cash_transactions(id) on delete cascade,
  product_id uuid references products(id),
  name text not null,
  description text,
  unit text not null default 'unit',
  quantity numeric(18, 4) not null check (quantity > 0),
  unit_price numeric(18, 2) not null check (unit_price >= 0),
  discount numeric(18, 2) not null default 0,
  discount_type text not null default 'percentage' check (discount_type in ('percentage', 'amount')),
  tax_id uuid references taxes(id),
  tax_name_snapshot text,
  tax_rate_snapshot numeric(9, 4) not null default 0
);

create table if not exists cash_transaction_tags (
  cash_transaction_id uuid not null references cash_transactions(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete restrict,
  primary key (cash_transaction_id, tag_id)
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('sales', 'purchase')),
  status text not null,
  contact_id uuid not null references contacts(id),
  document_number text not null,
  document_date date not null,
  due_date date,
  order_number text,
  reference text,
  vat_number text,
  title text,
  category_id uuid not null references categories(id),
  currency text not null default 'LAK',
  exchange_rate numeric(18, 8) not null default 1,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, document_number)
);

create table if not exists document_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  product_id uuid references products(id),
  name text not null,
  description text,
  unit text not null default 'unit',
  quantity numeric(18, 4) not null check (quantity > 0),
  unit_price numeric(18, 2) not null check (unit_price >= 0),
  discount numeric(18, 2) not null default 0,
  discount_type text not null default 'percentage' check (discount_type in ('percentage', 'amount')),
  tax_id uuid references taxes(id),
  tax_name_snapshot text,
  tax_rate_snapshot numeric(9, 4) not null default 0
);

create table if not exists document_tags (
  document_id uuid not null references documents(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete restrict,
  primary key (document_id, tag_id)
);

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  owner_type text not null check (owner_type in ('cash_transaction', 'document')),
  owner_id text not null,
  name text not null,
  mime_type text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  storage_path text,
  created_at timestamptz not null default now()
);

create table if not exists journal_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  entry_date date not null,
  reference text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references journal_entries(id) on delete cascade,
  account_id uuid not null references accounts(id),
  debit numeric(18, 2) not null default 0 check (debit >= 0),
  credit numeric(18, 2) not null default 0 check (credit >= 0),
  description text,
  check (debit > 0 or credit > 0),
  check (not (debit > 0 and credit > 0))
);

create table if not exists saved_report_filters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  report_key text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists action_contracts (
  key text primary key,
  permission text not null,
  risk text not null check (risk in ('low', 'medium', 'high')),
  requires_confirmation boolean not null default false,
  dry_run_available boolean not null default true,
  enabled boolean not null default true
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_type text not null check (actor_type in ('user', 'ai_agent', 'system')),
  actor_id uuid,
  action text not null,
  risk text not null check (risk in ('low', 'medium', 'high')),
  target_type text not null,
  target_id text not null,
  summary text not null,
  created_at timestamptz not null default now()
);

create index if not exists cash_transactions_org_date_idx on cash_transactions (organization_id, transaction_date desc);
create index if not exists documents_org_status_idx on documents (organization_id, kind, status);
create index if not exists journal_entries_org_date_idx on journal_entries (organization_id, entry_date desc);
create index if not exists audit_logs_org_created_idx on audit_logs (organization_id, created_at desc);
create index if not exists attachments_owner_idx on attachments (owner_type, owner_id);
create unique index if not exists saved_report_filters_org_name_idx on saved_report_filters (organization_id, lower(name));
