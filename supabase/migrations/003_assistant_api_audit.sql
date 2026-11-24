-- Audit log for the assistant machine API (/api/assistant/*).
-- Service role only. No anon or authenticated policies: the dashboard does
-- not read this table from the browser.
-- Apply in the Supabase SQL editor or with the Supabase CLI. Do not treat
-- this file as already applied.

create table if not exists assistant_api_audit (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  key_id text not null,
  method text not null,
  path text not null,
  action text not null,
  status_code integer not null,
  target_table text,
  target_id text,
  request_bytes integer,
  error text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists assistant_api_audit_key_created_idx
  on assistant_api_audit (key_id, created_at desc);

alter table assistant_api_audit enable row level security;

revoke all on table assistant_api_audit from anon, authenticated;
grant select, insert, update, delete on table assistant_api_audit to service_role;
