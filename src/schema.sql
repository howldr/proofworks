-- howldr ProofWorks
-- Postgres schema (mirrors current Supabase production schema + tenancy)
--
-- Apply with: npm run migrate
-- Safe to re-run: every object uses IF NOT EXISTS / CREATE OR REPLACE.
-- tenant_id is added additively (nullable + backfilled). The NOT NULL +
-- composite UNIQUE/FK rewiring is deferred to a later migration once
-- db.js learns to scope queries by tenant_id.

-- ─── Tenants ─────────────────────────────────────────────────────────────────
-- Multi-tenancy: every policy and child row belongs to exactly one tenant.
-- The 'default' tenant is seeded for single-tenant deploys and as the
-- backfill home for any pre-tenancy rows.

create table if not exists tenants (
  id                   bigserial   primary key,
  slug                 text        not null unique,
  name                 text        not null,
  custom_domain        text        unique,
  lf_share_name        text        not null,
  lf_api_key_encrypted text,
  status               text        not null default 'active'
    check (status in ('active','suspended')),
  created_at           timestamptz not null default now()
);

create index if not exists idx_tenants_slug          on tenants (slug);
create index if not exists idx_tenants_custom_domain on tenants (custom_domain);

insert into tenants (slug, name, lf_share_name)
values ('default', 'Default Tenant', 'policies')
on conflict (slug) do nothing;

-- Per-tenant reminder/review cadence. Defaults match the historical
-- deployment-wide env values, so behaviour is unchanged until a tenant edits
-- them. Additive + idempotent for existing installs.
alter table tenants add column if not exists review_advance_notice_days integer  not null default 30;
alter table tenants add column if not exists review_grace_period_days   integer  not null default 30;
alter table tenants add column if not exists acceptance_reminder_days   integer[] not null default '{3,7,14}';
alter table tenants add column if not exists governance_lead_email       text;

-- Optional module entitlements (the evidence spine, tenancy, auth, staff, and
-- settings are core and always on). Default grants Policy Hub; existing tenants
-- backfill to it via the column default. Enforcement reads this column only —
-- how it gets set (scripts/set-entitlements.js, hosted or self-hosted) is
-- decoupled. See src/modules.js.
alter table tenants add column if not exists entitlements text[] not null default '{policy_hub}';

-- ─── App users (ProofWorks UI users — owners, authorisers, etc.) ────────────
-- One row per Supabase Auth user that has access to ProofWorks. The id
-- column matches auth.users.id (uuid). Staff who only receive policy
-- acknowledgement messages don't get rows here — they authenticate via
-- LiquidFiles + signed JWT click-throughs and never touch the app UI.
--
-- Role enum:
--   admin           — tenant-wide; create policies, manage users, see all
--   owner           — per-policy assignment; submit / distribute / retire
--   authoriser      — per-policy assignment; approve / return
--   governance_lead — tenant-wide; receives overdue escalations, audit access
--   acceptor        — a named signer: accepts risks where they are the
--                     acceptor, gives executive sign-off on policies where
--                     they are the exec, decides/attests access reviews where
--                     they are the reviewer. Sees the Risk Register and Access
--                     Reviews, plus only the policies assigned to them —
--                     signing authority without register-wide management.
--   staff           — the workforce: people policies are distributed TO. They
--                     accept via LiquidFiles and normally never need an app
--                     account; if given one, they see the ACTIVE policy
--                     register only — no drafts, workflow, audit spine, or
--                     governance modules. Deliberately a separate category
--                     from viewer: an employee is not an auditor.
--   viewer          — tenant-wide read-only OBSERVERS: auditors, external
--                     assessors, SIEM/service integrations. Sees everything
--                     (incl. the audit spine); changes nothing.
--   howldr_support  — cross-tenant; tenant_id is NULL; for howldr-internal
--                     support and admin work. Middleware will bypass tenant
--                     filtering and log every access separately.

create table if not exists app_users (
  id          uuid        primary key,
  email       text        not null unique,
  tenant_id   bigint      references tenants(id) on delete cascade,
  role        text        not null check (role in (
                'admin','owner','authoriser','governance_lead','acceptor','staff','viewer','howldr_support'
              )),
  created_at  timestamptz not null default now(),
  -- howldr_support is cross-tenant (tenant_id NULL); every other role is tenant-scoped.
  check (
    (role = 'howldr_support' and tenant_id is null) or
    (role <> 'howldr_support' and tenant_id is not null)
  )
);

create index if not exists idx_app_users_tenant on app_users (tenant_id);
create index if not exists idx_app_users_email  on app_users (email);

-- ─── Policy ID allocation ────────────────────────────────────────────────────

create table if not exists policy_id_sequence (
  year          integer primary key,
  last_sequence integer not null default 0,
  tenant_id     bigint  references tenants(id)
);

-- ─── Policies ────────────────────────────────────────────────────────────────

create table if not exists policies (
  id                      bigserial   primary key,
  policy_id               text        not null unique,
  title                   text        not null,
  category                text,
  owner_email             text        not null,
  current_version         text        not null default 'v0.1',
  status                  text        not null default 'DRAFT'
    check (status in ('DRAFT','UNDER_REVIEW','OWNER_ACCEPTANCE','EXEC_REVIEW','PENDING_ACCEPTANCE','ACTIVE','RETIRED')),
  authorised_date         date,
  review_frequency_months integer     not null default 12,
  next_review_date        date,
  applicable_roles        text[]      not null default '{}',
  lf_folder_id_root       text,
  lf_folder_id_current    text,
  lf_folder_id_training   text,
  lf_folder_id_drafts     text,
  lf_folder_id_archive    text,
  lf_folder_id_acks       text,
  acknowledgement_count   integer     not null default 0,
  acknowledgement_total   integer     not null default 0,
  advance_notice_sent     boolean     not null default false,
  escalation_sent         boolean     not null default false,
  created_at              timestamptz not null default now(),
  last_updated            timestamptz not null default now(),
  tenant_id               bigint      references tenants(id)
);

