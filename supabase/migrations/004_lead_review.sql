-- Lead review status and private still images.
-- Review is a human decision only. It does not enroll a workflow, send email,
-- or open a deal. Images live in the private Supabase Storage bucket
-- `lead-stills` and are served through authenticated API routes.
-- Apply in the Supabase SQL editor. Do not treat this file as already applied.

alter table leads add column if not exists review_status text not null default 'not_reviewed';
alter table leads add column if not exists review_comment text;
alter table leads add column if not exists reviewed_at timestamptz;

do $$ begin
  alter table leads add constraint leads_review_status_check
    check (review_status in ('not_reviewed', 'approved', 'needs_changes'));
exception when duplicate_object then null; end $$;

create table if not exists lead_images (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  storage_key text not null,
  content_type text not null,
  byte_size integer not null,
  filename text,
  created_by text not null default 'human',
  created_at timestamptz not null default now()
);

create index if not exists lead_images_lead_created_idx
  on lead_images (lead_id, created_at desc);

alter table lead_images enable row level security;
revoke all on table lead_images from anon, authenticated;
grant select, insert, update, delete on table lead_images to service_role;

insert into storage.buckets (id, name, public)
values ('lead-stills', 'lead-stills', false)
on conflict (id) do nothing;
