-- builders-for-claude-code: core schema.
-- A New Zealand residential builder's job record: the clients, the jobs from
-- quote to handover, the budget lines that carry the estimate, the purchase
-- orders and costs against them, the variations, the progress claims, the
-- subbies with their insurance and licensing, the schedule, and the site diary.
--
-- Runs unchanged on PGlite (embedded) and on Postgres / Supabase.
--
-- The sharp edges are deliberate:
--   * a quote at or over $30,000 does not become an active job without a
--     signed written contract date on the record (Building Act 2004 s362F)
--   * a progress claim cannot take total claims past the contract value plus
--     APPROVED variations, and there is no force flag: unapproved variation
--     work is work you may never be paid for
--   * a subbie with expired (or no) public liability insurance does not get
--     assigned to a job, and restricted building work needs an LBP number
--   * a job cannot be marked complete while claims are unpaid, variations are
--     undecided, or purchase orders are still open.

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Clients ------------------------------------------------------------------------
-- The people and companies the builder works for. Every job and every dollar
-- claimed traces to one of these rows.

create table if not exists clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  contact_name  text,
  email         text,
  phone         text,
  address       text,
  status        text not null default 'active',   -- active | former
  note          text,
  external_ref  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists clients_name_lower_idx on clients (lower(name));

-- Jobs ---------------------------------------------------------------------------
-- One build, renovation or extension, from quote to handover. The contract
-- value plus APPROVED variations is the ceiling every progress claim is
-- checked against.