create index if not exists idx_policies_status on policies (status);
create index if not exists idx_policies_owner  on policies (owner_email);
create index if not exists idx_policies_review on policies (next_review_date);

-- ─── Authorisers ─────────────────────────────────────────────────────────────

create table if not exists policy_authorisers (
  id          bigserial   primary key,
  policy_id   text        not null references policies(policy_id) on delete cascade,
  email       text        not null,
  approved_at timestamptz,
  returned_at timestamptz,
  feedback    text,
  created_at  timestamptz not null default now(),
  tenant_id   bigint      references tenants(id),
  unique (policy_id, email)
);

-- ─── Acknowledgements (per recipient, per version) ───────────────────────────

create table if not exists acknowledgements (
  id              bigserial     primary key,
  policy_id       text          not null references policies(policy_id) on delete cascade,
  version         text          not null,
  recipient_email text          not null,
  manager_email   text,
  lf_message_id   text,
  distributed_at  timestamptz   not null default now(),
  expires_at      date,
  acknowledged_at timestamptz,
  ip_address      text,
  download_count  integer,
  reminded_at     timestamptz[] not null default '{}',
  created_at      timestamptz   not null default now(),
  tenant_id       bigint        references tenants(id),
  unique (policy_id, version, recipient_email)
);

create index if not exists idx_acks_outstanding
  on acknowledgements (policy_id)
  where acknowledged_at is null;

-- ─── Outbound notifications ──────────────────────────────────────────────────

create table if not exists notifications (
  id              bigserial   primary key,
  policy_id       text        not null references policies(policy_id) on delete cascade,
  event_type      text        not null,
  recipient_email text,
  lf_message_id   text,
  version         text,
  sent_at         timestamptz not null default now(),
  tenant_id       bigint      references tenants(id)
);

create index if not exists idx_notifications_message on notifications (lf_message_id);

-- ─── Audit changelog ─────────────────────────────────────────────────────────

create table if not exists policy_changelog (
  id           bigserial   primary key,
  policy_id    text        not null references policies(policy_id) on delete cascade,
  event        text        not null,
  from_status  text,
  to_status    text,
  from_version text,
  to_version   text,
  actor_email  text,
  metadata     jsonb,
  created_at   timestamptz not null default now(),
  tenant_id    bigint      references tenants(id)
);

create index if not exists idx_changelog_policy on policy_changelog (policy_id);

-- ─── Tenancy migration for existing installs ─────────────────────────────────
-- No-ops on fresh installs (the columns/FKs are already declared above).
-- On pre-tenancy databases: adds the column + FK + indexes + backfills.

alter table policies           add column if not exists tenant_id bigint references tenants(id);
alter table policy_id_sequence add column if not exists tenant_id bigint references tenants(id);
alter table policy_authorisers add column if not exists tenant_id bigint references tenants(id);
alter table acknowledgements   add column if not exists tenant_id bigint references tenants(id);
alter table notifications      add column if not exists tenant_id bigint references tenants(id);
alter table policy_changelog   add column if not exists tenant_id bigint references tenants(id);

update policies           set tenant_id = (select id from tenants where slug = 'default') where tenant_id is null;
update policy_id_sequence set tenant_id = (select id from tenants where slug = 'default') where tenant_id is null;
update policy_authorisers set tenant_id = (select id from tenants where slug = 'default') where tenant_id is null;
update acknowledgements   set tenant_id = (select id from tenants where slug = 'default') where tenant_id is null;
update notifications      set tenant_id = (select id from tenants where slug = 'default') where tenant_id is null;
update policy_changelog   set tenant_id = (select id from tenants where slug = 'default') where tenant_id is null;

create index if not exists idx_policies_tenant            on policies           (tenant_id);
create index if not exists idx_policy_authorisers_tenant  on policy_authorisers (tenant_id);
create index if not exists idx_acks_tenant                on acknowledgements   (tenant_id);
create index if not exists idx_notifications_tenant       on notifications      (tenant_id);
create index if not exists idx_changelog_tenant           on policy_changelog   (tenant_id);

-- ─── Step 3: enforce tenant scoping ──────────────────────────────────────────
-- After step 1 added tenant_id columns and step 2 routed via req.tenant, this
-- step makes the constraints actually scope by tenant. Every block self-checks
-- before mutating so re-runs are no-ops.

-- Enforce NOT NULL on tenant_id (backfill from step 1 made this safe).
alter table policies            alter column tenant_id set not null;
alter table policy_id_sequence  alter column tenant_id set not null;
alter table policy_authorisers  alter column tenant_id set not null;
alter table acknowledgements    alter column tenant_id set not null;
alter table notifications       alter column tenant_id set not null;
alter table policy_changelog    alter column tenant_id set not null;

-- Drop the single-column FK from each child to policies(policy_id). The
-- constraint name is auto-generated, so look it up by shape rather than name.
do $$
declare
  t text;
  cname text;
begin
  foreach t in array array['policy_authorisers','acknowledgements','notifications','policy_changelog']
  loop
    for cname in
      select c.conname from pg_constraint c
      where c.conrelid = t::regclass
        and c.contype  = 'f'
        and c.confrelid = 'policies'::regclass
        and array_length(c.conkey, 1) = 1
    loop
      execute format('alter table %I drop constraint %I', t, cname);
    end loop;
  end loop;
end $$;

-- Drop the single-column UNIQUE on policies(policy_id).
do $$
declare
  cname text;
