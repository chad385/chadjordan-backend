-- CRM hardening for the manual outreach practice.
-- Apply in the Supabase SQL editor AFTER 004_lead_review.sql and BEFORE
-- deploying the worker that expects these objects.
-- Safe to run more than once.

-- Pipeline stage names. Deals stay on the same rows; only the label changes.
update pipeline_stages as stage
set name = renamed.new_name
from pipelines as pipeline,
     (values
       ('New', 'Researched'),
       ('Nurturing', 'Audit sent'),
       ('Call Booked', 'In conversation'),
       ('Proposal', 'Strategy session'),
       ('Negotiation', 'Won')
     ) as renamed(old_name, new_name)
where stage.pipeline_id = pipeline.id
  and pipeline.is_default
  and stage.name = renamed.old_name;

-- Lead mail comes from hello@. System alerts stay on alerts@.
update backend_settings
set value = jsonb_set(
      jsonb_set(
        case
          when coalesce(value->>'alert_from_email', '') = ''
            then value || '{"alert_from_email":"alerts@chadjordan.studio"}'::jsonb
          else value
        end,
        '{from_email}',
        case
          when value->>'from_email' in ('alerts@chadjordan.studio', 'you@yourdomain.com')
            then '"hello@chadjordan.studio"'::jsonb
          else to_jsonb(value->>'from_email')
        end
      ),
      '{reply_to}',
      case
        when coalesce(value->>'reply_to', '') in ('', 'you@yourdomain.com')
          then '"hello@chadjordan.studio"'::jsonb
        else to_jsonb(value->>'reply_to')
      end
    ),
    updated_at = now()
where key = 'crm_sender';

-- Articles stop generating a hero until this row is set back to automatic.
update brand_context
set content = 'text_only', updated_at = now()
where category = 'content'
  and key = 'article_image_mode'
  and content = 'automatic';

-- Per-key capture rate limit. Service role only.
create table if not exists capture_rate_events (
  id uuid primary key default gen_random_uuid(),
  key_fingerprint text not null,
  created_at timestamptz not null default now()
);

create index if not exists capture_rate_events_fingerprint_created_idx
  on capture_rate_events (key_fingerprint, created_at desc);

alter table capture_rate_events enable row level security;
revoke all on table capture_rate_events from anon, authenticated;
grant select, insert, update, delete on table capture_rate_events to service_role;