create table if not exists jobs (
  id                  uuid primary key default gen_random_uuid(),
  ref                 text unique,               -- JOB-101
  client_id           uuid not null references clients(id) on delete cascade,
  name                text not null,
  site_address        text,
  job_type            text not null default 'new_build',  -- new_build | renovation | extension | other
  status              text not null default 'quote',      -- quote | active | complete | lost
  quoted_on           date,
  contract_value      numeric not null default 0,
  contract_signed_on  date,                      -- Building Act 2004 s362F: required at $30k+
  retention_pct       numeric not null default 0,
  started_on          date,
  completed_on        date,
  note                text,
  external_ref        text unique,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists jobs_client_idx on jobs (client_id);
create index if not exists jobs_status_idx on jobs (status);

-- Budget lines ---------------------------------------------------------------------------
-- The estimate, kept alive as the budget. Every purchase order and every cost
-- lands on one of these, so budget vs actual is a join, not a spreadsheet
-- rebuilt every month.

create table if not exists budget_lines (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references jobs(id) on delete cascade,
  cost_code     text not null,                   -- '03', '07' ... sort order on the report
  name          text not null,                   -- Framing, Roofing, Electrical
  budget        numeric not null default 0,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (job_id, cost_code, name)
);
create index if not exists budget_lines_job_idx on budget_lines (job_id);

-- Purchase orders ---------------------------------------------------------------------------
-- Committed money: ordered but not yet invoiced. An open PO is spend the
-- budget report must count before the invoice arrives, or the line looks
-- healthier than it is.

create table if not exists purchase_orders (
  id              uuid primary key default gen_random_uuid(),
  ref             text unique,                   -- PO-301
  job_id          uuid not null references jobs(id) on delete cascade,
  budget_line_id  uuid not null references budget_lines(id) on delete cascade,
  supplier        text not null,
  amount          numeric not null,
  issued_on       date not null default current_date,
  status          text not null default 'open',  -- open | billed | cancelled
  billed_on       date,
  note            text,
  external_ref    text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists purchase_orders_job_idx on purchase_orders (job_id);

-- Costs ---------------------------------------------------------------------------
-- Actual money: the invoice, the till receipt, the subbie's bill. Every cost
-- lands on a job AND a budget line; that is the entire discipline job costing
-- exists for, and the schema will not let it slip.

create table if not exists costs (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references jobs(id) on delete cascade,
  budget_line_id     uuid not null references budget_lines(id) on delete cascade,
  purchase_order_id  uuid references purchase_orders(id) on delete set null,
  incurred_on        date not null default current_date,
  supplier           text,
  invoice_ref        text,
  amount             numeric not null,
  note               text,
  external_ref       text unique,
  created_at         timestamptz not null default now()
);
create index if not exists costs_job_idx on costs (job_id);
create index if not exists costs_line_idx on costs (budget_line_id);

-- Variations ---------------------------------------------------------------------------
-- The margin killer of the whole industry. A variation is priced, put to the
-- client, and APPROVED IN WRITING before the work happens: only approved
-- variations raise the contract ceiling the claims are checked against.

create table if not exists variations (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,                     -- VAR-201
  job_id        uuid not null references jobs(id) on delete cascade,
  description   text not null,
  price         numeric not null,
  cost_estimate numeric not null default 0,
  proposed_on   date not null default current_date,
  status        text not null default 'proposed',  -- proposed | approved | declined
  decided_on    date,
  approved_by   text,                            -- who said yes, in writing
  note          text,
  external_ref  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists variations_job_idx on variations (job_id);

-- Progress claims ---------------------------------------------------------------------------
-- The Construction Contracts Act 2002 payment claim, as data: served on a
-- date, due on a date, paid or loudly overdue. Total claims never pass the
-- contract plus approved variations; the CLI refuses and there is no force flag.

create table if not exists progress_claims (
  id              uuid primary key default gen_random_uuid(),
  ref             text unique,                   -- PC-401
  job_id          uuid not null references jobs(id) on delete cascade,
  claimed_on      date not null default current_date,
  amount          numeric not null,
  retention_held  numeric not null default 0,
  due_on          date not null,
  status          text not null default 'served',  -- served | paid
  paid_on         date,
  amount_paid     numeric not null default 0,
  note            text,
  external_ref    text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists progress_claims_job_idx on progress_claims (job_id);

-- Subbies ---------------------------------------------------------------------------
-- The trades. Public liability insurance lives here because an uninsured
-- subbie on an active site is the business's uncapped risk, and an LBP number
-- lives here because restricted building work legally requires one.

create table if not exists subbies (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  trade                 text not null,           -- electrical, plumbing, framing ...
  contact_name          text,
  email                 text,
  phone                 text,
  liability_expires_on  date,                    -- public liability insurance expiry
  lbp_number            text,                    -- Licensed Building Practitioner, for restricted work
  status                text not null default 'active',   -- active | former
  note                  text,
  external_ref          text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists subbies_name_lower_idx on subbies (lower(name));

-- Job assignments ---------------------------------------------------------------------------
-- Which subbie is on which job, for what scope and price, and whether the
-- scope is restricted building work. The insurance and LBP gates live at the
-- door of this table.

create table if not exists job_subbies (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references jobs(id) on delete cascade,
  subbie_id        uuid not null references subbies(id) on delete cascade,
  scope            text not null,
  agreed_price     numeric not null default 0,
  restricted_work  boolean not null default false,  -- Building Act 2004 RBW: needs an LBP
  assigned_on      date not null default current_date,
  created_at       timestamptz not null default now(),
  unique (job_id, subbie_id, scope)
);
create index if not exists job_subbies_job_idx on job_subbies (job_id);

-- Tasks ---------------------------------------------------------------------------
-- The schedule, plain: what happens on which job, when, and whose trade it is.

create table if not exists tasks (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references jobs(id) on delete cascade,
  name        text not null,
  trade       text,
  subbie_id   uuid references subbies(id) on delete set null,
  starts_on   date not null,
  ends_on     date not null,
  status      text not null default 'planned',   -- planned | done
  done_on     date,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists tasks_job_idx on tasks (job_id);

-- The site diary ---------------------------------------------------------------------------
-- Calls, decisions, weather, deliveries, instructions: against a client, a
-- job or a subbie. In a dispute, the diary is the builder's memory and defence.

create table if not exists notes (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients(id) on delete set null,
  job_id      uuid references jobs(id) on delete set null,
  subbie_id   uuid references subbies(id) on delete set null,
  noted_on    date not null default current_date,
  note        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists notes_job_idx on notes (job_id);
create index if not exists notes_client_idx on notes (client_id);

-- updated_at triggers ------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['clients','jobs','budget_lines','purchase_orders','variations','progress_claims','subbies','tasks']
  loop
    execute format('drop trigger if exists %I on %I', t || '_updated_at', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
  end loop;
end
$$;

-- =====================================================================================
-- Views: the questions a builder asks every Monday, as SQL anyone can read.
-- =====================================================================================

-- Jobs with the whole money story on one line: contract, approved variations,
-- claimed, paid, actual costs, committed POs, and the margin the job is
-- actually tracking to.
create or replace view v_jobs as
select
  j.id as job_id,
  j.ref,
  j.name as job,
  c.name as client,
  c.id as client_id,
  j.site_address,
  j.job_type,
  j.status,
  j.quoted_on,
  (current_date - j.quoted_on) as days_since_quoted,
  j.contract_value,
  j.contract_signed_on,
  j.retention_pct,
  j.started_on,
  j.completed_on,
  (select coalesce(sum(v.price), 0) from variations v where v.job_id = j.id and v.status = 'approved') as approved_variations,
  (select count(*) from variations v where v.job_id = j.id and v.status = 'proposed') as proposed_variations,
  j.contract_value + (select coalesce(sum(v.price), 0) from variations v where v.job_id = j.id and v.status = 'approved') as revised_contract,
  (select coalesce(sum(pc.amount), 0) from progress_claims pc where pc.job_id = j.id) as claimed,
  (select coalesce(sum(pc.amount_paid), 0) from progress_claims pc where pc.job_id = j.id) as paid,
  (select coalesce(sum(pc.amount), 0) from progress_claims pc where pc.job_id = j.id and pc.status = 'served') as outstanding,
  (select coalesce(sum(pc.retention_held), 0) from progress_claims pc where pc.job_id = j.id) as retention_held,
  (select coalesce(sum(bl.budget), 0) from budget_lines bl where bl.job_id = j.id) as budget_total,
  (select coalesce(sum(co.amount), 0) from costs co where co.job_id = j.id) as costs_actual,
  (select coalesce(sum(po.amount), 0) from purchase_orders po where po.job_id = j.id and po.status = 'open') as committed,
  j.contract_value
    + (select coalesce(sum(v.price), 0) from variations v where v.job_id = j.id and v.status = 'approved')
    - (select coalesce(sum(co.amount), 0) from costs co where co.job_id = j.id)
    - (select coalesce(sum(po.amount), 0) from purchase_orders po where po.job_id = j.id and po.status = 'open') as forecast_margin,
  (select max(n.noted_on) from notes n where n.job_id = j.id) as last_diary_on,
  (current_date - coalesce((select max(n.noted_on) from notes n where n.job_id = j.id), j.started_on, j.quoted_on)) as days_quiet,
  (select max(pc.claimed_on) from progress_claims pc where pc.job_id = j.id) as last_claimed_on
from jobs j
join clients c on c.id = j.client_id;

-- Budget vs actual vs committed per line, with the state loud.
create or replace view v_budget as
select
  bl.id as line_id,
  j.ref as job_ref,
  j.job_id,
  j.job,
  j.client,
  j.status as job_status,
  bl.cost_code,
  bl.name as line,
  bl.budget,
  (select coalesce(sum(co.amount), 0) from costs co where co.budget_line_id = bl.id) as actual,
  (select coalesce(sum(po.amount), 0) from purchase_orders po where po.budget_line_id = bl.id and po.status = 'open') as committed,
  bl.budget
    - (select coalesce(sum(co.amount), 0) from costs co where co.budget_line_id = bl.id)
    - (select coalesce(sum(po.amount), 0) from purchase_orders po where po.budget_line_id = bl.id and po.status = 'open') as remaining,
  case
    when (select coalesce(sum(co.amount), 0) from costs co where co.budget_line_id = bl.id)
       + (select coalesce(sum(po.amount), 0) from purchase_orders po where po.budget_line_id = bl.id and po.status = 'open') > bl.budget then 'OVER'
    when bl.budget > 0 and ((select coalesce(sum(co.amount), 0) from costs co where co.budget_line_id = bl.id)
       + (select coalesce(sum(po.amount), 0) from purchase_orders po where po.budget_line_id = bl.id and po.status = 'open')) / bl.budget > 0.9 then 'near'
    else 'ok'
  end as state
from budget_lines bl
join v_jobs j on j.job_id = bl.job_id;

-- Variations with the waiting time loud. A proposed variation is work someone
-- is probably already doing for free.
create or replace view v_variations as
select
  v.id as variation_id,
  v.ref,
  j.ref as job_ref,
  j.job,
  j.client,
  v.description,
  v.price,
  v.cost_estimate,
  v.proposed_on,
  (current_date - v.proposed_on) as days_waiting,
  v.status,
  v.decided_on,
  v.approved_by
from variations v
join v_jobs j on j.job_id = v.job_id;

-- Progress claims with the Construction Contracts Act clock running.
create or replace view v_claims as
select
  pc.id as claim_id,
  pc.ref,
  j.ref as job_ref,
  j.job,
  j.client,
  pc.claimed_on,
  pc.amount,
  pc.retention_held,
  pc.due_on,
  pc.status,
  pc.paid_on,
  pc.amount_paid,
  (current_date - pc.due_on) as days_overdue,
  case
    when pc.status = 'paid' then 'paid'
    when pc.due_on < current_date then 'OVERDUE'
    else 'served'
  end as state
from progress_claims pc
join v_jobs j on j.job_id = pc.job_id;

-- Subbies with the insurance and licensing state loud, and where they are.
create or replace view v_subbies as
select
  s.id as subbie_id,
  s.name,
  s.trade,
  s.contact_name,
  s.phone,
  s.liability_expires_on,
  (s.liability_expires_on - current_date) as days_to_expiry,
  case
    when s.liability_expires_on is null then 'NONE'
    when s.liability_expires_on < current_date then 'EXPIRED'
    when s.liability_expires_on <= current_date + 30 then 'expiring'
    else 'current'
  end as insurance,
  s.lbp_number,
  s.status,
  (select count(*) from job_subbies js join jobs j on j.id = js.job_id where js.subbie_id = s.id and j.status = 'active') as active_jobs
from subbies s;

-- The schedule with the slippage loud.
create or replace view v_tasks as
select
  t.id as task_id,
  j.ref as job_ref,
  j.job,
  t.name as task,
  t.trade,
  s.name as subbie,
  t.starts_on,
  t.ends_on,
  t.status,
  t.done_on,
  (current_date - t.ends_on) as days_late,
  case
    when t.status = 'done' then 'done'
    when t.ends_on < current_date then 'LATE'
    when t.starts_on <= current_date then 'in progress'
    else 'planned'
  end as state
from tasks t
join v_jobs j on j.job_id = t.job_id
left join subbies s on s.id = t.subbie_id;

-- Everything that wants a decision, one union, worst first. An overdue payment
-- claim outranks everything: it is your money, and the Act's clock is running.
create or replace view v_attention as
-- A served claim past its due date.
select 'claim_overdue' as reason, pc.ref as label, pc.client, pc.job as place,
       pc.days_overdue as days,
       to_char(pc.amount, 'FM999,999,990') || ' claimed ' || to_char(pc.claimed_on, 'YYYY-MM-DD') || ', due ' ||
       to_char(pc.due_on, 'YYYY-MM-DD') || ': ' || pc.days_overdue || ' days overdue. The Act gives you remedies; use them' as detail
from v_claims pc
where pc.state = 'OVERDUE'
union all
-- A variation still proposed: work someone may be doing for free.
select 'variation_unapproved', v.ref, v.client, v.job,
       v.days_waiting,
       'proposed ' || to_char(v.proposed_on, 'YYYY-MM-DD') || ' at ' || to_char(v.price, 'FM999,999,990') ||
       ': no variation work, and no claiming it, until it is approved in writing'
from v_variations v
where v.status = 'proposed'
union all
-- A subbie with expired insurance on an active job.
select 'insurance_expired', s.name, '', j.ref || ' ' || j.job,
       abs(s.days_to_expiry),
       s.trade || ' with public liability ' || case when s.liability_expires_on is null then 'NOT ON RECORD' else 'expired ' || to_char(s.liability_expires_on, 'YYYY-MM-DD') end ||
       ', assigned to an active job: an incident today is uninsured'
from v_subbies s
join job_subbies js on js.subbie_id = s.subbie_id
join v_jobs j on j.job_id = js.job_id and j.status = 'active'
where s.insurance in ('EXPIRED', 'NONE')
union all
-- A budget line spent past its budget.
select 'budget_over', b.job_ref, b.client, b.line,
       null,
       to_char(b.actual + b.committed, 'FM999,999,990') || ' actual + committed against ' || to_char(b.budget, 'FM999,999,990') ||
       ' budgeted (' || to_char(b.actual + b.committed - b.budget, 'FM999,999,990') || ' over): the margin is leaking here'
from v_budget b
where b.state = 'OVER' and b.job_status = 'active'
union all
-- Retention still held after handover.
select 'retention_due', j.ref, j.client, j.job,
       (current_date - j.completed_on),
       to_char(j.retention_held, 'FM999,999,990') || ' retention held, job complete ' || to_char(j.completed_on, 'YYYY-MM-DD') ||
       ': release it or account for it, it is trust money'
from v_jobs j
where j.status = 'complete' and j.retention_held > 0 and j.completed_on < current_date - 60
union all
-- A quote going cold.
select 'quote_stale', j.ref, j.client, j.job,
       j.days_since_quoted,
       'quoted ' || to_char(j.quoted_on, 'YYYY-MM-DD') || ' at ' || to_char(j.contract_value, 'FM999,999,990') ||
       ' with no decision for ' || j.days_since_quoted || ' days: ring them or lose it'
from v_jobs j
where j.status = 'quote' and j.days_since_quoted > 14
union all
-- An active job with costs mounting and no claim served in 30 days.
select 'claim_gap', j.ref, j.client, j.job,
       (current_date - coalesce(j.last_claimed_on, j.started_on)),
       'no progress claim for ' || (current_date - coalesce(j.last_claimed_on, j.started_on)) ||
       ' days while costs run at ' || to_char(j.costs_actual, 'FM999,999,990') || ': work done and unclaimed is an interest-free loan to the client'
from v_jobs j
where j.status = 'active'
  and coalesce(j.last_claimed_on, j.started_on) < current_date - 30
  and j.claimed < j.revised_contract
union all
-- An open purchase order aged past 30 days.
select 'po_aged', po.ref, po.supplier, j.ref || ' ' || j.job,
       (current_date - po.issued_on),
       'open ' || (current_date - po.issued_on) || ' days at ' || to_char(po.amount, 'FM999,999,990') ||
       ': bill it, chase it, or cancel it, committed money should not float'
from purchase_orders po
join v_jobs j on j.job_id = po.job_id
where po.status = 'open' and po.issued_on < current_date - 30
union all
-- A task past its end date and not done.
select 'task_late', t.job_ref, coalesce(t.subbie, t.trade, ''), t.task,
       t.days_late,
       'should have finished ' || to_char(t.ends_on, 'YYYY-MM-DD') || ' (' || t.days_late || ' days ago): every late task pushes the claim behind it'
from v_tasks t
where t.state = 'LATE'
union all
-- An active job with a silent site diary.
select 'job_quiet', j.ref, j.client, j.job,
       j.days_quiet,
       'no site diary entry for ' || j.days_quiet || ' days: in a dispute, the diary is the defence, and right now it is blank'
from v_jobs j
where j.status = 'active' and j.days_quiet > 14
union all
-- Insurance expiring inside 30 days on an assigned subbie.
select 'insurance_expiring', s.name, '', j.ref || ' ' || j.job,
       s.days_to_expiry,
       s.trade || ' public liability expires ' || to_char(s.liability_expires_on, 'YYYY-MM-DD') || ': chase the renewal certificate now'
from v_subbies s
join job_subbies js on js.subbie_id = s.subbie_id
join v_jobs j on j.job_id = js.job_id and j.status = 'active'
where s.insurance = 'expiring';