begin
  for cname in
    select c.conname
    from pg_constraint c
    join unnest(c.conkey) as ck(num) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = ck.num
    where c.conrelid = 'policies'::regclass
      and c.contype  = 'u'
      and array_length(c.conkey, 1) = 1
      and a.attname = 'policy_id'
  loop
    execute format('alter table policies drop constraint %I', cname);
  end loop;
end $$;

-- Add composite UNIQUE on policies(tenant_id, policy_id).
-- (Check pg_constraint rather than catch-on-fail — ADD CONSTRAINT UNIQUE
--  creates a backing index and can throw duplicate_table on a re-run,
--  which a duplicate_object handler wouldn't catch.)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'policies_tenant_policy_key') then
    alter table policies add constraint policies_tenant_policy_key unique (tenant_id, policy_id);
  end if;
end $$;

-- Add composite FKs on children → policies(tenant_id, policy_id).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'policy_authorisers_tenant_policy_fkey') then
    alter table policy_authorisers add constraint policy_authorisers_tenant_policy_fkey
      foreign key (tenant_id, policy_id) references policies(tenant_id, policy_id) on delete cascade;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'acknowledgements_tenant_policy_fkey') then
    alter table acknowledgements add constraint acknowledgements_tenant_policy_fkey
      foreign key (tenant_id, policy_id) references policies(tenant_id, policy_id) on delete cascade;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_tenant_policy_fkey') then
    alter table notifications add constraint notifications_tenant_policy_fkey
      foreign key (tenant_id, policy_id) references policies(tenant_id, policy_id) on delete cascade;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'policy_changelog_tenant_policy_fkey') then
    alter table policy_changelog add constraint policy_changelog_tenant_policy_fkey
      foreign key (tenant_id, policy_id) references policies(tenant_id, policy_id) on delete cascade;
  end if;
end $$;

-- Replace child UNIQUE constraints with tenant-prefixed versions.
do $$
declare
  cname text;
begin
  for cname in
    select c.conname from pg_constraint c
    where c.conrelid = 'policy_authorisers'::regclass
      and c.contype  = 'u'
      and array_length(c.conkey, 1) = 2
  loop
    execute format('alter table policy_authorisers drop constraint %I', cname);
  end loop;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'policy_authorisers_tenant_policy_email_key') then
    alter table policy_authorisers add constraint policy_authorisers_tenant_policy_email_key
      unique (tenant_id, policy_id, email);
  end if;
end $$;

do $$
declare
  cname text;
begin
  for cname in
    select c.conname from pg_constraint c
    where c.conrelid = 'acknowledgements'::regclass
      and c.contype  = 'u'
      and array_length(c.conkey, 1) = 3
  loop
    execute format('alter table acknowledgements drop constraint %I', cname);
  end loop;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'acknowledgements_tenant_policy_version_recipient_key') then
    alter table acknowledgements add constraint acknowledgements_tenant_policy_version_recipient_key
      unique (tenant_id, policy_id, version, recipient_email);
  end if;
end $$;

-- Restructure policy_id_sequence PK from (year) to (tenant_id, year).
do $$
begin
  if (select array_length(conkey, 1) from pg_constraint
      where conrelid = 'policy_id_sequence'::regclass and contype = 'p') = 1 then
    alter table policy_id_sequence drop constraint policy_id_sequence_pkey;
    alter table policy_id_sequence add primary key (tenant_id, year);
  end if;
end $$;

-- ─── Views ───────────────────────────────────────────────────────────────────
-- Join now includes tenant_id since policy_id is no longer globally unique.
--
-- This base declaration is superseded at the end of the file, where the view is
-- re-declared with the attestation columns appended. Because that end-of-file
-- version has MORE columns, a plain CREATE OR REPLACE here would fail on any
-- re-run ("cannot drop columns from view") by trying to shrink the existing
-- wider view back to this shape. Dropping first sidesteps the column-order rule
-- so the schema stays re-runnable; nothing depends on the view between here and
-- its final form.

drop view if exists outstanding_acceptances;
create view outstanding_acceptances as
  select
    a.policy_id,
    a.version,
    a.recipient_email,
    a.manager_email,
    a.lf_message_id,
    a.distributed_at,
    a.expires_at,
    a.reminded_at,
    (extract(day from (now() - a.distributed_at)))::int as days_elapsed,
    p.title,
    p.owner_email,
    p.status,
    a.tenant_id
  from acknowledgements a
  join policies p on p.tenant_id = a.tenant_id and p.policy_id = a.policy_id
  where a.acknowledged_at is null
    and p.status = 'PENDING_ACCEPTANCE';

create or replace view policies_due_for_review as
  select
    policy_id,
    title,
    owner_email,
    current_version,
    status,
    next_review_date,
    advance_notice_sent,
    (extract(day from (now() - next_review_date::timestamptz)))::int as days_overdue,
    tenant_id
  from policies
  where status in ('ACTIVE','UNDER_REVIEW')
    and next_review_date is not null;

-- ─── Review activity (async review loop) ─────────────────────────────────────
-- Comments + questions raised during a review, and per-reviewer read tracking.
-- Placed after the composite policies(tenant_id, policy_id) UNIQUE exists so
-- the composite FKs resolve on a fresh install.

create table if not exists policy_comments (
  id           bigserial   primary key,
  tenant_id    bigint      not null references tenants(id),
  policy_id    text        not null,
  version      text        not null,
  author_email text        not null,
  kind         text        not null default 'comment' check (kind in ('comment','question')),
  body         text        not null,
  created_at   timestamptz not null default now(),
  foreign key (tenant_id, policy_id) references policies(tenant_id, policy_id) on delete cascade
);

create index if not exists idx_policy_comments on policy_comments (tenant_id, policy_id, created_at);

create table if not exists policy_reads (
  id            bigserial   primary key,
  tenant_id     bigint      not null references tenants(id),
  policy_id     text        not null,
  version       text        not null,
  reader_email  text        not null,
  read_count    integer     not null default 1,
  first_read_at timestamptz not null default now(),
  last_read_at  timestamptz not null default now(),
  foreign key (tenant_id, policy_id) references policies(tenant_id, policy_id) on delete cascade,
  unique (tenant_id, policy_id, version, reader_email)
);

create index if not exists idx_policy_reads on policy_reads (tenant_id, policy_id, version);

-- ─── Distribution audiences (reusable recipient groups) ──────────────────────
-- Named lists of acknowledgement recipients (staff emails + optional manager
-- for escalation) so distribution picks a group instead of pasting emails.
-- An audience can also include ROLES: everyone in the staff directory holding
-- one of those roles is added when the group is expanded at send time (so the
-- acknowledgement rows still snapshot exactly who was included), minus any
-- EXCLUDED addresses. Role membership covers app-account holders only.

create table if not exists distribution_groups (
  id         bigserial   primary key,
  tenant_id  bigint      not null references tenants(id) on delete cascade,
  name       text        not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

alter table distribution_groups add column if not exists roles           text[] not null default '{}';
alter table distribution_groups add column if not exists excluded_emails text[] not null default '{}';

create table if not exists distribution_group_members (
  id            bigserial primary key,
  tenant_id     bigint    not null references tenants(id) on delete cascade,
  group_id      bigint    not null references distribution_groups(id) on delete cascade,
  email         text      not null,
  manager_email text,
  unique (group_id, email)
);

create index if not exists idx_dist_group_members on distribution_group_members (group_id);

-- ─── Authorisation routes: ordered stages + append-only approvals ─────────────
-- Authorisation is a ROUTE of ordered STAGES — parallel within a stage,
-- sequential between. Each stage carries a threshold: NULL = every member must
-- approve; integer N = a quorum of N. Membership stays on policy_authorisers
-- (each row tagged with its stage_position). Decisions are recorded append-only
-- in policy_approvals, pinned to the policy version (and, when the draft is
-- fetchable, its content hash) so a receipt proves exactly which version an
-- authoriser signed off — and a new review round (version bump on return)
-- starts clean without mutating history.
--
-- Placed after the composite policies(tenant_id, policy_id) UNIQUE so the
-- composite FKs resolve on a fresh install.

create table if not exists policy_auth_stages (
  id          bigserial   primary key,
  tenant_id   bigint      not null references tenants(id),
  policy_id   text        not null,
  position    integer     not null,
  threshold   integer,                 -- NULL = all members; else quorum count N
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, policy_id) references policies(tenant_id, policy_id) on delete cascade,
  unique (tenant_id, policy_id, position),   -- also serves as the lookup index
  check (threshold is null or threshold >= 1)
);

-- Tag each authoriser with the stage it belongs to. Default 1 keeps pre-routes
-- installs (a single implicit stage) working unchanged.
alter table policy_authorisers add column if not exists stage_position integer not null default 1;

create table if not exists policy_approvals (
  id               bigserial   primary key,
  tenant_id        bigint      not null references tenants(id),
  policy_id        text        not null,
  stage_position   integer     not null,
  authoriser_email text        not null,
  decision         text        not null check (decision in ('approved','returned')),
  version          text        not null,
  content_hash     text,
  feedback         text,
  created_at       timestamptz not null default now(),
  foreign key (tenant_id, policy_id) references policies(tenant_id, policy_id) on delete cascade
);

create index if not exists idx_policy_approvals
  on policy_approvals (tenant_id, policy_id, version, authoriser_email, created_at);

-- Deadline captured at submission, reused when notifying later stages as the
-- route advances (the approving authoriser doesn't re-supply it).
alter table policies add column if not exists review_expires_at date;

-- Backfill for pre-routes installs: give every policy that already has
-- authorisers a single stage at position 1 (threshold NULL = all), and migrate
-- the legacy overwritten approved_at/returned_at into append-only approval rows
-- so the history survives.
--
-- Idempotency is one-time-per-policy: the legacy approved_at/returned_at columns
-- are left in place (deprecated, no longer written or read) but persist forever,
-- so a version-keyed guard would re-insert them against a later current_version
-- on a future migration run. Guarding on "this policy has no policy_approvals
-- rows at all" instead means the backfill fires exactly once — before the app
-- records its first append-only decision — and never fights new-flow data.
insert into policy_auth_stages (tenant_id, policy_id, position, threshold)
select distinct pa.tenant_id, pa.policy_id, 1, null::integer
from policy_authorisers pa
where not exists (
  select 1 from policy_auth_stages s
  where s.tenant_id = pa.tenant_id and s.policy_id = pa.policy_id
);

insert into policy_approvals (tenant_id, policy_id, stage_position, authoriser_email, decision, version, feedback, created_at)
select
  pa.tenant_id, pa.policy_id, coalesce(pa.stage_position, 1), pa.email,
  case when pa.approved_at is not null then 'approved' else 'returned' end,
  p.current_version,
  case when pa.returned_at is not null then pa.feedback end,
  coalesce(pa.approved_at, pa.returned_at)
from policy_authorisers pa
join policies p on p.tenant_id = pa.tenant_id and p.policy_id = pa.policy_id
where (pa.approved_at is not null or pa.returned_at is not null)
  and not exists (
    select 1 from policy_approvals ap
    where ap.tenant_id = pa.tenant_id and ap.policy_id = pa.policy_id
  );

-- ─── Executive authorisation gate ─────────────────────────────────────────────
-- A category-triggered final tier. After all authorisers approve, a policy
-- whose category is in the tenant's exec_required_categories waits in
-- EXEC_REVIEW for its named executive (policies.exec_email) to authorise before
-- it can be distributed. The exec's decision lands in the same append-only,
-- version-pinned policy_approvals table under the reserved stage_position 0
-- (route stages are 1-based, so 0 never collides with an authoriser stage).

alter table policies add column if not exists exec_email text;
alter table tenants  add column if not exists exec_required_categories text[] not null default '{}';

-- ─── Owner-acceptance gate ────────────────────────────────────────────────────
-- An optional (per-tenant) tier between full authoriser consensus and the exec
-- gate: when tenants.owner_acceptance_required is on, a policy waits in
-- OWNER_ACCEPTANCE for its owner to explicitly accept the authorised version
-- before it advances. Default off preserves the historical accept-by-distribute
-- behaviour. The owner's decision is an append-only, version-pinned receipt in
-- policy_approvals under reserved stage_position -1 (authorisers 1+, exec 0).

alter table tenants add column if not exists owner_acceptance_required boolean not null default false;

-- Permit the new OWNER_ACCEPTANCE / EXEC_REVIEW statuses. The original inline
-- CHECK is auto-named policies_status_check; drop + re-add (idempotent — no
-- existing row uses the new values, and every old value is still allowed).
alter table policies drop constraint if exists policies_status_check;
alter table policies add constraint policies_status_check
  check (status in ('DRAFT','UNDER_REVIEW','OWNER_ACCEPTANCE','EXEC_REVIEW','PENDING_ACCEPTANCE','ACTIVE','RETIRED'));

-- ─── Hash-pinned receipts ─────────────────────────────────────────────────────
-- Pin the exact published document (LiquidFiles file id + checksum) to each
-- acknowledgement row at distribution time, so a receipt proves which bytes
-- the recipient downloaded — not just which version label.

alter table acknowledgements add column if not exists lf_file_id        text;
alter table acknowledgements add column if not exists document_checksum text;

-- ─── Explicit attestation ─────────────────────────────────────────────────────
-- Each acceptance row carries a high-entropy bearer token; the acceptance
-- message links to a public page where the recipient clicks "I have read and
-- accept". That click records attested_at — explicit agreement on top of the
-- download receipt. The token survives re-distribution (first one wins) so
-- links in earlier messages keep working.

alter table acknowledgements add column if not exists accept_token text;
alter table acknowledgements add column if not exists attested_at  timestamptz;
alter table acknowledgements add column if not exists attest_ip    text;

create unique index if not exists idx_acks_accept_token
  on acknowledgements (accept_token)
  where accept_token is not null;

-- Re-declare the outstanding view with the attestation columns appended.
-- Must stay AFTER the alters above (REPLACE VIEW may only append columns,
-- and the columns must exist by the time this runs on an existing install).
create or replace view outstanding_acceptances as
  select
    a.policy_id,
    a.version,
    a.recipient_email,
    a.manager_email,
    a.lf_message_id,
    a.distributed_at,
    a.expires_at,
    a.reminded_at,
    (extract(day from (now() - a.distributed_at)))::int as days_elapsed,
    p.title,
    p.owner_email,
    p.status,
    a.tenant_id,
    a.accept_token
  from acknowledgements a
  join policies p on p.tenant_id = a.tenant_id and p.policy_id = a.policy_id
  where a.acknowledged_at is null
    and p.status = 'PENDING_ACCEPTANCE';

-- ─── Evidence Locker (module: evidence_locker) ────────────────────────────────
-- A register of evidence items with the same guarantees policies have:
-- attributed, timestamped, hash-pinned, append-only. An item's proof comes in
-- three strengths, derived from what it carries (never stored, so it can't
-- drift):
--   held          — the file is on the tenant's share (lf_file_id + checksum)
--   fingerprinted — a SHA-256 captured at registration; bytes NOT stored
--                   ("proof not payload" — verify any produced copy later)
--   declared      — a locator/attestation only
-- Items are never deleted: they are RETIRED (or superseded by a newer item).
-- All mutations append to evidence_events.

create table if not exists evidence_id_sequence (
  tenant_id     bigint  not null references tenants(id),
  year          integer not null,
  last_sequence integer not null default 0,
  primary key (tenant_id, year)
);

create table if not exists evidence_items (
  id            bigserial   primary key,
  tenant_id     bigint      not null references tenants(id),
  evidence_id   text        not null,             -- EVD-YYYY-NNN
  title         text        not null,
  description   text,
  category      text,
  tags          text[]      not null default '{}',
  control_label text,                             -- declared mapping, e.g. 'ISO 27001 A.9.2'
  owner_email   text        not null,
  collected_at  date,
  expires_at    date,                             -- freshness: valid-until / next review
  locator       text,                             -- where it lives if not held (URL or free text)
  lf_file_id    text,                             -- held items: file on the tenant share
  lf_folder_id  text,
  file_name     text,
  file_size     bigint,
  checksum      text,                             -- sha256 (held + fingerprinted)
  status        text        not null default 'ACTIVE'
    check (status in ('ACTIVE','RETIRED')),
  superseded_by text,                             -- evidence_id of the replacement, if any
  created_by    text        not null,
  created_at    timestamptz not null default now(),
  unique (tenant_id, evidence_id)
);

create index if not exists idx_evidence_tenant   on evidence_items (tenant_id, status);
create index if not exists idx_evidence_category on evidence_items (tenant_id, category);
create index if not exists idx_evidence_expiry   on evidence_items (tenant_id, expires_at)
  where expires_at is not null;

create table if not exists evidence_events (
  id          bigserial   primary key,
  tenant_id   bigint      not null references tenants(id),
  evidence_id text        not null,
  event       text        not null,
  actor_email text,
  metadata    jsonb,
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, evidence_id)
    references evidence_items(tenant_id, evidence_id) on delete cascade
);

create index if not exists idx_evidence_events on evidence_events (tenant_id, evidence_id, created_at);

-- ─── Risk Register (module: risk_register) ────────────────────────────────────
-- Risks are assessed on a fixed 5×5 likelihood × impact matrix, twice per
-- round: INHERENT (before treatment) and RESIDUAL (after). Assessment rounds
-- are append-only — re-assessing starts a new round, never overwrites.
-- ACCEPTANCE is the spine tie-in: a named acceptor formally accepts the
-- residual risk, and the receipt is pinned to the assessment round it covered.
-- A newer round therefore visibly needs re-acceptance; nothing is recomputed
-- or mutated. Score bands (likelihood × impact, 1–25):
--   Low 1–4 · Medium 5–9 · High 10–15 · Critical 16–25

create table if not exists risk_id_sequence (
  tenant_id     bigint  not null references tenants(id),
  year          integer not null,
  last_sequence integer not null default 0,
  primary key (tenant_id, year)
);

create table if not exists risks (
  id               bigserial   primary key,
  tenant_id        bigint      not null references tenants(id),
  risk_id          text        not null,             -- RSK-YYYY-NNN
  title            text        not null,
  description      text,
  category         text,
  tags             text[]      not null default '{}',
  owner_email      text        not null,
  acceptor_email   text,                             -- null → the owner accepts
  next_review_date date,
  policy_ids       text[]      not null default '{}',  -- soft links to the controls
  evidence_ids     text[]      not null default '{}',  -- soft links to the proof
  status           text        not null default 'OPEN'
    check (status in ('OPEN','CLOSED')),
  created_by       text        not null,
  created_at       timestamptz not null default now(),
  unique (tenant_id, risk_id)
);

create index if not exists idx_risks_tenant   on risks (tenant_id, status);
create index if not exists idx_risks_category on risks (tenant_id, category);
create index if not exists idx_risks_review   on risks (tenant_id, next_review_date)
  where next_review_date is not null;

create table if not exists risk_assessments (
  id                  bigserial   primary key,
  tenant_id           bigint      not null references tenants(id),
  risk_id             text        not null,
  round               integer     not null,
  inherent_likelihood integer     not null check (inherent_likelihood between 1 and 5),
  inherent_impact     integer     not null check (inherent_impact     between 1 and 5),
  residual_likelihood integer     not null check (residual_likelihood between 1 and 5),
  residual_impact     integer     not null check (residual_impact     between 1 and 5),
  treatment           text        not null
    check (treatment in ('accept','mitigate','transfer','avoid')),
  treatment_notes     text,
  assessed_by         text        not null,
  created_at          timestamptz not null default now(),
  foreign key (tenant_id, risk_id) references risks(tenant_id, risk_id) on delete cascade,
  unique (tenant_id, risk_id, round)
);

create table if not exists risk_acceptances (
  id             bigserial   primary key,
  tenant_id      bigint      not null references tenants(id),
  risk_id        text        not null,
  round          integer     not null,               -- the assessment round accepted
  acceptor_email text        not null,
  notes          text,
  created_at     timestamptz not null default now(),
  foreign key (tenant_id, risk_id) references risks(tenant_id, risk_id) on delete cascade
);

create index if not exists idx_risk_acceptances on risk_acceptances (tenant_id, risk_id, round);

create table if not exists risk_events (
  id          bigserial   primary key,
  tenant_id   bigint      not null references tenants(id),
  risk_id     text        not null,
  event       text        not null,
  actor_email text,
  metadata    jsonb,
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, risk_id) references risks(tenant_id, risk_id) on delete cascade
);

create index if not exists idx_risk_events on risk_events (tenant_id, risk_id, created_at);

-- ─── Access Reviews (module: access_reviews) ──────────────────────────────────
-- CSV-first access attestation campaigns. A review names a SYSTEM and a
-- REVIEWER, and carries LINES (subject × resource × access, pasted from an
-- export). The reviewer decides each line — keep / flag / remove — and then
-- ATTESTS the whole review: an append-only receipt recording that a named
-- person certified the access list at a point in time, with the decision
-- counts pinned into the receipt. Line decisions are working state (re-decide
-- while OPEN is allowed); the attestation is the evidence event.

create table if not exists access_review_id_sequence (
  tenant_id     bigint  not null references tenants(id),
  year          integer not null,
  last_sequence integer not null default 0,
  primary key (tenant_id, year)
);

create table if not exists access_reviews (
  id               bigserial   primary key,
  tenant_id        bigint      not null references tenants(id),
  review_id        text        not null,             -- ARV-YYYY-NNN
  title            text        not null,
  system           text        not null,             -- what's being reviewed (e.g. 'Microsoft 365')
  description      text,
  reviewer_email   text        not null,             -- who decides + attests
  due_date         date,
  next_review_date date,                             -- when this should happen again
  status           text        not null default 'OPEN'
    check (status in ('OPEN','ATTESTED')),
  created_by       text        not null,
  created_at       timestamptz not null default now(),
  unique (tenant_id, review_id)
);

create index if not exists idx_access_reviews_tenant on access_reviews (tenant_id, status);
create index if not exists idx_access_reviews_due    on access_reviews (tenant_id, due_date)
  where due_date is not null;

create table if not exists access_review_lines (
  id            bigserial   primary key,
  tenant_id     bigint      not null references tenants(id),
  review_id     text        not null,
  subject       text        not null,                -- account / person under review
  resource      text        not null,                -- system / group / role
  access_detail text,                                -- permission level, notes from the export
  decision      text        check (decision in ('keep','flag','remove')),
  decision_note text,
  decided_by    text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  foreign key (tenant_id, review_id)
    references access_reviews(tenant_id, review_id) on delete cascade
);

create index if not exists idx_access_review_lines on access_review_lines (tenant_id, review_id, id);

create table if not exists access_review_attestations (
  id             bigserial   primary key,
  tenant_id      bigint      not null references tenants(id),
  review_id      text        not null,
  reviewer_email text        not null,
  notes          text,
  lines_total    integer     not null,
  lines_keep     integer     not null,
  lines_flag     integer     not null,
  lines_remove   integer     not null,
  created_at     timestamptz not null default now(),
  foreign key (tenant_id, review_id)
    references access_reviews(tenant_id, review_id) on delete cascade
);

create index if not exists idx_access_review_attestations
  on access_review_attestations (tenant_id, review_id, created_at);

-- ─── Audit event spine (core — not module-gated) ──────────────────────────────
-- The cross-module, append-only, hash-chained ledger (ADR 0003 §7–8). Every
-- module's instrumented action lands here in one normalized shape; the
-- per-module event tables above remain as module-local detail views.
--
-- Chain: event_hash = sha256(prev_hash + '\n' + canonical(core fields)),
-- prev_hash = the previous event's hash for the SAME tenant (per-tenant
-- chains; genesis prev_hash is 64 zeros). db.appendAuditEvent() serialises
-- appends per tenant with an advisory lock. See src/audit/spine.js.
--
-- Deliberately NO FK to the object tables: ledger rows must survive their
-- object (a deleted policy's history is still evidence). No ON DELETE CASCADE
-- from tenants either — tenants are never deleted (lapse → read-only).
--
-- WRITES are inserts only. The trigger below rejects UPDATE and DELETE at the
-- database layer so immutability doesn't depend on application discipline.

create table if not exists audit_events (
  id          bigserial   primary key,
  tenant_id   bigint      not null references tenants(id),
  occurred_at timestamptz not null,
  actor_email text,
  action      text        not null,
  object_type text        not null,
  object_id   text        not null,
  metadata    jsonb,
  prev_hash   text        not null check (length(prev_hash)  = 64),
  event_hash  text        not null check (length(event_hash) = 64),
  unique (tenant_id, event_hash)
);

create index if not exists idx_audit_events_tenant on audit_events (tenant_id, id);
create index if not exists idx_audit_events_object on audit_events (tenant_id, object_type, object_id, id);

create or replace function audit_events_immutable() returns trigger as $$
begin
  raise exception 'audit_events is append-only: % blocked', tg_op;
end
$$ language plpgsql;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_audit_events_immutable') then
    create trigger trg_audit_events_immutable
      before update or delete on audit_events
      for each row execute function audit_events_immutable();
  end if;
end $$;

-- ─── Vendor Assessments (module: vendor_assessments) ──────────────────────────
-- A vendor IS a risk until understood. Vendors are assessed on the same fixed
-- 5×5 likelihood × impact matrix as the Risk Register — inherent (before
-- safeguards) and residual (after) — in append-only rounds. The DECISION is
-- the receipt, and unlike a risk acceptance it is bidirectional: APPROVE
-- (engage, accepting the residual risk) or DECLINE (walk away — evaluating a
-- vendor and declining is itself audit-valuable evidence of due diligence).
-- A decision pins to the round it judged; re-assessing visibly reopens the
-- decision. Tier escalation (the category-triggered exec gate, in miniature):
-- HIGH and CRITICAL tier vendors can only be decided by an admin or
-- governance lead; below that, the named approver (falling back to the
-- relationship owner) suffices. Vendors are OFFBOARDED, never deleted.

create table if not exists vendor_id_sequence (
  tenant_id     bigint  not null references tenants(id),
  year          integer not null,
  last_sequence integer not null default 0,
  primary key (tenant_id, year)
);

create table if not exists vendors (
  id               bigserial   primary key,
  tenant_id        bigint      not null references tenants(id),
  vendor_id        text        not null,             -- VEN-YYYY-NNN
  name             text        not null,
  description      text,                             -- what they provide
  category         text,
  tags             text[]      not null default '{}',
  tier             text        not null default 'medium'
    check (tier in ('low','medium','high','critical')),
  data_scope       text,                             -- what data they touch — declared, not computed
  owner_email      text        not null,             -- relationship owner
  approver_email   text,                             -- null → the owner decides (tier gate still applies)
  next_review_date date,
  policy_ids       text[]      not null default '{}',  -- soft links: governing controls
  evidence_ids     text[]      not null default '{}',  -- soft links: their proof (SOC 2, DPA…)
  risk_ids         text[]      not null default '{}',  -- soft links: risks this vendor is a source of
  status           text        not null default 'OPEN'
    check (status in ('OPEN','OFFBOARDED')),
  created_by       text        not null,
  created_at       timestamptz not null default now(),
  unique (tenant_id, vendor_id)
);

create index if not exists idx_vendors_tenant   on vendors (tenant_id, status);
create index if not exists idx_vendors_category on vendors (tenant_id, category);
create index if not exists idx_vendors_review   on vendors (tenant_id, next_review_date)
  where next_review_date is not null;

create table if not exists vendor_assessments (
  id                  bigserial   primary key,
  tenant_id           bigint      not null references tenants(id),
  vendor_id           text        not null,
  round               integer     not null,
  inherent_likelihood integer     not null check (inherent_likelihood between 1 and 5),
  inherent_impact     integer     not null check (inherent_impact     between 1 and 5),
  residual_likelihood integer     not null check (residual_likelihood between 1 and 5),
  residual_impact     integer     not null check (residual_impact     between 1 and 5),
  treatment           text        not null
    check (treatment in ('accept','mitigate','transfer','avoid')),
  treatment_notes     text,
  assessed_by         text        not null,
  created_at          timestamptz not null default now(),
  foreign key (tenant_id, vendor_id) references vendors(tenant_id, vendor_id) on delete cascade,
  unique (tenant_id, vendor_id, round)
);

create table if not exists vendor_decisions (
  id            bigserial   primary key,
  tenant_id     bigint      not null references tenants(id),
  vendor_id     text        not null,
  round         integer     not null,               -- the assessment round judged
  decision      text        not null check (decision in ('approve','decline')),
  decider_email text        not null,
  notes         text,
  created_at    timestamptz not null default now(),
  foreign key (tenant_id, vendor_id) references vendors(tenant_id, vendor_id) on delete cascade
);

create index if not exists idx_vendor_decisions on vendor_decisions (tenant_id, vendor_id, round);

create table if not exists vendor_events (
  id          bigserial   primary key,
  tenant_id   bigint      not null references tenants(id),
  vendor_id   text        not null,
  event       text        not null,
  actor_email text,
  metadata    jsonb,
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, vendor_id) references vendors(tenant_id, vendor_id) on delete cascade
);

create index if not exists idx_vendor_events on vendor_events (tenant_id, vendor_id, created_at);

-- ─── Obligations Register (module: obligations) ───────────────────────────────
-- The UNDERSTANDING layer of the spine (Understanding → Method → Proof): an
-- obligation is a commitment the organisation must honour, named by its
-- SOURCE — a law, regulation, contract, insurance policy, standard, or an
-- internal commitment. Risks, policies, and evidence LINK BACK to the
-- obligations they answer, so every receipt in the audit pack traces to a
-- reason. An obligation with no links is visibly UNANSWERED. Obligations are
-- RETIRED, never deleted; sources renew (contracts, insurance), so each
-- carries a review date and an append-only event log.

create table if not exists obligation_id_sequence (
  tenant_id     bigint  not null references tenants(id),
  year          integer not null,
  last_sequence integer not null default 0,
  primary key (tenant_id, year)
);

create table if not exists obligations (
  id               bigserial   primary key,
  tenant_id        bigint      not null references tenants(id),
  obligation_id    text        not null,             -- OBL-YYYY-NNN
  title            text        not null,             -- the commitment itself
  description      text,
  source_type      text        not null
    check (source_type in ('law','regulation','contract','insurance','standard','internal')),
  source_name      text        not null,             -- e.g. "UK GDPR", "Cyber policy CP-2024-118"
  source_ref       text,                             -- article / clause, e.g. "Art. 33"
  owner_email      text        not null,             -- accountable person
  next_review_date date,                             -- when the source renews / gets re-checked
  policy_ids       text[]      not null default '{}',  -- soft links: the method
  risk_ids         text[]      not null default '{}',  -- soft links: what threatens it
  evidence_ids     text[]      not null default '{}',  -- soft links: the proof
  status           text        not null default 'ACTIVE'
    check (status in ('ACTIVE','RETIRED')),
  created_by       text        not null,
  created_at       timestamptz not null default now(),
  unique (tenant_id, obligation_id)
);

create index if not exists idx_obligations_tenant on obligations (tenant_id, status);
create index if not exists idx_obligations_source on obligations (tenant_id, source_type);
create index if not exists idx_obligations_review on obligations (tenant_id, next_review_date)
  where next_review_date is not null;

create table if not exists obligation_events (
  id            bigserial   primary key,
  tenant_id     bigint      not null references tenants(id),
  obligation_id text        not null,
  event         text        not null,
  actor_email   text,
  metadata      jsonb,
  created_at    timestamptz not null default now(),
  foreign key (tenant_id, obligation_id) references obligations(tenant_id, obligation_id) on delete cascade
);

create index if not exists idx_obligation_events on obligation_events (tenant_id, obligation_id, created_at);

-- ─── Workspace theme (core — presentation) ────────────────────────────────────
-- Curated preset picked by a tenant admin in Settings. NOT free-form CSS: a
-- theme is a named set of --brand token overrides shipped with the app, so a
-- client's presentation is customisable without arbitrary stylesheets on the
-- shared SPA. Known values live in src/themes.js (validated in the API, no DB
-- check so presets can grow without a migration).

alter table tenants add column if not exists theme text not null default 'howldr';

-- Workspace logo: a small data-URL image (validated + size-capped in the API,
-- ~64KB binary) shown in the app header with a discrete "by howldr" byline.
-- Stored inline — no file hosting, nothing to leak, deleted with the tenant.
alter table tenants add column if not exists logo_data_url text;

-- Custom theme accent: a single #rrggbb colour (validated in the API) used
-- when theme = 'custom' — typically generated from the workspace logo. The
-- SPA derives the full token set from this one colour, so it stays as
-- constrained as the presets: a colour, never arbitrary CSS.
alter table tenants add column if not exists theme_accent text;

-- ─── Staff + acceptor roles (workforce ≠ observers ≠ signers) ─────────────────
-- Permit the 'staff' role (the workforce policies are distributed to) and the
-- 'acceptor' role (named signers: risk acceptance, exec sign-off, access-review
-- attestation) as categories separate from 'viewer' (auditors / SIEM
-- observers). The original inline CHECK is auto-named app_users_role_check;
-- drop + re-add (idempotent — no existing row uses the new values, every old
-- value is still allowed).

alter table app_users drop constraint if exists app_users_role_check;
alter table app_users add constraint app_users_role_check
  check (role in ('admin','owner','authoriser','governance_lead','acceptor','staff','viewer','howldr_support'));
